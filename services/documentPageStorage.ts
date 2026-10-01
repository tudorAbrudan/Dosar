/**
 * Primitive pentru salvarea paginilor (imagine / PDF) în folderul `documents/`
 * din DocumentDirectory. Folosit de `add.tsx` (pages locale înainte de save)
 * și `edit.tsx` (pages care se atașează la un document existent).
 *
 * Toate funcțiile întorc atât `localPath` (URI absolut) cât și `relativePath`
 * (calea relativă `documents/<filename>`) pentru că:
 *   - `localPath` e folosit la randare (`<Image source={{ uri }} />`)
 *   - `relativePath` e salvat în SQLite (`documents.file_path`) — relativ ca
 *     să nu spargem la migrări sau backup/restore.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { processDocumentImage } from './imageProcessing';
import type { DocumentType } from '@/types';

const DOCUMENTS_DIR = `${FileSystem.documentDirectory}documents`;

async function ensureDocumentsDir(): Promise<void> {
  await FileSystem.makeDirectoryAsync(DOCUMENTS_DIR, { intermediates: true });
}

let fileSeq = 0;

/**
 * Nume UNIC pentru un fișier din `documents/`. `Date.now()` singur dă același nume
 * pentru două pagini salvate în aceeași milisecundă → a doua suprascrie prima și ambele
 * rânduri din `document_pages` pointează la același fișier (permis, 2026-05: ștergi/rotești
 * una, se întâmplă și la cealaltă). Contorul + sufixul aleator elimină coliziunea.
 */
export function uniqueDocFilename(ext: 'jpg' | 'pdf'): string {
  fileSeq = (fileSeq + 1) % 1000;
  const rand = Math.random().toString(36).slice(2, 6);
  return `doc_${Date.now()}_${fileSeq}${rand}.${ext}`;
}

export interface SavedPage {
  /** URI absolut (`file://.../documents/<file>`) — pentru randare. */
  localPath: string;
  /** Cale relativă (`documents/<file>`) — pentru `documents.file_path`. */
  relativePath: string;
  /** URI-ul rezultat după `processDocumentImage` (poate diferi de localPath
   *  când procesarea folosește un fișier intermediar din cache). */
  processedUri: string;
}

/**
 * Procesează (deskew, contrast, rotate prin EXIF) o imagine și o salvează în
 * `documents/` ca pagină nouă. Procesarea folosește `docType` pentru
 * preset-uri specifice (ex: card-uri sunt cropped diferit).
 */
export async function saveImageAsPage(
  srcUri: string,
  docType: DocumentType,
  exifOrientation?: number
): Promise<SavedPage> {
  const processedUri = await processDocumentImage(srcUri, docType, exifOrientation);
  await ensureDocumentsDir();
  const filename = uniqueDocFilename('jpg');
  const relativePath = `documents/${filename}`;
  const localPath = `${FileSystem.documentDirectory}${relativePath}`;
  await FileSystem.copyAsync({ from: processedUri, to: localPath });
  return { processedUri, localPath, relativePath };
}

/**
 * Procesează și salvează un batch de imagini scanate cu același timestamp
 * de bază pentru a păstra ordinea originală în filename.
 */
export async function saveScannedPagesBatch(
  srcUris: string[],
  docType: DocumentType
): Promise<SavedPage[]> {
  if (srcUris.length === 0) return [];
  await ensureDocumentsDir();
  const batchTs = Date.now();
  const results: SavedPage[] = [];
  for (let i = 0; i < srcUris.length; i++) {
    const processedUri = await processDocumentImage(srcUris[i], docType);
    const filename = `doc_${batchTs}_${i}.jpg`;
    const relativePath = `documents/${filename}`;
    const localPath = `${FileSystem.documentDirectory}${relativePath}`;
    await FileSystem.copyAsync({ from: processedUri, to: localPath });
    results.push({ processedUri, localPath, relativePath });
  }
  return results;
}

/**
 * Copiază un PDF (de la `DocumentPicker`) în `documents/` ca atașament.
 * Nu procesăm PDF-urile (păstrăm originalul).
 */
export async function savePdfAsPage(
  srcUri: string
): Promise<Pick<SavedPage, 'localPath' | 'relativePath'>> {
  await ensureDocumentsDir();
  const filename = uniqueDocFilename('pdf');
  const relativePath = `documents/${filename}`;
  const localPath = `${FileSystem.documentDirectory}${relativePath}`;
  await FileSystem.copyAsync({ from: srcUri, to: localPath });
  return { localPath, relativePath };
}
