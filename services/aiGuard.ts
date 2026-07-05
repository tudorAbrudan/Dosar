/**
 * Guard central pentru trimiterea documentelor la analiză AI (classify /
 * extracție câmpuri / vision) din ecranele de adăugare / editare document.
 *
 * Regula de bază (vezi `.claude/rules/ai-privacy.md`):
 * - Documentele medicale (Art. 9 GDPR) NU pleacă la un provider REMOTE fără
 *   consimțământ explicit pe dosarul medical al persoanei legate
 *   (`medical_record.ai_consent_at`) + toggle global AI medical. Pe un model
 *   LOCAL (on-device) nimic nu părăsește dispozitivul → permis.
 * - Tipurile personale sensibile (buletin, pașaport, card etc. — vezi
 *   `ocrConsent.SENSITIVE_TYPES`) pe provider REMOTE cer consimțământ per-tip
 *   la prima utilizare. Pe LOCAL nu cerem.
 * - Restul (tip non-medical, non-sensibil, nelegat de un dosar medical) merge
 *   pe consimțământul generic AI (verificat deja de vizibilitatea butonului
 *   „Analiză AI").
 *
 * UN SINGUR loc — orice flux nou care trimite conținut de document la AI din
 * `app/` sau `components/` trebuie să treacă prin `ensureAiAnalysisAllowed`.
 * Verificat automat de `scripts/medical-ai-guard-audit.js`.
 */
import { Alert } from 'react-native';
import { MEDICAL_DOC_TYPES, STANDARD_DOC_TYPES, DOCUMENT_TYPE_LABELS } from '@/types';
import type { DocumentType, DocumentEntityLink } from '@/types';
import { getAiConfig } from './aiProvider';
import { getAiMedicalAllowed } from './settings';
import { getMedicalRecord, getMedicalRecordByPersonId } from './medicalRecord';
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

type MedicalRecordResolution = { id: string; ai_consent_at: string | null } | null;

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
    if (r) return { id: r.id, ai_consent_at: r.ai_consent_at };
  }
  const links = entityLinks ?? [];
  const direct = links.find(l => l.entityType === 'medical_record');
  if (direct) {
    const r = await getMedicalRecord(direct.entityId);
    if (r) return { id: r.id, ai_consent_at: r.ai_consent_at };
  }
  const person = links.find(l => l.entityType === 'person');
  if (person) {
    const r = await getMedicalRecordByPersonId(person.entityId);
    if (r) return { id: r.id, ai_consent_at: r.ai_consent_at };
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
                  'Documentele de acest tip nu vor fi trimise la AI. Poți schimba din Setări.',
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
  const isLocal = config.type === 'local';

  const isMedical =
    MEDICAL_DOC_TYPES.has(ctx.docType) ||
    (ctx.entityLinks?.some(l => l.entityType === 'medical_record') ?? false);

  if (isMedical) {
    // Pe model local nimic nu părăsește dispozitivul.
    if (isLocal) return { allowed: true };

    const record = await resolveLinkedMedicalRecord(ctx.entityLinks, ctx.recordIdHint);
    if (record?.ai_consent_at) {
      // Consimțământ per-dosar acordat — respectăm și override-ul global.
      const globallyAllowed = await getAiMedicalAllowed();
      if (globallyAllowed) return { allowed: true };
      return {
        allowed: false,
        reason:
          'Analiza AI pentru date medicale este dezactivată global. Activeaz-o din Setări → Asistent AI → Date medicale.',
      };
    }
    if (record) {
      return {
        allowed: false,
        reason:
          'Acest document medical nu poate fi trimis la asistentul AI fără consimțământ. Deschide dosarul medical al persoanei și activează asistentul AI (Date medicale), sau folosește un model local.',
      };
    }
    return {
      allowed: false,
      reason:
        'Documentele medicale nu se trimit la un asistent AI extern fără consimțământ. Atașează documentul la un dosar medical și activează acolo asistentul AI, sau alege un model local din Setări → Asistent AI.',
    };
  }

  // Tipuri personale sensibile pe provider remote → consimțământ per-tip.
  if (!isLocal && getDocTypeSensitivity(ctx.docType) === 'sensitive') {
    const choice = await getPerTypeConsent(ctx.docType);
    if (choice === 'deny') {
      return {
        allowed: false,
        reason:
          'Ai ales să nu trimiți acest tip de document la AI. Poți schimba din Setări dacă te răzgândești.',
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
  if (config.type === 'local') return candidates;

  const record = await resolveLinkedMedicalRecord(entityLinks, recordIdHint);
  const medicalAllowed = !!record?.ai_consent_at && (await getAiMedicalAllowed());
  if (medicalAllowed) return candidates;

  const base = candidates ?? STANDARD_DOC_TYPES;
  return base.filter(t => !MEDICAL_DOC_TYPES.has(t));
}
