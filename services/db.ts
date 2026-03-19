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
    animal_id TEXT,
    custom_type_id TEXT,
    metadata TEXT,
    auto_delete TEXT,
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

  CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    cui TEXT,
    reg_com TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_docs_expiry ON documents(expiry_date);
  CREATE INDEX IF NOT EXISTS idx_docs_person ON documents(person_id);
  CREATE INDEX IF NOT EXISTS idx_docs_vehicle ON documents(vehicle_id);
  CREATE INDEX IF NOT EXISTS idx_docs_property ON documents(property_id);
  CREATE INDEX IF NOT EXISTS idx_pages_doc ON document_pages(document_id);
  CREATE INDEX IF NOT EXISTS idx_fuel_vehicle ON fuel_records(vehicle_id, date DESC);
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

// Migrare: adaugă auto_delete dacă nu există
try {
  db.execSync('ALTER TABLE documents ADD COLUMN auto_delete TEXT');
} catch {
  // coloana există deja
}

// Index pe animal_id — creat după migrare pentru a garanta că există coloana
try {
  db.execSync('CREATE INDEX IF NOT EXISTS idx_docs_animal ON documents(animal_id)');
} catch {
  // indexul există deja sau coloana lipsă (fallback safe)
}

// Migrare: adaugă company_id dacă nu există
try {
  db.execSync('ALTER TABLE documents ADD COLUMN company_id TEXT');
} catch {
  // coloana există deja
}

// Index pe company_id
try {
  db.execSync('CREATE INDEX IF NOT EXISTS idx_docs_company ON documents(company_id)');
} catch {
  // indexul există deja
}
