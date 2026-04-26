/**
 * Smoke tests — verifică că fiecare serviciu se poate importa fără a arunca erori.
 *
 * Tipul de bug prins: import top-level care aruncă (ex. requireNativeModule cu
 * modul nativ lipsă) face ca ORICE ecran care importă serviciul să nu se încarce.
 * Exact bug-ul care a cauzat crash-ul la "Adaugă document" în prod (build 10).
 */

describe('Smoke tests — importuri servicii', () => {
  it('pdfExtractor se importă fără erori', () => {
    expect(() => require('@/services/pdfExtractor')).not.toThrow();
  });

  it('pdfOcr se importă fără erori (chiar dacă modulul nativ lipsește)', () => {
    // Acesta e exact bug-ul din build 10: requireNativeModule('PdfRenderer')
    // arunca la top-level → add.tsx nu se putea încărca → crash la navigare
    expect(() => require('@/services/pdfOcr')).not.toThrow();
  });

  it('backup se importă fără erori', () => {
    expect(() => require('@/services/backup')).not.toThrow();
  });

  it('db se importă fără erori', () => {
    expect(() => require('@/services/db')).not.toThrow();
  });

  it('documents se importă fără erori', () => {
    expect(() => require('@/services/documents')).not.toThrow();
  });

  it('entities se importă fără erori', () => {
    expect(() => require('@/services/entities')).not.toThrow();
  });

  it('fileUtils se importă fără erori', () => {
    expect(() => require('@/services/fileUtils')).not.toThrow();
  });

  it('notifications se importă fără erori', () => {
    expect(() => require('@/services/notifications')).not.toThrow();
  });

  it('settings se importă fără erori', () => {
    expect(() => require('@/services/settings')).not.toThrow();
  });

  it('customTypes se importă fără erori', () => {
    expect(() => require('@/services/customTypes')).not.toThrow();
  });

  it('ocr se importă fără erori', () => {
    expect(() => require('@/services/ocr')).not.toThrow();
  });

  it('ocrExtractors se importă fără erori', () => {
    expect(() => require('@/services/ocrExtractors')).not.toThrow();
  });

  it('localModel se importă fără erori', () => {
    expect(() => require('@/services/localModel')).not.toThrow();
  });

  it('financialAccounts se importă fără erori', () => {
    expect(() => require('@/services/financialAccounts')).not.toThrow();
  });

  it('transactions se importă fără erori', () => {
    expect(() => require('@/services/transactions')).not.toThrow();
  });

  it('categories se importă fără erori', () => {
    expect(() => require('@/services/categories')).not.toThrow();
  });

  it('bankStatementParser se importă fără erori', () => {
    expect(() => require('@/services/bankStatementParser')).not.toThrow();
  });

  it('fuel se importă fără erori', () => {
    expect(() => require('@/services/fuel')).not.toThrow();
  });
});
