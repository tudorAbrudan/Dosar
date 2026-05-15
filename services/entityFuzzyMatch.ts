/**
 * Fuzzy match local pentru entitate dintr-un text OCR.
 *
 * Folosit ca fallback când AI-ul nu sugerează nicio entitate explicit:
 * caută substringul numelui (normalizat fără diacritice) în textul OCR și
 * întoarce match-ul cu cel mai lung nume găsit. Card-urile sunt excluse —
 * numerele de card nu se potrivesc nominal cu textul OCR.
 */

import type { EntityType } from '@/types';

interface EntityCandidate {
  id: string;
  name: string;
}

export interface EntityMatchSources {
  persons: EntityCandidate[];
  vehicles: EntityCandidate[];
  properties: EntityCandidate[];
  animals: EntityCandidate[];
  companies: EntityCandidate[];
}

export interface EntityMatchResult {
  entityType: EntityType;
  entityId: string;
  /** Lungimea numelui matched — folosit ca scor pentru a alege cel mai specific. */
  score: number;
}

/** Minim caractere pentru a evita match accidental pe silabe scurte. */
const MIN_SCORE = 3;

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchEntityInOcr(
  ocrText: string,
  sources: EntityMatchSources
): EntityMatchResult | null {
  const normOcr = normalize(ocrText);
  const candidates: EntityMatchResult[] = [];

  const check = (entityType: EntityType, items: EntityCandidate[]) => {
    for (const item of items) {
      const normName = normalize(item.name);
      if (normName.length < 2) continue;
      if (normOcr.includes(normName)) {
        candidates.push({ entityType, entityId: item.id, score: normName.length });
      }
    }
  };

  // check-hardcoded-entities-disable-next-cluster
  // Cardurile sunt sărite intenționat — nu se potrivesc nominal cu textul OCR.
  check('person', sources.persons);
  check('vehicle', sources.vehicles);
  check('property', sources.properties);
  check('animal', sources.animals);
  check('company', sources.companies);

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (best.score < MIN_SCORE) return null;
  return best;
}
