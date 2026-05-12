import { getDocTypeSensitivity, setPerTypeConsent } from '@/services/ocrConsent';

describe('getDocTypeSensitivity', () => {
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

describe('setPerTypeConsent', () => {
  it('este o funcție exportată', () => {
    expect(typeof setPerTypeConsent).toBe('function');
  });
});
