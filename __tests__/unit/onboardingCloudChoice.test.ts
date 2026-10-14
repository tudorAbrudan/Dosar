/**
 * Regresia (audit UX backup 2026-10-14): în onboarding, „Continuă" pornea backup-ul
 * automat și când iCloud avea deja un backup. La prima ieșire din aplicație,
 * manifestul gol de pe telefonul nou îl înlocuia.
 */
import { autoBackupOnContinue } from '@/components/onboarding/CloudBackupStep';

const FOUND = { count: 12, date: '01.10.2026', encrypted: false };

describe('autoBackupOnContinue', () => {
  it('nu atinge backup-ul automat când iCloud are deja un backup', () => {
    expect(autoBackupOnContinue({ status: 'available', meta: FOUND }, true)).toBeNull();
    expect(
      autoBackupOnContinue({ status: 'available', meta: { ...FOUND, encrypted: true } }, true)
    ).toBeNull();
  });

  it('fără backup în iCloud respectă comutatorul', () => {
    expect(autoBackupOnContinue({ status: 'available', meta: null }, true)).toBe(true);
    expect(autoBackupOnContinue({ status: 'available', meta: null }, false)).toBe(false);
  });

  it('iCloud indisponibil sau verificare în curs: nimic de persistat', () => {
    expect(autoBackupOnContinue({ status: 'unavailable' }, true)).toBeNull();
    expect(autoBackupOnContinue({ status: 'checking' }, true)).toBeNull();
  });
});
