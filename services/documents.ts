import { db, generateId } from './db';
import type { Document, DocumentPage, DocumentType } from '@/types';

export interface CreateDocumentInput {
  type: DocumentType;
  custom_type_id?: string;
  issue_date?: string;
  expiry_date?: string;
  note?: string;
  file_path?: string;
  person_id?: string;
  property_id?: string;
  vehicle_id?: string;
  card_id?: string;
  animal_id?: string;
  metadata?: Record<string, string>;
}

type Row = {
  id: string;
  type: string;
  custom_type_id: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  note: string | null;
  file_path: string | null;
  person_id: string | null;
  property_id: string | null;
  vehicle_id: string | null;
  card_id: string | null;
  animal_id: string | null;
  metadata: string | null;
  created_at: string;
};

type PageRow = {
  id: string;
  document_id: string;
  page_order: number;
  file_path: string;
  created_at: string;
};

function mapRow(r: Row, pages?: DocumentPage[]): Document {
  return {
    id: r.id,
    type: r.type as DocumentType,
    custom_type_id: r.custom_type_id ?? undefined,
    issue_date: r.issue_date ?? undefined,
    expiry_date: r.expiry_date ?? undefined,
    note: r.note ?? undefined,
    file_path: r.file_path ?? undefined,
    metadata: r.metadata ? (JSON.parse(r.metadata) as Record<string, string>) : undefined,
    pages: pages ?? [],
    person_id: r.person_id ?? undefined,
    property_id: r.property_id ?? undefined,
    vehicle_id: r.vehicle_id ?? undefined,
    card_id: r.card_id ?? undefined,
    animal_id: r.animal_id ?? undefined,
    created_at: r.created_at,
  };
}

async function loadPages(documentId: string): Promise<DocumentPage[]> {
  const rows = await db.getAllAsync<PageRow>(
    'SELECT * FROM document_pages WHERE document_id = ? ORDER BY page_order ASC',
    [documentId]
  );
  return rows.map(r => ({
    id: r.id,
    document_id: r.document_id,
    page_order: r.page_order,
    file_path: r.file_path,
    created_at: r.created_at,
  }));
}

export async function getDocuments(): Promise<Document[]> {
  const rows = await db.getAllAsync<Row>('SELECT * FROM documents ORDER BY created_at DESC');
  return rows.map(r => mapRow(r));
}

export async function getDocumentsExpiringIn(days: number): Promise<Document[]> {
  const from = new Date().toISOString().slice(0, 10);
  const to = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const rows = await db.getAllAsync<Row>(
    'SELECT * FROM documents WHERE expiry_date IS NOT NULL AND expiry_date >= ? AND expiry_date <= ? ORDER BY expiry_date ASC',
    [from, to]
  );
  return rows.map(r => mapRow(r));
}

export async function getAllDocumentsWithExpiry(): Promise<Document[]> {
  const rows = await db.getAllAsync<Row>(
    'SELECT * FROM documents WHERE expiry_date IS NOT NULL ORDER BY expiry_date ASC'
  );
  return rows.map(r => mapRow(r));
}

export async function getDocumentById(id: string): Promise<Document | null> {
  const row = await db.getFirstAsync<Row>('SELECT * FROM documents WHERE id = ?', [id]);
  if (!row) return null;
  const pages = await loadPages(id);
  return mapRow(row, pages);
}

export async function getDocumentsByEntity(
  kind: 'person_id' | 'property_id' | 'vehicle_id' | 'card_id' | 'animal_id',
  id: string
): Promise<Document[]> {
  const rows = await db.getAllAsync<Row>(
    `SELECT * FROM documents WHERE ${kind} = ? ORDER BY created_at DESC`,
    [id]
  );
  return rows.map(r => mapRow(r));
}

export async function createDocument(input: CreateDocumentInput): Promise<Document> {
  const id = generateId();
  const created_at = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO documents (id, type, custom_type_id, issue_date, expiry_date, note, file_path, person_id, property_id, vehicle_id, card_id, animal_id, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.type,
      input.custom_type_id ?? null,
      input.issue_date ?? null,
      input.expiry_date ?? null,
      input.note ?? null,
      input.file_path ?? null,
      input.person_id ?? null,
      input.property_id ?? null,
      input.vehicle_id ?? null,
      input.card_id ?? null,
      input.animal_id ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      created_at,
    ]
  );
  return {
    id,
    type: input.type,
    custom_type_id: input.custom_type_id,
    issue_date: input.issue_date,
    expiry_date: input.expiry_date,
    note: input.note,
    file_path: input.file_path,
    metadata: input.metadata,
    person_id: input.person_id,
    property_id: input.property_id,
    vehicle_id: input.vehicle_id,
    card_id: input.card_id,
    animal_id: input.animal_id,
    created_at,
  };
}

export async function deleteDocument(id: string): Promise<void> {
  await db.runAsync('DELETE FROM documents WHERE id = ?', [id]);
}

export interface UpdateDocumentInput {
  type: DocumentType;
  custom_type_id?: string;
  issue_date?: string;
  expiry_date?: string;
  note?: string;
  file_path?: string;
  animal_id?: string;
  metadata?: Record<string, string>;
}

export async function updateDocument(id: string, input: UpdateDocumentInput): Promise<void> {
  await db.runAsync(
    'UPDATE documents SET type=?, custom_type_id=?, issue_date=?, expiry_date=?, note=?, file_path=?, animal_id=?, metadata=? WHERE id=?',
    [
      input.type,
      input.custom_type_id ?? null,
      input.issue_date ?? null,
      input.expiry_date ?? null,
      input.note ?? null,
      input.file_path ?? null,
      input.animal_id ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      id,
    ]
  );
}

export async function addDocumentPage(documentId: string, filePath: string): Promise<void> {
  const maxOrder = await db.getFirstAsync<{ max: number | null }>(
    'SELECT MAX(page_order) as max FROM document_pages WHERE document_id = ?',
    [documentId]
  );
  const nextOrder = (maxOrder?.max ?? -1) + 1;
  await db.runAsync(
    'INSERT INTO document_pages (id, document_id, page_order, file_path, created_at) VALUES (?, ?, ?, ?, ?)',
    [generateId(), documentId, nextOrder, filePath, new Date().toISOString()]
  );
}

export async function removeDocumentPage(pageId: string): Promise<void> {
  await db.runAsync('DELETE FROM document_pages WHERE id = ?', [pageId]);
}

export async function reorderDocumentPages(
  documentId: string,
  orderedPageIds: string[]
): Promise<void> {
  for (let i = 0; i < orderedPageIds.length; i++) {
    await db.runAsync('UPDATE document_pages SET page_order = ? WHERE id = ? AND document_id = ?', [
      i,
      orderedPageIds[i],
      documentId,
    ]);
  }
}
