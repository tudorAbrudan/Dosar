import { db, generateId } from './db';
import { emit } from './events';
import type { CreateRowOptions, CustomDocumentType } from '@/types';

export async function getCustomTypes(): Promise<CustomDocumentType[]> {
  return db.getAllAsync<CustomDocumentType>(
    'SELECT * FROM custom_document_types ORDER BY created_at ASC'
  );
}

export async function createCustomType(
  name: string,
  opts: CreateRowOptions = {}
): Promise<CustomDocumentType> {
  const id = opts.id ?? generateId();
  const created_at = new Date().toISOString();
  await db.runAsync('INSERT INTO custom_document_types (id, name, created_at) VALUES (?, ?, ?)', [
    id,
    name.trim(),
    created_at,
  ]);
  emit('customTypes:changed');
  return { id, name: name.trim(), created_at };
}

export async function deleteCustomType(id: string): Promise<void> {
  await db.runAsync('DELETE FROM custom_document_types WHERE id = ?', [id]);
  emit('customTypes:changed');
  emit('documents:changed');
}
