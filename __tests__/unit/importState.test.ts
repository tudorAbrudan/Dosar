import {
  beginImport,
  isImportInProgress,
  isRestoreInProgress,
  trackShareWork,
  waitForShareSyncIdle,
} from '@/services/importState';

describe('importState', () => {
  it('importuri suprapuse: primul terminat nu închide flag-ul celuilalt', () => {
    const endRestore = beginImport({ restore: true });
    const endZip = beginImport({ restore: false });

    endZip();
    expect(isImportInProgress()).toBe(true);
    expect(isRestoreInProgress()).toBe(true);

    endRestore();
    expect(isImportInProgress()).toBe(false);
    expect(isRestoreInProgress()).toBe(false);
  });

  it('restaurarea se termină înaintea importului ZIP: rămâne doar flag-ul de import', () => {
    const endRestore = beginImport({ restore: true });
    const endZip = beginImport({ restore: false });

    endRestore();
    expect(isRestoreInProgress()).toBe(false);
    expect(isImportInProgress()).toBe(true);

    endZip();
    expect(isImportInProgress()).toBe(false);
  });

  it('a doua încheiere a aceluiași import nu scade contorul altui import', () => {
    const endA = beginImport({ restore: true });
    const endB = beginImport({ restore: true });

    endA();
    endA();
    expect(isRestoreInProgress()).toBe(true);

    endB();
    expect(isRestoreInProgress()).toBe(false);
  });

  it('restaurarea așteaptă și push-urile pornite în afara sync-ului', async () => {
    let finish!: () => void;
    const push = trackShareWork(new Promise<void>(r => (finish = r)));
    let idle = false;
    const wait = waitForShareSyncIdle().then(() => {
      idle = true;
    });

    await Promise.resolve();
    expect(idle).toBe(false);

    finish();
    await push;
    await wait;
    expect(idle).toBe(true);
  });

  it('un push eșuat nu blochează și nu aruncă din așteptare', async () => {
    trackShareWork(Promise.reject(new Error('offline'))).catch(() => {});
    await expect(waitForShareSyncIdle()).resolves.toBeUndefined();
  });
});
