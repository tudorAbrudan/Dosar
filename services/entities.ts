import { db, generateId } from './db';
import type { Person, Property, Vehicle, Card, Animal, Company } from '@/types';
import * as FileSystem from 'expo-file-system/legacy';

export async function getPersons(): Promise<Person[]> {
  const rows = await db.getAllAsync<{
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    iban: string | null;
    created_at: string;
  }>('SELECT id, name, phone, email, iban, created_at FROM persons ORDER BY created_at DESC');
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    phone: r.phone ?? undefined,
    email: r.email ?? undefined,
    iban: r.iban ?? undefined,
    createdAt: r.created_at,
  }));
}

export async function getProperties(): Promise<Property[]> {
  const rows = await db.getAllAsync<{ id: string; name: string; created_at: string }>(
    'SELECT id, name, created_at FROM properties ORDER BY created_at DESC'
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
    'SELECT id, name, photo_uri, plate_number, fuel_type, created_at FROM vehicles ORDER BY created_at DESC'
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
  }>('SELECT id, nickname, last4, expiry, created_at FROM cards ORDER BY created_at DESC');
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
  iban?: string
): Promise<Person> {
  const id = generateId();
  const created_at = new Date().toISOString();
  await db.runAsync(
    'INSERT INTO persons (id, name, phone, email, iban, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, name, phone ?? null, email ?? null, iban ?? null, created_at]
  );
  return { id, name, phone, email, iban, createdAt: created_at };
}

export async function createProperty(name: string): Promise<Property> {
  const id = generateId();
  const created_at = new Date().toISOString();
  await db.runAsync('INSERT INTO properties (id, name, created_at) VALUES (?, ?, ?)', [
    id,
    name,
    created_at,
  ]);
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
  return { id, name, createdAt: created_at };
}

export async function createCard(nickname: string, last4: string, expiry?: string): Promise<Card> {
  const id = generateId();
  const created_at = new Date().toISOString();
  await db.runAsync(
    'INSERT INTO cards (id, nickname, last4, expiry, created_at) VALUES (?, ?, ?, ?, ?)',
    [id, nickname, last4, expiry ?? null, created_at]
  );
  return { id, nickname, last4, expiry, createdAt: created_at };
}

export async function updatePerson(
  id: string,
  name: string,
  phone?: string,
  email?: string,
  iban?: string
): Promise<void> {
  await db.runAsync('UPDATE persons SET name = ?, phone = ?, email = ?, iban = ? WHERE id = ?', [
    name,
    phone ?? null,
    email ?? null,
    iban ?? null,
    id,
  ]);
}

export async function updateProperty(id: string, name: string): Promise<void> {
  await db.runAsync('UPDATE properties SET name = ? WHERE id = ?', [name, id]);
}

export async function updateVehicle(
  id: string,
  name: string,
  photo_uri?: string | null,
  plate_number?: string | null,
  fuel_type?: 'diesel' | 'benzina' | 'gpl' | 'electric' | null
): Promise<void> {
  await db.runAsync(
    'UPDATE vehicles SET name = ?, photo_uri = ?, plate_number = ?, fuel_type = ? WHERE id = ?',
    [
      name,
      photo_uri ?? null,
      plate_number ?? null,
      fuel_type ?? 'diesel',
      id,
    ]
  );
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
}

export async function deletePerson(id: string): Promise<void> {
  await db.runAsync('DELETE FROM persons WHERE id = ?', [id]);
}

export async function deleteProperty(id: string): Promise<void> {
  await db.runAsync('DELETE FROM properties WHERE id = ?', [id]);
}

export async function deleteVehicle(id: string): Promise<void> {
  // Șterge fișierul poză dacă există (best-effort, fără eroare fatală)
  try {
    const row = await db.getFirstAsync<{ photo_uri: string | null }>(
      'SELECT photo_uri FROM vehicles WHERE id = ?',
      [id]
    );
    if (row?.photo_uri) {
      const info = await FileSystem.getInfoAsync(row.photo_uri);
      if (info.exists) {
        await FileSystem.deleteAsync(row.photo_uri, { idempotent: true });
      }
    }
  } catch {
    // Nu blocăm ștergerea entității dacă ștergerea fișierului eșuează
  }
  await db.runAsync('DELETE FROM vehicles WHERE id = ?', [id]);
}

export async function deleteCard(id: string): Promise<void> {
  await db.runAsync('DELETE FROM cards WHERE id = ?', [id]);
}

export async function getAnimals(): Promise<Animal[]> {
  const rows = await db.getAllAsync<{
    id: string;
    name: string;
    species: string;
    created_at: string;
  }>('SELECT id, name, species, created_at FROM animals ORDER BY created_at DESC');
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
  return { id, name, species, createdAt: created_at };
}

export async function updateAnimal(id: string, name: string, species: string): Promise<void> {
  await db.runAsync('UPDATE animals SET name = ?, species = ? WHERE id = ?', [name, species, id]);
}

export async function deleteAnimal(id: string): Promise<void> {
  await db.runAsync('DELETE FROM animals WHERE id = ?', [id]);
}

export async function getCompanies(): Promise<Company[]> {
  const rows = await db.getAllAsync<{
    id: string;
    name: string;
    cui: string | null;
    reg_com: string | null;
    created_at: string;
  }>('SELECT id, name, cui, reg_com, created_at FROM companies ORDER BY created_at DESC');
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
}

export async function deleteCompany(id: string): Promise<void> {
  await db.runAsync('DELETE FROM companies WHERE id = ?', [id]);
}
