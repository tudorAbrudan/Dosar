/**
 * Identificator scurt și „sigur" pentru un document, folosit ca subtitlu în
 * listele de documente (Home „Adăugate recent", ecranul Documente, tab-ul
 * Documente din dosarul medical).
 *
 * Scop: diferențiază două documente de același tip (ex. mai multe „Analize
 * medicale") FĂRĂ a scurge date personale. Nota brută a unui document conține
 * adesea linii „CNP: …", „Nume: …" — afișarea primei linii din notă scurgea PII
 * în listă. Funcția asta sare câmpurile personale și preferă emitentul
 * (laborator/clinică/spital), apoi prima pereche „Câmp: Valoare" ne-personală.
 *
 * Returnează `null` dacă nu găsește un identificator util — apelantul decide
 * fallback-ul (eticheta tipului sau data emiterii).
 */

// Câmpuri personale care NU trebuie afișate în listă (PII).
const PERSONAL_FIELD_PATTERN =
  /^(pacient|nume|prenume|cnp|adres[aă]|jude[tț]|cas|cod\s*pacient|sex(ul)?|v[aâ]rsta|telefon|email|data\s*na[sș]terii|n[aă]scut[aă]?|asigurat[aă]?|tip\s*document|document)\b/i;
// Linie care numește direct emitentul documentului.
const ISSUER_LINE_PATTERN =
  /^(laborator(?:ul)?|clinic[aă]|spital(?:ul)?|cabinet(?:ul)?\s*medical|cabinet|unitate\s*medical[aă]|emitent|furnizor|medic|doctor|policlinic[aă]|centru\s*medical)\s*[:\-]\s*(.+)/i;
const FIELD_VALUE_PATTERN = /^([^:]+?)\s*:\s*(.+)$/;
// O valoare care e doar o dată nu e un identificator util.
const DATE_ONLY_PATTERN = /^\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}$|^\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}$/;

function isUsefulIdentifier(value: string): boolean {
  const v = value.trim();
  if (v.length < 2) return false;
  if (DATE_ONLY_PATTERN.test(v)) return false;
  return true;
}

function stripLinePrefix(line: string): string {
  return line.replace(/^[\s\-•*·▪►‐-―\d.()]+/, '').trim();
}

export interface IdentifiableDoc {
  note?: string | null;
  metadata?: Record<string, string> | null;
}

/**
 * Extrage un identificator scurt (emitent sau primă valoare ne-personală) sau
 * `null`. Nu include niciodată câmpuri personale (CNP, nume, adresă etc.).
 */
export function getDocumentIdentifier(doc: IdentifiableDoc): string | null {
  const m = doc.metadata;
  if (m) {
    for (const key of [
      'lab',
      'clinic',
      'clinica',
      'supplier',
      'unitate_medicala',
      'spital',
      'cabinet',
      'emitent',
      'furnizor',
    ]) {
      const v = m[key];
      if (typeof v === 'string' && isUsefulIdentifier(v)) return v.trim();
    }
  }
  if (doc.note?.trim()) {
    const lines = doc.note.split('\n').map(stripLinePrefix).filter(Boolean);
    for (const line of lines) {
      const match = line.match(ISSUER_LINE_PATTERN);
      if (match && match[2] && isUsefulIdentifier(match[2])) return match[2].trim();
    }
    for (const line of lines) {
      const fv = line.match(FIELD_VALUE_PATTERN);
      if (!fv) continue;
      if (PERSONAL_FIELD_PATTERN.test(fv[1].trim())) continue;
      const value = fv[2].trim();
      if (isUsefulIdentifier(value)) return value;
    }
  }
  return null;
}

/** Formatează o dată ISO scurt în RO (ex. „3 mar. 2026"). */
export function formatDocDateRoShort(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString('ro-RO', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}
