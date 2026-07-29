/**
 * Reparare căi de fișiere (poze/PDF-uri documente + poze vehicule).
 *
 * Declanșator (2026-07-29): pozele unui document nu se mai afișau, iar OCR-ul /
 * trimiterea la AI eșuau cu o cale `/var/mobile/Containers/...` netradusă.
 * Inspecția containerului de pe device a arătat că acolo căile din DB erau
 * corecte (relative) dar 2 fișiere din 58 lipseau efectiv de pe disc — iar
 * aplicația nu semnala nicăieri asta. De aici cele două roluri de mai jos:
 * rescrierea căilor rupte ȘI raportarea fișierelor chiar lipsă.
 *
 * Modul de eșec 1 — căi absolute din formatul vechi. Versiunile vechi stocau în
 * SQLite calea ABSOLUTĂ a fișierului, incluzând UUID-ul containerului iOS:
 *
 *   /var/mobile/Containers/Data/Application/<UUID>/Documents/documents/doc_x.jpg
 *
 * UUID-ul containerului se schimbă la reinstalare / restore / trecere între
 * build de development și build de App Store. După o astfel de schimbare,
 * fișierul e în continuare pe disc (containerul e migrat cu tot cu conținut),
 * dar calea din DB indică spre containerul VECHI → poza nu se mai afișează,
 * iar `readAsStringAsync` (OCR / trimitere la AI) eșuează cu
 * „File '/var/mobile/.../Documents/documents/doc_x.jpg' ... does not exist".
 *
 * Reparația: fișierele reale sunt indexate după basename (numele fișierului e
 * unic — `doc_<timestamp>[_<n>].{jpg,pdf}`), iar rândurile din DB care indică
 * spre căi inexistente sunt rescrise la calea RELATIVĂ corectă
 * (`documents/doc_x.jpg`), singurul format valid azi (vezi `fileUtils.ts`).
 *
 * Modul de eșec 2 — fișier efectiv absent de pe disc (cazul real din 2026-07-29).
 * Aici nu există ce rescrie, deci singura reparație onestă e RAPORTAREA: userul
 * află câte fișiere lipsesc și care, în loc să vadă un ecran gol și o eroare
 * englezească abia când apasă „Trimite la AI".
 *
 * Reparația NU șterge niciodată nimic: doar rescrie căi. Un fișier care nu se
 * găsește nicăieri e raportat ca lipsă, nu curățat din DB — rândul rămâne cu
 * textul OCR, metadatele și legăturile lui. Fișierele orfane (nereferite de
 * nicio linie din DB) sunt doar numărate, niciodată șterse: pe 2026-07-29 exact
 * ele au permis recuperarea paginilor dispărute.
 */
import * as FileSystem from 'expo-file-system/legacy';

import { db } from './db';
import { emit } from './events';
import { toRelativePath } from './fileUtils';

/** Foldere din DocumentDirectory care pot conține fișiere referite din DB. */
const SCAN_DIRS = ['documents', 'vehicles'] as const;
/** Folder cu un nivel suplimentar de imbricare: `shared/<zone>/<file>`. */
const NESTED_SCAN_DIR = 'shared';

export interface FilePathRepairReport {
  /** Câte referințe de fișier există în DB (documente + pagini + poze vehicule). */
  scanned: number;
  /** Câte căi au fost rescrise ca să indice fișierul real de pe disc. */
  repaired: number;
  /** Câte referințe n-au niciun fișier corespondent pe disc. */
  missing: number;
  /** Primele câteva căi lipsă — pentru mesajul afișat utilizatorului. */
  missingSamples: string[];
  /**
   * Fișiere prezente pe disc pe care nu le referă niciun rând din DB — de
   * regulă originalele dinainte de decupare, păstrate la salvarea paginii.
   * NU se șterg automat: pe 2026-07-29 exact aceste orfane au permis
   * recuperarea unui document ale cărui pagini dispăruseră de pe disc.
   */
  orphans: number;
}

interface FileRef {
  table: 'documents' | 'document_pages' | 'vehicles';
  column: 'file_path' | 'photo_uri';
  id: string;
  stored: string;
}

function basenameOf(path: string): string {
  const clean = path.split('?')[0];
  return clean.slice(clean.lastIndexOf('/') + 1);
}

async function listDir(relativeDir: string): Promise<string[]> {
  const base = FileSystem.documentDirectory;
  if (!base) return [];
  try {
    return await FileSystem.readDirectoryAsync(`${base}${relativeDir}`);
  } catch {
    // Folderul nu există (instalare nouă, feature nefolosit) — nimic de indexat.
    return [];
  }
}

/**
 * Indexează fișierele reale de pe disc: `Set` cu toate căile relative existente
 * + `Map` basename → cale relativă. Basename-urile duplicate (același nume în
 * două foldere) sunt marcate ca ambigue și excluse din reparare, ca să nu legăm
 * un document de fișierul altuia.
 */
async function indexFilesOnDisk(): Promise<{
  existing: Set<string>;
  byBasename: Map<string, string>;
}> {
  const existing = new Set<string>();
  const byBasename = new Map<string, string>();
  const ambiguous = new Set<string>();

  const addFile = (relativePath: string) => {
    existing.add(relativePath);
    const name = basenameOf(relativePath);
    if (byBasename.has(name) && byBasename.get(name) !== relativePath) {
      ambiguous.add(name);
      return;
    }
    byBasename.set(name, relativePath);
  };

  for (const dir of SCAN_DIRS) {
    for (const name of await listDir(dir)) addFile(`${dir}/${name}`);
  }
  for (const zone of await listDir(NESTED_SCAN_DIR)) {
    for (const name of await listDir(`${NESTED_SCAN_DIR}/${zone}`)) {
      addFile(`${NESTED_SCAN_DIR}/${zone}/${name}`);
    }
  }

  for (const name of ambiguous) byBasename.delete(name);
  return { existing, byBasename };
}

async function collectFileRefs(): Promise<FileRef[]> {
  const refs: FileRef[] = [];

  const docs = await db.getAllAsync<{ id: string; file_path: string }>(
    "SELECT id, file_path FROM documents WHERE file_path IS NOT NULL AND file_path != ''"
  );
  for (const r of docs) {
    refs.push({ table: 'documents', column: 'file_path', id: r.id, stored: r.file_path });
  }

  const pages = await db.getAllAsync<{ id: string; file_path: string }>(
    "SELECT id, file_path FROM document_pages WHERE file_path IS NOT NULL AND file_path != ''"
  );
  for (const r of pages) {
    refs.push({ table: 'document_pages', column: 'file_path', id: r.id, stored: r.file_path });
  }

  const vehicles = await db.getAllAsync<{ id: string; photo_uri: string }>(
    "SELECT id, photo_uri FROM vehicles WHERE photo_uri IS NOT NULL AND photo_uri != ''"
  );
  for (const r of vehicles) {
    refs.push({ table: 'vehicles', column: 'photo_uri', id: r.id, stored: r.photo_uri });
  }

  return refs;
}

/**
 * Scanează toate referințele de fișiere din DB și rescrie căile rupte la
 * fișierul real de pe disc (căutat după basename). Idempotentă: la a doua
 * rulare nu mai are ce repara.
 *
 * `document_pages.file_path` are UNIQUE — dacă rescrierea ar duce la coliziune
 * cu altă pagină, rândul e lăsat neatins și raportat ca lipsă (mai bine o poză
 * lipsă decât două pagini care indică același fișier).
 */
export async function repairFilePaths(): Promise<FilePathRepairReport> {
  const [{ existing, byBasename }, refs] = await Promise.all([
    indexFilesOnDisk(),
    collectFileRefs(),
  ]);

  const report: FilePathRepairReport = {
    scanned: refs.length,
    repaired: 0,
    missing: 0,
    missingSamples: [],
    orphans: 0,
  };

  /** Căile efectiv folosite după reparare — ce rămâne pe disc peste ele e orfan. */
  const referenced = new Set<string>();

  for (const ref of refs) {
    // `toRelativePath` taie prefixul containerului CURENT; o cale absolută din
    // alt container rămâne neschimbată și pică pe verificarea de mai jos.
    const relative = toRelativePath(ref.stored);
    if (existing.has(relative)) {
      // Fișierul e acolo unde trebuie. Dacă în DB era stocat absolut (format
      // vechi), îl normalizăm la relativ ca să nu se rupă la următoarea
      // schimbare de container.
      if (relative !== ref.stored) {
        await updateRef(ref, relative, report);
      }
      referenced.add(relative);
      continue;
    }

    const candidate = byBasename.get(basenameOf(ref.stored));
    if (candidate) {
      await updateRef(ref, candidate, report);
      referenced.add(candidate);
      continue;
    }

    report.missing++;
    if (report.missingSamples.length < 5) report.missingSamples.push(basenameOf(ref.stored));
  }

  for (const path of existing) {
    if (!referenced.has(path)) report.orphans++;
  }

  if (report.repaired > 0) {
    emit('documents:changed');
    emit('entities:changed');
  }

  return report;
}

async function updateRef(
  ref: FileRef,
  newPath: string,
  report: FilePathRepairReport
): Promise<void> {
  try {
    await db.runAsync(`UPDATE ${ref.table} SET ${ref.column} = ? WHERE id = ?`, [newPath, ref.id]);
    report.repaired++;
  } catch (e) {
    // Coliziune UNIQUE pe document_pages.file_path sau DB blocată — rândul rămâne
    // cu calea veche, îl raportăm ca lipsă ca să apară în raportul utilizatorului.
    console.warn(
      `[filePathRepair] nu am putut rescrie ${ref.table}.${ref.column} pentru ${ref.id}:`,
      e instanceof Error ? e.message : e
    );
    report.missing++;
    if (report.missingSamples.length < 5) report.missingSamples.push(basenameOf(ref.stored));
  }
}

/**
 * Varianta rulată automat la pornire: repară tăcut, loghează doar dacă a avut
 * ce face. Fără UI — raportul complet e disponibil din Setări → „Repară
 * fișierele documentelor".
 */
export async function repairFilePathsOnStartup(): Promise<void> {
  const report = await repairFilePaths();
  if (report.repaired > 0 || report.missing > 0) {
    console.warn(
      `[filePathRepair] referințe: ${report.scanned}, reparate: ${report.repaired}, lipsă: ${report.missing}, orfane: ${report.orphans}`
    );
  }
}
