/* eslint-disable @typescript-eslint/no-var-requires */
const {
  auditEnvLine,
  auditConfigSource,
} = require('../../scripts/expo-public-secrets-audit');

describe('expo-public-secrets-audit', () => {
  it('passes EXPO_PUBLIC_APP_VERSION', () => {
    expect(auditEnvLine('EXPO_PUBLIC_APP_VERSION=1.2.3', 1, '.env')).toBeNull();
  });

  it('flags EXPO_PUBLIC_OPENAI_API_KEY (not in allowlist)', () => {
    const v = auditEnvLine('EXPO_PUBLIC_OPENAI_API_KEY=sk-...', 5, '.env');
    expect(v?.name).toBe('EXPO_PUBLIC_OPENAI_API_KEY');
    expect(v?.trigger).toBe('KEY');
  });

  it('flags EXPO_PUBLIC_SUPABASE_SECRET', () => {
    expect(auditEnvLine('EXPO_PUBLIC_SUPABASE_SECRET=x', 1, '.env')?.trigger).toBe('SECRET');
  });

  it('ignores non-EXPO_PUBLIC lines', () => {
    expect(auditEnvLine('MISTRAL_API_KEY=secret', 1, '.env')).toBeNull();
  });

  it('ignores commented lines', () => {
    expect(auditEnvLine('# EXPO_PUBLIC_FOO_KEY=x', 1, '.env')).toBeNull();
  });

  it('flags EXPO_PUBLIC_*_TOKEN in app.config.ts', () => {
    const src = `export default { extra: { EXPO_PUBLIC_GH_TOKEN: process.env.GH_TOKEN } };`;
    const v = auditConfigSource(src, 'app.config.ts');
    expect(v.some((x: { name: string }) => x.name === 'EXPO_PUBLIC_GH_TOKEN')).toBe(true);
  });

  it('skips allowlisted EXPO_PUBLIC_MISTRAL_API_KEY in env', () => {
    expect(auditEnvLine('EXPO_PUBLIC_MISTRAL_API_KEY=sk-xxx', 1, '.env')).toBeNull();
  });

  it('skips allowlisted EXPO_PUBLIC_MISTRAL_API_KEY in config', () => {
    const src = `extra: { EXPO_PUBLIC_MISTRAL_API_KEY: process.env.MISTRAL_API_KEY }`;
    expect(auditConfigSource(src, 'app.config.ts')).toEqual([]);
  });

  it('does not double-report same name in config source', () => {
    const src = `
      EXPO_PUBLIC_FOO_KEY
      EXPO_PUBLIC_FOO_KEY
    `;
    expect(auditConfigSource(src, 'app.config.ts')).toHaveLength(1);
  });
});
