import { createRestoreIdAllocator, rememberId } from '@/services/restoreIds';

function counter(): () => string {
  let n = 0;
  return () => `new-${++n}`;
}

describe('createRestoreIdAllocator', () => {
  it('restaurare: păstrează ID-ul original', async () => {
    const ids = createRestoreIdAllocator({ preserve: true, newId: counter() });
    expect(await ids.claim('persons', 'p-1')).toBe('p-1');
    expect(await ids.claim('vehicles', 'v-1')).toBe('v-1');
  });

  it('ID duplicat în același tabel: doar prima apariție îl păstrează', async () => {
    const ids = createRestoreIdAllocator({ preserve: true, newId: counter() });
    expect(await ids.claim('persons', 'x')).toBe('x');
    expect(await ids.claim('persons', 'x')).toBe('new-1');
    // Același ID într-un alt tabel e permis (cheile primare sunt per tabel).
    expect(await ids.claim('vehicles', 'x')).toBe('x');
  });

  it('ID lipsă sau care nu e string primește unul nou', async () => {
    const ids = createRestoreIdAllocator({ preserve: true, newId: counter() });
    expect(await ids.claim('persons', undefined)).toBe('new-1');
    expect(await ids.claim('persons', '')).toBe('new-2');
    expect(await ids.claim('persons', 42)).toBe('new-3');
  });

  it('fără preserve: mereu ID nou', async () => {
    const ids = createRestoreIdAllocator({ preserve: false, newId: counter() });
    expect(await ids.claim('persons', 'p-1')).toBe('new-1');
  });

  it('import peste date existente: un ID deja folosit primește unul nou', async () => {
    const ids = createRestoreIdAllocator({
      preserve: true,
      isTaken: async (_table, id) => id === 'p-ocupat',
      newId: counter(),
    });
    expect(await ids.claim('persons', 'p-ocupat')).toBe('new-1');
    expect(await ids.claim('persons', 'p-liber')).toBe('p-liber');
  });
});

describe('rememberId', () => {
  it('prima apariție a unui ID vechi câștigă', () => {
    const map = new Map<string, string>();
    rememberId(map, 'old', 'a');
    rememberId(map, 'old', 'b');
    rememberId(map, undefined, 'c');
    expect([...map]).toEqual([['old', 'a']]);
  });
});
