/**
 * Verificări de acoperire legală a unei mașini la adăugarea unui document:
 * suprapunere de valabilitate (dublură) + obligații lipsă/expirate.
 * Read-only — nu scrie nimic.
 */
import type { Document, DocumentType } from '@/types';
import { buildVehicleLegalStatus, type LegalObligation } from './vehicleStatus';

/** Tipuri repetabile pentru care suprapunerea e relevantă. */
const OVERLAP_TYPES: ReadonlySet<DocumentType> = new Set<DocumentType>(['rca', 'vigneta', 'casco']);

export interface OverlapCandidate {
  type: DocumentType;
  issue_date?: string;
  expiry_date?: string;
  excludeId?: string;
}

/**
 * Întoarce documentul existent de același tip a cărui valabilitate se suprapune
 * cu candidatul (ai deja o acoperire validă peste perioada nouă). `null` dacă
 * tipul nu e repetabil, candidatul n-are expirare, sau nu există suprapunere.
 * Alege documentul cu expirarea cea mai târzie (cel mai „valid").
 */
export function findOverlappingDoc(
  documents: Document[],
  candidate: OverlapCandidate
): Document | null {
  if (!OVERLAP_TYPES.has(candidate.type) || !candidate.expiry_date) return null;
  const start = candidate.issue_date ?? new Date().toISOString().slice(0, 10);
  const matches = documents.filter(
    d =>
      d.type === candidate.type &&
      d.id !== candidate.excludeId &&
      d.expiry_date != null &&
      // existentul e încă valid la momentul în care începe noul document
      d.expiry_date >= start
  );
  if (matches.length === 0) return null;
  return matches.reduce((latest, d) =>
    (d.expiry_date ?? '') > (latest.expiry_date ?? '') ? d : latest
  );
}

/**
 * Obligațiile legale (RCA/ITP/Rovinietă) care sunt `missing` sau `expired`,
 * excluzând tipul tocmai adăugat (nu te avertiza despre ce ai pus chiar acum).
 */
export function findMissingObligations(
  documents: Document[],
  justAddedType: DocumentType,
  today: Date,
  notificationDays: number
): LegalObligation[] {
  return buildVehicleLegalStatus(documents, today, notificationDays).filter(
    o => o.key !== justAddedType && (o.status === 'missing' || o.status === 'expired')
  );
}
