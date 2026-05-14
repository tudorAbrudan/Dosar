/**
 * Utilități partajate pentru extractoarele OCR — parsare date, căutări în ferestre de linii.
 */

/** Convertește DD.MM.YYYY / DD/MM/YYYY / DD-MM-YYYY în YYYY-MM-DD. */
export function parseDate(s: string): string | undefined {
  const m = s.match(/(\d{2})[.\/-](\d{2})[.\/-](\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return undefined;
}

/**
 * Caută prima dată DD.MM.YYYY găsită pe o linie care matchează `keyword`,
 * sau pe următoarele `windowLines` linii. Returnează YYYY-MM-DD sau undefined.
 */
export function findDateNear(
  text: string,
  keyword: RegExp,
  windowLines = 1
): string | undefined {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (keyword.test(lines[i])) {
      const d = parseDate(lines[i]);
      if (d) return d;
      for (let j = 1; j <= windowLines && i + j < lines.length; j++) {
        const d2 = parseDate(lines[i + j]);
        if (d2) return d2;
      }
    }
  }
  return undefined;
}

/** Returnează prima dată DD.MM.YYYY găsită în text, ca YYYY-MM-DD. */
export function firstDate(text: string): string | undefined {
  const m = text.match(/(\d{2})[.\/-](\d{2})[.\/-](\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return undefined;
}

/** Convertește MM/YYYY în număr comparabil (YYYYMM) pentru sortare/comparare. */
export function mmYyyyToSortKey(mm: string, yyyy: string): number {
  return parseInt(yyyy) * 100 + parseInt(mm);
}
