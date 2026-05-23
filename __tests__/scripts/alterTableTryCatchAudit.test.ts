/* eslint-disable @typescript-eslint/no-var-requires */
const { auditSource } = require('../../scripts/alter-table-trycatch-audit');

describe('alter-table-trycatch-audit', () => {
  it('passes ALTER TABLE inside try/catch', () => {
    const src = `
      try {
        await db.execAsync(\`ALTER TABLE documents ADD COLUMN tag TEXT;\`);
      } catch (e) {
        // coloana există
      }
    `;
    expect(auditSource(src)).toEqual([]);
  });

  it('flags ALTER TABLE without try wrapper', () => {
    const src = `await db.execAsync(\`ALTER TABLE documents ADD COLUMN tag TEXT;\`);`;
    const v = auditSource(src);
    expect(v).toHaveLength(1);
    expect(v[0].statement).toContain('ALTER TABLE documents');
  });

  it('flags ALTER TABLE where try block is already closed', () => {
    const src = `
      try { foo(); } catch {}
      await db.execAsync(\`ALTER TABLE documents ADD COLUMN x TEXT;\`);
    `;
    expect(auditSource(src)).toHaveLength(1);
  });

  it('handles multiple ALTER TABLE in same try', () => {
    const src = `
      try {
        await db.execAsync(\`ALTER TABLE a ADD COLUMN x TEXT;\`);
        await db.execAsync(\`ALTER TABLE b ADD COLUMN y TEXT;\`);
      } catch (e) {}
    `;
    expect(auditSource(src)).toEqual([]);
  });

  it('flags one of two when only first is wrapped', () => {
    const src = `
      try { await db.execAsync(\`ALTER TABLE a ADD COLUMN x TEXT;\`); } catch {}
      await db.execAsync(\`ALTER TABLE b ADD COLUMN y TEXT;\`);
    `;
    const v = auditSource(src);
    expect(v).toHaveLength(1);
    expect(v[0].statement).toContain('ALTER TABLE b');
  });
});
