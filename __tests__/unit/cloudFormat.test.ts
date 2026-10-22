import { formatLastBackup } from '@/services/cloud/format';

// Ora locală a testului: datele se construiesc cu `new Date(an, lună, zi, ...)`,
// deci rezultatul nu depinde de fusul orar al mașinii.
const NOW = new Date(2026, 9, 22, 10, 19).getTime();

describe('formatLastBackup', () => {
  it('azi și ieri cu ora', () => {
    expect(formatLastBackup(new Date(2026, 9, 22, 9, 5).getTime(), NOW)).toBe('azi, 09:05');
    expect(formatLastBackup(new Date(2026, 9, 21, 18, 20).getTime(), NOW)).toBe('ieri, 18:20');
  });

  it('ieri peste granița de lună', () => {
    const now = new Date(2026, 10, 1, 8, 0).getTime();
    expect(formatLastBackup(new Date(2026, 9, 31, 23, 59).getTime(), now)).toBe('ieri, 23:59');
  });

  it('mai vechi: ziua și luna, cu anul doar dacă e alt an', () => {
    expect(formatLastBackup(new Date(2026, 9, 12, 9, 41).getTime(), NOW)).toBe('12 oct.');
    expect(formatLastBackup(new Date(2026, 4, 3, 9, 41).getTime(), NOW)).toBe('3 mai');
    expect(formatLastBackup(new Date(2025, 8, 30, 9, 41).getTime(), NOW)).toBe('30 sept. 2025');
  });
});
