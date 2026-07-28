import { ALL_ENTITY_TYPES, MEDICAL_DOC_TYPES } from '@/types';
import type { Document, EntityType } from '@/types';
import { db, generateId } from './db';
import { getDocumentsByEntity } from './documents';
import { emit } from './events';

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
 * WHITELIST per tip de entitate — singurele coloane care ajung într-un share.
 * Fără ea, `getShareBundle` ar trimite orb TOATE coloanele string ale rândului
 * (o coloană sensibilă viitoare ar scurge implicit). `photo_uri` pe vehicul NU
 * e aici — e o cale de fișier locală, nu are sens cross-device (fișierul nu e
 * urcat ca CKAsset pentru entități, doar pentru documente).
 * check-hardcoded-entities-disable-next-cluster
 */
export const ENTITY_SYNC_FIELDS: Record<ShareableEntityType, readonly string[]> = {
  person: ['name', 'phone', 'email', 'date_of_birth'],
  property: ['name'],
  vehicle: ['name', 'plate_number', 'fuel_type'],
  animal: ['name', 'species'],
  company: ['name', 'cui', 'reg_com'],
};

/**
 * Rând SQLite brut → câmpuri de share, filtrate prin whitelist. Pur, testabil
 * fără DB. String-urile nevide se păstrează ca atare; number/boolean devin
 * `String(v)` (SQLite affinity le convertește corect la apply) — altfel o
 * coloană INTEGER/REAL pleacă tăcut nicăieri (`typeof v === 'string'` ar cădea).
 */
export function rowToShareFields(
  row: Record<string, unknown>,
  allowedCols: readonly string[]
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const col of allowedCols) {
    const v = row[col];
    if (v == null) continue;
    if (typeof v === 'string') {
      if (v.length > 0) out[col] = v;
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      out[col] = String(v);
    }
  }
  return out;
}

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

  const entityFields = rowToShareFields(entityRow, [
    'id',
    'created_at',
    ...ENTITY_SYNC_FIELDS[shareable],
  ]);

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

/**
 * Câmpurile whitelisted ale UNEI entități, fără fetch-ul complet de bundle
 * (documente + pagini). Folosit de push-ul granular (o editare de entitate),
 * unde nu avem nevoie de lista de documente. `null` dacă entitatea nu (mai)
 * există sau tipul nu e shareable.
 */
export async function getEntityShareFields(
  entityType: EntityType,
  entityId: string
): Promise<Record<string, string> | null> {
  if (!isShareableEntityType(entityType)) return null;
  const shareable = entityType as ShareableEntityType;
  const row = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM ${ENTITY_TABLE[shareable]} WHERE id = ?`,
    [entityId]
  );
  if (!row) return null;
  return rowToShareFields(row, ['id', 'created_at', ...ENTITY_SYNC_FIELDS[shareable]]);
}

// ─────────────────────────────────────────────────────────────────────────
// Store local pentru starea de sharing (tabele LOCAL-ONLY `shared_entities` +
// `cloud_records`, excluse din backup). Consumat de layer-ul nativ CloudKit.
// ─────────────────────────────────────────────────────────────────────────

export type ShareRole = 'owner' | 'participant';

/** 'read' = participantul doar citește. 'readwrite' = poate edita (push-back). */
export type SharePermission = 'read' | 'readwrite';

export interface SharedEntity {
  id: string;
  entity_type: EntityType;
  entity_id: string;
  zone_name: string;
  role: ShareRole;
  permission: SharePermission;
  share_url?: string;
  owner_name?: string;
  created_at: string;
  revoked_at?: string;
  /** Diagnostics — ultimul pull reușit / ultima eroare de sync (SharingBetaSection/partajare.tsx). */
  last_synced_at?: string;
  last_sync_error?: string;
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
  file_hash?: string;
}

interface SharedEntityRow {
  id: string;
  entity_type: string;
  entity_id: string;
  zone_name: string;
  role: string;
  permission: string | null;
  share_url: string | null;
  owner_name: string | null;
  created_at: string;
  revoked_at: string | null;
  change_token: string | null;
  last_synced_at: string | null;
  last_sync_error: string | null;
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
  file_hash: string | null;
}

function mapSharedEntity(r: SharedEntityRow): SharedEntity {
  return {
    id: r.id,
    entity_type: r.entity_type as EntityType,
    entity_id: r.entity_id,
    zone_name: r.zone_name,
    role: r.role as ShareRole,
    permission: (r.permission as SharePermission) ?? 'read',
    share_url: r.share_url ?? undefined,
    owner_name: r.owner_name ?? undefined,
    created_at: r.created_at,
    revoked_at: r.revoked_at ?? undefined,
    last_synced_at: r.last_synced_at ?? undefined,
    last_sync_error: r.last_sync_error ?? undefined,
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
    file_hash: r.file_hash ?? undefined,
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
  permission?: SharePermission;
  shareUrl?: string;
  ownerName?: string;
}): Promise<SharedEntity> {
  const id = generateId();
  const createdAt = new Date().toISOString();
  // Upsert pe zone_name: la re-înregistrare (ex. reconcile participant) NU
  // clobber-ăm `change_token` / `id` / `created_at` existente — doar câmpurile
  // descriptive. `INSERT OR REPLACE` ar șterge rândul și ar reseta token-ul de sync.
  await db.runAsync(
    `INSERT INTO shared_entities
       (id, entity_type, entity_id, zone_name, role, permission, share_url, owner_name, created_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(zone_name) DO UPDATE SET
       entity_type = excluded.entity_type,
       entity_id = excluded.entity_id,
       role = excluded.role,
       permission = excluded.permission,
       share_url = excluded.share_url,
       owner_name = excluded.owner_name,
       revoked_at = NULL`,
    [
      id,
      params.entityType,
      params.entityId,
      params.zoneName,
      params.role,
      params.permission ?? 'read',
      params.shareUrl ?? null,
      params.ownerName ?? null,
      createdAt,
    ]
  );
  const row = await db.getFirstAsync<SharedEntityRow>(
    `SELECT * FROM shared_entities WHERE zone_name = ?`,
    [params.zoneName]
  );
  emit('sharing:changed');
  return row ? mapSharedEntity(row) : mapSharedEntity({
    id,
    entity_type: params.entityType,
    entity_id: params.entityId,
    zone_name: params.zoneName,
    role: params.role,
    permission: params.permission ?? 'read',
    share_url: params.shareUrl ?? null,
    owner_name: params.ownerName ?? null,
    created_at: createdAt,
    revoked_at: null,
    change_token: null,
    last_synced_at: null,
    last_sync_error: null,
  });
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

/**
 * True dacă entitatea e read-only pentru userul curent — sunt participant pe
 * ea și share-ul NU e readwrite. Owner sau entitate nepartajată → false
 * (control total local). Folosit de UI (`hooks/useShareReadOnly.ts`) pentru
 * gating edit/delete.
 */
export async function isEntityReadOnlyForMe(
  entityType: EntityType,
  entityId: string
): Promise<boolean> {
  const share = await getShareForEntity(entityType, entityId);
  if (!share) return false;
  return share.role === 'participant' && share.permission !== 'readwrite';
}

export async function revokeShare(zoneName: string): Promise<void> {
  await db.runAsync(`UPDATE shared_entities SET revoked_at = ? WHERE zone_name = ?`, [
    new Date().toISOString(),
    zoneName,
  ]);
  emit('sharing:changed');
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

/**
 * Plural al `getCloudRecordForLocal` — un document poate fi pushuit în MAI
 * MULTE zone (legat de mai multe entități partajate). Folosit de
 * `pushLocalChange` ca fallback de rezolvare a zonelor pentru un delete, când
 * `document_entities` (sursa normală, via `getZonesForDocument`) a fost deja
 * curățată.
 */
export async function getCloudRecordsForLocal(
  localTable: string,
  localId: string
): Promise<CloudRecordRef[]> {
  const rows = await db.getAllAsync<CloudRecordRow>(
    `SELECT * FROM cloud_records WHERE local_table = ? AND local_id = ?`,
    [localTable, localId]
  );
  return rows.map(mapCloudRecord);
}

/** Curăță bookkeeping-ul după o ștergere reușită pe server (owner sau apply pull). */
export async function deleteCloudRecord(zoneName: string, recordName: string): Promise<void> {
  await db.runAsync(`DELETE FROM cloud_records WHERE zone_name = ? AND record_name = ?`, [
    zoneName,
    recordName,
  ]);
}

/** CKAsset hash-skip (decizia 5): fișierul principal se re-urcă doar dacă hash-ul s-a schimbat. */
export async function setCloudRecordFileHash(
  zoneName: string,
  recordName: string,
  hash: string | null
): Promise<void> {
  await db.runAsync(`UPDATE cloud_records SET file_hash = ? WHERE zone_name = ? AND record_name = ?`, [
    hash,
    zoneName,
    recordName,
  ]);
}

// ─────────────────────────────────────────────────────────────────────────
// Sync-state per zonă: CKServerChangeToken (fetch incremental) + permisiune.
// ─────────────────────────────────────────────────────────────────────────

/** Salvează token-ul de schimbări (base64) după un pull incremental. */
export async function setZoneChangeToken(zoneName: string, token: string | null): Promise<void> {
  await db.runAsync(`UPDATE shared_entities SET change_token = ? WHERE zone_name = ?`, [
    token,
    zoneName,
  ]);
}

/** Token-ul de la ultimul pull, sau null (prima sincronizare = full fetch). */
export async function getZoneChangeToken(zoneName: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ change_token: string | null }>(
    `SELECT change_token FROM shared_entities WHERE zone_name = ?`,
    [zoneName]
  );
  return row?.change_token ?? null;
}

/**
 * Diagnostics per zonă (SharingBetaSection/partajare.tsx). Succes → resetează
 * `last_sync_error`; eșec → păstrează `last_synced_at` anterior (ultimul pull
 * REUȘIT), doar înregistrează eroarea curentă.
 */
export async function markZoneSyncSuccess(zoneName: string): Promise<void> {
  await db.runAsync(
    `UPDATE shared_entities SET last_synced_at = ?, last_sync_error = NULL WHERE zone_name = ?`,
    [new Date().toISOString(), zoneName]
  );
}

export async function markZoneSyncError(zoneName: string, error: string): Promise<void> {
  await db.runAsync(`UPDATE shared_entities SET last_sync_error = ? WHERE zone_name = ?`, [
    error,
    zoneName,
  ]);
}

/** Owner: setează permisiunea unei zone (read / readwrite). */
export async function setSharePermission(
  zoneName: string,
  permission: SharePermission
): Promise<void> {
  await db.runAsync(`UPDATE shared_entities SET permission = ? WHERE zone_name = ?`, [
    permission,
    zoneName,
  ]);
  emit('sharing:changed');
}

/**
 * Toate share-urile active a căror entitate e legată de acest document (prin
 * `document_entities`). Un document poate fi în mai multe zone (legat de mai
 * multe entități partajate). Folosit ca să știm unde să propagăm o modificare de doc.
 */
export async function getZonesForDocument(documentId: string): Promise<SharedEntity[]> {
  const rows = await db.getAllAsync<SharedEntityRow>(
    `SELECT se.* FROM shared_entities se
       JOIN document_entities de
         ON de.entity_type = se.entity_type AND de.entity_id = se.entity_id
     WHERE de.document_id = ? AND se.revoked_at IS NULL`,
    [documentId]
  );
  // Dedup pe zone_name (un doc legat de aceeași entitate de mai multe ori).
  const seen = new Set<string>();
  const out: SharedEntity[] = [];
  for (const r of rows) {
    if (seen.has(r.zone_name)) continue;
    seen.add(r.zone_name);
    out.push(mapSharedEntity(r));
  }
  return out;
}

/**
 * True dacă documentul e read-only pentru userul curent — legat de ORICE zonă
 * unde sunt participant cu `permission!=='readwrite'`, indiferent dacă mai e
 * legat și de o zonă deținută/readwrite (decizie conservativă: evită push
 * accidental într-o zonă unde n-am drept de scriere). Document nepartajat sau
 * legat doar de zone deținute/readwrite → false.
 */
export async function isDocumentReadOnlyForMe(documentId: string): Promise<boolean> {
  const zones = await getZonesForDocument(documentId);
  return zones.some(z => z.role === 'participant' && z.permission !== 'readwrite');
}

// ─────────────────────────────────────────────────────────────────────────
// Coadă de push offline (model `pending_uploads`). Un rând per (zonă, record).
// ─────────────────────────────────────────────────────────────────────────

export type SharePushOp = 'upsert' | 'delete';
export type PushScope = 'private' | 'shared';
/** Ce tip de rând local e `record_name` — `flushSharePushes` re-derivă payload-ul
 * la flush time, deci coada trebuie să știe unde să caute (persons/... vs documents). */
export type SharePushKind = 'entity' | 'document';

export interface PendingSharePush {
  id: number;
  zone_name: string;
  record_name: string;
  op: SharePushOp;
  scope: PushScope;
  kind: SharePushKind;
  owner_name?: string;
  attempt_count: number;
  created_at: number;
}

interface PendingSharePushRow {
  id: number;
  zone_name: string;
  record_name: string;
  op: string;
  scope: string;
  kind: string;
  owner_name: string | null;
  attempt_count: number;
  created_at: number;
}

function mapPendingPush(r: PendingSharePushRow): PendingSharePush {
  return {
    id: r.id,
    zone_name: r.zone_name,
    record_name: r.record_name,
    op: r.op as SharePushOp,
    scope: r.scope as PushScope,
    kind: (r.kind as SharePushKind) ?? 'document',
    owner_name: r.owner_name ?? undefined,
    attempt_count: r.attempt_count,
    created_at: r.created_at,
  };
}

/**
 * Pune la coadă un push. Idempotent pe (zone_name, record_name): dacă există deja
 * un push în așteptare pentru acel record, îl suprascrie cu op-ul nou (ultima
 * intenție câștigă — ex. un `upsert` urmat de `delete` devine `delete`).
 */
export async function enqueueSharePush(params: {
  zoneName: string;
  recordName: string;
  op: SharePushOp;
  scope: PushScope;
  kind: SharePushKind;
  ownerName?: string;
}): Promise<void> {
  await db.runAsync(
    `INSERT INTO pending_share_pushes (zone_name, record_name, op, scope, kind, owner_name, attempt_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)
     ON CONFLICT(zone_name, record_name) DO UPDATE SET
       op = excluded.op,
       scope = excluded.scope,
       kind = excluded.kind,
       owner_name = excluded.owner_name,
       attempt_count = 0,
       last_error = NULL`,
    [
      params.zoneName,
      params.recordName,
      params.op,
      params.scope,
      params.kind,
      params.ownerName ?? null,
      Date.now(),
    ]
  );
}

export async function getPendingSharePushes(): Promise<PendingSharePush[]> {
  const rows = await db.getAllAsync<PendingSharePushRow>(
    `SELECT * FROM pending_share_pushes ORDER BY created_at ASC`
  );
  return rows.map(mapPendingPush);
}

export async function deleteSharePush(id: number): Promise<void> {
  await db.runAsync(`DELETE FROM pending_share_pushes WHERE id = ?`, [id]);
}

export async function bumpSharePushAttempt(id: number, error: string): Promise<void> {
  await db.runAsync(
    `UPDATE pending_share_pushes SET attempt_count = attempt_count + 1, last_error = ? WHERE id = ?`,
    [error, id]
  );
}
