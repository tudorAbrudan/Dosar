/**
 * Rezolvă numele entității afișate pentru un document, prioritizând entitatea
 * primară conform `DOC_PRIMARY_ENTITY[doc.type]`. Dacă lipsește, încearcă în
 * ordine: vehicul → persoană → proprietate → animal → firmă → card.
 *
 * Diferență față de `useEntities().resolveEntityName`: aici acceptăm un
 * Document și ne uităm la `_id` field-urile lui (nu link-uri explicite). Mai
 * mult — returnăm `null` la entitate lipsă (în loc de ID-ul ca string), util
 * pentru UI care vrea să sară afișarea când nu există entitate asociată.
 */
import { DOC_PRIMARY_ENTITY } from '@/types';
import type { Document, EntityType } from '@/types';

interface EntityCollections {
  persons: { id: string; name: string }[];
  properties: { id: string; name: string }[];
  vehicles: { id: string; name: string }[];
  cards: { id: string; nickname?: string | null; last4: string }[];
  animals: { id: string; name: string }[];
  companies: { id: string; name: string }[];
}

// Ordine fallback: vehicul → persoană → proprietate → animal → firmă → card.
// Diferă intenționat de `ALL_ENTITY_TYPES` (care e ordinea afișării UI):
// aici căutăm entitatea „mai relevantă" pentru un document, prioritizând
// vehiculul. Schimbarea ordinii ar schimba ce nume apare pe Home/Expirări.
// check-hardcoded-entities-disable-next-cluster
const FALLBACK_ORDER: readonly EntityType[] = [
  'vehicle',
  'person',
  'property',
  'animal',
  'company',
  'card',
];

export function resolveDocumentEntityName(
  doc: Document,
  entities: EntityCollections
): string | null {
  // check-hardcoded-entities-disable-next-cluster
  function getByType(type: EntityType): string | null {
    switch (type) {
      case 'vehicle':
        return doc.vehicle_id
          ? (entities.vehicles.find(v => v.id === doc.vehicle_id)?.name ?? null)
          : null;
      case 'person':
        return doc.person_id
          ? (entities.persons.find(p => p.id === doc.person_id)?.name ?? null)
          : null;
      case 'property':
        return doc.property_id
          ? (entities.properties.find(p => p.id === doc.property_id)?.name ?? null)
          : null;
      case 'animal':
        return doc.animal_id
          ? (entities.animals.find(a => a.id === doc.animal_id)?.name ?? null)
          : null;
      case 'company':
        return doc.company_id
          ? (entities.companies.find(c => c.id === doc.company_id)?.name ?? null)
          : null;
      case 'card': {
        if (!doc.card_id) return null;
        const c = entities.cards.find(card => card.id === doc.card_id);
        return c ? `${c.nickname ?? ''} ····${c.last4}`.trim() : null;
      }
      default:
        return null;
    }
  }

  const primary = DOC_PRIMARY_ENTITY[doc.type];
  if (primary) {
    const name = getByType(primary);
    if (name) return name;
  }

  for (const type of FALLBACK_ORDER) {
    const name = getByType(type);
    if (name) return name;
  }
  return null;
}
