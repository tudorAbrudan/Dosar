/**
 * Managerul de descărcare a modelelor locale.
 *
 * Există ca singleton (nu ca stare de componentă) pentru ca descărcarea pornită
 * în onboarding să continue când userul apasă „Continuă" — starea unei componente
 * ar muri la demontare. Aceeași instanță e văzută de onboarding, de banner-ul de
 * pe Acasă și de Setări → Asistent AI; două transferuri paralele pe același
 * fișier l-ar corupe.
 */
import { getDownloadState, subscribeDownload, startModelDownload } from '@/services/modelDownload';

jest.mock('@/services/localModel', () => ({
  LOCAL_MODEL_CATALOG: [{ id: 'test-model', name: 'Test Model', sizeBytes: 1024 * 1024 * 100 }],
  createModelDownload: jest.fn(),
  finalizeModelDownload: jest.fn(),
  deleteModel: jest.fn().mockResolvedValue(undefined),
  setSelectedModelId: jest.fn(),
}));

describe('modelDownload — singleton', () => {
  it('pornește în stare inactivă', () => {
    const s = getDownloadState();
    expect(s.active).toBe(false);
    expect(s.modelId).toBeNull();
    expect(s.error).toBeNull();
  });

  it('subscribe emite imediat starea curentă', () => {
    const cb = jest.fn();
    const unsub = subscribeDownload(cb);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].active).toBe(false);
    unsub();
  });

  it('dezabonarea oprește notificările', () => {
    const cb = jest.fn();
    subscribeDownload(cb)();
    cb.mockClear();
    // startModelDownload pe un id inexistent nu schimbă starea, dar nici nu
    // trebuie să notifice un listener dezabonat.
    void startModelDownload('inexistent');
    expect(cb).not.toHaveBeenCalled();
  });

  it('refuză un model care nu există în catalog', async () => {
    await expect(startModelDownload('inexistent')).resolves.toBe(false);
    expect(getDownloadState().active).toBe(false);
  });
});
