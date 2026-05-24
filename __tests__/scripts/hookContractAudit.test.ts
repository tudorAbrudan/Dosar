/* eslint-disable @typescript-eslint/no-var-requires */
const { auditSource } = require('../../scripts/hook-contract-audit');

describe('hook-contract-audit', () => {
  it('passes hook with loading, error, refresh', () => {
    const src = `
      export function useThing() {
        const [loading, setLoading] = useState(false);
        const [error, setError] = useState<string | null>(null);
        const refresh = async () => {};
        return { items: [], loading, error, refresh };
      }
    `;
    expect(auditSource('hooks/useThing.ts', src)).toEqual([]);
  });

  it('flags hook missing error key', () => {
    const src = `
      export function useThing() {
        const [loading] = useState(false);
        return { items: [], loading, refresh: async () => {} };
      }
    `;
    const violations = auditSource('hooks/useThing.ts', src);
    expect(violations).toHaveLength(1);
    expect(violations[0].missing).toEqual(['error']);
  });

  it('accepts refetch as refresh equivalent', () => {
    const src = `
      export function useThing() {
        return { loading: false, error: null, refetch: () => {} };
      }
    `;
    expect(auditSource('hooks/useThing.ts', src)).toEqual([]);
  });

  it('skips hook in ALLOWED_HOOKS allowlist', () => {
    const src = `export function useThemeScheme() { return 'light'; }`;
    expect(auditSource('hooks/useThemeScheme.ts', src)).toEqual([]);
  });

  it('ignores non-hook exports', () => {
    const src = `export function helper() { return 42; }`;
    expect(auditSource('hooks/helpers.ts', src)).toEqual([]);
  });

  it('flags hook with no return object at all', () => {
    const src = `export function useThing() { fetchData(); }`;
    const v = auditSource('hooks/useThing.ts', src);
    expect(v).toHaveLength(1);
    expect(v[0].missing).toEqual(['loading', 'error', 'refresh']);
  });

  it('accepts const arrow hook form', () => {
    const src = `
      export const useThing = () => {
        return { loading: false, error: null, reload: () => {} };
      };
    `;
    expect(auditSource('hooks/useThing.ts', src)).toEqual([]);
  });

  it('uses last top-level return, not inner returns from nested arrows', () => {
    const src = `
      export function useThing() {
        const mapped = items.map(raw => {
          return { ...raw, onPress: () => {} };
        });
        return { items: mapped, loading: false, error: null, refresh: () => {} };
      }
    `;
    expect(auditSource('hooks/useThing.ts', src)).toEqual([]);
  });

  it('accepts ...state spread as proof of contract presence', () => {
    const src = `
      interface State { loading: boolean; error: string | null; data: string[] }
      export function useThing() {
        const [state] = useState<State>({ loading: false, error: null, data: [] });
        return { ...state, refresh: () => {} };
      }
    `;
    expect(auditSource('hooks/useThing.ts', src)).toEqual([]);
  });
});
