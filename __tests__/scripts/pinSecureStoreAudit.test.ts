/* eslint-disable @typescript-eslint/no-var-requires */
const { auditSource } = require('../../scripts/pin-secure-store-audit');

describe('pin-secure-store-audit', () => {
  it('passes AsyncStorage on non-secret key', () => {
    const src = `AsyncStorage.setItem('theme', 'dark');`;
    expect(auditSource('services/x.ts', src)).toEqual([]);
  });

  it('flags AsyncStorage.setItem on pin key', () => {
    const src = `AsyncStorage.setItem('user_pin', '1234');`;
    const v = auditSource('services/x.ts', src);
    expect(v).toHaveLength(1);
    expect(v[0].key).toContain('pin');
  });

  it('flags AsyncStorage.getItem on biometric key', () => {
    const src = `await AsyncStorage.getItem('biometric_enabled');`;
    expect(auditSource('services/x.ts', src)).toHaveLength(1);
  });

  it('flags removeItem on password key', () => {
    const src = `AsyncStorage.removeItem('user_password');`;
    expect(auditSource('services/x.ts', src)).toHaveLength(1);
  });

  it('accepts SecureStore.setItemAsync (not AsyncStorage)', () => {
    const src = `SecureStore.setItemAsync('pin', '1234');`;
    expect(auditSource('services/x.ts', src)).toEqual([]);
  });

  it('ignores AsyncStorage without secret-pattern key', () => {
    const src = `AsyncStorage.setItem('user_email', x);`;
    expect(auditSource('services/x.ts', src)).toEqual([]);
  });
});
