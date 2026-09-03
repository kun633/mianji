import { describe, expect, it } from 'vitest';
import { createSegment, type SleepSegment } from '../domain/sleep';
import { NativeSqliteSleepRepository, type SqliteAdapter } from './native-sqlite-repository';

function createInMemorySqliteAdapter(): SqliteAdapter {
  const store = new Map<string, any>();
  return {
    async execute(sql: string, values?: unknown[]) {
      if (sql.includes('CREATE TABLE') || sql.includes('CREATE INDEX')) return;
      if (sql.includes('DELETE FROM sleep_segments WHERE id = ?')) {
        store.delete(String(values?.[0]));
        return;
      }
      if (sql.includes('DELETE FROM sleep_segments')) {
        store.clear();
        return;
      }
      if (sql.includes('INSERT OR REPLACE INTO sleep_segments')) {
        const seg = {
          id: values?.[0],
          kind: values?.[1],
          groupId: values?.[2],
          startAt: values?.[3],
          startTimezone: values?.[4],
          endAt: values?.[5],
          endTimezone: values?.[6],
          status: values?.[7],
          uncertainReason: values?.[8],
          createdAt: values?.[9],
          updatedAt: values?.[10],
          finishedAt: values?.[11],
          schemaVersion: values?.[12],
        };
        store.set(seg.id, seg);
        return;
      }
    },
    async query<T>(sql: string, values?: unknown[]): Promise<T[]> {
      if (sql.includes("status = 'active'")) {
        const found = [...store.values()].find((s) => s.status === 'active');
        return found ? [found as T] : [];
      }
      if (sql.includes('WHERE id = ?')) {
        const found = store.get(String(values?.[0]));
        return found ? [found as T] : [];
      }
      if (sql.includes('ORDER BY startAt ASC')) {
        return [...store.values()].sort((a, b) => a.startAt.localeCompare(b.startAt)) as T[];
      }
      return [...store.values()] as T[];
    },
    async transaction<T>(operation: () => Promise<T>): Promise<T> {
      return operation();
    },
  };
}

describe('NativeSqliteSleepRepository', () => {
  const activeNight: SleepSegment = createSegment({
    id: 'night-1',
    kind: 'night',
    startAt: '2026-09-02T14:00:00.000Z',
    startTimezone: 'Asia/Shanghai',
    createdAt: '2026-09-02T14:00:00.000Z',
    updatedAt: '2026-09-02T14:00:00.000Z',
  });

  const activeNap: SleepSegment = createSegment({
    id: 'nap-1',
    kind: 'nap',
    startAt: '2026-09-03T05:00:00.000Z',
    startTimezone: 'Asia/Shanghai',
    createdAt: '2026-09-03T05:00:00.000Z',
    updatedAt: '2026-09-03T05:00:00.000Z',
  });

  it('persists an active record and prevents a second active record', async () => {
    const repo = new NativeSqliteSleepRepository(createInMemorySqliteAdapter());
    await repo.initialize();

    expect(await repo.createActiveIfNone(activeNight)).toBe(true);
    expect(await repo.getActive()).toEqual(activeNight);
    expect(await repo.createActiveIfNone(activeNap)).toBe(false);
  });

  it('supports get, list, save, remove and replaceAll', async () => {
    const repo = new NativeSqliteSleepRepository(createInMemorySqliteAdapter());
    await repo.initialize();

    await repo.save(activeNight);
    expect(await repo.get('night-1')).toEqual(activeNight);

    const list = await repo.list();
    expect(list).toHaveLength(1);

    const completedNight: SleepSegment = {
      ...activeNight,
      endAt: '2026-09-02T22:00:00.000Z',
      endTimezone: 'Asia/Shanghai',
      finishedAt: '2026-09-02T22:00:00.000Z',
      status: 'completed',
    };
    await repo.save(completedNight);
    expect((await repo.get('night-1'))?.status).toBe('completed');

    expect(await repo.replaceAllIfUnchanged([completedNight], [activeNap])).toBe(true);
    expect(await repo.list()).toEqual([activeNap]);

    // Snapshot conflict prevents overwrite
    expect(await repo.replaceAllIfUnchanged([], [completedNight])).toBe(false);

    await repo.remove('nap-1');
    expect(await repo.list()).toHaveLength(0);
  });
});
