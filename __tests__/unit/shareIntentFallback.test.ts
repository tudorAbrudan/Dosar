/**
 * Regresie iOS 27 (2026-10-01): sistemul livrează aplicației URL-ul extensiei de share
 * ca `acte:///` (fără `dataUrl=<cheie>` și fără `#media`), deci share-ul nu mai ajungea
 * la „Adaugă document". `pullPendingShareIntent` cere datele extensiei direct modulului
 * nativ, cu URL sintetic, pentru ambele tipuri (imagini = media, PDF = file).
 */
const mockGetShareIntent = jest.fn().mockResolvedValue(undefined);

jest.mock('expo-share-intent', () => ({
  ShareIntentModule: { getShareIntent: (...a: unknown[]) => mockGetShareIntent(...a) },
  getScheme: () => 'acte',
  getShareExtensionKey: () => 'acteShareKey',
}));

import { pullPendingShareIntent } from '@/services/shareIntentFallback';

beforeEach(() => mockGetShareIntent.mockClear());

describe('pullPendingShareIntent', () => {
  it('cere modulului nativ imagini (media) și PDF (file) cu URL sintetic', async () => {
    await pullPendingShareIntent();
    expect(mockGetShareIntent.mock.calls.map(c => c[0])).toEqual([
      'acte://dataUrl=acteShareKey#media',
      'acte://dataUrl=acteShareKey#file',
    ]);
  });

  it('nu aruncă dacă modulul eșuează pe un tip și continuă cu următorul', async () => {
    mockGetShareIntent.mockRejectedValueOnce(new Error('boom'));
    await expect(pullPendingShareIntent()).resolves.toBeUndefined();
    expect(mockGetShareIntent).toHaveBeenCalledTimes(2);
  });
});
