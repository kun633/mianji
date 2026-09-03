import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSegment } from '../domain/sleep';
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
});
