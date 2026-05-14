import { CloudQuotaError, detectQuotaError } from '@/services/cloud/errors';

describe('CloudQuotaError', () => {
  it('are name corect și mesaj default RO', () => {
    const err = new CloudQuotaError();
    expect(err.name).toBe('CloudQuotaError');
    expect(err.message).toMatch(/iCloud/i);
    expect(err.message).toMatch(/spațiu/i);
  });

  it('acceptă mesaj custom', () => {
    const err = new CloudQuotaError('Custom message');
    expect(err.message).toBe('Custom message');
  });

  it('instanceof Error', () => {
    expect(new CloudQuotaError()).toBeInstanceOf(Error);
  });
});

describe('detectQuotaError', () => {
  it.each([
    'iCloud quota exceeded',
    'Not enough space on disk',
    'Insufficient storage space',
    'No space left on device',
    'Storage is full',
    'NSFileWriteOutOfSpaceError',
    'ENOSPC: no space',
    'Error code 640',
    'Out of space',
  ])('detectează quota error în "%s"', (msg) => {
    expect(detectQuotaError(new Error(msg))).toBe(true);
  });

  it.each([
    'Network timeout',
    'Permission denied',
    'File not found',
    '',
  ])('NU detectează quota error în "%s"', (msg) => {
    expect(detectQuotaError(new Error(msg))).toBe(false);
  });

  it('handles null și undefined', () => {
    expect(detectQuotaError(null)).toBe(false);
    expect(detectQuotaError(undefined)).toBe(false);
  });

  it('handles non-Error values', () => {
    expect(detectQuotaError('quota exceeded')).toBe(true);
    expect(detectQuotaError(42)).toBe(false);
  });
});
