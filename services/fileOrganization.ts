/**
 * Naming partajat pentru organizarea fișierelor în backup: foldere
 * `<NumeEntitate>/<TipDoc>/<filename>`. Folosit de ZIP (`backup.ts`) și de
 * backup-ul cloud (`cloudSync.ts`) ca să producă structuri identice.
 */
import { toRelativePath } from './fileUtils';
import { DOCUMENT_TYPE_LABELS } from '@/types';
import type * as docs from './documents';

type DocLike = Awaited<ReturnType<typeof docs.getDocuments>>[number];
type PageLike = Awaited<ReturnType<typeof docs.getAllDocumentPages>>[number];

export interface EntityNameMaps {
  personNames: Map<string, string>;
  vehicleNames: Map<string, string>;
  propertyNames: Map<string, string>;
  cardNames: Map<string, string>;
  animalNames: Map<string, string>;
  companyNames: Map<string, string>;
  customTypeNames: Map<string, string>;
}

export function sanitizeFolderName(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, '_').trim() || 'General';
}

function entityFolder(doc: DocLike, m: EntityNameMaps): string {
  if (doc.vehicle_id) return m.vehicleNames.get(doc.vehicle_id) ?? 'General';
  if (doc.person_id) return m.personNames.get(doc.person_id) ?? 'General';
  if (doc.property_id) return m.propertyNames.get(doc.property_id) ?? 'General';
  if (doc.animal_id) return m.animalNames.get(doc.animal_id) ?? 'General';
  if (doc.company_id) return m.companyNames.get(doc.company_id) ?? 'General';
  if (doc.card_id) return m.cardNames.get(doc.card_id) ?? 'General';
  return 'General';
}

function docTypeFolder(doc: DocLike, m: EntityNameMaps): string {
  if (doc.type === 'custom' && doc.custom_type_id) {
    const customName = m.customTypeNames.get(doc.custom_type_id);
    if (customName) return customName;
  }
  return DOCUMENT_TYPE_LABELS[doc.type] ?? doc.type;
}

/** Calea relativă structurată (`<Entity>/<DocType>/<filename>`) pentru un document. */
export function relPathForDoc(doc: DocLike, diskRelPath: string, m: EntityNameMaps): string {
  const filename = diskRelPath.split('/').pop() ?? diskRelPath;
  const ef = sanitizeFolderName(entityFolder(doc, m));
  const tf = sanitizeFolderName(docTypeFolder(doc, m));
  return `${ef}/${tf}/${filename}`;
}

/** Map diskRelativePath → structuredRelativePath pentru documente + pagini. */
export function buildEntityFileMap(
  allDocuments: DocLike[],
  allPages: PageLike[],
  m: EntityNameMaps
): Record<string, string> {
  const fileMap: Record<string, string> = {};
  const docById = new Map(allDocuments.map(d => [d.id, d]));
  for (const doc of allDocuments) {
    if (!doc.file_path) continue;
    const rel = toRelativePath(doc.file_path);
    if (!fileMap[rel]) fileMap[rel] = relPathForDoc(doc, rel, m);
  }
  for (const page of allPages) {
    if (!page.file_path) continue;
    const rel = toRelativePath(page.file_path);
    if (fileMap[rel]) continue;
    const parentDoc = docById.get(page.document_id);
    fileMap[rel] = parentDoc ? relPathForDoc(parentDoc, rel, m) : rel;
  }
  return fileMap;
}
