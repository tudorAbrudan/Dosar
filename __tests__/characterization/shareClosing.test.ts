/* eslint-disable @typescript-eslint/no-var-requires */

/**
 * Characterization test — închiderea partajărilor cu confirmare de la participanți
 * (spec ../docs/superpowers/specs/2026-10-15-share-close-confirmations-design.md).
 *
 * Owner: după ce semnalul (ștergerea rădăcinii / `share_state`) e pe server, partajarea
 * se închide când au ieșit toți participanții din instantaneu, cel târziu după 30 de zile.
 */

import {
  createMockCloudKit,
  resetMockCloudKit,
  resetSchema,
  shareSeed,
} from '../helpers/shareFixtures';
import type { TestDb } from '../helpers/testDb';

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => {
    const { createTestDbInstance } = require('../helpers/testDb');
    return createTestDbInstance();
  },
}));

const mockNative = createMockCloudKit();

jest.mock('@/modules/expo-cloudkit-share/src', () => mockNative);

let db: typeof import('@/services/db').db;
let testDb: TestDb;
let seed: ReturnType<typeof shareSeed>;
let cloudShare: typeof import('@/services/cloudShare');
let shareClosing: typeof import('@/services/shareClosing');
let importState: typeof import('@/services/importState');
let sharing: typeof import('@/services/sharing');

beforeAll(() => {
  jest.resetModules();
  jest.isolateModules(() => {
    db = require('@/services/db').db as typeof db;
    testDb = db as unknown as TestDb;
    seed = shareSeed(testDb);
    cloudShare = require('@/services/cloudShare');
    shareClosing = require('@/services/shareClosing');
    importState = require('@/services/importState');
    sharing = require('@/services/sharing');
  });
});

beforeEach(() => {
  resetSchema(testDb);
  resetMockCloudKit(mockNative);
});

const ZONE = 'entity_vehicle_veh-1';
const DAY_MS = 24 * 60 * 60 * 1000;

function closingParticipants(): {
  id: string | null;
  name: string | null;
  confirmedAt: string | null;
}[] {
  return JSON.parse(seed.shareRow(ZONE).closing_participants ?? 'null');
}

/** Partajare proprie ștearsă „și la ei", cu ștergerea rădăcinii deja pe server. */
function seedDeletedShare(sentAt = new Date().toISOString()): void {
  seed.insertShare({
    zoneName: ZONE,
    entityId: 'veh-1',
    role: 'owner',
    deleteRequestedAt: sentAt,
    deleteSentAt: sentAt,
  });
}

describe('owner — confirmările participanților', () => {
  it('reține participanții acceptați la prima citire; cine intră după nu blochează închiderea', async () => {
    seedDeletedShare();
    mockNative.fetchShareParticipants.mockResolvedValueOnce([
      { id: 'user-ana', name: 'Ana Pop', status: 'accepted' },
      { id: 'user-mihai', status: 'accepted' },
      { id: 'user-pending', status: 'pending' },
    ]);

    await cloudShare.syncSharedEntities();

    expect(mockNative.fetchShareParticipants).toHaveBeenCalledWith(ZONE);
    expect(closingParticipants()).toEqual([
      { id: 'user-ana', name: 'Ana Pop', confirmedAt: null },
      { id: 'user-mihai', name: null, confirmedAt: null },
    ]);
    expect(seed.shareRow(ZONE).revoked_at).toBeNull();

    // Ana a ieșit (lipsește), Mihai e `removed`, un nou-venit a intrat pe link.
    mockNative.fetchShareParticipants.mockResolvedValueOnce([
      { id: 'user-mihai', status: 'removed' },
      { id: 'user-nou', status: 'accepted' },
    ]);
    await cloudShare.syncSharedEntities();

    expect(mockNative.deleteZone).toHaveBeenCalledWith(ZONE);
    expect(seed.shareRow(ZONE).revoked_at).not.toBeNull();
  });

  it('nu se închide cât mai e cineva din instantaneu', async () => {
    seedDeletedShare();
    mockNative.fetchShareParticipants.mockResolvedValue([
      { id: 'user-ana', status: 'accepted' },
      { id: 'user-mihai', status: 'accepted' },
    ]);
    await cloudShare.syncSharedEntities();

    mockNative.fetchShareParticipants.mockResolvedValue([{ id: 'user-mihai', status: 'accepted' }]);
    await cloudShare.syncSharedEntities();

    const [ana, mihai] = closingParticipants();
    expect(ana.confirmedAt).not.toBeNull();
    expect(mihai.confirmedAt).toBeNull();
    expect(mockNative.deleteZone).not.toHaveBeenCalled();
    expect(await shareClosing.getClosingShares()).toHaveLength(1);
  });

  it('fără participanți acceptați, zona se închide imediat ce ștergerea ajunge pe server', async () => {
    seed.insertVehicle('veh-1');
    seed.insertShare({ zoneName: ZONE, entityId: 'veh-1', role: 'owner' });
    seed.insertCloudRecord(ZONE, 'veh-1', 'vehicle');
    mockNative.fetchShareParticipants.mockResolvedValue([]);

    await cloudShare.deleteEntityShareEverywhere('vehicle', 'veh-1');
    await importState.waitForShareSyncIdle();
    expect(mockNative.deleteZone).not.toHaveBeenCalled();

    await cloudShare.syncSharedEntities();

    expect(mockNative.deleteZone).toHaveBeenCalledWith(ZONE);
    expect(seed.shareRow(ZONE).revoked_at).not.toBeNull();
  });

  it('un participant fără id nu poate confirma, deci nu permite închiderea înainte de termen', async () => {
    seedDeletedShare();
    mockNative.fetchShareParticipants.mockResolvedValueOnce([{ status: 'accepted' }]);
    await cloudShare.syncSharedEntities();
    mockNative.fetchShareParticipants.mockResolvedValueOnce([]);
    await cloudShare.syncSharedEntities();

    expect(closingParticipants()).toEqual([{ id: null, name: null, confirmedAt: null }]);
    expect(mockNative.deleteZone).not.toHaveBeenCalled();
  });

  it('o confirmare nu se retrage dacă participantul reapare în listă', () => {
    const now = '2026-10-15T10:00:00.000Z';
    const updated = shareClosing.updateClosingParticipants(
      [{ id: 'user-ana', name: 'Ana', confirmedAt: '2026-10-14T10:00:00.000Z' }],
      [{ id: 'user-ana', status: 'accepted' }],
      now
    );
    expect(updated[0].confirmedAt).toBe('2026-10-14T10:00:00.000Z');
  });

  it('share-ul dispărut (oprit din foaia de sistem) închide zona: nu mai are nimeni acces', async () => {
    seedDeletedShare();
    mockNative.fetchShareParticipants.mockRejectedValueOnce(new Error('share-missing'));

    await cloudShare.syncSharedEntities();

    expect(mockNative.deleteZone).toHaveBeenCalledWith(ZONE);
  });

  it('offline: rămâne deschisă, cu eroarea notată, fără instantaneu', async () => {
    seedDeletedShare();
    mockNative.fetchShareParticipants.mockRejectedValueOnce(new Error('network offline'));

    await cloudShare.syncSharedEntities();

    const row = seed.shareRow(ZONE);
    expect(row.revoked_at).toBeNull();
    expect(row.closing_participants).toBeNull();
    expect(row.last_sync_error).toContain('offline');
  });

  it('după termen se închide fără să mai citească participanții', async () => {
    seedDeletedShare(new Date(Date.now() - 31 * DAY_MS).toISOString());

    await cloudShare.syncSharedEntities();

    expect(mockNative.fetchShareParticipants).not.toHaveBeenCalled();
    expect(mockNative.deleteZone).toHaveBeenCalledWith(ZONE);
  });

  it('semnalul încă netrimis: nu citește participanții', async () => {
    seed.insertShare({
      zoneName: ZONE,
      entityId: 'veh-1',
      role: 'owner',
      deleteRequestedAt: new Date().toISOString(),
    });

    await cloudShare.syncSharedEntities();

    expect(mockNative.fetchShareParticipants).not.toHaveBeenCalled();
    expect(seed.shareRow(ZONE).revoked_at).toBeNull();
  });
});

describe('owner — „Revocă" și „Șterge doar la mine"', () => {
  const STOP_RECORD = {
    recordName: 'veh-1',
    recordType: 'vehicle',
    fields: { share_state: 'stopped' },
    mustExist: true,
  };

  function seedActiveShare(): void {
    seed.insertVehicle('veh-1');
    seed.insertShare({ zoneName: ZONE, entityId: 'veh-1', role: 'owner' });
    seed.insertCloudRecord(ZONE, 'veh-1', 'vehicle');
    // O editare a owner-ului încă netrimisă: nu mai pleacă după oprire.
    seed.insertPendingPush(ZONE, 'veh-1', 'upsert', 'entity');
  }

  it('trimite doar semnalul pe rădăcină, lasă zona deschisă și o închide când ies toți', async () => {
    seedActiveShare();
    mockNative.pushRecords.mockResolvedValue({ succeeded: { 'veh-1': 'tag-2' }, failed: {} });

    await cloudShare.revokeEntityShare('vehicle', 'veh-1');
    await importState.waitForShareSyncIdle();

    expect(mockNative.pushRecords).toHaveBeenCalledTimes(1);
    expect(mockNative.pushRecords.mock.calls[0][0]).toEqual({
      zoneName: ZONE,
      scope: 'private',
      records: [STOP_RECORD],
      deletions: [],
    });
    const row = seed.shareRow(ZONE);
    expect(row.stop_requested_at).not.toBeNull();
    expect(row.stop_sent_at).not.toBeNull();
    expect(row.revoked_at).toBeNull();
    expect(seed.pendingPushes(ZONE)).toHaveLength(0);
    expect(await sharing.getShareForEntity('vehicle', 'veh-1')).toBeNull();
    expect(seed.exists('vehicles', 'veh-1')).toBe(true);
    expect(mockNative.deleteZone).not.toHaveBeenCalled();
    const [closing] = await shareClosing.getClosingShares();
    expect(shareClosing.shareCloseKind(closing)).toBe('stop');

    await cloudShare.syncSharedEntities();
    expect(closingParticipants()).toEqual([{ id: 'user-ana', name: null, confirmedAt: null }]);
    expect(mockNative.pushRecords).toHaveBeenCalledTimes(1); // semnalul nu se retrimite

    mockNative.fetchShareParticipants.mockResolvedValue([]);
    await cloudShare.syncSharedEntities();
    expect(mockNative.deleteZone).toHaveBeenCalledWith(ZONE);
    expect(seed.shareRow(ZONE).revoked_at).not.toBeNull();
  });

  it('„Șterge doar la mine": entitatea dispare local, partajarea trece prin aceeași oprire', async () => {
    seedActiveShare();
    mockNative.pushRecords.mockResolvedValue({ succeeded: { 'veh-1': 'tag-2' }, failed: {} });

    // Ce face `deleteVehicle`: șterge rândul, apoi anunță partajarea (prin import
    // dinamic, care în test ar încărca altă instanță a modulului).
    seed.run('DELETE FROM vehicles WHERE id = ?', 'veh-1');
    await cloudShare.afterEntityMutation('vehicle', 'veh-1', 'delete');
    await importState.waitForShareSyncIdle();

    expect(seed.exists('vehicles', 'veh-1')).toBe(false);
    expect(mockNative.pushRecords.mock.calls[0][0].records).toEqual([STOP_RECORD]);
    expect(seed.shareRow(ZONE).stop_sent_at).not.toBeNull();
    expect(mockNative.deleteZone).not.toHaveBeenCalled();
  });

  it.each([
    [
      'schema din Production fără câmp',
      "Cannot create or modify field 'share_state' in record 'vehicle' in production schema",
    ],
    ['rădăcina lipsă pe server', 'record-missing'],
  ])('semnalul imposibil de trimis (%s) închide imediat', async (_label, error) => {
    seedActiveShare();
    mockNative.pushRecords.mockResolvedValue({ succeeded: {}, failed: { 'veh-1': error } });

    await cloudShare.revokeEntityShare('vehicle', 'veh-1');
    await importState.waitForShareSyncIdle();

    expect(mockNative.deleteZone).toHaveBeenCalledWith(ZONE);
    expect(seed.shareRow(ZONE).revoked_at).not.toBeNull();
  });

  it('offline: semnalul rămâne de trimis și pleacă la sync-ul următor', async () => {
    seedActiveShare();
    mockNative.pushRecords.mockRejectedValueOnce(new Error('network offline'));

    await cloudShare.revokeEntityShare('vehicle', 'veh-1');
    await importState.waitForShareSyncIdle();

    let row = seed.shareRow(ZONE);
    expect(row.stop_sent_at).toBeNull();
    expect(row.last_sync_error).toContain('offline');
    expect(mockNative.deleteZone).not.toHaveBeenCalled();

    mockNative.pushRecords.mockResolvedValue({ succeeded: { 'veh-1': 'tag-2' }, failed: {} });
    await cloudShare.syncSharedEntities();

    row = seed.shareRow(ZONE);
    expect(row.stop_sent_at).not.toBeNull();
    expect(mockNative.pushRecords).toHaveBeenLastCalledWith(
      expect.objectContaining({ records: [STOP_RECORD] })
    );
  });

  it('repartajarea unei entități oprite închide întâi zona veche și pornește curat', async () => {
    const now = new Date().toISOString();
    seed.insertVehicle('veh-1');
    seed.insertShare({
      zoneName: ZONE,
      entityId: 'veh-1',
      role: 'owner',
      stopRequestedAt: now,
      stopSentAt: now,
      closingParticipants: '[]',
    });
    mockNative.createSharedZone.mockResolvedValue({ zoneName: ZONE });
    mockNative.pushRecords.mockResolvedValue({ succeeded: { 'veh-1': 'tag-1' }, failed: {} });
    mockNative.shareZone.mockResolvedValue({ shareURL: 'https://www.icloud.com/share/y' });

    await cloudShare.shareEntity('vehicle', 'veh-1');

    expect(mockNative.deleteZone.mock.invocationCallOrder[0]).toBeLessThan(
      mockNative.createSharedZone.mock.invocationCallOrder[0]
    );
    const row = seed.shareRow(ZONE);
    expect(row.stop_requested_at).toBeNull();
    expect(row.stop_sent_at).toBeNull();
    expect(row.closing_participants).toBeNull();
    expect(await sharing.getShareForEntity('vehicle', 'veh-1')).not.toBeNull();
  });
});
