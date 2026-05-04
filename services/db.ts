import * as SQLite from 'expo-sqlite';

export function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
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
    calendar_event_id TEXT,
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

  DROP TABLE IF EXISTS vehicle_fuel_settings;

  CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    cui TEXT,
    reg_com TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS document_entities (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_doc_entities_doc ON document_entities(document_id);
  CREATE INDEX IF NOT EXISTS idx_doc_entities_entity ON document_entities(entity_type, entity_id);

  CREATE TABLE IF NOT EXISTS chat_threads (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS vehicle_maintenance_tasks (
    id TEXT PRIMARY KEY,
    vehicle_id TEXT NOT NULL,
    name TEXT NOT NULL,
    preset_key TEXT,
    trigger_km INTEGER,
    trigger_months INTEGER,
    last_done_km INTEGER,
    last_done_date TEXT,
    note TEXT,
    calendar_event_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cloud_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_manifest_hash TEXT,
    last_manifest_uploaded_at INTEGER,
    last_snapshot_at INTEGER,
    device_id TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pending_uploads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL UNIQUE,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_docs_expiry ON documents(expiry_date);
  CREATE INDEX IF NOT EXISTS idx_docs_person ON documents(person_id);
  CREATE INDEX IF NOT EXISTS idx_docs_vehicle ON documents(vehicle_id);
  CREATE INDEX IF NOT EXISTS idx_docs_property ON documents(property_id);
  CREATE INDEX IF NOT EXISTS idx_pages_doc ON document_pages(document_id);
  CREATE INDEX IF NOT EXISTS idx_fuel_vehicle ON fuel_records(vehicle_id, date DESC);
  CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON chat_messages(thread_id, created_at ASC);
  CREATE INDEX IF NOT EXISTS idx_chat_threads_updated ON chat_threads(updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_maintenance_vehicle ON vehicle_maintenance_tasks(vehicle_id);
  CREATE INDEX IF NOT EXISTS idx_pending_uploads_attempts ON pending_uploads(attempt_count);
`);

// Inițializare cloud_state single-row (idempotent)
try {
  const cloudStateRow = db.getFirstSync<{ id: number }>('SELECT id FROM cloud_state WHERE id = 1');
  if (!cloudStateRow) {
    db.runSync('INSERT INTO cloud_state (id, device_id) VALUES (1, ?)', [generateId()]);
  }
} catch {
  // jest mock pentru expo-sqlite nu implementează getFirstSync
}

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

// Migrare: adaugă ocr_text dacă nu există
try {
  db.execSync('ALTER TABLE documents ADD COLUMN ocr_text TEXT');
} catch {
  // coloana există deja
}

// Migrare: deduplicare document_entities + UNIQUE index (previne duplicate la restart)
try {
  db.execSync(`
    DELETE FROM document_entities
    WHERE id NOT IN (
      SELECT MIN(id) FROM document_entities
      GROUP BY document_id, entity_type, entity_id
    )
  `);
  db.execSync(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_doc_entities_unique
    ON document_entities(document_id, entity_type, entity_id)
  `);
} catch {
  // Index poate exista deja
}

// Migrare: populează document_entities din coloanele legacy (o singură dată)
// Cu UNIQUE index activ, INSERT OR IGNORE sare peste combinații existente
try {
  db.execSync(`
    INSERT OR IGNORE INTO document_entities (id, document_id, entity_type, entity_id)
    SELECT lower(hex(randomblob(16))), id, 'person', person_id
    FROM documents WHERE person_id IS NOT NULL
  `);
  db.execSync(`
    INSERT OR IGNORE INTO document_entities (id, document_id, entity_type, entity_id)
    SELECT lower(hex(randomblob(16))), id, 'vehicle', vehicle_id
    FROM documents WHERE vehicle_id IS NOT NULL
  `);
  db.execSync(`
    INSERT OR IGNORE INTO document_entities (id, document_id, entity_type, entity_id)
    SELECT lower(hex(randomblob(16))), id, 'property', property_id
    FROM documents WHERE property_id IS NOT NULL
  `);
  db.execSync(`
    INSERT OR IGNORE INTO document_entities (id, document_id, entity_type, entity_id)
    SELECT lower(hex(randomblob(16))), id, 'card', card_id
    FROM documents WHERE card_id IS NOT NULL
  `);
  db.execSync(`
    INSERT OR IGNORE INTO document_entities (id, document_id, entity_type, entity_id)
    SELECT lower(hex(randomblob(16))), id, 'animal', animal_id
    FROM documents WHERE animal_id IS NOT NULL
  `);
  db.execSync(`
    INSERT OR IGNORE INTO document_entities (id, document_id, entity_type, entity_id)
    SELECT lower(hex(randomblob(16))), id, 'company', company_id
    FROM documents WHERE company_id IS NOT NULL
  `);
} catch {
  // Migrare deja aplicată sau eroare neesențială
}

// Migrare: adaugă phone, email la persons dacă nu există
try {
  db.execSync('ALTER TABLE persons ADD COLUMN phone TEXT');
} catch {
  // coloana există deja
}
try {
  db.execSync('ALTER TABLE persons ADD COLUMN email TEXT');
} catch {
  // coloana există deja
}

// Migrare: adaugă file_hash la documents pentru detecție duplicate
try {
  db.execSync('ALTER TABLE documents ADD COLUMN file_hash TEXT');
} catch {
  // coloana există deja
}
try {
  db.execSync('CREATE INDEX IF NOT EXISTS idx_docs_file_hash ON documents(file_hash)');
} catch {
  // indexul există deja
}

// Notă privată — NU se trimite niciodată la AI. Vezi .claude/rules/ai-privacy.md
try {
  db.execSync('ALTER TABLE documents ADD COLUMN private_notes TEXT');
} catch {
  // coloana există deja
}

// Migrare: adaugă photo_uri la vehicles
try {
  db.execSync('ALTER TABLE vehicles ADD COLUMN photo_uri TEXT');
} catch {
  // coloana există deja
}

// Migrare: path-urile vechi absolute (file:// sau /var/...) conțin UUID-ul containerului iOS,
// care se invalidează la reinstalări native. Convertim la path relativ față de documentDirectory.
try {
  const rows =
    db.getAllSync<{ id: string; photo_uri: string }>(
      "SELECT id, photo_uri FROM vehicles WHERE photo_uri IS NOT NULL AND (substr(photo_uri, 1, 7) = 'file://' OR substr(photo_uri, 1, 1) = '/')"
    ) ?? [];
  for (const r of rows) {
    const match = r.photo_uri.match(/\/Documents\/(.+)$/);
    if (match) {
      db.runSync('UPDATE vehicles SET photo_uri = ? WHERE id = ?', [match[1], r.id]);
    } else {
      db.runSync('UPDATE vehicles SET photo_uri = NULL WHERE id = ?', [r.id]);
    }
  }
} catch {
  // best-effort; dacă migrarea eșuează, app-ul continuă — path-urile vechi vor face render silent fail
}

// Migrare: adaugă plate_number la vehicles
try {
  db.execSync('ALTER TABLE vehicles ADD COLUMN plate_number TEXT');
} catch {
  // coloana există deja
}

// Backfill: pozele vehiculelor existente nu au fost niciodată enqueue-uite în
// `pending_uploads` (bug istoric — enqueueFileUpload era apelat doar pentru
// documente). Marcăm tot ce există local ca pending pentru ca processQueue să
// le urce la următoarea sincronizare cloud. INSERT OR IGNORE păstrează rândurile
// existente (UNIQUE pe file_path) — nu resetează attempt_count pentru cele deja
// procesate. Idempotent: re-rularea migrării n-are efect dacă rândurile există.
try {
  db.execSync(`
    INSERT OR IGNORE INTO pending_uploads (file_path, attempt_count, created_at)
    SELECT photo_uri, 0, CAST(strftime('%s','now') AS INTEGER) * 1000
    FROM vehicles
    WHERE photo_uri IS NOT NULL AND photo_uri != ''
  `);
} catch {
  // best-effort — coloanele lipsă fac SELECT-ul să eșueze, sărim
}

// Migrare: adaugă fuel_type la vehicles
try {
  db.execSync("ALTER TABLE vehicles ADD COLUMN fuel_type TEXT DEFAULT 'diesel'");
} catch {
  // coloana există deja
}

// Migrare: adaugă calendar_event_id la vehicle_maintenance_tasks
try {
  db.execSync('ALTER TABLE vehicle_maintenance_tasks ADD COLUMN calendar_event_id TEXT');
} catch {
  // coloana există deja
}

// Migrare: adaugă is_full la fuel_records (default 1 = plin complet — datele existente rămân tratate ca pline)
try {
  db.execSync('ALTER TABLE fuel_records ADD COLUMN is_full INTEGER NOT NULL DEFAULT 1');
} catch {
  // coloana există deja
}

// Migrare: adaugă station la fuel_records (text liber: brand + adresă, ex. "OMV Cluj-Napoca, Calea Turzii")
try {
  db.execSync('ALTER TABLE fuel_records ADD COLUMN station TEXT');
} catch {
  // coloana există deja
}

// Index pentru filtrări/agregări după benzinărie (LIKE / substring)
try {
  db.execSync('CREATE INDEX IF NOT EXISTS idx_fuel_records_station ON fuel_records(station)');
} catch {
  // indexul există deja
}

// Index pentru algoritm full-to-full
try {
  db.execSync(
    'CREATE INDEX IF NOT EXISTS idx_fuel_records_vehicle_full ON fuel_records(vehicle_id, is_full)'
  );
} catch {
  // indexul există deja
}

// Entity ordering: poziție globală reorderabilă manual peste toate tipurile de entitate.
// sort_order e REAL ca să permită inserări între elemente fără renumerotare completă.
try {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS entity_order (
      entity_type TEXT NOT NULL,
      entity_id   TEXT NOT NULL,
      sort_order  REAL NOT NULL,
      PRIMARY KEY (entity_type, entity_id)
    );
    CREATE INDEX IF NOT EXISTS idx_entity_order_sort ON entity_order(sort_order);
  `);
} catch {
  // tabela/indexul există deja
}

// Migrare: populează entity_order pentru entitățile existente.
// Ordinea inițială = ordinea anterioară a app-ului (persoane, proprietăți, vehicule,
// carduri, animale, firme), fiecare tip sortat după created_at DESC (cele mai noi primele).
// INSERT OR IGNORE sare peste rândurile deja populate dacă migrarea rulează din nou.
try {
  db.execSync(`
    INSERT OR IGNORE INTO entity_order (entity_type, entity_id, sort_order)
    SELECT entity_type, entity_id,
           (ROW_NUMBER() OVER (ORDER BY type_rank, created_at DESC)) * 1000.0 AS sort_order
    FROM (
      SELECT 1 AS type_rank, 'person'   AS entity_type, id AS entity_id, created_at FROM persons
      UNION ALL
      SELECT 2, 'property', id, created_at FROM properties
      UNION ALL
      SELECT 3, 'vehicle',  id, created_at FROM vehicles
      UNION ALL
      SELECT 4, 'card',     id, created_at FROM cards
      UNION ALL
      SELECT 5, 'animal',   id, created_at FROM animals
      UNION ALL
      SELECT 6, 'company',  id, created_at FROM companies
    )
  `);
} catch {
  // Migrare deja aplicată sau ROW_NUMBER indisponibil pe SQLite vechi — fallback safe: ordonarea se va construi din created_at
}

// ────────────────────────────────────────────────────────────────────────────
// Migrație fuel_records: vehicle_id NULLABLE + adaugă coloane noi (pump_number,
// currency, fuel_type) ȘI elimină coloana legacy `account_id` rămasă din
// versiunea cu hub financiar.
// SQLite nu suportă ALTER COLUMN / DROP COLUMN simplu — verificăm schema cu
// PRAGMA și recreăm tabela când e nevoie.
// ────────────────────────────────────────────────────────────────────────────
try {
  const cols = db.getAllSync<{ name: string; notnull: number }>(
    "PRAGMA table_info('fuel_records')"
  );
  const vehicleCol = cols.find(c => c.name === 'vehicle_id');
  const hasAccountIdLegacy = cols.some(c => c.name === 'account_id');
  const needsRecreate =
    (vehicleCol !== undefined && vehicleCol.notnull === 1) || hasAccountIdLegacy;

  if (needsRecreate) {
    db.execSync(`
      CREATE TABLE fuel_records_v2 (
        id TEXT PRIMARY KEY,
        vehicle_id TEXT,
        date TEXT NOT NULL,
        liters REAL,
        km_total INTEGER,
        price REAL,
        currency TEXT NOT NULL DEFAULT 'RON',
        fuel_type TEXT,
        is_full INTEGER NOT NULL DEFAULT 1,
        station TEXT,
        pump_number TEXT,
        created_at TEXT NOT NULL
      );
      INSERT INTO fuel_records_v2 (id, vehicle_id, date, liters, km_total, price, currency, fuel_type, is_full, station, pump_number, created_at)
      SELECT id, vehicle_id, date, liters, km_total, price,
             COALESCE(currency, 'RON'),
             ${cols.some(c => c.name === 'fuel_type') ? 'fuel_type' : 'NULL'},
             COALESCE(is_full, 1),
             station,
             ${cols.some(c => c.name === 'pump_number') ? 'pump_number' : 'NULL'},
             created_at
      FROM fuel_records;
      DROP TABLE fuel_records;
      ALTER TABLE fuel_records_v2 RENAME TO fuel_records;
    `);
  } else {
    try {
      db.execSync('ALTER TABLE fuel_records ADD COLUMN pump_number TEXT');
    } catch {
      /* coloana există */
    }
    try {
      db.execSync("ALTER TABLE fuel_records ADD COLUMN currency TEXT NOT NULL DEFAULT 'RON'");
    } catch {
      /* coloana există */
    }
    try {
      db.execSync('ALTER TABLE fuel_records ADD COLUMN fuel_type TEXT');
    } catch {
      /* coloana există */
    }
  }

  db.execSync(`
    CREATE INDEX IF NOT EXISTS idx_fuel_vehicle ON fuel_records(vehicle_id, date DESC);
    CREATE INDEX IF NOT EXISTS idx_fuel_records_station ON fuel_records(station);
    CREATE INDEX IF NOT EXISTS idx_fuel_records_vehicle_full ON fuel_records(vehicle_id, is_full);
  `);
} catch {
  // best-effort: dacă migrarea eșuează, app-ul continuă cu schema existentă
}

// Migrare: orientation_locked pe document_pages — devine 1 după ce userul rotește
// manual o pagină; OCR-ul respectă apoi orientarea fixată și nu mai încearcă
// auto-rotire (vezi ocrWithAutoRotate în ecranele documentelor).
try {
  db.execSync(
    'ALTER TABLE document_pages ADD COLUMN orientation_locked INTEGER NOT NULL DEFAULT 0'
  );
} catch {
  // coloana există deja
}

// Migrare: main_orientation_locked pe documents — analog cu document_pages, dar
// pentru pagina principală (doc.file_path), care nu are rând în document_pages.
try {
  db.execSync(
    'ALTER TABLE documents ADD COLUMN main_orientation_locked INTEGER NOT NULL DEFAULT 0'
  );
} catch {
  // coloana există deja
}

// Migrare: adaugă calendar_event_id la documents pentru dedupe reminder calendar
try {
  db.execSync('ALTER TABLE documents ADD COLUMN calendar_event_id TEXT');
} catch {
  // coloana există deja
}
