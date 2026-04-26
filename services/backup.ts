import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import JSZip from 'jszip';
import type { DocumentType, EntityType, FinancialAccountType, TransactionSource } from '@/types';
import { DOCUMENT_TYPE_LABELS } from '@/types';
import * as entities from './entities';
import * as docs from './documents';
import * as financialAccounts from './financialAccounts';
import * as categories from './categories';
import * as transactions from './transactions';
import * as fuel from './fuel';
import { getCustomTypes, createCustomType } from './customTypes';
import { toFileUri, toRelativePath } from './fileUtils';
import { onRestoreSuccess } from './reviewPrompt';
import { db, generateId } from './db';

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
    financialAccountsList,
    expenseCategoriesList,
    transactionsList,
    bankStatementsRows,
    fuelRecordsList,
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
    financialAccounts.getFinancialAccounts(true),
    categories.getCategories(true),
    transactions.getTransactions({ excludeDuplicates: false }),
    db.getAllAsync<{
      id: string;
      account_id: string;
      period_from: string;
      period_to: string;
      file_path: string | null;
      file_hash: string | null;
      imported_at: string;
      transaction_count: number;
      total_inflow: number;
      total_outflow: number;
      notes: string | null;
      created_at: string;
    }>('SELECT * FROM bank_statements'),
    fuel.getAllFuelRecords(),
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
    version: 8,
    exportDate: new Date().toISOString(),
    persons,
    properties,
    vehicles,
    cards,
    animals,
    companies,
    financialAccounts: financialAccountsList,
    expenseCategories: expenseCategoriesList,
    transactions: transactionsList,
    bankStatements: bankStatementsRows,
    fuelRecords: fuelRecordsList,
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

  // --- Încarcă entitățile existente pentru deduplicare ---
  const [
    existingPersons,
    existingProperties,
    existingVehicles,
    existingCards,
    existingAnimals,
    existingCompanies,
    existingFinancialAccounts,
    existingCategories,
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
    financialAccounts.getFinancialAccounts(true),
    categories.getCategories(true),
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
  // Cont financiar: dedupe by name + type (case-insensitive)
  const existingFinancialAccountByKey = new Map(
    existingFinancialAccounts.map(a => [`${a.name.toLowerCase().trim()}|${a.type}`, a.id])
  );
  // Categorii: sistem după `key`, custom după `name`
  const existingCategoryByKey = new Map(
    existingCategories.filter(c => c.key).map(c => [`sys:${c.key}`, c.id])
  );
  const existingCategoryByName = new Map(
    existingCategories.filter(c => !c.is_system).map(c => [c.name.toLowerCase().trim(), c.id])
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
  const financialAccountMap = new Map<string, string>();
  const categoryMap = new Map<string, string>();
  const fuelRecordMap = new Map<string, string>();
  const transactionMap = new Map<string, string>();
  const bankStatementMap = new Map<string, string>();
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
                await FileSystem.moveAsync({ from: oldPath, to: newPath });
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

  // Conturi financiare (înainte de entityOrder ca să fie incluse în remap)
  for (const a of (payload.financialAccounts as AnyRecord[]) ?? []) {
    try {
      const nameKey = ((a.name as string) || '').toLowerCase().trim();
      const type = (a.type as FinancialAccountType) || 'bank';
      const key = `${nameKey}|${type}`;
      const existingId = existingFinancialAccountByKey.get(key);
      if (existingId) {
        if (a.id) financialAccountMap.set(a.id as string, existingId);
        skipped++;
      } else {
        const created = await financialAccounts.createFinancialAccount({
          name: (a.name as string) || 'Cont',
          type,
          currency: (a.currency as string) || 'RON',
          initial_balance: (a.initial_balance as number) ?? 0,
          initial_balance_date: a.initial_balance_date as string | undefined,
          iban: a.iban as string | undefined,
          bank_name: a.bank_name as string | undefined,
          color: a.color as string | undefined,
          icon: a.icon as string | undefined,
          notes: a.notes as string | undefined,
        });
        if (a.archived === true || a.archived === 1) {
          await financialAccounts.archiveFinancialAccount(created.id, true);
        }
        if (a.id) financialAccountMap.set(a.id as string, created.id);
        existingFinancialAccountByKey.set(key, created.id);
        imported++;
      }
    } catch (e) {
      errors.push(`Cont financiar "${a.name}": ${e instanceof Error ? e.message : 'eroare'}`);
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
      else if (entityType === 'financial_account') newId = financialAccountMap.get(oldId);
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

  // Categorii cheltuieli — sistem după `key`, custom după `name`
  for (const c of (payload.expenseCategories as AnyRecord[]) ?? []) {
    try {
      const key = c.key as string | undefined;
      const isSystem = c.is_system === true || c.is_system === 1;
      const oldId = c.id as string | undefined;

      if (isSystem && key) {
        const existingId = existingCategoryByKey.get(`sys:${key}`);
        if (existingId) {
          if (oldId) categoryMap.set(oldId, existingId);
          // Aplică limita lunară din backup dacă era setată (overrides default-ul)
          if (typeof c.monthly_limit === 'number') {
            try {
              await db.runAsync('UPDATE expense_categories SET monthly_limit = ? WHERE id = ?', [
                c.monthly_limit,
                existingId,
              ]);
            } catch {
              // ignorăm
            }
          }
          skipped++;
        }
        // Categoriile sistem nu se inserează manual (sunt seed-ate la pornire); skip dacă lipsesc
        continue;
      }

      const nameKey = ((c.name as string) || '').toLowerCase().trim();
      const existingId = existingCategoryByName.get(nameKey);
      if (existingId) {
        if (oldId) categoryMap.set(oldId, existingId);
        skipped++;
      } else {
        const created = await categories.createCategory({
          name: (c.name as string) || 'Categorie',
          icon: c.icon as string | undefined,
          color: c.color as string | undefined,
          monthly_limit: c.monthly_limit as number | undefined,
          display_order: c.display_order as number | undefined,
        });
        if (c.archived === true || c.archived === 1) {
          await categories.archiveCategory(created.id, true);
        }
        if (oldId) categoryMap.set(oldId, created.id);
        existingCategoryByName.set(nameKey, created.id);
        imported++;
      }
    } catch (e) {
      errors.push(`Categorie "${c.name}": ${e instanceof Error ? e.message : 'eroare'}`);
    }
  }

  // Extrase bancare — dedupe prin (account_id + period_from + period_to + file_hash)
  const existingBankStatements = await db.getAllAsync<{
    id: string;
    account_id: string;
    period_from: string;
    period_to: string;
    file_hash: string | null;
  }>('SELECT id, account_id, period_from, period_to, file_hash FROM bank_statements');
  const existingStatementByKey = new Map(
    existingBankStatements.map(s => [
      `${s.account_id}|${s.period_from}|${s.period_to}|${s.file_hash ?? ''}`,
      s.id,
    ])
  );

  for (const s of (payload.bankStatements as AnyRecord[]) ?? []) {
    try {
      const oldAccountId = s.account_id as string | undefined;
      if (!oldAccountId) continue;
      const newAccountId = financialAccountMap.get(oldAccountId);
      if (!newAccountId) continue;
      const key = `${newAccountId}|${s.period_from as string}|${s.period_to as string}|${(s.file_hash as string) ?? ''}`;
      const existingId = existingStatementByKey.get(key);
      if (existingId) {
        if (s.id) bankStatementMap.set(s.id as string, existingId);
        skipped++;
        continue;
      }
      const newId = generateId();
      const filePath = s.file_path ? toRelativePath(s.file_path as string) : null;
      await db.runAsync(
        `INSERT INTO bank_statements
           (id, account_id, period_from, period_to, file_path, file_hash,
            imported_at, transaction_count, total_inflow, total_outflow, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newId,
          newAccountId,
          s.period_from as string,
          s.period_to as string,
          filePath,
          (s.file_hash as string | null) ?? null,
          (s.imported_at as string) || new Date().toISOString(),
          (s.transaction_count as number) ?? 0,
          (s.total_inflow as number) ?? 0,
          (s.total_outflow as number) ?? 0,
          (s.notes as string | null) ?? null,
          (s.created_at as string) || new Date().toISOString(),
        ]
      );
      if (s.id) bankStatementMap.set(s.id as string, newId);
      existingStatementByKey.set(key, newId);
      imported++;
    } catch (e) {
      errors.push(`Extras bancar: ${e instanceof Error ? e.message : 'eroare'}`);
    }
  }

  // Înregistrări carburant — înainte de tranzacții (tranzacțiile leagă fuel_record_id)
  for (const f of (payload.fuelRecords as AnyRecord[]) ?? []) {
    try {
      const oldId = f.id as string | undefined;
      const oldVehicleId = f.vehicle_id as string | undefined;
      const newVehicleId = oldVehicleId ? vehicleMap.get(oldVehicleId) : undefined;
      const oldAccountId = f.account_id as string | undefined;
      const newAccountId = oldAccountId ? financialAccountMap.get(oldAccountId) : undefined;

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
        account_id: newAccountId,
      };

      const created = newVehicleId
        ? await fuel.addFuelRecord(newVehicleId, input)
        : await fuel.addCanisterFuelRecord(input);

      if (oldId) fuelRecordMap.set(oldId, created.id);
      existingFuelByKey.add(dedupeKey);
      imported++;
    } catch (e) {
      errors.push(`Alimentare carburant: ${e instanceof Error ? e.message : 'eroare'}`);
    }
  }

  // Tranzacții — primul pas: insert fără linked_transaction_id / duplicate_of_id (al doilea pas leagă)
  // Dedupe: account + date + amount + (description || merchant)
  const existingTransactions = await transactions.getTransactions({ excludeDuplicates: false });
  const txKey = (t: {
    account_id?: string;
    date: string;
    amount: number;
    description?: string;
    merchant?: string;
  }) =>
    `${t.account_id ?? ''}|${t.date}|${t.amount.toFixed(2)}|${(t.description ?? '').toLowerCase().trim()}|${(t.merchant ?? '').toLowerCase().trim()}`;
  const existingTxByKey = new Map(existingTransactions.map(t => [txKey(t), t.id]));

  const txWithLink: { oldId: string; newId: string; oldLinkedId: string }[] = [];
  const txDuplicates: { oldId: string; newId: string; oldOriginalId: string }[] = [];
  const txWithSourceDoc: { newId: string; oldDocId: string }[] = [];

  for (const t of (payload.transactions as AnyRecord[]) ?? []) {
    try {
      const oldId = t.id as string | undefined;
      const oldAccountId = t.account_id as string | undefined;
      const newAccountId = oldAccountId ? financialAccountMap.get(oldAccountId) : undefined;
      const oldCategoryId = t.category_id as string | undefined;
      const newCategoryId = oldCategoryId ? categoryMap.get(oldCategoryId) : undefined;
      const oldStatementId = t.statement_id as string | undefined;
      const newStatementId = oldStatementId ? bankStatementMap.get(oldStatementId) : undefined;
      const oldFuelRecordId = t.fuel_record_id as string | undefined;
      const newFuelRecordId = oldFuelRecordId ? fuelRecordMap.get(oldFuelRecordId) : undefined;

      const candidate = {
        account_id: newAccountId,
        date: t.date as string,
        amount: t.amount as number,
        description: t.description as string | undefined,
        merchant: t.merchant as string | undefined,
      };
      const existingId = existingTxByKey.get(txKey(candidate));
      if (existingId) {
        if (oldId) transactionMap.set(oldId, existingId);
        skipped++;
        continue;
      }

      const created = await transactions.createTransaction({
        account_id: newAccountId,
        date: t.date as string,
        amount: t.amount as number,
        currency: (t.currency as string) || 'RON',
        amount_ron: t.amount_ron as number | undefined,
        description: t.description as string | undefined,
        merchant: t.merchant as string | undefined,
        category_id: newCategoryId,
        source: (t.source as TransactionSource) || 'manual',
        statement_id: newStatementId,
        fuel_record_id: newFuelRecordId,
        is_refund: t.is_refund === true || t.is_refund === 1,
        notes: t.notes as string | undefined,
      });

      if (oldId) transactionMap.set(oldId, created.id);
      existingTxByKey.set(txKey(candidate), created.id);

      const oldLinkedId = t.linked_transaction_id as string | undefined;
      const isTransfer = t.is_internal_transfer === true || t.is_internal_transfer === 1;
      if (isTransfer && oldLinkedId && oldId) {
        txWithLink.push({ oldId, newId: created.id, oldLinkedId });
      }
      const oldOriginalId = t.duplicate_of_id as string | undefined;
      if (oldOriginalId && oldId) {
        txDuplicates.push({ oldId, newId: created.id, oldOriginalId });
      }
      const oldSourceDocId = t.source_document_id as string | undefined;
      if (oldSourceDocId) {
        txWithSourceDoc.push({ newId: created.id, oldDocId: oldSourceDocId });
      }
      imported++;
    } catch (e) {
      errors.push(`Tranzacție: ${e instanceof Error ? e.message : 'eroare'}`);
    }
  }

  // Pas 2: leagă transferurile interne (perechi)
  const linkedSeen = new Set<string>();
  for (const entry of txWithLink) {
    if (linkedSeen.has(entry.oldId)) continue;
    const newLinkedId = transactionMap.get(entry.oldLinkedId);
    if (!newLinkedId) continue;
    try {
      await transactions.linkAsInternalTransfer(entry.newId, newLinkedId);
      linkedSeen.add(entry.oldId);
      linkedSeen.add(entry.oldLinkedId);
    } catch {
      // perechea poate să nu îndeplinească constrângerile (ex. dată > 2 zile după dedupe); ignorăm
    }
  }

  // Pas 2: marchează duplicatele
  for (const entry of txDuplicates) {
    const newOriginalId = transactionMap.get(entry.oldOriginalId);
    if (!newOriginalId) continue;
    try {
      await transactions.markAsDuplicate(entry.newId, newOriginalId);
    } catch {
      // ignorăm
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
      await docs.addDocumentPage(newDocId, filePath);
      imported++;
    } catch (e) {
      errors.push(`Pagina document: ${e instanceof Error ? e.message : 'eroare'}`);
    }
  }

  // Pas final: re-leagă tranzacții la documentele lor sursă (acum că ambele
  // tabele sunt importate cu ID-urile noi).
  for (const link of txWithSourceDoc) {
    const newDocId = docIdMap.get(link.oldDocId);
    if (!newDocId) continue;
    try {
      await db.runAsync('UPDATE transactions SET source_document_id = ? WHERE id = ?', [
        newDocId,
        link.newId,
      ]);
    } catch {
      // best-effort
    }
  }

  try {
    await onRestoreSuccess(imported);
  } catch {
    // Trigger review opțional.
  }

  return { imported, skipped, errors };
}
