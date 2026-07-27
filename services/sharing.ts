import { ALL_ENTITY_TYPES, MEDICAL_DOC_TYPES } from '@/types';
import type { Document, EntityType } from '@/types';
import { db, generateId } from './db';
import { getDocumentsByEntity } from './documents';

/**
 * Layer de partajare entități între conturi (CloudKit) — logica pură + granița
 * de privacy. Native side (CKSyncEngine) consumă `EntityShareBundle`.
 * Vezi `docs/superpowers/specs/2026-07-22-cloudkit-entity-sharing.md`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * REGULĂ CRITICĂ DE SECURITATE (verificată de `scripts/share-privacy-audit.js`
 * + `__tests__/characterization/sharing.test.ts`):
 *   1. Documentele medicale (MEDICAL_DOC_TYPES) NU pleacă NICIODATĂ într-un share.
 *   2. `private_notes` (CVV/PIN/parole) NU pleacă NICIODATĂ.
 *   3. Serializarea e **WHITELIST**, nu blacklist: doar câmpurile din
 *      `SHAREABLE_DOC_FIELDS` ajung în payload. Un câmp sensibil nou adăugat pe
 *      `Document` NU scurge implicit — trebuie adăugat explicit aici.
 * ─────────────────────────────────────────────────────────────────────────
 */

// `medical_record`: flux propriu criptat, nu se partajează ca entitate.
// `card`: exclus by default (poate purta note sensibile) — opt-in în Faza 3
// (open question din spec §8).
// Mapări service-layer entityType→(set excludere / tabel / coloană FK) de mai
// jos: chei EntityType legitime, NU duplicare de labels UI. Vezi dynamic-types.md.
// check-hardcoded-entities-disable-next-cluster
const NON_SHAREABLE_ENTITY_TYPES: ReadonlySet<EntityType> = new Set<EntityType>([
  'medical_record',
  'card',
]);

export const SHAREABLE_ENTITY_TYPES: EntityType[] = ALL_ENTITY_TYPES.filter(
  t => !NON_SHAREABLE_ENTITY_TYPES.has(t)
);

export function isShareableEntityType(t: EntityType): boolean {
  return !NON_SHAREABLE_ENTITY_TYPES.has(t);
}

type ShareableEntityType = Exclude<EntityType, 'medical_record' | 'card'>;

// entityType → tabel SQLite. Cheile sunt un enum validat (NU input user), deci
// interpolarea numelui de tabel în query e sigură față de injection.
const ENTITY_TABLE: Record<ShareableEntityType, string> = {
  person: 'persons',
  property: 'properties',
  vehicle: 'vehicles',
  animal: 'animals',
  company: 'companies',
};

// check-hardcoded-entities-disable-next-cluster
const ENTITY_DOC_KIND: Record<
  ShareableEntityType,
  'person_id' | 'property_id' | 'vehicle_id' | 'animal_id' | 'company_id'
> = {
  person: 'person_id',
  property: 'property_id',
  vehicle: 'vehicle_id',
  animal: 'animal_id',
  company: 'company_id',
};

/**
 * WHITELIST — singurele câmpuri de document care ajung în share. Orice câmp
 * ABSENT de aici NU pleacă. `private_notes` NU e aici (by design). `file_path`
 * NU e aici — fișierele merg ca CKAsset (vezi `files`), nu ca string.
 */
const SHAREABLE_DOC_FIELDS = ['type', 'issue_date', 'expiry_date', 'note', 'created_at'] as const;

export interface ShareBundleFile {
  /** Cale relativă în DocumentsDirectory → devine CKAsset. */
  file_path: string;
  role: 'main' | 'page';
  page_order?: number;
}

export interface ShareableDocumentRecord {
  recordName: string; // = doc.id
  fields: Record<string, string>;
  files: ShareBundleFile[];
}

export interface EntityShareBundle {
  entityType: EntityType;
  entityRecordName: string; // = entityId
  entityFields: Record<string, string>;
  documents: ShareableDocumentRecord[];
}

interface PageRef {
  file_path: string;
  page_order: number;
}

/**
 * Convertește un `Document` la forma partajabilă (whitelist). Returnează `null`
 * dacă documentul e medical — acelea NU se partajează niciodată.
 */
export function toShareableDocument(
  doc: Document,
  pages: PageRef[] = []
): ShareableDocumentRecord | null {
  if (MEDICAL_DOC_TYPES.has(doc.type)) return null;

  const fields: Record<string, string> = {};
  for (const key of SHAREABLE_DOC_FIELDS) {
    const value = (doc as unknown as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.length > 0) fields[key] = value;
  }
  if (doc.metadata && Object.keys(doc.metadata).length > 0) {
    fields.metadata = JSON.stringify(doc.metadata);
  }

  const files: ShareBundleFile[] = [];
  if (doc.file_path) files.push({ file_path: doc.file_path, role: 'main' });
  const pageList = pages.length > 0 ? pages : (doc.pages ?? []);
  for (const page of pageList) {
    if (page.file_path) {
      files.push({ file_path: page.file_path, role: 'page', page_order: page.page_order });
    }
  }

  return { recordName: doc.id, fields, files };
}

/**
 * Defense-in-depth: aruncă dacă bundle-ul serializat conține markeri de câmpuri
 * sensibile. Redundant peste whitelist — plasă dacă cineva ocolește `toShareableDocument`.
 */
export function assertNoSensitiveLeak(bundle: EntityShareBundle): void {
  const serialized = JSON.stringify(bundle);
  if (serialized.includes('"private_notes"')) {
    throw new Error('Share leak: câmp private_notes prezent în bundle');
  }
  for (const doc of bundle.documents) {
    if ((MEDICAL_DOC_TYPES as ReadonlySet<string>).has(doc.fields.type)) {
      throw new Error('Share leak: document medical în bundle');
    }
  }
}

/**
 * Construiește bundle-ul partajabil pentru o entitate: rândul entității +
 * documentele ei (fără medical, fără private_notes) + referințe la fișiere.
 */
export async function getShareBundle(
  entityType: EntityType,
  entityId: string
): Promise<EntityShareBundle> {
  if (!isShareableEntityType(entityType)) {
    throw new Error(`Entitatea "${entityType}" nu poate fi partajată`);
  }
  const shareable = entityType as ShareableEntityType;
  const table = ENTITY_TABLE[shareable];
  const kind = ENTITY_DOC_KIND[shareable];

  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM ${table} WHERE id = ?`,
    [entityId]
  );
  const entityRow = rows[0];
  if (!entityRow) throw new Error('Entitatea nu există');

  const entityFields: Record<string, string> = {};
  for (const [k, v] of Object.entries(entityRow)) {
    if (typeof v === 'string' && v.length > 0) entityFields[k] = v;
  }

  const docs = await getDocumentsByEntity(kind, entityId);
  const documents: ShareableDocumentRecord[] = [];
  for (const doc of docs) {
    const pages = await db.getAllAsync<PageRef>(
      'SELECT file_path, page_order FROM document_pages WHERE document_id = ? ORDER BY page_order ASC',
      [doc.id]
    );
    const record = toShareableDocument(doc, pages);
    if (record) documents.push(record);
  }

  const bundle: EntityShareBundle = {
    entityType,
    entityRecordName: entityId,
    entityFields,
    documents,
  };
  assertNoSensitiveLeak(bundle);
  return bundle;
}

// ─────────────────────────────────────────────────────────────────────────
// Store local pentru starea de sharing (tabele LOCAL-ONLY `shared_entities` +
// `cloud_records`, excluse din backup). Consumat de layer-ul nativ CloudKit.
// ─────────────────────────────────────────────────────────────────────────

export type ShareRole = 'owner' | 'participant';

export interface SharedEntity {
  id: string;
  entity_type: EntityType;
  entity_id: string;
  zone_name: string;
  role: ShareRole;
  share_url?: string;
  owner_name?: string;
  created_at: string;
  revoked_at?: string;
}

export interface CloudRecordRef {
  id: string;
  zone_name: string;
  record_name: string;
  record_type: string;
  local_table: string;
  local_id: string;
  change_tag?: string;
  synced_at?: string;
}

interface SharedEntityRow {
  id: string;
  entity_type: string;
  entity_id: string;
  zone_name: string;
  role: string;
  share_url: string | null;
  owner_name: string | null;
  created_at: string;
  revoked_at: string | null;
}

interface CloudRecordRow {
  id: string;
  zone_name: string;
  record_name: string;
  record_type: string;
  local_table: string;
  local_id: string;
  change_tag: string | null;
  synced_at: string | null;
}

function mapSharedEntity(r: SharedEntityRow): SharedEntity {
  return {
    id: r.id,
    entity_type: r.entity_type as EntityType,
    entity_id: r.entity_id,
    zone_name: r.zone_name,
    role: r.role as ShareRole,
    share_url: r.share_url ?? undefined,
    owner_name: r.owner_name ?? undefined,
    created_at: r.created_at,
    revoked_at: r.revoked_at ?? undefined,
  };
}

function mapCloudRecord(r: CloudRecordRow): CloudRecordRef {
  return {
    id: r.id,
    zone_name: r.zone_name,
    record_name: r.record_name,
    record_type: r.record_type,
    local_table: r.local_table,
    local_id: r.local_id,
    change_tag: r.change_tag ?? undefined,
    synced_at: r.synced_at ?? undefined,
  };
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

export async function recordShare(params: {
  entityType: EntityType;
  entityId: string;
  zoneName: string;
  role: ShareRole;
  shareUrl?: string;
  ownerName?: string;
}): Promise<SharedEntity> {
  const id = generateId();
  const createdAt = new Date().toISOString();
  await db.runAsync(
    `INSERT OR REPLACE INTO shared_entities
       (id, entity_type, entity_id, zone_name, role, share_url, owner_name, created_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [
      id,
      params.entityType,
      params.entityId,
      params.zoneName,
      params.role,
      params.shareUrl ?? null,
      params.ownerName ?? null,
      createdAt,
    ]
  );
  return {
    id,
    entity_type: params.entityType,
    entity_id: params.entityId,
    zone_name: params.zoneName,
    role: params.role,
    share_url: params.shareUrl,
    owner_name: params.ownerName,
    created_at: createdAt,
  };
}

export async function getSharedEntities(includeRevoked = false): Promise<SharedEntity[]> {
  const where = includeRevoked ? '' : 'WHERE revoked_at IS NULL';
  const rows = await db.getAllAsync<SharedEntityRow>(
    `SELECT * FROM shared_entities ${where} ORDER BY created_at DESC`
  );
  return rows.map(mapSharedEntity);
}

export async function getShareForEntity(
  entityType: EntityType,
  entityId: string
): Promise<SharedEntity | null> {
  const row = await db.getFirstAsync<SharedEntityRow>(
    `SELECT * FROM shared_entities
     WHERE entity_type = ? AND entity_id = ? AND revoked_at IS NULL
     LIMIT 1`,
    [entityType, entityId]
  );
  return row ? mapSharedEntity(row) : null;
}

export async function revokeShare(zoneName: string): Promise<void> {
  await db.runAsync(`UPDATE shared_entities SET revoked_at = ? WHERE zone_name = ?`, [
    new Date().toISOString(),
    zoneName,
  ]);
}

export async function upsertCloudRecord(params: {
  zoneName: string;
  recordName: string;
  recordType: string;
  localTable: string;
  localId: string;
  changeTag?: string;
}): Promise<void> {
  const syncedAt = new Date().toISOString();
  const existing = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM cloud_records WHERE zone_name = ? AND record_name = ?`,
    [params.zoneName, params.recordName]
  );
  if (existing) {
    await db.runAsync(
      `UPDATE cloud_records
         SET record_type = ?, local_table = ?, local_id = ?, change_tag = ?, synced_at = ?
       WHERE id = ?`,
      [
        params.recordType,
        params.localTable,
        params.localId,
        params.changeTag ?? null,
        syncedAt,
        existing.id,
      ]
    );
    return;
  }
  await db.runAsync(
    `INSERT INTO cloud_records
       (id, zone_name, record_name, record_type, local_table, local_id, change_tag, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      generateId(),
      params.zoneName,
      params.recordName,
      params.recordType,
      params.localTable,
      params.localId,
      params.changeTag ?? null,
      syncedAt,
    ]
  );
}

export async function getCloudRecord(
  zoneName: string,
  recordName: string
): Promise<CloudRecordRef | null> {
  const row = await db.getFirstAsync<CloudRecordRow>(
    `SELECT * FROM cloud_records WHERE zone_name = ? AND record_name = ?`,
    [zoneName, recordName]
  );
  return row ? mapCloudRecord(row) : null;
}

export async function getCloudRecordForLocal(
  localTable: string,
  localId: string
): Promise<CloudRecordRef | null> {
  const row = await db.getFirstAsync<CloudRecordRow>(
    `SELECT * FROM cloud_records WHERE local_table = ? AND local_id = ? LIMIT 1`,
    [localTable, localId]
  );
  return row ? mapCloudRecord(row) : null;
}
