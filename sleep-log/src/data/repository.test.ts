import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSegment } from '../domain/sleep';
import { openDB } from 'idb';
import { deleteSleepDatabase, IndexedDbSleepRepository } from './repository';

describe('IndexedDbSleepRepository', () => {
  beforeEach(deleteSleepDatabase);
  afterEach(deleteSleepDatabase);

  it('persists an active segment across repository instances', async () => {
    const first = new IndexedDbSleepRepository();
    const segment = createSegment({ id: 'seg-1', kind: 'night', groupId: 'night-1', now: '2026-09-02T15:00:00.000Z', timezone: 'Asia/Shanghai' });
    await first.save(segment);
    const reopened = new IndexedDbSleepRepository();
    expect((await reopened.getActive())?.id).toBe('seg-1');
  });

  it('upgrades a version 1 database without losing existing segments', async () => {
    const old = await openDB('mianji-sleep-log', 1, { upgrade(db) {
      const store = db.createObjectStore('segments', { keyPath: 'id' });
      store.createIndex('by-status', 'status');
      store.createIndex('by-start', 'startAt');
    } });
    const segment = createSegment({ id: 'old', kind: 'night', groupId: 'old-night', now: '2026-09-02T15:00:00.000Z', timezone: 'Asia/Shanghai' });
    await old.put('segments', segment);
    old.close();
    const repo = new IndexedDbSleepRepository();
    expect(await repo.list()).toEqual([segment]);
    expect(await repo.getPlan()).toBeNull();
  });

  it('keeps records and plan together when a restore preview is stale', async () => {
    const repo = new IndexedDbSleepRepository();
    const segment = createSegment({ id: 'first', kind: 'night', groupId: 'g', now: '2026-09-02T15:00:00.000Z', timezone: 'Asia/Shanghai' });
    const later = createSegment({ id: 'later', kind: 'nap', groupId: null, now: '2026-09-03T05:00:00.000Z', timezone: 'Asia/Shanghai' });
    const plan = { startedOn: '2026-09-03', baselineWakeMinutes: 620, targetWakeMinutes: 450 as const, sleepOpportunityMinutes: 570 as const, stepMinutes: 25 as const, stepDays: 3 as const, pausedOn: null, pausedDays: 0 };
    await repo.save(segment);
    await repo.savePlan(plan);
    await repo.save(later);
    expect(await repo.replaceAllWithPlanIfUnchanged([segment], [], plan, null)).toBe(false);
    expect(await repo.list()).toEqual([segment, later]);
    expect(await repo.getPlan()).toEqual(plan);
  });

  it('replaces all records atomically', async () => {
    const repo = new IndexedDbSleepRepository();
    const one = createSegment({ id: 'one', kind: 'nap', groupId: null, now: '2026-09-02T05:00:00.000Z', timezone: 'Asia/Shanghai' });
    const two = createSegment({ id: 'two', kind: 'night', groupId: 'night-2', now: '2026-09-02T15:00:00.000Z', timezone: 'Asia/Shanghai' });
    await repo.save(one);
    await repo.replaceAll([two]);
    expect((await repo.list()).map((item) => item.id)).toEqual(['two']);
  });

  it('atomically creates only one active segment across concurrent repository instances', async () => {
    const first = new IndexedDbSleepRepository();
    const second = new IndexedDbSleepRepository();
    const night = createSegment({ id: 'night', kind: 'night', groupId: 'night-1', now: '2026-09-02T15:00:00.000Z', timezone: 'Asia/Shanghai' });
    const nap = createSegment({ id: 'nap', kind: 'nap', groupId: null, now: '2026-09-02T15:00:00.000Z', timezone: 'Asia/Shanghai' });

    const results = await Promise.all([
      first.createActiveIfNone(night),
      second.createActiveIfNone(nap),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await first.list()).filter((segment) => segment.status === 'active')).toHaveLength(1);
  });

  it('does not replace records when the preview snapshot is stale', async () => {
    const repo = new IndexedDbSleepRepository();
    const previewed = createSegment({ id: 'previewed', kind: 'nap', groupId: null, now: '2026-09-02T05:00:00.000Z', timezone: 'Asia/Shanghai' });
    const arrivedLater = createSegment({ id: 'arrived-later', kind: 'night', groupId: 'night-2', now: '2026-09-02T15:00:00.000Z', timezone: 'Asia/Shanghai' });
    const replacement = createSegment({ id: 'replacement', kind: 'nap', groupId: null, now: '2026-09-03T05:00:00.000Z', timezone: 'Asia/Shanghai' });
    await repo.save(previewed);
    const snapshot = await repo.list();
    await repo.save(arrivedLater);

    const replaced = await repo.replaceAllIfUnchanged(snapshot, [replacement]);

    expect(replaced).toBe(false);
    expect((await repo.list()).map((segment) => segment.id)).toEqual(['previewed', 'arrived-later']);
  });

  it('rejects stale previews when either optional reflection band changes', async () => {
    const repo = new IndexedDbSleepRepository();
    const night = { ...createSegment({ id: 'reflected', kind: 'night', groupId: null, now: '2026-09-02T14:00:00.000Z', timezone: 'Asia/Shanghai' }),
      endAt: '2026-09-02T22:00:00.000Z', status: 'completed' as const,
      reflection: { alarmUsed: null, wakeEnergy: null, daytimeEnergy: null } };
    const plan = { startedOn: '2026-09-03', baselineWakeMinutes: 620, targetWakeMinutes: 450 as const, sleepOpportunityMinutes: 570 as const, stepMinutes: 25 as const, stepDays: 3 as const, pausedOn: null, pausedDays: 0 };
    await repo.save(night);
    for (const changed of [
      { ...night, reflection: { ...night.reflection, sleepOnsetBand: 'unknown' as const } },
      { ...night, reflection: { ...night.reflection, nightAwakeningBand: 'one_or_two' as const } },
    ]) {
      const snapshot = await repo.list();
      await repo.save(changed);
      expect(await repo.replaceAllIfUnchanged(snapshot, [])).toBe(false);
      expect(await repo.replaceAllWithPlanIfUnchanged(snapshot, [], null, plan)).toBe(false);
      expect(await repo.list()).toEqual([changed]);
      expect(await repo.getPlan()).toBeNull();
    }
  });
});
