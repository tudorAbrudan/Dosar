import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import JSZip from 'jszip';
import {
  ALL_ENTITY_TYPES,
  type DocumentType,
  type EntityType,
  type MedicalRecord,
  type MedicalChatThread,
  type MedicalDocumentSummary,
  type MedicalShare,
  type Reminder,
} from '@/types';
import * as entities from './entities';
import * as docs from './documents';
import * as fuel from './fuel';
import * as maintenance from './maintenance';
import * as serviceProviders from './serviceProviders';
import { getCustomTypes, createCustomType } from './customTypes';
import { toFileUri, toRelativePath } from './fileUtils';
import { sanitizeFolderName, buildEntityFileMap, type EntityNameMaps } from './fileOrganization';
import { onRestoreSuccess } from './reviewPrompt';
import { getLocalDbSizeBytes } from './cloud/stats';
import { db, generateId } from './db';
import { emit } from './events';

/**
 * Prag (bytes) peste care exportul manual ZIP e riscant din punct de vedere al
 * memoriei, iar UI-ul (Setări → Backup) avertizează înainte de a continua.
 *
 * Raționament: `zip.generateAsync({ type: 'base64' })` construiește TOT arhiva ca un
 * singur string base64 în RAM. La vârf, memoria ≈ 2.5–3× dimensiunea fișierelor brute
 * (JSZip ține conținutul fișierelor + stringul base64 final, ~1.33× peste zip). ~300MB
 * de fișiere înseamnă un vârf de ~0.8–1GB — suficient pentru un jetsam pe device-uri cu
 * puțină memorie, exact pe utilizatorii cu cele mai multe date. Sub prag, comportamentul
 * de export rămâne neschimbat; peste prag recomandăm backup-ul în iCloud (streaming pe
 * fișiere, fără arhivă in-memory).
 */
export const EXPORT_SIZE_WARN_BYTES = 300 * 1024 * 1024;

/**
 * Estimează dimensiunea totală (bytes) a datelor care vor intra în ZIP-ul de backup:
 * suma mărimilor pe disc ale tuturor fișierelor (documente, pagini, poze vehicule) plus
 * dimensiunea DB-ului SQLite local ca proxy pentru manifestul JSON (conservator, de
 * același ordin de mărime, fără a reconstrui manifestul).
 *
 * Termenul dominant sunt fișierele binare; manifestul e neglijabil pe biblioteci mari.
 * Fișierele lipsă / inaccesibile contribuie 0 (sunt oricum sărite la export). Folosit de
 * UI ca să decidă dacă avertizează asupra riscului de memorie înainte de export.
 */
export async function estimateBackupSizeBytes(): Promise<number> {
  const rows = await db.getAllAsync<{ file_path: string }>(
    `SELECT file_path FROM documents WHERE file_path IS NOT NULL AND file_path != ''
     UNION
     SELECT file_path FROM document_pages WHERE file_path IS NOT NULL AND file_path != ''
     UNION
     SELECT photo_uri AS file_path FROM vehicles WHERE photo_uri IS NOT NULL AND photo_uri != ''`
  );
  let total = 0;
  for (const r of rows) {
    try {
      const info = await FileSystem.getInfoAsync(toFileUri(r.file_path));
      if (info.exists && 'size' in info && typeof info.size === 'number') {
        total += info.size;
      }
    } catch {
      // Fișier inaccesibil — contribuie 0, la fel ca la export.
    }
  }
  total += await getLocalDbSizeBytes();
  return total;
}

/**
 * Citește un fișier ca base64. Returnează null dacă nu există sau nu poate fi citit.
 */
async function readFileBase64(storedPath: string): Promise<string | null> {
  try {
    const uri = toFileUri(storedPath);
    return await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  } catch {
    return null;
  }
}

/**
 * Exportă toate datele ca fișier ZIP conținând:
 *  - backup.json  (manifest cu entități + documente + fileMap)
 *  - files/<NumeEntitate>/<TipDocument>/<fisier>  (pozele și PDF-urile organizate pe entități)
 *
 * Format version: 16
 * v15: medical observations/chat plaintext (spec 2026-06-05)
 * v16: document_entities (junction table) inclus în manifest — restore fidelity 2026-07.
 *      Manifestele vechi (fără câmp) fac fallback la reconstrucția din coloanele legacy.
 */
export async function exportBackup(): Promise<void> {
  const [
    persons,
    properties,
    vehicles,
    cards,
    animals,
    companies,
    fuelRecordsList,
    maintenanceTasks,
    serviceProvidersList,
    documents,
    allPages,
    customTypes,
    entityOrder,
  ] = await Promise.all([
    entities.getPersons(),
    entities.getProperties(),
    entities.getVehicles(),
    entities.getCards(),
    entities.getAnimals(),
    entities.getCompanies(),
    fuel.getAllFuelRecords(),
    maintenance.getAllMaintenanceTasks(),
    serviceProviders.getAllServiceProviders(),
    docs.getDocuments(),
    docs.getAllDocumentPages(),
    getCustomTypes(),
    db.getAllAsync<{ entity_type: EntityType; entity_id: string; sort_order: number }>(
      'SELECT entity_type, entity_id, sort_order FROM entity_order'
    ),
  ]);

  const [
    medicalRecords,
    medicalObservations,
    medicalChatThreads,
    medicalChatMessages,
    medicalDocumentSummaries,
    medicalShares,
    reminders,
    documentEntities,
  ] = await Promise.all([
    db.getAllAsync<MedicalRecord>('SELECT * FROM medical_record'),
    db.getAllAsync<any>('SELECT * FROM medical_observations'),
    db.getAllAsync<MedicalChatThread>('SELECT * FROM medical_chat_threads'),
    db.getAllAsync<any>('SELECT * FROM medical_chat_messages'),
    db.getAllAsync<MedicalDocumentSummary>('SELECT * FROM medical_document_summaries'),
    db.getAllAsync<MedicalShare>('SELECT * FROM medical_shares'),
    db.getAllAsync<Reminder>('SELECT * FROM reminders'),
    db.getAllAsync<{
      id: string;
      document_id: string;
      entity_type: EntityType;
      entity_id: string;
    }>('SELECT id, document_id, entity_type, entity_id FROM document_entities'),
  ]);

  const personNames = new Map(persons.map(p => [p.id, p.name]));
  const vehicleNames = new Map(vehicles.map(v => [v.id, v.name]));
  const propertyNames = new Map(properties.map(p => [p.id, p.name]));
  const cardNames = new Map(
    cards.map(c => [c.id, c.nickname ? `${c.nickname} ····${c.last4}` : `Card ····${c.last4}`])
  );
  const animalNames = new Map(animals.map(a => [a.id, a.name]));
  const companyNames = new Map(companies.map(c => [c.id, c.name]));
  const customTypeNames = new Map(customTypes.map(ct => [ct.id, ct.name]));

  const maps: EntityNameMaps = {
    personNames,
    vehicleNames,
    propertyNames,
    cardNames,
    animalNames,
    companyNames,
    customTypeNames,
  };
  const fileMap = buildEntityFileMap(documents, allPages, maps);

  // Task 17: include vehicle photos in ZIP
  for (const v of vehicles) {
    if (!v.photo_uri) continue;
    const rel = toRelativePath(v.photo_uri);
    if (!rel || fileMap[rel]) continue;
    const folder = sanitizeFolderName(v.name);
    fileMap[rel] = `Vehicule/${folder}/photo.jpg`;
  }

  const manifest = {
    version: 16, // v16: document_entities inclus în manifest (restore fidelity 2026-07)
    exportDate: new Date().toISOString(),
    persons,
    properties,
    vehicles,
    cards,
    animals,
    companies,
    fuelRecords: fuelRecordsList,
    maintenanceTasks,
    serviceProviders: serviceProvidersList,
    customTypes,
    documents,
    documentPages: allPages,
    documentEntities,
    entityOrder,
    fileMap,
    medicalRecords,
    medicalObservations,
    medicalChatThreads,
    medicalChatMessages,
    medicalDocumentSummaries,
    medicalShares,
    reminders,
  };

  const zip = new JSZip();
  zip.file('backup.json', JSON.stringify(manifest, null, 2));

  for (const [diskRelPath, zipRelPath] of Object.entries(fileMap)) {
    try {
      const b64 = await readFileBase64(diskRelPath);
      if (b64) {
        zip.file(`files/${zipRelPath}`, b64, { base64: true });
      }
    } catch {
      // Fișier inaccesibil — continuă fără el
    }
  }

  // `compression: 'STORE'` (fără DEFLATE): pozele JPG și PDF-urile sunt deja comprimate,
  // deci DEFLATE nu reduce dimensiunea dar arde CPU și crește vârful de RAM. STORE e deja
  // default-ul JSZip; îl setăm explicit ca intenția să fie clară și robustă la schimbări de
  // default. Importul (`JSZip.loadAsync`) citește orice metodă, deci compatibilitatea nu e afectată.
  const zipBase64 = await zip.generateAsync({ type: 'base64', compression: 'STORE' });

  const date = new Date().toISOString().slice(0, 10);
  const filename = `acte_backup_${date}.zip`;
  const path = `${FileSystem.cacheDirectory}${filename}`;

  await FileSystem.writeAsStringAsync(path, zipBase64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  await Sharing.shareAsync(path, {
    mimeType: 'application/zip',
    dialogTitle: 'Salvează backup',
    UTI: 'public.zip-archive',
  });
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

/**
 * Extrage fișierele dintr-un ZIP și le scrie pe disk.
 * Dacă există fileMap (version 5+), îl folosește pentru a determina calea pe disk.
 * Backward compatible cu version 4 (fără fileMap).
 */
async function extractFilesFromZip(zip: JSZip, fileMap?: Record<string, string>): Promise<void> {
  const filesFolder = zip.folder('files');
  if (!filesFolder) return;

  // Reverse map: zipRelPath → diskRelPath (din fileMap al manifestului)
  const reverseMap = new Map<string, string>();
  if (fileMap) {
    for (const [diskPath, zipPath] of Object.entries(fileMap)) {
      reverseMap.set(zipPath, diskPath);
    }
  }

  const fileEntries: { relativePath: string; file: JSZip.JSZipObject }[] = [];
  filesFolder.forEach((relativePath, file) => {
    if (!file.dir) {
      fileEntries.push({ relativePath, file });
    }
  });

  for (const { relativePath, file } of fileEntries) {
    try {
      const b64 = await file.async('base64');
      // Version 5+: folosește reverse map pentru calea pe disk
      // Version 4 și mai vechi: relativePath din ZIP = calea pe disk
      const diskRelPath = reverseMap.get(relativePath) ?? relativePath;
      const dest = `${FileSystem.documentDirectory}${diskRelPath}`;
      const destDir = dest.substring(0, dest.lastIndexOf('/'));
      await FileSystem.makeDirectoryAsync(destDir, { intermediates: true });
      await FileSystem.writeAsStringAsync(dest, b64, { encoding: FileSystem.EncodingType.Base64 });
    } catch {
      // Fișier individual inaccesibil — continuă
    }
  }
}

export interface ApplyManifestOptions {
  /** Dacă true, șterge toate datele utilizator înainte de import (cloud restore). Default false. */
  wipeFirst?: boolean;
}

// Set to true while applyManifest is running (cloud restore OR ZIP import).
// Document service hooks consult `isImportInProgress()` to suppress
// re-enqueueing into `pending_uploads` for files that came from the manifest.
let _importInProgress = false;
export function isImportInProgress(): boolean {
  return _importInProgress;
}

/**
 * Aplică un manifest (payload JSON deja parsat) peste DB-ul curent.
 * Folosit atât de importBackup (după parse ZIP/JSON) cât și de cloudSync.restore().
 *
 * Ambele căi (wipeFirst și aditiv) rulează într-o tranzacție SQLite atomică:
 * dacă orice pas eșuează, DB-ul rămâne în starea de dinaintea apelului (nu
 * rămâne pe jumătate restaurat / importat). Pentru `wipeFirst: true` tranzacția
 * acoperă wipe + import; pentru `wipeFirst: false` (calea ZIP din `importBackup`)
 * acoperă importul aditiv.
 *
 * Atomicitate: tranzacția DB acoperă DOAR scrierea în SQLite. Operațiunile pe
 * disc (copy fișiere, fișiere descărcate de `restoreFromCloud`) NU sunt
 * rollback-uite — pot rămâne orfani după un eșec, recuperate la următoarea încercare.
 */
export async function applyManifest(
  payload: Record<string, unknown>,
  options: ApplyManifestOptions = {}
): Promise<ImportResult> {
  _importInProgress = true;
  try {
    let result!: ImportResult;
    await db.withTransactionAsync(async () => {
      if (options.wipeFirst) {
        await wipeUserData();
      }
      result = await applyManifestBody(payload, options.wipeFirst === true);
    });
    return result;
  } finally {
    _importInProgress = false;
    emit('documents:changed');
    emit('links:changed');
    emit('entities:changed');
    emit('customTypes:changed');
    emit('settings:changed');
  }
}

async function applyManifestBody(
  payload: Record<string, unknown>,
  wipeFirst = false
): Promise<ImportResult> {
  // --- Încarcă entitățile existente pentru deduplicare ---
  const [
    existingPersons,
    existingProperties,
    existingVehicles,
    existingCards,
    existingAnimals,
    existingCompanies,
    existingFuelRecords,
    existingDocuments,
    existingCustomTypes,
  ] = await Promise.all([
    entities.getPersons(),
    entities.getProperties(),
    entities.getVehicles(),
    entities.getCards(),
    entities.getAnimals(),
    entities.getCompanies(),
    fuel.getAllFuelRecords(),
    docs.getDocuments(),
    getCustomTypes(),
  ]);

  const existingPersonByName = new Map(
    existingPersons.map(p => [p.name.toLowerCase().trim(), p.id])
  );
  const existingPropertyByName = new Map(
    existingProperties.map(p => [p.name.toLowerCase().trim(), p.id])
  );
  const existingVehicleByName = new Map(
    existingVehicles.map(v => [v.name.toLowerCase().trim(), v.id])
  );
  const existingCardByKey = new Map(
    existingCards.map(c => [`${c.last4}|${c.nickname.toLowerCase().trim()}`, c.id])
  );
  const existingAnimalByKey = new Map(
    existingAnimals.map(a => [
      `${a.name.toLowerCase().trim()}|${a.species.toLowerCase().trim()}`,
      a.id,
    ])
  );
  const existingCompanyByCui = new Map(
    existingCompanies.filter(c => c.cui).map(c => [c.cui!, c.id])
  );
  const existingCompanyByName = new Map(
    existingCompanies.map(c => [c.name.toLowerCase().trim(), c.id])
  );
  const existingCustomTypeByName = new Map(
    existingCustomTypes.map(ct => [ct.name.toLowerCase().trim(), ct.id])
  );
  // Document key: type + issue_date + expiry_date
  const existingDocByKey = new Map(
    existingDocuments.map(d => [`${d.type}|${d.issue_date ?? ''}|${d.expiry_date ?? ''}`, d.id])
  );
  // Fuel record: dedupe exact (vehicle + date + liters + km_total)
  const existingFuelByKey = new Set(
    existingFuelRecords.map(
      f =>
        `${f.vehicle_id ?? ''}|${f.date}|${f.liters ?? ''}|${f.km_total ?? ''}|${f.station ?? ''}`
    )
  );

  // --- Import entități și documente (comun pentru ambele formate) ---
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Remap id-vechi → id-nou per tip de entitate, folosit la FK-uri și la
  // restaurarea document_entities. Generat din ALL_ENTITY_TYPES: un EntityType
  // nou primește automat hartă imediat ce bucla lui de restore o populează.
  const entityIdMaps = new Map<EntityType, Map<string, string>>(
    ALL_ENTITY_TYPES.map(t => [t, new Map<string, string>()])
  );
  const personMap = entityIdMaps.get('person')!;
  const propertyMap = entityIdMaps.get('property')!;
  const vehicleMap = entityIdMaps.get('vehicle')!;
  const cardMap = entityIdMaps.get('card')!;
  const animalMap = entityIdMaps.get('animal')!;
  const companyMap = entityIdMaps.get('company')!;
  const customTypeMap = new Map<string, string>();
  const docIdMap = new Map<string, string>();
  // Dosarele medicale își păstrează ID-ul la restore (INSERT OR REPLACE cu id-ul
  // original), deci maparea e identitate — dar o construim explicit ca remap-ul
  // pentru document_entities (entity_type='medical_record') să treacă prin aceeași
  // logică ca restul entităților și să sară linkurile către dosare neimportate.
  const recordIdMap = entityIdMaps.get('medical_record')!;

  type AnyRecord = Record<string, unknown>;

  // personMap rămâne disponibil pentru remap în restul importului (entity_order etc.).
  for (const p of (payload.persons as AnyRecord[]) ?? []) {
    try {
      const nameKey = ((p.name as string) || '').toLowerCase().trim();
      const existingId = existingPersonByName.get(nameKey);
      if (existingId) {
        if (p.id) personMap.set(p.id as string, existingId);
        skipped++;
      } else {
        const created = await entities.createPerson(
          (p.name as string) || 'Persoană',
          (p.phone as string | null) ?? undefined,
          (p.email as string | null) ?? undefined,
          (p.date_of_birth as string | null) ?? undefined
        );
        if (p.id) personMap.set(p.id as string, created.id);
        existingPersonByName.set(nameKey, created.id);
        imported++;
      }
    } catch (e) {
      errors.push(`Persoană "${p.name}": ${e instanceof Error ? e.message : 'eroare'}`);
    }
  }

  for (const pr of (payload.properties as AnyRecord[]) ?? []) {
    try {
      const nameKey = ((pr.name as string) || '').toLowerCase().trim();
      const existingId = existingPropertyByName.get(nameKey);
      if (existingId) {
        if (pr.id) propertyMap.set(pr.id as string, existingId);
        skipped++;
      } else {
        const created = await entities.createProperty((pr.name as string) || 'Proprietate');
        if (pr.id) propertyMap.set(pr.id as string, created.id);
        existingPropertyByName.set(nameKey, created.id);
        imported++;
      }
    } catch (e) {
      errors.push(`Proprietate "${pr.name}": ${e instanceof Error ? e.message : 'eroare'}`);
    }
  }

  for (const v of (payload.vehicles as AnyRecord[]) ?? []) {
    try {
      const nameKey = ((v.name as string) || '').toLowerCase().trim();
      const existingId = existingVehicleByName.get(nameKey);
      if (existingId) {
        if (v.id) vehicleMap.set(v.id as string, existingId);
        skipped++;
      } else {
        const vehicleName = (v.name as string) || 'Vehicul';
        const created = await entities.createVehicle(vehicleName);

        const oldPhotoRel = v.photo_uri ? toRelativePath(v.photo_uri as string) : undefined;
        let newPhotoUri: string | null = null;
        if (oldPhotoRel) {
          const oldPath = `${FileSystem.documentDirectory}${oldPhotoRel}`;
          const newRelative = `vehicles/${created.id}.jpg`;
          const newPath = `${FileSystem.documentDirectory}${newRelative}`;
          try {
            await FileSystem.makeDirectoryAsync(`${FileSystem.documentDirectory}vehicles`, {
              intermediates: true,
            });
            const info = await FileSystem.getInfoAsync(oldPath);
            if (info.exists) {
              if (oldPath !== newPath) {
                // Use copyAsync (not moveAsync) so a transaction rollback can be retried
                // — the source file remains on disk for the next attempt. Orphan source
                // files after successful import are an accepted trade-off until a
                // dedicated cleanup pass is added.
                await FileSystem.copyAsync({ from: oldPath, to: newPath });
              }
              newPhotoUri = newRelative;
            }
          } catch {
            // dacă mutarea eșuează, păstrăm photo_uri null
          }
        }

        const plate = (v.plate_number as string | undefined) ?? null;
        const fuel = (v.fuel_type as 'diesel' | 'benzina' | 'gpl' | 'electric' | undefined) ?? null;
        await entities.updateVehicle(created.id, vehicleName, newPhotoUri, plate, fuel);

        if (v.id) vehicleMap.set(v.id as string, created.id);
        existingVehicleByName.set(nameKey, created.id);
        imported++;
      }
    } catch (e) {
      errors.push(`Vehicul "${v.name}": ${e instanceof Error ? e.message : 'eroare'}`);
    }
  }

  for (const c of (payload.cards as AnyRecord[]) ?? []) {
    try {
      const cardKey = `${(c.last4 as string) || ''}|${((c.nickname as string) || '').toLowerCase().trim()}`;
      const existingId = existingCardByKey.get(cardKey);
      if (existingId) {
        if (c.id) cardMap.set(c.id as string, existingId);
        skipped++;
      } else {
        const created = await entities.createCard(
          (c.nickname as string) || 'Card',
          (c.last4 as string) || '****',
          c.expiry as string | undefined
        );
        if (c.id) cardMap.set(c.id as string, created.id);
        existingCardByKey.set(cardKey, created.id);
        imported++;
      }
    } catch (e) {
      errors.push(`Card "${c.nickname}": ${e instanceof Error ? e.message : 'eroare'}`);
    }
  }

  for (const a of (payload.animals as AnyRecord[]) ?? []) {
    try {
      const animalKey = `${((a.name as string) || '').toLowerCase().trim()}|${((a.species as string) || '').toLowerCase().trim()}`;
      const existingId = existingAnimalByKey.get(animalKey);
      if (existingId) {
        if (a.id) animalMap.set(a.id as string, existingId);
        skipped++;
      } else {
        const created = await entities.createAnimal(
          (a.name as string) || 'Animal',
          (a.species as string) || ''
        );
        if (a.id) animalMap.set(a.id as string, created.id);
        existingAnimalByKey.set(animalKey, created.id);
        imported++;
      }
    } catch (e) {
      errors.push(`Animal "${a.name}": ${e instanceof Error ? e.message : 'eroare'}`);
    }
  }

  for (const co of (payload.companies as AnyRecord[]) ?? []) {
    try {
      const cui = co.cui as string | undefined;
      const nameKey = ((co.name as string) || '').toLowerCase().trim();
      const existingId =
        (cui && existingCompanyByCui.get(cui)) ?? existingCompanyByName.get(nameKey);
      if (existingId) {
        if (co.id) companyMap.set(co.id as string, existingId);
        skipped++;
      } else {
        const created = await entities.createCompany(
          (co.name as string) || 'Firmă',
          cui,
          co.reg_com as string | undefined
        );
        if (co.id) companyMap.set(co.id as string, created.id);
        if (cui) existingCompanyByCui.set(cui, created.id);
        existingCompanyByName.set(nameKey, created.id);
        imported++;
      }
    } catch (e) {
      errors.push(`Firmă "${co.name}": ${e instanceof Error ? e.message : 'eroare'}`);
    }
  }

  // Restaurează ordinea globală a entităților, remappând ID-urile vechi la cele noi.
  // Ordinea e nice-to-have: erorile individuale nu blochează restul importului.
  for (const row of (payload.entityOrder as AnyRecord[]) ?? []) {
    try {
      const oldId = row.entity_id as string | undefined;
      const entityType = row.entity_type as EntityType | undefined;
      const sortOrder = row.sort_order as number | undefined;
      if (!oldId || !entityType || typeof sortOrder !== 'number') continue;
      let newId: string | undefined;
      if (entityType === 'person') newId = personMap.get(oldId);
      else if (entityType === 'property') newId = propertyMap.get(oldId);
      else if (entityType === 'vehicle') newId = vehicleMap.get(oldId);
      else if (entityType === 'card') newId = cardMap.get(oldId);
      else if (entityType === 'animal') newId = animalMap.get(oldId);
      else if (entityType === 'company') newId = companyMap.get(oldId);
      if (!newId) continue;
      await db.runAsync(
        'INSERT OR REPLACE INTO entity_order (entity_type, entity_id, sort_order) VALUES (?, ?, ?)',
        [entityType, newId, sortOrder]
      );
    } catch {
      // ignorăm erori punctuale la restaurarea ordinii
    }
  }

  for (const ct of (payload.customTypes as AnyRecord[]) ?? []) {
    try {
      const nameKey = ((ct.name as string) || '').toLowerCase().trim();
      const existingId = existingCustomTypeByName.get(nameKey);
      if (existingId) {
        if (ct.id) customTypeMap.set(ct.id as string, existingId);
        skipped++;
      } else {
        const created = await createCustomType((ct.name as string) || 'Tip');
        if (ct.id) customTypeMap.set(ct.id as string, created.id);
        existingCustomTypeByName.set(nameKey, created.id);
        imported++;
      }
    } catch (e) {
      errors.push(`Tip personalizat "${ct.name}": ${e instanceof Error ? e.message : 'eroare'}`);
    }
  }

  // Înregistrări carburant
  for (const f of (payload.fuelRecords as AnyRecord[]) ?? []) {
    try {
      const oldVehicleId = f.vehicle_id as string | undefined;
      const newVehicleId = oldVehicleId ? vehicleMap.get(oldVehicleId) : undefined;

      const dedupeKey = `${newVehicleId ?? ''}|${f.date as string}|${f.liters ?? ''}|${f.km_total ?? ''}|${(f.station as string) ?? ''}`;
      if (existingFuelByKey.has(dedupeKey)) {
        skipped++;
        continue;
      }

      const input = {
        date: f.date as string,
        liters: f.liters as number | undefined,
        km_total: f.km_total as number | undefined,
        price: f.price as number | undefined,
        currency: (f.currency as string) || 'RON',
        fuel_type: f.fuel_type as 'diesel' | 'benzina' | 'gpl' | 'electric' | undefined,
        is_full: f.is_full === true || f.is_full === 1,
        station: f.station as string | undefined,
        pump_number: f.pump_number as string | undefined,
      };

      if (newVehicleId) {
        await fuel.addFuelRecord(newVehicleId, input);
      } else {
        await fuel.addCanisterFuelRecord(input);
      }

      existingFuelByKey.add(dedupeKey);
      imported++;
    } catch (e) {
      errors.push(`Alimentare carburant: ${e instanceof Error ? e.message : 'eroare'}`);
    }
  }

  // Mentenanță auto: remap vehicle_id la noile id-uri și deduplicate pe
  // (vehicle_id|name|preset_key). Tasks orfane (vehicle_id necunoscut) sunt sărite
  // ca să nu introducem rânduri inserabile fără context. Inserăm direct în SQL ca
  // să păstrăm `created_at`, `updated_at` și `calendar_event_id` originale.
  const existingMaintenance = await maintenance.getAllMaintenanceTasks();
  const existingMaintenanceByKey = new Set(
    existingMaintenance.map(
      t => `${t.vehicle_id}|${t.name.toLowerCase().trim()}|${t.preset_key ?? ''}`
    )
  );
  for (const m of (payload.maintenanceTasks as AnyRecord[]) ?? []) {
    try {
      const oldVehicleId = m.vehicle_id as string | undefined;
      if (!oldVehicleId) {
        skipped++;
        continue;
      }
      const newVehicleId = vehicleMap.get(oldVehicleId);
      if (!newVehicleId) {
        skipped++;
        continue;
      }
      const name = ((m.name as string) || '').trim();
      const presetKey = (m.preset_key as string | null | undefined) ?? null;
      const key = `${newVehicleId}|${name.toLowerCase()}|${presetKey ?? ''}`;
      if (existingMaintenanceByKey.has(key)) {
        skipped++;
        continue;
      }
      const id = (m.id as string | undefined) || generateId();
      const createdAt =
        (m.createdAt as string) || (m.created_at as string) || new Date().toISOString();
      const updatedAt = (m.updatedAt as string) || (m.updated_at as string) || createdAt;
      await db.runAsync(
        `INSERT INTO vehicle_maintenance_tasks
         (id, vehicle_id, name, preset_key, trigger_km, trigger_months,
          last_done_km, last_done_date, note, calendar_event_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          newVehicleId,
          name || 'Mentenanță',
          presetKey,
          (m.trigger_km as number | undefined) ?? null,
          (m.trigger_months as number | undefined) ?? null,
          (m.last_done_km as number | undefined) ?? null,
          (m.last_done_date as string | undefined) ?? null,
          ((m.note as string | undefined) ?? '').trim() || null,
          (m.calendar_event_id as string | undefined) ?? null,
          createdAt,
          updatedAt,
        ]
      );
      existingMaintenanceByKey.add(key);
      imported++;
    } catch (e) {
      errors.push(`Mentenanță auto: ${e instanceof Error ? e.message : 'eroare'}`);
    }
  }

  // Furnizori utilități: remap property_id la noile id-uri; INSERT OR REPLACE pentru idempotență.
  for (const p of (payload.serviceProviders as AnyRecord[]) ?? []) {
    try {
      const oldPropertyId = p.property_id as string | undefined;
      const newPropertyId = oldPropertyId ? (propertyMap.get(oldPropertyId) ?? oldPropertyId) : null;
      // Skip dacă există deja un furnizor identic pe aceeași proprietate
      const existingRows = await db.getAllAsync<{ id: string }>(
        `SELECT id FROM service_providers WHERE property_id = ? AND type = ? AND provider_name IS ? AND customer_code IS ?`,
        [newPropertyId, p.type as string, (p.provider_name as string | null) ?? null, (p.customer_code as string | null) ?? null]
      );
      if (existingRows.length > 0) {
        skipped++;
        continue;
      }
      await db.runAsync(
        `INSERT OR REPLACE INTO service_providers
           (id, property_id, type, provider_name, customer_code,
            consumption_point_code, support_phone, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          (p.id as string | undefined) || generateId(),
          newPropertyId,
          p.type as string,
          (p.provider_name as string | null | undefined) ?? null,
          (p.customer_code as string | null | undefined) ?? null,
          (p.consumption_point_code as string | null | undefined) ?? null,
          (p.support_phone as string | null | undefined) ?? null,
          (p.created_at as string | undefined) || new Date().toISOString(),
        ]
      );
      imported++;
    } catch (e) {
      errors.push(`Furnizor utilități: ${e instanceof Error ? e.message : 'eroare'}`);
    }
  }

  for (const d of (payload.documents as AnyRecord[]) ?? []) {
    try {
      const docKey = `${d.type as string}|${(d.issue_date as string) ?? ''}|${(d.expiry_date as string) ?? ''}`;
      // Dedupe DOAR pe calea aditivă (import ZIP peste date existente) și DOAR
      // contra rândurilor preexistente în DB — NICIODATĂ contra documentelor
      // tocmai inserate din ACELAȘI manifest (altfel două documente distincte cu
      // aceeași cheie type|issue|expiry, ex. două `altul` fără date, s-ar colapsa
      // iar paginile s-ar atașa greșit la supraviețuitor). La restore (wipeFirst)
      // DB-ul e gol → orice skip = pierdere de date, deci dedupe complet dezactivat.
      if (!wipeFirst) {
        const existingDocId = existingDocByKey.get(docKey);
        if (existingDocId) {
          if (d.id) docIdMap.set(d.id as string, existingDocId);
          skipped++;
          continue;
        }
      }
      const filePath = d.file_path ? toRelativePath(d.file_path as string) : undefined;
      const created = await docs.createDocument({
        type: d.type as DocumentType,
        custom_type_id: d.custom_type_id
          ? (customTypeMap.get(d.custom_type_id as string) ?? undefined)
          : undefined,
        issue_date: (d.issue_date as string) || undefined,
        expiry_date: (d.expiry_date as string) || undefined,
        note: (d.note as string) || undefined,
        file_path: filePath || undefined,
        ocr_text: (d.ocr_text as string) || undefined,
        auto_delete: (d.auto_delete as string) || undefined,
        private_notes: (d.private_notes as string) || undefined,
        metadata: d.metadata
          ? typeof d.metadata === 'string'
            ? (JSON.parse(d.metadata) as Record<string, string>)
            : (d.metadata as Record<string, string>)
          : undefined,
        person_id: d.person_id ? personMap.get(d.person_id as string) : undefined,
        property_id: d.property_id ? propertyMap.get(d.property_id as string) : undefined,
        vehicle_id: d.vehicle_id ? vehicleMap.get(d.vehicle_id as string) : undefined,
        card_id: d.card_id ? cardMap.get(d.card_id as string) : undefined,
        animal_id: d.animal_id ? animalMap.get(d.animal_id as string) : undefined,
        company_id: d.company_id ? companyMap.get(d.company_id as string) : undefined,
      });
      if (d.id) docIdMap.set(d.id as string, created.id);
      // NU adăugăm docKey în existingDocByKey: documentele din același manifest nu
      // se dedupe între ele (vezi comentariul de mai sus). Harta rămâne snapshot-ul
      // rândurilor preexistente în DB.
      // Propagăm flag-ul de orientare lock-uită pe pagina principală.
      if (d.main_orientation_locked === true || d.main_orientation_locked === 1) {
        await docs.lockMainOrientation(created.id);
      }
      // Propagăm ID-ul evenimentului de calendar (pentru dedupe la edit ulterior).
      if (d.calendar_event_id) {
        await docs.setDocumentCalendarEventId(created.id, d.calendar_event_id as string);
      }
      // Propagăm coloanele care NU trec prin createDocument:
      //  - AI medical (spec 2026-05-24): rezumat AI, timestamp prompt reminders,
      //    JSON tranzitoriu — populate doar de pipeline-ul medical.
      //  - file_hash: createDocument îl RECALCULEAZĂ de pe disc; dacă fișierul
      //    lipsește la restore (download eșuat / fișier absent la export) rezultă
      //    null. Restaurăm valoarea din manifest ca detecția de duplicat să rămână
      //    funcțională fără backfill.
      if (
        d.ai_summary != null ||
        d.medical_reminders_prompted_at != null ||
        d.pending_reminders_json != null ||
        (d.file_hash != null && created.file_hash == null)
      ) {
        await db.runAsync(
          `UPDATE documents
             SET ai_summary = ?,
                 medical_reminders_prompted_at = ?,
                 pending_reminders_json = ?,
                 file_hash = COALESCE(file_hash, ?)
           WHERE id = ?`,
          [
            (d.ai_summary as string | null | undefined) ?? null,
            (d.medical_reminders_prompted_at as string | null | undefined) ?? null,
            (d.pending_reminders_json as string | null | undefined) ?? null,
            (d.file_hash as string | null | undefined) ?? null,
            created.id,
          ]
        );
      }
      imported++;
    } catch (e) {
      errors.push(`Document "${d.type}": ${e instanceof Error ? e.message : 'eroare'}`);
    }
  }

  for (const page of (payload.documentPages as AnyRecord[]) ?? []) {
    try {
      if (!page.document_id || !page.file_path) continue;
      const newDocId = docIdMap.get(page.document_id as string);
      if (!newDocId) continue;
      const filePath = toRelativePath(page.file_path as string);
      const newPageId = await docs.addDocumentPage(newDocId, filePath);
      if (page.orientation_locked === true || page.orientation_locked === 1) {
        await docs.lockPageOrientation(newPageId);
      }
      imported++;
    } catch (e) {
      errors.push(`Pagina document: ${e instanceof Error ? e.message : 'eroare'}`);
    }
  }

  // ── Restaurare tabele medicale ──────────────────────────────────────────────
  // Dosarele își păstrează id-ul (recordIdMap = identitate) dar person_id trebuie
  // remapat: persoanele primesc id-uri NOI la restore, iar fără remap
  // getMedicalRecordByPersonId(noulPersonId) întoarce null → dosarul devine invizibil.
  for (const r of (payload.medicalRecords as AnyRecord[]) ?? []) {
    try {
      const oldPersonId = r.person_id as string;
      const newPersonId = personMap.get(oldPersonId) ?? oldPersonId;
      // UPSERT (nu INSERT OR REPLACE): cu FK ON, REPLACE = DELETE + INSERT, iar
      // DELETE-ul ar cascada pe medical_observations/threads/messages/shares. La
      // import ADITIV peste un dosar existent (același id) asta ar șterge copiii
      // deja în DB (ex. observații adăugate după backup). `ON CONFLICT(id) DO UPDATE`
      // actualizează rândul in-place, fără DELETE → copiii NU se pierd. La restore
      // (wipeFirst) DB e gol → niciun conflict → comportament identic cu INSERT.
      // Un conflict pe UNIQUE(person_id) cu alt id aruncă → prinsă mai jos → dosarul
      // din backup e sărit, cel existent rămâne intact (nu suprascriem date existente).
      await db.runAsync(
        `INSERT INTO medical_record
          (id, person_id, name, ai_consent_at, ai_consent_version, encryption_key_ref,
           blood_group, allergies, emergency_contact_name, emergency_contact_phone,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           person_id = excluded.person_id,
           name = excluded.name,
           ai_consent_at = excluded.ai_consent_at,
           ai_consent_version = excluded.ai_consent_version,
           encryption_key_ref = excluded.encryption_key_ref,
           blood_group = excluded.blood_group,
           allergies = excluded.allergies,
           emergency_contact_name = excluded.emergency_contact_name,
           emergency_contact_phone = excluded.emergency_contact_phone,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at`,
        [
          r.id as string,
          newPersonId,
          r.name as string,
          (r.ai_consent_at as string | null) ?? null,
          (r.ai_consent_version as number | null) ?? 1,
          r.encryption_key_ref as string,
          (r.blood_group as string | null) ?? null,
          (r.allergies as string | null) ?? null,
          (r.emergency_contact_name as string | null) ?? null,
          (r.emergency_contact_phone as string | null) ?? null,
          r.created_at as string,
          r.updated_at as string,
        ]
      );
      recordIdMap.set(r.id as string, r.id as string);
    } catch (e) {
      errors.push(`Dosar medical: ${e instanceof Error ? e.message : 'eroare'}`);
    }
  }
  for (const o of (payload.medicalObservations as AnyRecord[]) ?? []) {
    try {
      // source_document_id → remap prin docIdMap; dacă documentul sursă nu a fost
      // importat (lipsă din manifest), coloana e FK ON DELETE SET NULL → o punem null
      // ca să nu rămână legătura către un id inexistent.
      const oldSrc = (o.source_document_id as string | null) ?? null;
      const newSrc = oldSrc ? (docIdMap.get(oldSrc) ?? null) : null;
      await db.runAsync(
        `INSERT OR REPLACE INTO medical_observations
          (id, medical_record_id, source_document_id, name, value, unit,
           ref_min, ref_max, observed_at, category, confidence, needs_review,
           user_corrected, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          o.id as string,
          o.medical_record_id as string,
          newSrc,
          (o.name as string | null) ?? '[indisponibil]',
          (o.value as string | null) ?? null,
          (o.unit as string | null) ?? null,
          (o.ref_min as string | null) ?? null,
          (o.ref_max as string | null) ?? null,
          (o.observed_at as string | null) ?? null,
          o.category as string,
          o.confidence as number,
          o.needs_review ? 1 : 0,
          o.user_corrected ? 1 : 0,
          o.created_at as string,
          o.updated_at as string,
        ]
      );
    } catch (e) {
      errors.push(`Observație medicală: ${e instanceof Error ? e.message : 'eroare'}`);
    }
  }
  for (const t of (payload.medicalChatThreads as AnyRecord[]) ?? []) {
    try {
      // UPSERT (nu INSERT OR REPLACE): thread-ul e părinte pentru medical_chat_messages
      // (FK ON DELETE CASCADE). Cu FK ON, REPLACE ar șterge mesajele existente la
      // import aditiv peste un thread cu același id. `ON CONFLICT(id) DO UPDATE`
      // actualizează in-place → mesajele NU se pierd.
      await db.runAsync(
        `INSERT INTO medical_chat_threads
          (id, medical_record_id, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           medical_record_id = excluded.medical_record_id,
           title = excluded.title,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at`,
        [
          t.id as string,
          t.medical_record_id as string,
          t.title as string,
          t.created_at as string,
          t.updated_at as string,
        ]
      );
    } catch (e) {
      errors.push(`Thread chat medical: ${e instanceof Error ? e.message : 'eroare'}`);
    }
  }
  for (const m of (payload.medicalChatMessages as AnyRecord[]) ?? []) {
    try {
      await db.runAsync(
        `INSERT OR REPLACE INTO medical_chat_messages
          (id, thread_id, role, content, citations_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          m.id as string,
          m.thread_id as string,
          m.role as string,
          (m.content as string | null) ?? '[mesaj indisponibil]',
          (m.citations_json as string | null) ?? null,
          m.created_at as string,
        ]
      );
    } catch (e) {
      errors.push(`Mesaj chat medical: ${e instanceof Error ? e.message : 'eroare'}`);
    }
  }
  for (const s of (payload.medicalDocumentSummaries as AnyRecord[]) ?? []) {
    try {
      // document_id e PK + FK către documents; remapăm prin docIdMap. Fără mapare
      // (document neimportat) sumarul e orfan → îl sărim (altfel FK violation).
      const oldDocId = s.document_id as string;
      const newDocId = docIdMap.get(oldDocId);
      if (!newDocId) {
        skipped++;
        continue;
      }
      await db.runAsync(
        `INSERT OR REPLACE INTO medical_document_summaries
          (document_id, summary, generated_at, model_used)
         VALUES (?, ?, ?, ?)`,
        [
          newDocId,
          s.summary as string,
          s.generated_at as string,
          (s.model_used as string | null) ?? null,
        ]
      );
    } catch (e) {
      errors.push(`Sumar document medical: ${e instanceof Error ? e.message : 'eroare'}`);
    }
  }
  for (const sh of (payload.medicalShares as AnyRecord[]) ?? []) {
    try {
      await db.runAsync(
        `INSERT OR REPLACE INTO medical_shares
          (id, medical_record_id, created_at, expires_at, size_bytes, doc_count, obs_count, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sh.id as string,
          sh.medical_record_id as string,
          sh.created_at as string,
          sh.expires_at as string,
          sh.size_bytes as number,
          sh.doc_count as number,
          sh.obs_count as number,
          (sh.revoked_at as string | null) ?? null,
        ]
      );
    } catch (e) {
      errors.push(`Share medical: ${e instanceof Error ? e.message : 'eroare'}`);
    }
  }

  // ── Restaurare document_entities (junction table) ────────────────────────────
  // Sursa completă a legăturilor document↔entitate: multi-link de același tip ȘI
  // legături către dosare medicale (care NU au coloană legacy). createDocument a
  // recreat deja legăturile din coloanele legacy single-value; aici completăm restul
  // cu INSERT OR IGNORE (UNIQUE pe document_id+entity_type+entity_id sare duplicatele).
  // Manifest vechi fără câmp → loop sărit → fallback la reconstrucția legacy.
  const remapLinkEntityId = (entityType: string, oldId: string): string | undefined =>
    entityIdMaps.get(entityType as EntityType)?.get(oldId);
  if (Array.isArray(payload.documentEntities)) {
    for (const link of payload.documentEntities as AnyRecord[]) {
      try {
        const oldDocId = link.document_id as string | undefined;
        const entityType = link.entity_type as string | undefined;
        const oldEntityId = link.entity_id as string | undefined;
        if (!oldDocId || !entityType || !oldEntityId) continue;
        const newDocId = docIdMap.get(oldDocId);
        if (!newDocId) continue; // documentul nu a fost importat
        const newEntityId = remapLinkEntityId(entityType, oldEntityId);
        if (!newEntityId) continue; // entitatea nu a fost importată → link orfan sărit
        await db.runAsync(
          'INSERT OR IGNORE INTO document_entities (id, document_id, entity_type, entity_id) VALUES (?, ?, ?, ?)',
          [generateId(), newDocId, entityType, newEntityId]
        );
      } catch (e) {
        errors.push(`Legătură document: ${e instanceof Error ? e.message : 'eroare'}`);
      }
    }
  }

  // ── Restaurare remindere ────────────────────────────────────────────────────
  // Opțional pentru backward compat cu backup-uri vechi (fără câmpul reminders).
  // Remap FK-uri (document_id + entity_id-uri) la noile id-uri; calendar_event_id →
  // null (eveniment specific device-ului vechi, nevalabil pe device-ul curent).
  // Dedupe cu reminderul auto-creat de syncDocumentExpiryReminder în createDocument:
  // pentru un `document_expiry` pe același document ACTUALIZĂM rândul auto-creat
  // (păstrând dismissed_at din backup) în loc să inserăm un duplicat. Reminderele al
  // căror document sursă nu mai există sunt sărite (altfel orfani nenavigabili).
  if (Array.isArray(payload.reminders)) {
    for (const r of payload.reminders as AnyRecord[]) {
      try {
        const oldDocId = (r.document_id as string | null) ?? null;
        let newDocId: string | null = null;
        if (oldDocId) {
          newDocId = docIdMap.get(oldDocId) ?? null;
          if (!newDocId) {
            // Import aditiv: documentul poate exista deja în DB fără să fi fost în
            // payload.documents (deci absent din docIdMap). Îl acceptăm dacă rândul chiar există.
            const existingDoc = await db.getFirstAsync<{ id: string }>(
              'SELECT id FROM documents WHERE id = ? LIMIT 1',
              [oldDocId]
            );
            newDocId = existingDoc?.id ?? null;
          }
          if (!newDocId) continue; // reminder orfan — documentul sursă lipsește
        }
        const sourceType = r.source_type as string;
        const label = r.label as string;
        const reminderDate = r.reminder_date as string;
        const dismissedAt = (r.dismissed_at as string | null) ?? null;
        const newPerson = r.person_id ? (personMap.get(r.person_id as string) ?? null) : null;
        const newVehicle = r.vehicle_id ? (vehicleMap.get(r.vehicle_id as string) ?? null) : null;
        const newProperty = r.property_id ? (propertyMap.get(r.property_id as string) ?? null) : null;
        const newAnimal = r.animal_id ? (animalMap.get(r.animal_id as string) ?? null) : null;
        const newCard = r.card_id ? (cardMap.get(r.card_id as string) ?? null) : null;

        let existingReminderId: string | null = null;
        if (newDocId && sourceType === 'document_expiry') {
          const existing = await db.getFirstAsync<{ id: string }>(
            `SELECT id FROM reminders WHERE document_id = ? AND source_type = 'document_expiry' LIMIT 1`,
            [newDocId]
          );
          existingReminderId = existing?.id ?? null;
        }

        if (existingReminderId) {
          await db.runAsync(
            `UPDATE reminders SET
               label = ?, reminder_date = ?, dismissed_at = ?, calendar_event_id = NULL,
               person_id = ?, vehicle_id = ?, property_id = ?, animal_id = ?, card_id = ?
             WHERE id = ?`,
            [
              label,
              reminderDate,
              dismissedAt,
              newPerson,
              newVehicle,
              newProperty,
              newAnimal,
              newCard,
              existingReminderId,
            ]
          );
        } else {
          await db.runAsync(
            `INSERT OR REPLACE INTO reminders (
               id, source_type, document_id, person_id, vehicle_id, property_id, animal_id, card_id,
               label, reminder_date, calendar_event_id, origin, created_at, dismissed_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
            [
              r.id as string,
              sourceType,
              newDocId,
              newPerson,
              newVehicle,
              newProperty,
              newAnimal,
              newCard,
              label,
              reminderDate,
              r.origin as string,
              r.created_at as string,
              dismissedAt,
            ]
          );
        }
      } catch (e) {
        console.warn('[applyManifest] reminder skip:', r.id, e);
      }
    }
  }

  // Rebuild medical_fts from documents.ocr_text + medical_document_summaries
  try {
    const { rebuildFtsFromExistingData } = await import('./medicalFts');
    await rebuildFtsFromExistingData();
  } catch {
    // FTS rebuild e opțional — nu blochează restore-ul
  }

  try {
    await onRestoreSuccess(imported);
  } catch {
    // Trigger review opțional.
  }

  return { imported, skipped, errors };
}

/**
 * Șterge toate datele utilizator (entități, documente, fișiere asociate metadata)
 * înaintea unui restore complet din cloud. Nu atinge tabelele de infrastructură
 * (cloud_state, pending_uploads).
 */
async function wipeUserData(): Promise<void> {
  await db.execAsync(`
    DELETE FROM medical_fts;
    DELETE FROM medical_shares;
    DELETE FROM medical_chat_messages;
    DELETE FROM medical_chat_threads;
    DELETE FROM medical_observations;
    DELETE FROM medical_document_summaries;
    DELETE FROM medical_record;
    DELETE FROM reminders;
    DELETE FROM document_pages;
    DELETE FROM document_entities;
    DELETE FROM documents;
    DELETE FROM fuel_records;
    DELETE FROM service_providers;
    DELETE FROM vehicle_maintenance_tasks;
    DELETE FROM custom_document_types;
    DELETE FROM cards;
    DELETE FROM animals;
    DELETE FROM companies;
    DELETE FROM vehicles;
    DELETE FROM properties;
    DELETE FROM persons;
    DELETE FROM entity_order;
    DELETE FROM chat_messages;
    DELETE FROM chat_threads;
    DELETE FROM cloud_pending_deletes;
  `);
}

/**
 * Importă datele dintr-un backup ZIP (version 4) sau JSON vechi (version 1-3).
 * Backward compatibility: backupurile JSON mai vechi sunt importate ca înainte.
 */
export async function importBackup(): Promise<ImportResult> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/zip', 'application/json', 'public.zip-archive', 'public.json'],
    copyToCacheDirectory: true,
  });

  if (!result || result.canceled || !result.assets || result.assets.length === 0) {
    throw new Error('Anulat');
  }

  const asset = result.assets[0];
  const uri = asset.uri;
  const name = asset.name ?? '';

  const isZip =
    name.toLowerCase().endsWith('.zip') ||
    asset.mimeType === 'application/zip' ||
    asset.mimeType === 'public.zip-archive';

  let payload: Record<string, unknown>;

  if (isZip) {
    // --- Format ZIP (version 4) ---
    let zipBase64: string;
    try {
      zipBase64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
    } catch {
      throw new Error('Nu s-a putut citi fișierul ZIP.');
    }

    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(zipBase64, { base64: true });
    } catch {
      throw new Error('Fișierul ZIP este invalid sau corupt.');
    }

    const manifestFile = zip.file('backup.json');
    if (!manifestFile) {
      throw new Error('Fișierul ZIP nu conține un manifest valid (backup.json lipsă).');
    }

    const manifestText = await manifestFile.async('string');
    try {
      payload = JSON.parse(manifestText) as Record<string, unknown>;
    } catch {
      throw new Error('Manifestul backup.json este invalid.');
    }

    // Extrage fișierele din ZIP pe disk (pasează fileMap pentru version 5+)
    const manifestFileMap =
      payload.fileMap && typeof payload.fileMap === 'object'
        ? (payload.fileMap as Record<string, string>)
        : undefined;
    await extractFilesFromZip(zip, manifestFileMap);
  } else {
    // --- Format JSON vechi (version 1-3) ---
    const json = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    try {
      payload = JSON.parse(json) as Record<string, unknown>;
    } catch {
      throw new Error('Fișierul JSON este invalid sau corupt.');
    }

    // Restaurare imagini din câmpul images (version 3)
    if (payload.images && typeof payload.images === 'object') {
      const imagesDir = `${FileSystem.documentDirectory}documents`;
      await FileSystem.makeDirectoryAsync(imagesDir, { intermediates: true });
      for (const [relativePath, base64] of Object.entries(
        payload.images as Record<string, string>
      )) {
        try {
          const dest = `${FileSystem.documentDirectory}${relativePath}`;
          await FileSystem.writeAsStringAsync(dest, base64, {
            encoding: FileSystem.EncodingType.Base64,
          });
        } catch {
          // Skip imagini care nu pot fi restaurate
        }
      }
    }
  }

  return await applyManifest(payload);
}
