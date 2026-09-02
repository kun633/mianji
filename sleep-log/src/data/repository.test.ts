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
});
