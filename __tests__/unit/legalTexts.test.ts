import {
  buildTermsText,
  buildPrivacyText,
  LEGAL_VERSION,
  LEGAL_DATE,
} from '@/components/settings/legalTexts';

const DEPS = {
  appName: 'TestApp',
  contactEmail: 'test@example.com',
  privacyUrl: 'https://privacy.test',
};

describe('legalTexts', () => {
  it('TERMS conține versiunea și data curentă', () => {
    const text = buildTermsText(DEPS);
    expect(text).toContain(LEGAL_VERSION);
    expect(text).toContain(LEGAL_DATE);
  });

  it('TERMS injectează app name și email contact', () => {
    const text = buildTermsText(DEPS);
    expect(text).toContain('TestApp');
    expect(text).toContain('test@example.com');
  });

  it('PRIVACY conține referințele AI opt-in critice', () => {
    const text = buildPrivacyText(DEPS);
    expect(text).toMatch(/ASISTENT AI/i);
    expect(text).toMatch(/consimț[aă]m[âa]nt/i);
    expect(text).toContain('CVV');
  });

  it('PRIVACY injectează app name, email și URL', () => {
    const text = buildPrivacyText(DEPS);
    expect(text).toContain('TestApp');
    expect(text).toContain('test@example.com');
    expect(text).toContain('https://privacy.test');
  });

  it('PRIVACY listează drepturile GDPR', () => {
    const text = buildPrivacyText(DEPS);
    expect(text).toMatch(/Acces/);
    expect(text).toMatch(/Rectificare/);
    expect(text).toMatch(/Ștergere/);
    expect(text).toMatch(/Portabilitate/);
  });
});
