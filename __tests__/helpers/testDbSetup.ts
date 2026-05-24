/**
 * Aplică schema reală din `services/db.ts` pe un DB de test.
 *
 * Strategia: extrage TOATE apelurile `db.execSync/runSync/execAsync/runAsync`
 * cu argument string literal (backtick / single / double quote) și execută
 * conținutul lor în ordinea sursă. Skip-uiește statements cu `?` placeholders
 * (necesită params runtime, nu schema-relevant).
 *
 * Toate erorile sunt înghițite — schema reală e validată prin testele care
 * verifică explicit existența tabelelor și coloanelor. Asta evită fragilitatea
 * față de:
 *   - ALTER TABLE care pică pentru duplicate column (matches production behavior)
 *   - Data migrations care depind de starea environment
 *   - Ordinea inter-block care variază
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { TestDb } from './testDb';

export function applySchemaToTestDb(db: TestDb): void {
  const dbTsPath = resolve(__dirname, '../../services/db.ts');
  const source = readFileSync(dbTsPath, 'utf8');

  const re =
    /db\.(?:execSync|execAsync|runSync|runAsync)\s*\(\s*(?:`([\s\S]*?)`|'([^']*)'|"([^"]*)")\s*[,)]/g;

  let m;
  let executed = 0;
  while ((m = re.exec(source)) !== null) {
    const content = m[1] ?? m[2] ?? m[3];
    if (!content) continue;
    // Skip statements care necesită runtime params
    if (content.includes('?')) continue;
    try {
      db._raw.exec(content);
      executed++;
    } catch {
      // Ignored — schema reală e validată prin testele de schema, nu prin
      // succesul aplicării block-by-block (data migrations pot pica în test env).
    }
  }

  if (executed === 0) {
    throw new Error(
      'applySchemaToTestDb: nu am executat niciun statement — verifică pattern-ul regex'
    );
  }
}
