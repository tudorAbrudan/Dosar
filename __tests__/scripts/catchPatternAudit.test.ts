/* eslint-disable @typescript-eslint/no-var-requires */
const { auditSource } = require('../../scripts/catch-pattern-audit');

describe('catch-pattern-audit', () => {
  it('passes catch with instanceof Error guard', () => {
    const src = `
      try { foo(); }
      catch (e) {
        const msg = e instanceof Error ? e.message : 'Eroare necunoscută';
        Alert.alert(msg);
      }
    `;
    expect(auditSource('services/foo.ts', src)).toEqual([]);
  });

  it('flags catch using e.message without guard', () => {
    const src = `
      try { foo(); }
      catch (e) {
        console.log(e.message);
      }
    `;
    const v = auditSource('services/foo.ts', src);
    expect(v).toHaveLength(1);
    expect(v[0].variable).toBe('e');
  });

  it('accepts catch where error is just logged generically', () => {
    const src = `
      try { foo(); }
      catch (e) {
        console.log('eroare', e);
      }
    `;
    expect(auditSource('services/foo.ts', src)).toEqual([]);
  });

  it('handles typed catch (e: unknown)', () => {
    const src = `
      try { foo(); }
      catch (err: unknown) {
        console.log(err.message);
      }
    `;
    expect(auditSource('services/foo.ts', src)).toHaveLength(1);
  });

  it('passes typed catch with guard', () => {
    const src = `
      try { foo(); }
      catch (err: unknown) {
        if (err instanceof Error) Alert.alert(err.message);
      }
    `;
    expect(auditSource('services/foo.ts', src)).toEqual([]);
  });

  it('handles multiple catches in same file', () => {
    const src = `
      try { a(); } catch (e1) { Log.error(e1.message); }
      try { b(); } catch (e2) {
        if (e2 instanceof Error) console.log(e2.message);
      }
    `;
    const v = auditSource('services/foo.ts', src);
    expect(v).toHaveLength(1);
    expect(v[0].variable).toBe('e1');
  });
});
