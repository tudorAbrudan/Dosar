/**
 * Guard central pentru trimiterea documentelor la analiză AI (classify /
 * extracție câmpuri / vision) din ecranele de adăugare / editare document.
 *
 * Regula de bază (vezi `.claude/rules/ai-privacy.md`):
 * - Documentele medicale (Art. 9 GDPR) NU pleacă de pe telefon fără
 *   consimțământ explicit pe dosarul medical al persoanei legate
 *   (`medical_record.ai_consent_at`) + toggle global AI medical. Dacă nimic nu
 *   părăsește dispozitivul (model local FĂRĂ provider OCR remote) → permis.
 * - Tipurile personale sensibile (buletin, pașaport, card etc. — vezi
 *   `ocrConsent.SENSITIVE_TYPES`) care pleacă de pe telefon cer consimțământ
 *   per-tip la prima utilizare.
 * - „Pleacă de pe telefon" se decide DOAR din `getAiRoute` — un model local cu
 *   provider OCR remote trimite pozele în cloud, deci NU e tratat ca local.
 * - Restul (tip non-medical, non-sensibil, nelegat de un dosar medical) merge
 *   pe consimțământul generic AI (verificat deja de vizibilitatea butonului
 *   „Analiză AI").
 *
 * UN SINGUR loc — orice flux nou care trimite conținut de document la AI din
 * `app/` sau `components/` trebuie să treacă prin unul dintre gate-urile de aici:
 * - `ensureAiAnalysisAllowed` — butonul manual „Trimite documentul la AI";
 * - `ensureAutoAiAllowed` — completarea automată la atașarea documentului;
 * - `getScanAiAccess` — scanări cu scop precis (bon carburant, factură utilități).
 * Verificat automat de `scripts/medical-ai-guard-audit.js` (la nivel de funcție).
 */
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MEDICAL_DOC_TYPES, STANDARD_DOC_TYPES, DOCUMENT_TYPE_LABELS } from '@/types';
import type { DocumentType, DocumentEntityLink } from '@/types';
import {
  AI_CONSENT_KEY,
  aiRouteLeavesDevice,
  getAiConfig,
  getAiRoute,
  validateConfig,
} from './aiProvider';
import { getAiMedicalAllowed } from './settings';
import {
  getMedicalRecord,
  getMedicalRecordByPersonId,
  isMedicalAiConsentValid,
} from './medicalRecord';
import { getDocTypeSensitivity, getPerTypeConsent, setPerTypeConsent } from './ocrConsent';

export interface AiAnalysisContext {
  /** Tipul (rezolvat) al documentului care va fi trimis la AI. */
  docType: DocumentType;
  /** Legăturile curente ale documentului (din picker sau din DB la editare). */
  entityLinks?: DocumentEntityLink[];
  /** Hint direct pentru dosarul medical (ex. `params.medical_record_id`). */
  recordIdHint?: string | null;
}

export interface AiGuardResult {
  allowed: boolean;
  /**
   * Mesaj în română de afișat userului când `allowed === false`. `undefined`
   * înseamnă „blocat fără mesaj" (userul a ales explicit „Nu acum") — caller-ul
   * nu afișează niciun Alert în acest caz.
   */
  reason?: string;
}

type MedicalRecordResolution = { id: string; consentValid: boolean } | null;

/**
 * Rezolvă dosarul medical relevant pentru un document, în aceeași ordine ca
 * `medicalExtractor.extractFromDocument`: hint explicit → link direct
 * `medical_record` → persoana legată (relație 1:1). Returnează `null` dacă
 * documentul nu e (încă) asociat vreunui dosar medical.
 */
async function resolveLinkedMedicalRecord(
  entityLinks: DocumentEntityLink[] | undefined,
  recordIdHint: string | null | undefined
): Promise<MedicalRecordResolution> {
  if (recordIdHint) {
    const r = await getMedicalRecord(recordIdHint);
    if (r) return { id: r.id, consentValid: isMedicalAiConsentValid(r) };
  }
  const links = entityLinks ?? [];
  const direct = links.find(l => l.entityType === 'medical_record');
  if (direct) {
    const r = await getMedicalRecord(direct.entityId);
    if (r) return { id: r.id, consentValid: isMedicalAiConsentValid(r) };
  }
  const person = links.find(l => l.entityType === 'person');
  if (person) {
    const r = await getMedicalRecordByPersonId(person.entityId);
    if (r) return { id: r.id, consentValid: isMedicalAiConsentValid(r) };
  }
  return null;
}

/**
 * Afișează Alert-ul de consimțământ per-tip pentru un tip sensibil pe provider
 * remote. Trei opțiuni: Permite (persistă „allow"), Nu acum (nepersistat →
 * blocat o dată, fără mesaj), Nu întreba din nou (persistă „deny").
 */
function promptSensitiveConsent(docType: DocumentType): Promise<AiGuardResult> {
  const label = DOCUMENT_TYPE_LABELS[docType] ?? docType;
  return new Promise(resolve => {
    Alert.alert(
      'Trimiți documentul la AI?',
      `„${label}" conține date personale. Le trimiți la asistentul AI pentru analiză? Alegerea se aplică tuturor documentelor de acest tip.`,
      [
        {
          text: 'Nu acum',
          style: 'cancel',
          onPress: () => resolve({ allowed: false }),
        },
        {
          text: 'Nu întreba din nou',
          style: 'destructive',
          onPress: () => {
            void setPerTypeConsent(docType, 'deny').then(() =>
              resolve({
                allowed: false,
                reason:
                  'Documentele de acest tip nu vor fi trimise la AI. Poți schimba din Setări → Asistent AI → „Resetează alegerile pentru documente sensibile".',
              })
            );
          },
        },
        {
          text: 'Permite',
          onPress: () => {
            void setPerTypeConsent(docType, 'allow').then(() => resolve({ allowed: true }));
          },
        },
      ]
    );
  });
}

/**
 * Verifică dacă documentul (cu tipul `docType`) poate fi trimis la analiză AI.
 * Poate afișa un Alert interactiv (consimțământ per-tip sensibil). Vezi
 * documentația din capul fișierului pentru reguli.
 */
export async function ensureAiAnalysisAllowed(ctx: AiAnalysisContext): Promise<AiGuardResult> {
  const config = await getAiConfig();
  const staysOnDevice = !aiRouteLeavesDevice(getAiRoute(config));

  const isMedical =
    MEDICAL_DOC_TYPES.has(ctx.docType) ||
    (ctx.entityLinks?.some(l => l.entityType === 'medical_record') ?? false);

  if (isMedical) {
    // Nimic nu părăsește dispozitivul (model local, fără provider OCR remote).
    if (staysOnDevice) return { allowed: true };

    const record = await resolveLinkedMedicalRecord(ctx.entityLinks, ctx.recordIdHint);
    if (record?.consentValid) {
      // Consimțământ per-dosar acordat — respectăm și override-ul global.
      const globallyAllowed = await getAiMedicalAllowed();
      if (globallyAllowed) return { allowed: true };
      return {
        allowed: false,
        reason:
          'Asistentul AI pe dosarele medicale e oprit din Setări → Asistent AI. Pornește-l de acolo.',
      };
    }
    if (record) {
      return {
        allowed: false,
        reason:
          'Acest document medical nu pleacă la AI fără acordul tău pe dosar. Deschide dosarul medical al persoanei → Chat → „Activează AI pentru acest dosar", sau folosește modelul local.',
      };
    }
    return {
      allowed: false,
      reason:
        'Documentele medicale nu pleacă la AI în cloud fără acord. Atașează documentul la un dosar medical și activează acolo asistentul AI, sau alege modelul local din Setări → Asistent AI.',
    };
  }

  // Tipuri personale sensibile care pleacă de pe telefon → consimțământ per-tip.
  if (!staysOnDevice && getDocTypeSensitivity(ctx.docType) === 'sensitive') {
    const choice = await getPerTypeConsent(ctx.docType);
    if (choice === 'deny') {
      return {
        allowed: false,
        reason:
          'Ai ales să nu trimiți acest tip de document la AI. Poți schimba din Setări → Asistent AI → „Resetează alegerile pentru documente sensibile".',
      };
    }
    if (choice === null) return promptSensitiveConsent(ctx.docType);
    return { allowed: true }; // 'allow'
  }

  // Non-medical, non-sensibil → consimțământul generic (deja verificat de
  // vizibilitatea butonului „Analiză AI") e suficient.
  return { allowed: true };
}

/**
 * Filtrează candidații pentru clasificarea AI: pe provider REMOTE fără
 * consimțământ medical în contextul curent, elimină tipurile medicale din
 * listă. Astfel clasificatorul nu poate eticheta documentul ca medical și nu
 * escaladează la fluxul de extracție medicală remote.
 *
 * Notă privacy (varianta „mai puțin invazivă"): imaginea trimisă la classify
 * intră sub consimțământul generic AI (butonul „Analiză AI" nu apare fără el).
 * Un document filat explicit într-un context non-medical rămâne tratat ca
 * non-medical; un document realmente medical trebuie atașat la un dosar medical,
 * unde `ensureAiAnalysisAllowed` blochează complet fără consimțământ.
 */
export async function filterMedicalCandidatesForAi(
  candidates: DocumentType[] | undefined,
  entityLinks: DocumentEntityLink[] | undefined,
  recordIdHint?: string | null
): Promise<DocumentType[] | undefined> {
  const config = await getAiConfig();
  if (!aiRouteLeavesDevice(getAiRoute(config))) return candidates;

  const record = await resolveLinkedMedicalRecord(entityLinks, recordIdHint);
  const medicalAllowed = !!record?.consentValid && (await getAiMedicalAllowed());
  if (medicalAllowed) return candidates;

  const base = candidates ?? STANDARD_DOC_TYPES;
  return base.filter(t => !MEDICAL_DOC_TYPES.has(t));
}

/** Acordul general pentru AI în cloud (bifat în Setări → Asistent AI sau la onboarding). */
export async function hasCloudAiConsent(): Promise<boolean> {
  return (await AsyncStorage.getItem(AI_CONSENT_KEY)) === 'true';
}

/**
 * Completarea automată la atașarea unui document (fără apăsare de buton).
 *
 * - Rulează DOAR când textul ajunge în cloud (Dosar AI / cheie proprie). Pe
 *   modelul local, încărcarea GGUF în timpul OCR-ului ducea la jetsam pe
 *   telefoanele de 6GB (analiza 2026-07).
 * - Cere acordul general AI.
 * - Aceleași reguli de privacy ca butonul manual (`ensureAiAnalysisAllowed`):
 *   medical fără consimțământ pe dosar → nu; tip sensibil → întrebare per tip.
 * - Apelantul trimite DOAR text: poza pleacă numai când userul o cere explicit.
 *
 * Refuzul e silențios (`reason` lipsește): completarea automată nu deranjează
 * cu alerte; butonul manual rămâne și explică motivul dacă e apăsat.
 */
export async function ensureAutoAiAllowed(ctx: AiAnalysisContext): Promise<AiGuardResult> {
  const config = await getAiConfig();
  if (validateConfig(config) !== null) return { allowed: false };
  if (getAiRoute(config).text !== 'cloud') return { allowed: false };
  if (!(await hasCloudAiConsent())) return { allowed: false };
  const result = await ensureAiAnalysisAllowed(ctx);
  return result.allowed ? result : { allowed: false };
}

export interface ScanAiAccess {
  /** AI-ul poate fi folosit pentru scanarea curentă. */
  useAi: boolean;
  /** Poza poate fi trimisă (configurația citește imagini, cu acord pentru cloud). */
  withImage: boolean;
}

/**
 * Scanări cu scop precis, pornite explicit de user (bon de carburant, factură
 * de utilități) — documente fără date personale sensibile. AI doar dacă e
 * configurat și, când ceva pleacă de pe telefon, cu acordul general AI.
 */
export async function getScanAiAccess(): Promise<ScanAiAccess> {
  const config = await getAiConfig();
  if (validateConfig(config) !== null) return { useAi: false, withImage: false };
  const route = getAiRoute(config);
  if (aiRouteLeavesDevice(route) && !(await hasCloudAiConsent())) {
    return { useAi: false, withImage: false };
  }
  return { useAi: true, withImage: route.images === 'cloud' };
}
