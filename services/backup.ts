import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import JSZip from 'jszip';
import type { DocumentType, EntityType } from '@/types';
import { DOCUMENT_TYPE_LABELS } from '@/types';
import * as entities from './entities';
import * as docs from './documents';
import * as fuel from './fuel';
import * as maintenance from './maintenance';
import { getCustomTypes, createCustomType } from './customTypes';
import { toFileUri, toRelativePath } from './fileUtils';
import { onRestoreSuccess } from './reviewPrompt';
import { db, generateId } from './db';
import { emit } from './events';

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
 * Sanitizează un string pentru utilizare ca nume de folder în arhivă.
 */
function sanitizeFolderName(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, '_').trim() || 'General';
}

/**
 * Construiește un map: diskRelativePath → zipRelativePath (în interiorul files/).
 * Organizează fișierele în foldere cu numele entităților și tipului de document.
 */
function buildFileMap(
  allDocuments: Awaited<ReturnType<typeof docs.getDocuments>>,
  allPages: Awaited<ReturnType<typeof docs.getAllDocumentPages>>,
  personNames: Map<string, string>,
  vehicleNames: Map<string, string>,
  propertyNames: Map<string, string>,
  cardNames: Map<string, string>,
  animalNames: Map<string, string>,
  companyNames: Map<string, string>
): Record<string, string> {
  const fileMap: Record<string, string> = {};
  const docById = new Map(allDocuments.map(d => [d.id, d]));

  function entityFolder(doc: (typeof allDocuments)[number]): string {
    if (doc.vehicle_id) return vehicleNames.get(doc.vehicle_id) ?? 'General';
    if (doc.person_id) return personNames.get(doc.person_id) ?? 'General';
    if (doc.property_id) return propertyNames.get(doc.property_id) ?? 'General';
    if (doc.animal_id) return animalNames.get(doc.animal_id) ?? 'General';
    if (doc.company_id) return companyNames.get(doc.company_id) ?? 'General';
    if (doc.card_id) return cardNames.get(doc.card_id) ?? 'General';
    return 'General';
  }

  function zipPath(entityName: string, docType: DocumentType, diskRelPath: string): string {
    const filename = diskRelPath.split('/').pop() ?? diskRelPath;
    const ef = sanitizeFolderName(entityName);
    const tf = sanitizeFolderName(DOCUMENT_TYPE_LABELS[docType] ?? docType);
    return `${ef}/${tf}/${filename}`;
  }

  for (const doc of allDocuments) {
    if (!doc.file_path) continue;
    const rel = toRelativePath(doc.file_path);
    if (!fileMap[rel]) {
      fileMap[rel] = zipPath(entityFolder(doc), doc.type, rel);
    }
  }

  for (const page of allPages) {
    if (!page.file_path) continue;
    const rel = toRelativePath(page.file_path);
    if (fileMap[rel]) continue;
    const parentDoc = docById.get(page.document_id);
    if (parentDoc) {
      fileMap[rel] = zipPath(entityFolder(parentDoc), parentDoc.type, rel);
    } else {
      fileMap[rel] = rel; // fallback: cale originală
    }
  }

  return fileMap;
}

/**
 * Exportă toate datele ca fișier ZIP conținând:
 *  - backup.json  (manifest cu entități + documente + fileMap)
 *  - files/<NumeEntitate>/<TipDocument>/<fisier>  (pozele și PDF-urile organizate pe entități)
 *
 * Format version: 8
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
    docs.getDocuments(),
    docs.getAllDocumentPages(),
    getCustomTypes(),
    db.getAllAsync<{ entity_type: EntityType; entity_id: string; sort_order: number }>(
      'SELECT entity_type, entity_id, sort_order FROM entity_order'
    ),
  ]);

  const personNames = new Map(persons.map(p => [p.id, p.name]));
  const vehicleNames = new Map(vehicles.map(v => [v.id, v.name]));
  const propertyNames = new Map(properties.map(p => [p.id, p.name]));
  const cardNames = new Map(
    cards.map(c => [c.id, c.nickname ? `${c.nickname} ····${c.last4}` : `Card ····${c.last4}`])
  );
  const animalNames = new Map(animals.map(a => [a.id, a.name]));
  const companyNames = new Map(companies.map(c => [c.id, c.name]));

  const fileMap = buildFileMap(
    documents,
    allPages,
    personNames,
    vehicleNames,
    propertyNames,
    cardNames,
    animalNames,
    companyNames
  );

  // Task 17: include vehicle photos in ZIP
  for (const v of vehicles) {
    if (!v.photo_uri) continue;
    const rel = toRelativePath(v.photo_uri);
    if (!rel || fileMap[rel]) continue;
    const folder = sanitizeFolderName(v.name);
    fileMap[rel] = `Vehicule/${folder}/photo.jpg`;
  }

  const manifest = {
    version: 10,
    exportDate: new Date().toISOString(),
    persons,
    properties,
    vehicles,
    cards,
    animals,
    companies,
    fuelRecords: fuelRecordsList,
    maintenanceTasks,
    customTypes,
    documents,
    documentPages: allPages,
    entityOrder,
    fileMap,
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

  const zipBase64 = await zip.generateAsync({ type: 'base64' });

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
 * Când `wipeFirst: true`, întreaga operație (wipe + import) rulează într-o
 * tranzacție SQLite atomică: dacă orice pas eșuează, DB-ul rămâne în starea
 * de dinaintea apelului (nu rămâne pe jumătate restaurat). Pentru
 * `wipeFirst: false` (calea ZIP din `importBackup`) execuția rămâne aditivă
 * fără tranzacție — un eșec parțial poate lăsa entități importate în DB.
 *
 * Atomicitate: tranzacția DB se aplică doar pentru `wipeFirst: true` și
 * acoperă DOAR scrierea în SQLite. Operațiunile pe disc (copy fișiere,
 * fișiere descărcate de `restoreFromCloud`) NU sunt rollback-uite — pot
 * rămâne orfani după un eșec, recuperate la următoarea încercare.
 */
export async function applyManifest(
  payload: Record<string, unknown>,
  options: ApplyManifestOptions = {}
): Promise<ImportResult> {
  _importInProgress = true;
  try {
    if (options.wipeFirst) {
      let result!: ImportResult;
      await db.withTransactionAsync(async () => {
        await wipeUserData();
        result = await applyManifestBody(payload);
      });
      return result;
    }
    return await applyManifestBody(payload);
  } finally {
    _importInProgress = false;
    emit('documents:changed');
    emit('links:changed');
    emit('entities:changed');
    emit('customTypes:changed');
    emit('settings:changed');
  }
}

async function applyManifestBody(payload: Record<string, unknown>): Promise<ImportResult> {
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

  const personMap = new Map<string, string>();
  const propertyMap = new Map<string, string>();
  const vehicleMap = new Map<string, string>();
  const cardMap = new Map<string, string>();
  const animalMap = new Map<string, string>();
  const companyMap = new Map<string, string>();
  const customTypeMap = new Map<string, string>();
  const docIdMap = new Map<string, string>();

  type AnyRecord = Record<string, unknown>;

  for (const p of (payload.persons as AnyRecord[]) ?? []) {
    try {
      const nameKey = ((p.name as string) || '').toLowerCase().trim();
      const existingId = existingPersonByName.get(nameKey);
      if (existingId) {
        if (p.id) personMap.set(p.id as string, existingId);
        skipped++;
      } else {
        const created = await entities.createPerson((p.name as string) || 'Persoană');
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

  for (const d of (payload.documents as AnyRecord[]) ?? []) {
    try {
      const docKey = `${d.type as string}|${(d.issue_date as string) ?? ''}|${(d.expiry_date as string) ?? ''}`;
      const existingDocId = existingDocByKey.get(docKey);
      if (existingDocId) {
        if (d.id) docIdMap.set(d.id as string, existingDocId);
        skipped++;
        continue;
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
      existingDocByKey.set(docKey, created.id);
      // Propagăm flag-ul de orientare lock-uită pe pagina principală.
      if (d.main_orientation_locked === true || d.main_orientation_locked === 1) {
        await docs.lockMainOrientation(created.id);
      }
      // Propagăm ID-ul evenimentului de calendar (pentru dedupe la edit ulterior).
      if (d.calendar_event_id) {
        await docs.setDocumentCalendarEventId(created.id, d.calendar_event_id as string);
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
    DELETE FROM document_pages;
    DELETE FROM document_entities;
    DELETE FROM documents;
    DELETE FROM fuel_records;
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
