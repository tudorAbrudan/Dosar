/**
 * Generare PDF dintr-un document — produce un HTML standalone care, trimis
 * la `Print.printToFileAsync`, randează:
 *   - paginile documentului (imagini sau PDF-uri convertite la JPEG)
 *   - o pagină de meta la final cu tip, date, câmpuri, notă
 *
 * Extras din `documente/[id].tsx` (~190 linii inline) pentru a izola
 * generarea HTML de orchestrarea print/share.
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';

import { isPdfFile } from './pdfExtractor';
import { renderAllPdfPagesAsBase64 } from './pdfOcr';
import { toFileUri } from './fileUtils';
import { getDocumentLabel } from '@/types';
import type { Document, CustomDocumentType } from '@/types';
import { primary } from '@/theme/colors';
import { DOCUMENT_FIELDS } from '@/types/documentFields';

interface PageRecord {
  file_path: string;
}

interface BuildPdfHtmlOptions {
  doc: Document;
  allPages: PageRecord[];
  customTypes: CustomDocumentType[];
}

/** Slug-ify nume entități / etichete pentru filename PDF. */
export function slugifyForPdfFilename(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Convertește toate paginile (imagini + PDF-uri) la `<img>` tag-uri cu
 * base64 inline. Paginile PDF sunt randate la JPEG; imaginile sunt redimensionate
 * la max 1400px lățime și comprimate la 75% calitate.
 */
async function renderPagesAsHtml(pages: PageRecord[]): Promise<{ html: string[]; failed: boolean }> {
  const imgTags: string[] = [];
  for (const page of pages) {
    const fileUri = toFileUri(page.file_path);
    if (isPdfFile(page.file_path)) {
      const pdfPages = await renderAllPdfPagesAsBase64(fileUri);
      for (const b64 of pdfPages) {
        imgTags.push(`<div class="img-page"><img src="data:image/jpeg;base64,${b64}" /></div>`);
      }
    } else {
      try {
        const compressed = await ImageManipulator.manipulateAsync(
          fileUri,
          [{ resize: { width: 1400 } }],
          { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG }
        );
        const base64 = await FileSystem.readAsStringAsync(compressed.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        imgTags.push(`<div class="img-page"><img src="data:image/jpeg;base64,${base64}" /></div>`);
      } catch {
        // Pagină corruptă / inaccesibilă — sărim peste; raportăm la final.
      }
    }
  }
  return { html: imgTags, failed: imgTags.length === 0 && pages.length > 0 };
}

function renderMetaFields(doc: Document): string[] {
  const fields: string[] = [];
  if (doc.issue_date) {
    fields.push(`
      <div class="field">
        <div class="field-label">Data emisiunii</div>
        <div class="field-value">${escapeHtml(doc.issue_date)}</div>
      </div>`);
  }
  if (doc.expiry_date) {
    fields.push(`
      <div class="field">
        <div class="field-label">Data expirării</div>
        <div class="field-value">${escapeHtml(doc.expiry_date)}</div>
      </div>`);
  }
  if (doc.metadata) {
    const defs = DOCUMENT_FIELDS[doc.type] ?? [];
    for (const f of defs) {
      const val = doc.metadata[f.key];
      if (val) {
        fields.push(`
          <div class="field">
            <div class="field-label">${escapeHtml(f.label)}</div>
            <div class="field-value">${escapeHtml(val)}</div>
          </div>`);
      }
    }
  }
  return fields;
}

function buildHtmlShell(args: {
  imgTags: string[];
  docLabel: string;
  metaFields: string[];
  note: string | null | undefined;
  generatedDate: string;
}): string {
  const { imgTags, docLabel, metaFields, note, generatedDate } = args;
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; background: #fff; color: #1e2318; }

  .img-page {
    width: 100vw;
    height: 100vh;
    padding: 12mm;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .img-page img {
    max-width: 100%;
    max-height: 100%;
    width: auto;
    height: auto;
    display: block;
  }

  .meta-page { padding: 12mm; page-break-inside: avoid; }
  .meta-header {
    display: flex; align-items: flex-start; justify-content: space-between;
    padding-bottom: 4mm;
    border-bottom: 2px solid ${primary};
    margin-bottom: 6mm;
  }
  .meta-brand { font-size: 16px; font-weight: 800; color: #1a1a1a; }
  .meta-brand-url { font-size: 11px; font-weight: 400; color: #666; margin-left: 8px; vertical-align: middle; }
  .meta-doc-type { font-size: 24px; font-weight: 700; margin-bottom: 6mm; }
  .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm; margin-bottom: 4mm; }
  .field {
    background: #f8faf4; border: 1px solid #e2ebd4;
    border-radius: 6px; padding: 3mm 4mm;
  }
  .field-label {
    font-size: 8px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.06em; color: #374151; margin-bottom: 1.5mm;
  }
  .field-value { font-size: 13px; font-weight: 500; }
  .note-box {
    background: #f8faf4; border: 1px solid #e2ebd4;
    border-left: 3px solid ${primary};
    border-radius: 0 6px 6px 0; padding: 3mm 4mm; margin-bottom: 6mm;
  }
  .note-label {
    font-size: 8px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.06em; color: #374151; margin-bottom: 1.5mm;
  }
  .note-value { font-size: 12px; color: #444; line-height: 1.6; }
  .meta-footer {
    margin-top: 8mm; padding-top: 3mm;
    border-top: 0.5px solid #e2ebd4;
    display: flex; flex-direction: column; gap: 1mm;
    font-size: 8px; color: #bbb;
  }
  .meta-footer-brand { color: #1a1a1a; font-weight: 700; }
</style></head><body>

  ${imgTags.join('\n')}

  <div class="meta-page">
    <div class="meta-header">
      <div>
        <div class="meta-brand">Dosar <span class="meta-brand-url">tudorabrudan.github.io/Dosar</span></div>
      </div>
    </div>
    <div class="meta-doc-type">${docLabel}</div>
    ${metaFields.length > 0 ? `<div class="fields">${metaFields.join('')}</div>` : ''}
    ${note ? `<div class="note-box"><div class="note-label">Notă</div><div class="note-value">${escapeHtml(note)}</div></div>` : ''}
    <div class="meta-footer">
      <span class="meta-footer-brand">Generat cu Dosar · tudorabrudan.github.io/Dosar · App Store: apps.apple.com/ro/app/dosar-documente-personale/id6760576986</span>
      <span>Generat pe ${generatedDate}</span>
    </div>
  </div>

</body></html>`;
}

export interface BuildPdfHtmlResult {
  html: string;
  /** True dacă paginile existau dar niciuna nu a putut fi inclusă. */
  pagesFailed: boolean;
}

export async function buildDocumentPdfHtml({
  doc,
  allPages,
  customTypes,
}: BuildPdfHtmlOptions): Promise<BuildPdfHtmlResult> {
  const { html: imgTags, failed } = await renderPagesAsHtml(allPages);
  const docLabel = escapeHtml(getDocumentLabel(doc, customTypes));
  const generatedDate = new Date().toLocaleDateString('ro-RO', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
  const metaFields = renderMetaFields(doc);
  return {
    html: buildHtmlShell({
      imgTags,
      docLabel,
      metaFields,
      note: doc.note,
      generatedDate,
    }),
    pagesFailed: failed,
  };
}
