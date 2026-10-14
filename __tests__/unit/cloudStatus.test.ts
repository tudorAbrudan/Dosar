import { deriveCloudStatus, type CloudStatusInput } from '@/services/cloud/status';

const ACTIVE: CloudStatusInput = {
  available: true,
  enabled: true,
  passwordRequired: false,
  pendingCount: 0,
  lastUploadedAt: 1_700_000_000_000,
};

describe('deriveCloudStatus', () => {
  it('„Sincronizat" doar cu backup activ, fără coadă și cu un manifest în iCloud', () => {
    expect(deriveCloudStatus(ACTIVE)).toBe('idle');
  });

  it('parola lipsă bate „Se sincronizează" (fișierele nu pleacă oricum)', () => {
    expect(deriveCloudStatus({ ...ACTIVE, passwordRequired: true, pendingCount: 12 })).toBe(
      'needsPassword'
    );
    expect(deriveCloudStatus({ ...ACTIVE, passwordRequired: true })).toBe('needsPassword');
  });

  it('fără manifest în iCloud nu e „Sincronizat"', () => {
    expect(deriveCloudStatus({ ...ACTIVE, lastUploadedAt: null })).toBe('noBackup');
  });

  it('coada în curs rămâne „Se sincronizează" și înainte de primul manifest', () => {
    expect(deriveCloudStatus({ ...ACTIVE, pendingCount: 3, lastUploadedAt: null })).toBe(
      'uploading'
    );
  });

  it('iCloud indisponibil și backup oprit au prioritate', () => {
    expect(deriveCloudStatus({ ...ACTIVE, available: false, passwordRequired: true })).toBe(
      'unavailable'
    );
    expect(deriveCloudStatus({ ...ACTIVE, enabled: false, passwordRequired: true })).toBe('paused');
  });
});
