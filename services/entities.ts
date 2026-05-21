import { db, generateId } from './db';
import type { Person, Property, Vehicle, Card, Animal, Company } from '@/types';
import * as FileSystem from 'expo-file-system/legacy';
import { toFileUri } from './fileUtils';
import { assignNextOrder, removeOrder } from './entityOrder';
import { emit } from './events';
import * as cloudSync from './cloudSync';
import { getCloudBackupEnabled } from './settings';
import { isImportInProgress } from './backup';

// Fallback sort pentru entități care nu au rând în entity_order (edge case:
// migrarea nu a rulat sau entitatea a fost creată în afara căii standard).
// Valoarea mare le împinge la coada listei, tie-break pe created_at DESC.
const ORDER_FALLBACK = 1e18;

export async function getPersons(): Promise<Person[]> {
  const rows = await db.getAllAsync<{
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    date_of_birth: string | null;
    created_at: string;
  }>(
    `SELECT p.id, p.name, p.phone, p.email, p.date_of_birth, p.created_at
     FROM persons p
     LEFT JOIN entity_order eo ON eo.entity_type = 'person' AND eo.entity_id = p.id
     ORDER BY COALESCE(eo.sort_order, ?) ASC, p.created_at DESC`,
    [ORDER_FALLBACK]
  );
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    phone: r.phone ?? undefined,
    email: r.email ?? undefined,
    date_of_birth: r.date_of_birth ?? undefined,
    createdAt: r.created_at,
  }));
}

export async function getProperties(): Promise<Property[]> {
  const rows = await db.getAllAsync<{ id: string; name: string; created_at: string }>(
    `SELECT p.id, p.name, p.created_at
     FROM properties p
     LEFT JOIN entity_order eo ON eo.entity_type = 'property' AND eo.entity_id = p.id
     ORDER BY COALESCE(eo.sort_order, ?) ASC, p.created_at DESC`,
    [ORDER_FALLBACK]
  );
  return rows.map(r => ({ id: r.id, name: r.name, createdAt: r.created_at }));
}

export async function getVehicles(): Promise<Vehicle[]> {
  const rows = await db.getAllAsync<{
    id: string;
    name: string;
    photo_uri: string | null;
    plate_number: string | null;
    fuel_type: string | null;
    created_at: string;
  }>(
    `SELECT v.id, v.name, v.photo_uri, v.plate_number, v.fuel_type, v.created_at
     FROM vehicles v
     LEFT JOIN entity_order eo ON eo.entity_type = 'vehicle' AND eo.entity_id = v.id
     ORDER BY COALESCE(eo.sort_order, ?) ASC, v.created_at DESC`,
    [ORDER_FALLBACK]
  );
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    photo_uri: r.photo_uri ?? undefined,
    plate_number: r.plate_number ?? undefined,
    fuel_type: (r.fuel_type ?? 'diesel') as import('@/types').VehicleFuelType,
    createdAt: r.created_at,
  }));
}

export async function getCards(): Promise<Card[]> {
  const rows = await db.getAllAsync<{
    id: string;
    nickname: string;
    last4: string;
    expiry: string | null;
    created_at: string;
  }>(
    `SELECT c.id, c.nickname, c.last4, c.expiry, c.created_at
     FROM cards c
     LEFT JOIN entity_order eo ON eo.entity_type = 'card' AND eo.entity_id = c.id
     ORDER BY COALESCE(eo.sort_order, ?) ASC, c.created_at DESC`,
    [ORDER_FALLBACK]
  );
  return rows.map(r => ({
    id: r.id,
    nickname: r.nickname,
    last4: r.last4,
    expiry: r.expiry ?? undefined,
    createdAt: r.created_at,
  }));
}

export async function createPerson(
  name: string,
  phone?: string,
  email?: string,
  date_of_birth?: string
): Promise<Person> {
  const id = generateId();
  const created_at = new Date().toISOString();
  await db.runAsync(
    'INSERT INTO persons (id, name, phone, email, date_of_birth, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, name, phone ?? null, email ?? null, date_of_birth ?? null, created_at]
  );
  await assignNextOrder('person', id);
  emit('entities:changed');
  return { id, name, phone, email, date_of_birth, createdAt: created_at };
}

export async function createProperty(name: string): Promise<Property> {
  const id = generateId();
  const created_at = new Date().toISOString();
  await db.runAsync('INSERT INTO properties (id, name, created_at) VALUES (?, ?, ?)', [
    id,
    name,
    created_at,
  ]);
  await assignNextOrder('property', id);
  emit('entities:changed');
  return { id, name, createdAt: created_at };
}

export async function createVehicle(name: string): Promise<Vehicle> {
  const id = generateId();
  const created_at = new Date().toISOString();
  await db.runAsync('INSERT INTO vehicles (id, name, created_at) VALUES (?, ?, ?)', [
    id,
    name,
    created_at,
  ]);
  await assignNextOrder('vehicle', id);
  emit('entities:changed');
  return { id, name, createdAt: created_at };
}

export async function createCard(nickname: string, last4: string, expiry?: string): Promise<Card> {
  const id = generateId();
  const created_at = new Date().toISOString();
  await db.runAsync(
    'INSERT INTO cards (id, nickname, last4, expiry, created_at) VALUES (?, ?, ?, ?, ?)',
    [id, nickname, last4, expiry ?? null, created_at]
  );
  await assignNextOrder('card', id);
  emit('entities:changed');
  return { id, nickname, last4, expiry, createdAt: created_at };
}

export async function updatePerson(
  id: string,
  name: string,
  phone?: string,
  email?: string,
  date_of_birth?: string
): Promise<void> {
  await db.runAsync(
    'UPDATE persons SET name = ?, phone = ?, email = ?, date_of_birth = ? WHERE id = ?',
    [name, phone ?? null, email ?? null, date_of_birth ?? null, id]
  );
  emit('entities:changed');
}

export async function updateProperty(id: string, name: string): Promise<void> {
  await db.runAsync('UPDATE properties SET name = ? WHERE id = ?', [name, id]);
  emit('entities:changed');
}

export async function updateVehicle(
  id: string,
  name: string,
  photo_uri?: string | null,
  plate_number?: string | null,
  fuel_type?: 'diesel' | 'benzina' | 'gpl' | 'electric' | null
): Promise<void> {
  // Read previous photo so we can sync changes to the cloud queue.
  const prev = await db.getFirstAsync<{ photo_uri: string | null }>(
    'SELECT photo_uri FROM vehicles WHERE id = ?',
    [id]
  );
  const previousPhoto = prev?.photo_uri ?? null;
  const nextPhoto = photo_uri ?? null;

  await db.runAsync(
    'UPDATE vehicles SET name = ?, photo_uri = ?, plate_number = ?, fuel_type = ? WHERE id = ?',
    [name, nextPhoto, plate_number ?? null, fuel_type ?? 'diesel', id]
  );

  if (previousPhoto !== nextPhoto && !isImportInProgress()) {
    const cloudEnabled = await getCloudBackupEnabled();
    if (cloudEnabled) {
      if (previousPhoto) {
        await cloudSync.dequeueFileDelete(previousPhoto);
      }
      if (nextPhoto) {
        await cloudSync.enqueueFileUpload(nextPhoto);
        cloudSync.processQueue().catch(() => {
          /* fire and forget */
        });
      }
    }
  }

  emit('entities:changed');
}

export async function updateCard(
  id: string,
  nickname: string,
  last4: string,
  expiry?: string
): Promise<void> {
  await db.runAsync('UPDATE cards SET nickname = ?, last4 = ?, expiry = ? WHERE id = ?', [
    nickname,
    last4,
    expiry ?? null,
    id,
  ]);
  emit('entities:changed');
}

export async function deletePerson(id: string): Promise<void> {
  await db.runAsync('DELETE FROM persons WHERE id = ?', [id]);
  await removeOrder('person', id);
  emit('entities:changed');
  emit('links:changed');
  emit('documents:changed');
}

export async function deleteProperty(id: string): Promise<void> {
  await db.runAsync('DELETE FROM properties WHERE id = ?', [id]);
  await removeOrder('property', id);
  emit('entities:changed');
  emit('links:changed');
  emit('documents:changed');
}

export async function deleteVehicle(id: string): Promise<void> {
  // Șterge fișierul poză dacă există (best-effort, fără eroare fatală)
  let storedPhoto: string | null = null;
  try {
    const row = await db.getFirstAsync<{ photo_uri: string | null }>(
      'SELECT photo_uri FROM vehicles WHERE id = ?',
      [id]
    );
    storedPhoto = row?.photo_uri ?? null;
    if (storedPhoto) {
      const absolute = toFileUri(storedPhoto);
      const info = await FileSystem.getInfoAsync(absolute);
      if (info.exists) {
        await FileSystem.deleteAsync(absolute, { idempotent: true });
      }
    }
  } catch {
    // Nu blocăm ștergerea entității dacă ștergerea fișierului eșuează
  }
  await db.runAsync('DELETE FROM vehicles WHERE id = ?', [id]);
  await removeOrder('vehicle', id);

  if (storedPhoto && !isImportInProgress()) {
    const cloudEnabled = await getCloudBackupEnabled();
    if (cloudEnabled) {
      await cloudSync.dequeueFileDelete(storedPhoto);
    }
  }

  emit('entities:changed');
  emit('links:changed');
  emit('documents:changed');
}

export async function deleteCard(id: string): Promise<void> {
  await db.runAsync('DELETE FROM cards WHERE id = ?', [id]);
  await removeOrder('card', id);
  emit('entities:changed');
  emit('links:changed');
  emit('documents:changed');
}

export async function getAnimals(): Promise<Animal[]> {
  const rows = await db.getAllAsync<{
    id: string;
    name: string;
    species: string;
    created_at: string;
  }>(
    `SELECT a.id, a.name, a.species, a.created_at
     FROM animals a
     LEFT JOIN entity_order eo ON eo.entity_type = 'animal' AND eo.entity_id = a.id
     ORDER BY COALESCE(eo.sort_order, ?) ASC, a.created_at DESC`,
    [ORDER_FALLBACK]
  );
  return rows.map(r => ({ id: r.id, name: r.name, species: r.species, createdAt: r.created_at }));
}

export async function createAnimal(name: string, species: string): Promise<Animal> {
  const id = generateId();
  const created_at = new Date().toISOString();
  await db.runAsync('INSERT INTO animals (id, name, species, created_at) VALUES (?, ?, ?, ?)', [
    id,
    name,
    species,
    created_at,
  ]);
  await assignNextOrder('animal', id);
  emit('entities:changed');
  return { id, name, species, createdAt: created_at };
}

export async function updateAnimal(id: string, name: string, species: string): Promise<void> {
  await db.runAsync('UPDATE animals SET name = ?, species = ? WHERE id = ?', [name, species, id]);
  emit('entities:changed');
}

export async function deleteAnimal(id: string): Promise<void> {
  await db.runAsync('DELETE FROM animals WHERE id = ?', [id]);
  await removeOrder('animal', id);
  emit('entities:changed');
  emit('links:changed');
  emit('documents:changed');
}

export async function getCompanies(): Promise<Company[]> {
  const rows = await db.getAllAsync<{
    id: string;
    name: string;
    cui: string | null;
    reg_com: string | null;
    created_at: string;
  }>(
    `SELECT c.id, c.name, c.cui, c.reg_com, c.created_at
     FROM companies c
     LEFT JOIN entity_order eo ON eo.entity_type = 'company' AND eo.entity_id = c.id
     ORDER BY COALESCE(eo.sort_order, ?) ASC, c.created_at DESC`,
    [ORDER_FALLBACK]
  );
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    cui: r.cui ?? undefined,
    reg_com: r.reg_com ?? undefined,
    createdAt: r.created_at,
  }));
}

export async function createCompany(
  name: string,
  cui?: string,
  reg_com?: string
): Promise<Company> {
  const id = generateId();
  const created_at = new Date().toISOString();
  await db.runAsync(
    'INSERT INTO companies (id, name, cui, reg_com, created_at) VALUES (?, ?, ?, ?, ?)',
    [id, name, cui ?? null, reg_com ?? null, created_at]
  );
  await assignNextOrder('company', id);
  emit('entities:changed');
  return { id, name, cui, reg_com, createdAt: created_at };
}

export async function updateCompany(
  id: string,
  name: string,
  cui?: string,
  reg_com?: string
): Promise<void> {
  await db.runAsync('UPDATE companies SET name = ?, cui = ?, reg_com = ? WHERE id = ?', [
    name,
    cui ?? null,
    reg_com ?? null,
    id,
  ]);
  emit('entities:changed');
}

export async function deleteCompany(id: string): Promise<void> {
  await db.runAsync('DELETE FROM companies WHERE id = ?', [id]);
  await removeOrder('company', id);
  emit('entities:changed');
  emit('links:changed');
  emit('documents:changed');
}
