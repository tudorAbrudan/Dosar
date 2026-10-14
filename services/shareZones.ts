/**
 * Ce tipuri de entități se partajează și cum se numesc zonele lor CloudKit.
 * Modul frunză (doar `@/types`): îl folosesc sharing.ts, cloudShare.ts și resetarea
 * registrului fără să intre în ciclul sharing → documents → cloudSync → backup.
 */
import { ALL_ENTITY_TYPES } from '@/types';
import type { EntityType } from '@/types';

// `medical_record`: flux propriu criptat, nu se partajează ca entitate.
// `card`: exclus by default (poate purta note sensibile) — opt-in în Faza 3
// (open question din spec §8).
// Mapări service-layer entityType→(set excludere / tabel) de mai jos: chei
// EntityType legitime, NU duplicare de labels UI. Vezi dynamic-types.md.
// check-hardcoded-entities-disable-next-cluster
const NON_SHAREABLE_ENTITY_TYPES: ReadonlySet<EntityType> = new Set<EntityType>([
  'medical_record',
  'card',
]);

export type ShareableEntityType = Exclude<EntityType, 'medical_record' | 'card'>;

export const SHAREABLE_ENTITY_TYPES: EntityType[] = ALL_ENTITY_TYPES.filter(
  t => !NON_SHAREABLE_ENTITY_TYPES.has(t)
);

export function isShareableEntityType(t: EntityType): boolean {
  return !NON_SHAREABLE_ENTITY_TYPES.has(t);
}

// entityType → tabel SQLite. Cheile sunt un enum validat (NU input user), deci
// interpolarea numelui de tabel în query e sigură față de injection.
// check-hardcoded-entities-disable-next-cluster
const ENTITY_TABLE: Record<ShareableEntityType, string> = {
  person: 'persons',
  property: 'properties',
  vehicle: 'vehicles',
  animal: 'animals',
  company: 'companies',
};

/** Tabelul SQLite al unui tip partajabil (undefined pentru tipurile care nu se partajează). */
export function shareEntityTable(t: EntityType): string | undefined {
  return isShareableEntityType(t) ? ENTITY_TABLE[t as ShareableEntityType] : undefined;
}

/** Numele zonei CloudKit pentru o entitate — o zonă per entitate partajată. */
export function zoneNameFor(entityType: EntityType, entityId: string): string {
  return `entity_${entityType}_${entityId}`;
}

/**
 * Inversul lui `zoneNameFor`: extrage entityType + entityId din numele zonei.
 * Folosit de participant ca să mapeze o zonă acceptată (din `sharedCloudDatabase`)
 * înapoi la o entitate locală. Întoarce `null` pentru zone de sistem (`_defaultZone`,
 * `cloudkit.*`) sau tipuri necunoscute — NU inventăm o entitate dintr-o zonă străină.
 * `entityId` poate conține `_` (id-urile generate), deci luăm restul după prefix ca id.
 */
export function parseZoneName(
  zoneName: string
): { entityType: EntityType; entityId: string } | null {
  for (const t of SHAREABLE_ENTITY_TYPES) {
    const prefix = `entity_${t}_`;
    if (zoneName.startsWith(prefix)) {
      const entityId = zoneName.slice(prefix.length);
      if (entityId.length > 0) return { entityType: t, entityId };
    }
  }
  return null;
}
