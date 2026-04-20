import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  getDocTypeSensitivity,
  resolveLlmOcrEnabled,
  setGlobalLlmOcrEnabled,
  setPerTypeConsent,
  clearPerTypeConsent,
} from '@/services/ocrConsent';

describe('getDocTypeSensitivity', () => {
  it('clasifică reteta_medicala ca medical', () => {
    expect(getDocTypeSensitivity('reteta_medicala')).toBe('medical');
  });

  it('clasifică analize_medicale ca medical', () => {
    expect(getDocTypeSensitivity('analize_medicale')).toBe('medical');
  });

  it('clasifică buletin ca sensitive', () => {
    expect(getDocTypeSensitivity('buletin')).toBe('sensitive');
  });

  it('clasifică rca ca sensitive', () => {
    expect(getDocTypeSensitivity('rca')).toBe('sensitive');
  });

  it('clasifică factura ca general', () => {
    expect(getDocTypeSensitivity('factura')).toBe('general');
  });

  it('clasifică contract ca general', () => {
    expect(getDocTypeSensitivity('contract')).toBe('general');
  });

  it('clasifică garantie ca general', () => {
    expect(getDocTypeSensitivity('garantie')).toBe('general');
  });
});

describe('resolveLlmOcrEnabled', () => {
  // In-memory store to simulate AsyncStorage across calls within a test
  let store: Record<string, string> = {};

  beforeEach(() => {
    store = {};

    (AsyncStorage.getItem as jest.Mock).mockImplementation(
      (key: string) => Promise.resolve(store[key] ?? null)
    );
    (AsyncStorage.setItem as jest.Mock).mockImplementation(
      (key: string, value: string) => {
        store[key] = value;
        return Promise.resolve(undefined);
      }
    );
    (AsyncStorage.removeItem as jest.Mock).mockImplementation(
      (key: string) => {
        delete store[key];
        return Promise.resolve(undefined);
      }
    );
  });

  beforeEach(async () => {
    await setGlobalLlmOcrEnabled(true);
    await clearPerTypeConsent('factura');
    await clearPerTypeConsent('buletin');
    await clearPerTypeConsent('reteta_medicala');
  });

  it('medical returnează false indiferent de global', async () => {
    await setGlobalLlmOcrEnabled(true);
    expect(await resolveLlmOcrEnabled('reteta_medicala')).toBe(false);
  });

  it('sensitive fără per-type consent returnează false', async () => {
    expect(await resolveLlmOcrEnabled('buletin')).toBe(false);
  });

  it('sensitive cu per-type allow returnează true', async () => {
    await setPerTypeConsent('buletin', 'allow');
    expect(await resolveLlmOcrEnabled('buletin')).toBe(true);
  });

  it('sensitive cu per-type deny returnează false', async () => {
    await setPerTypeConsent('buletin', 'deny');
    expect(await resolveLlmOcrEnabled('buletin')).toBe(false);
  });

  it('general fără per-type urmează global (true)', async () => {
    await setGlobalLlmOcrEnabled(true);
    expect(await resolveLlmOcrEnabled('factura')).toBe(true);
  });

  it('general fără per-type urmează global (false)', async () => {
    await setGlobalLlmOcrEnabled(false);
    expect(await resolveLlmOcrEnabled('factura')).toBe(false);
  });

  it('general cu per-type deny suprascrie global', async () => {
    await setGlobalLlmOcrEnabled(true);
    await setPerTypeConsent('factura', 'deny');
    expect(await resolveLlmOcrEnabled('factura')).toBe(false);
  });

  it('general cu per-type allow când global e false', async () => {
    await setGlobalLlmOcrEnabled(false);
    await setPerTypeConsent('factura', 'allow');
    expect(await resolveLlmOcrEnabled('factura')).toBe(true);
  });
});
