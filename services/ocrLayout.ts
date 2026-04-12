import type { TextBlock } from '@react-native-ml-kit/text-recognition';

// ─── Tipuri interne ───────────────────────────────────────────────────────────

interface WordBox {
  text: string;
  x: number; // frame.left
  y: number; // frame.top
  w: number; // frame.width
  h: number; // frame.height
}

// ─── Extragere cuvinte cu poziție ─────────────────────────────────────────────

/**
 * Aplatizează toate elementele (cuvintele) din blocks în WordBox[].
 * Fallback la nivel de linie dacă elementele lipsesc (ex: unele build-uri Android).
 */
function flattenElements(blocks: TextBlock[]): WordBox[] {
  const words: WordBox[] = [];
  for (const block of blocks) {
    for (const line of block.lines) {
      if (line.elements.length > 0) {
        for (const el of line.elements) {
          if (!el.frame || !el.text.trim()) continue;
          words.push({
            text: el.text.trim(),
            x: el.frame.left,
            y: el.frame.top,
            w: el.frame.width,
            h: el.frame.height,
          });
        }
      } else if (line.frame && line.text.trim()) {
        // Fallback: linia întreagă ca un singur "cuvânt"
        words.push({
          text: line.text.trim(),
          x: line.frame.left,
          y: line.frame.top,
          w: line.frame.width,
          h: line.frame.height,
        });
      }
    }
  }
  return words;
}

// ─── Grupare pe rânduri ───────────────────────────────────────────────────────

/**
 * Grupează cuvintele în rânduri bazat pe coordonata Y.
 * Toleranță = 50% din înălțimea primului cuvânt din rând (relative, nu fixă).
 */
function groupIntoRows(words: WordBox[]): WordBox[][] {
  if (words.length === 0) return [];

  const sorted = [...words].sort((a, b) => a.y - b.y);
  const rows: WordBox[][] = [];
  let currentRow: WordBox[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const word = sorted[i];
    const ref = currentRow[0];
    const tolerance = ref.h * 0.5;
    const yCenterWord = word.y + word.h / 2;
    const yCenterRef = ref.y + ref.h / 2;

    if (Math.abs(yCenterWord - yCenterRef) <= tolerance) {
      currentRow.push(word);
    } else {
      rows.push(currentRow);
      currentRow = [word];
    }
  }
  rows.push(currentRow);

  // Sortare pe X în interiorul fiecărui rând
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
  }

  return rows;
}

// ─── Detectare coloane ────────────────────────────────────────────────────────

const COLUMN_GAP_FACTOR = 1.5;

/**
 * Împarte un rând în coloane detectând gap-uri mari între cuvinte consecutive.
 * Gap > medie_lățime_cuvânt × 1.5 → separator de coloană.
 */
function detectColumns(row: WordBox[]): string[] {
  if (row.length <= 1) return row.map(w => w.text);

  const avgW = row.reduce((sum, w) => sum + w.w, 0) / row.length;
  const threshold = avgW * COLUMN_GAP_FACTOR;
  const columns: string[] = [];
  let current = row[0].text;

  for (let i = 1; i < row.length; i++) {
    const gap = row[i].x - (row[i - 1].x + row[i - 1].w);
    if (gap > threshold) {
      columns.push(current);
      current = row[i].text;
    } else {
      current += ' ' + row[i].text;
    }
  }
  columns.push(current);
  return columns;
}

// ─── Export principal ─────────────────────────────────────────────────────────

/**
 * Reconstruiește textul dintr-o imagine păstrând structura spațială.
 *
 * Dacă documentul are structură tabelară (≥40% din rânduri au 2+ coloane),
 * coloanele sunt separate cu "  |  ".
 * Altfel, cuvintele din același rând sunt reunite cu spații.
 *
 * Returnează string gol dacă blocks sunt goale sau fără frame-uri.
 */
export function reconstructLayout(blocks: TextBlock[]): string {
  const words = flattenElements(blocks);
  if (words.length === 0) return '';

  const rows = groupIntoRows(words);
  const columnCounts = rows.map(row => detectColumns(row).length);
  const maxCols = Math.max(...columnCounts);
  const multiColumnRows = columnCounts.filter(c => c >= 2).length;
  const isTabular = maxCols >= 2 && multiColumnRows >= rows.length * 0.4;

  return rows
    .map(row => {
      const cols = detectColumns(row);
      return isTabular && cols.length > 1 ? cols.join('  |  ') : cols.join(' ');
    })
    .join('\n');
}
