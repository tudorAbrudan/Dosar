/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Returnează o instanță DB compatibilă cu API-ul `expo-sqlite` (folosit în
 * `services/db.ts`), backed de `better-sqlite3` in-memory.
 *
 * Folosire în test:
 *   jest.mock('expo-sqlite', () => ({
 *     openDatabaseSync: () => require('../helpers/testDb').createTestDbInstance(),
 *   }));
 */
import Database from 'better-sqlite3';

export function createTestDbInstance() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');

  const flatten = (params: unknown[]): unknown[] =>
    params.length === 1 && Array.isArray(params[0]) ? (params[0] as unknown[]) : params;

  return {
    execSync(sql: string): void {
      sqlite.exec(sql);
    },
    async execAsync(sql: string): Promise<void> {
      sqlite.exec(sql);
    },
    runSync(sql: string, ...params: unknown[]): { lastInsertRowId: number; changes: number } {
      const stmt = sqlite.prepare(sql);
      const result = stmt.run(...(flatten(params) as never[]));
      return { lastInsertRowId: Number(result.lastInsertRowid), changes: result.changes };
    },
    async runAsync(
      sql: string,
      ...params: unknown[]
    ): Promise<{ lastInsertRowId: number; changes: number }> {
      const stmt = sqlite.prepare(sql);
      const result = stmt.run(...(flatten(params) as never[]));
      return { lastInsertRowId: Number(result.lastInsertRowid), changes: result.changes };
    },
    async getAllAsync<T = unknown>(sql: string, ...params: unknown[]): Promise<T[]> {
      const stmt = sqlite.prepare(sql);
      return stmt.all(...(flatten(params) as never[])) as T[];
    },
    async getFirstAsync<T = unknown>(sql: string, ...params: unknown[]): Promise<T | null> {
      const stmt = sqlite.prepare(sql);
      return (stmt.get(...(flatten(params) as never[])) as T) ?? null;
    },
    getFirstSync<T = unknown>(sql: string, ...params: unknown[]): T | null {
      const stmt = sqlite.prepare(sql);
      return (stmt.get(...(flatten(params) as never[])) as T) ?? null;
    },
    getAllSync<T = unknown>(sql: string, ...params: unknown[]): T[] {
      const stmt = sqlite.prepare(sql);
      return stmt.all(...(flatten(params) as never[])) as T[];
    },
    async withTransactionAsync(fn: () => Promise<void>): Promise<void> {
      sqlite.exec('BEGIN');
      try {
        await fn();
        sqlite.exec('COMMIT');
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    },
    closeSync(): void {
      sqlite.close();
    },
    /** Internal — pentru introspectare la teste schema. */
    _raw: sqlite,
  };
}

export type TestDb = ReturnType<typeof createTestDbInstance>;
