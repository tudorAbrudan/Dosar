import * as SQLite from 'expo-sqlite';

export function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export const db = SQLite.openDatabaseSync('documente.db');

db.execSync(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS document_pages (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    page_order INTEGER NOT NULL DEFAULT 0,
    file_path TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS persons (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS properties (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS vehicles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY,
    nickname TEXT NOT NULL,
    last4 TEXT NOT NULL,
    expiry TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    issue_date TEXT,
    expiry_date TEXT,
    note TEXT,
    file_path TEXT,
    person_id TEXT,
    property_id TEXT,
    vehicle_id TEXT,
    card_id TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS animals (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    species TEXT NOT NULL DEFAULT 'câine',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS custom_document_types (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS fuel_records (
    id TEXT PRIMARY KEY,
    vehicle_id TEXT NOT NULL,
    date TEXT NOT NULL,
    liters REAL,
    km_total INTEGER,
    price REAL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS vehicle_fuel_settings (
    vehicle_id TEXT PRIMARY KEY,
    service_km_interval INTEGER NOT NULL DEFAULT 10000,
    last_service_km INTEGER,
    last_service_date TEXT,
    updated_at TEXT NOT NULL
  );
`);

// Migrare: adaugă custom_type_id dacă nu există
try {
  db.execSync('ALTER TABLE documents ADD COLUMN custom_type_id TEXT');
} catch {
  // coloana există deja
}

// Migrare: adaugă metadata dacă nu există
try {
  db.execSync('ALTER TABLE documents ADD COLUMN metadata TEXT');
} catch {
  // coloana există deja
}

// Migrare: adaugă animal_id dacă nu există
try {
  db.execSync('ALTER TABLE documents ADD COLUMN animal_id TEXT');
} catch {
  // coloana există deja
}
