/**
 * ID-urile rândurilor scrise de `applyManifest`.
 *
 * La restaurarea cu înlocuire baza e goală, deci fiecare rând își păstrează ID-ul
 * din manifest. Asta ține legate de date tot ce le referă prin ID: zonele și
 * recordurile CloudKit de partajare, evenimentele din calendar (`acte:///documente/<id>`),
 * și nu mai contopește două entități cu același nume („două Dacia" deveneau una).
 *
 * Manifeste vechi sau corupte: un ID lipsă / care nu e string primește unul nou; un
 * ID care se repetă în același tabel îl păstrează doar prima apariție (FK-urile
 * merg spre ea), restul primesc ID-uri noi. Același ID în tabele diferite e permis.
 */
import { db, generateId } from './db';

export interface RestoreIdAllocator {
  /** ID-ul cu care se inserează rândul: originalul dacă se poate, altfel unul nou. */
  claim(table: string, rawId: unknown): Promise<string>;
}

export interface RestoreIdOptions {
  /** false = mereu ID nou (comportamentul importului aditiv clasic). */
  preserve: boolean;
  /**
   * Import peste date existente: ID-ul original se păstrează doar dacă nu e deja
   * folosit. La restaurarea cu înlocuire (DB golită) nu e nevoie.
   */
  isTaken?: (table: string, id: string) => Promise<boolean>;
  newId?: () => string;
}

export function createRestoreIdAllocator(options: RestoreIdOptions): RestoreIdAllocator {
  const newId = options.newId ?? generateId;
  const claimed = new Map<string, Set<string>>();
  return {
    async claim(table, rawId) {
      if (!options.preserve || typeof rawId !== 'string' || rawId.length === 0) return newId();
      let used = claimed.get(table);
      if (!used) {
        used = new Set();
        claimed.set(table, used);
      }
      if (used.has(rawId)) return newId();
      if (options.isTaken && (await options.isTaken(table, rawId))) return newId();
      used.add(rawId);
      return rawId;
    },
  };
}

/** Prima apariție a unui ID vechi câștigă: un duplicat din manifest nu mută FK-urile. */
export function rememberId(map: Map<string, string>, oldId: unknown, newId: string): void {
  if (typeof oldId === 'string' && oldId.length > 0 && !map.has(oldId)) map.set(oldId, newId);
}

/** Tabelele în care importul poate păstra un ID original (nume fixe, nu input). */
const RESTORABLE_TABLES = new Set([
  'persons',
  'properties',
  'vehicles',
  'cards',
  'animals',
  'companies',
  'custom_document_types',
  'fuel_records',
  'vehicle_maintenance_tasks',
  'service_providers',
  'documents',
  'document_pages',
]);

/**
 * Pentru importul aditiv: un ID e „ocupat" dacă există deja în tabel SAU dacă
 * registrul de partajare îl cunoaște. Al doilea caz contează după „Șterge toate
 * datele" (registrul rămâne): un rând importat cu ID-ul unei entități partajate ar
 * fi împins în zonă cu starea din fișier. Un ID ocupat primește unul nou, ca înainte.
 */
export async function isIdTakenForImport(table: string, id: string): Promise<boolean> {
  if (!RESTORABLE_TABLES.has(table)) return true;
  // `local_table` = numele tabelului SQLite (și pentru paginile primite, al căror ID
  // local e chiar numele recordului), deci interogarea folosește idx_cloud_records_local.
  const row = await db.getFirstAsync<{ hit: number }>(
    `SELECT 1 AS hit FROM ${table} WHERE id = ?
     UNION ALL SELECT 1 FROM shared_entities WHERE entity_id = ?
     UNION ALL SELECT 1 FROM cloud_records WHERE local_table = ? AND local_id = ?
     LIMIT 1`,
    [id, id, table, id]
  );
  return !!row;
}
