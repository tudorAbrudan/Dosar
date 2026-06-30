import { extractUtilityInvoiceInfo } from '@/services/ocr';

describe('extractUtilityInvoiceInfo', () => {
  test('extracts POD code (RO + digits)', () => {
    const r = extractUtilityInvoiceInfo('Cod loc de consum: RO005E812345678');
    expect(r.consumptionPointCode).toBe('RO005E812345678');
  });

  test('extracts customer code after label', () => {
    const r = extractUtilityInvoiceInfo('Cod client 1002345678\nFactura...');
    expect(r.customerCode).toBe('1002345678');
  });

  test('returns empty object when nothing matches', () => {
    expect(extractUtilityInvoiceInfo('text fără coduri')).toEqual({});
  });
});
