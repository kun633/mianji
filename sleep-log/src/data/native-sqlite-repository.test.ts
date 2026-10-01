import { describe, expect, it } from 'vitest';
import { createSegment, type SleepSegment } from '../domain/sleep';
import { NativeSqliteSleepRepository, type SqliteAdapter } from './native-sqlite-repository';

function createInMemorySqliteAdapter(legacyRows: SleepSegment[] = []): SqliteAdapter {
  const store = new Map<string, any>(legacyRows.map((row) => [row.id, { ...row }]));
  let planValue: string | null = null;
  let hasTable = legacyRows.length > 0;
  let hasReflectionColumn = false;
  return {
    async execute(sql: string, values?: unknown[]) {
      if (sql.includes('CREATE TABLE IF NOT EXISTS sleep_segments')) {
        if (!hasTable) { hasTable = true; hasReflectionColumn = true; }
        return;
      }
      if (sql.includes('CREATE TABLE') || sql.includes('CREATE INDEX')) return;
      if (sql.includes('INSERT OR REPLACE INTO sleep_plan')) { planValue = values?.[0] as string | null; return; }
      if (sql.includes('ALTER TABLE sleep_segments ADD COLUMN reflectionJson')) {
        if (hasReflectionColumn) throw new Error('duplicate column name: reflectionJson');
        hasReflectionColumn = true;
        return;
      }
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
          reflectionJson: values?.[13],
        };
        store.set(String(seg.id), seg);
        return;
      }
    },
    async query<T>(sql: string, values?: unknown[]): Promise<T[]> {
      if (sql.includes('PRAGMA table_info')) return (hasReflectionColumn ? [{ name: 'reflectionJson' }] : [{ name: 'schemaVersion' }]) as T[];
      if (sql.includes('SELECT value FROM sleep_plan')) return planValue ? [{ value: planValue } as T] : [];
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
    groupId: null,
    now: '2026-09-02T14:00:00.000Z',
    timezone: 'Asia/Shanghai',
  });

  const activeNap: SleepSegment = createSegment({
    id: 'nap-1',
    kind: 'nap',
    groupId: null,
    now: '2026-09-03T05:00:00.000Z',
    timezone: 'Asia/Shanghai',
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

  it('stores reflections and a pauseable plan alongside existing records', async () => {
    const repo = new NativeSqliteSleepRepository(createInMemorySqliteAdapter());
    await repo.initialize();
    const completed = { ...activeNight, endAt: '2026-09-02T23:00:00.000Z', endTimezone: 'Asia/Shanghai', status: 'completed' as const, finishedAt: '2026-09-02T23:00:00.000Z', reflection: { sleepOnsetAt: null, alarmUsed: false, wakeEnergy: 4, daytimeEnergy: 3 } };
    await repo.save(completed);
    expect((await repo.get(completed.id))?.reflection).toEqual(completed.reflection);
    const plan = { startedOn: '2026-09-03', baselineWakeMinutes: 620, targetWakeMinutes: 450 as const, sleepOpportunityMinutes: 570 as const, stepMinutes: 25 as const, stepDays: 3 as const, pausedOn: null, pausedDays: 0 };
    await repo.savePlan(plan);
    expect(await repo.getPlan()).toEqual(plan);
  });

  it('upgrades a legacy table without removing existing records and is safe to initialize again', async () => {
    const adapter = createInMemorySqliteAdapter([activeNight]);
    const repo = new NativeSqliteSleepRepository(adapter);
    await repo.initialize();
    await repo.initialize();
    expect(await repo.list()).toEqual([activeNight]);
    expect(await repo.getPlan()).toBeNull();
  });

  it('does not overwrite records or a changed plan from a stale restore preview', async () => {
    const repo = new NativeSqliteSleepRepository(createInMemorySqliteAdapter());
    await repo.initialize();
    const plan = { startedOn: '2026-09-03', baselineWakeMinutes: 620, targetWakeMinutes: 450 as const, sleepOpportunityMinutes: 570 as const, stepMinutes: 25 as const, stepDays: 3 as const, pausedOn: null, pausedDays: 0 };
    await repo.save(activeNight);
    await repo.savePlan(plan);
    expect(await repo.replaceAllWithPlanIfUnchanged([activeNight], [], null, null)).toBe(false);
    expect(await repo.list()).toEqual([activeNight]);
    expect(await repo.getPlan()).toEqual(plan);
  });

  it('round-trips new bands and blocks both stale restore paths without a schema change', async () => {
    const repo = new NativeSqliteSleepRepository(createInMemorySqliteAdapter());
    await repo.initialize();
    const night = { ...activeNight, endAt: '2026-09-02T22:00:00.000Z', status: 'completed' as const,
      reflection: { alarmUsed: null, wakeEnergy: null, daytimeEnergy: null } };
    await repo.save(night);
    const plan = { startedOn: '2026-09-03', baselineWakeMinutes: 620, targetWakeMinutes: 450 as const, sleepOpportunityMinutes: 570 as const, stepMinutes: 25 as const, stepDays: 3 as const, pausedOn: null, pausedDays: 0 };
    for (const changed of [
      { ...night, reflection: { ...night.reflection, sleepOnsetBand: 'under_15' as const } },
      { ...night, reflection: { ...night.reflection, nightAwakeningBand: 'multiple_or_long' as const } },
    ]) {
      const snapshot = await repo.list();
      await repo.save(changed);
      expect(await repo.get(night.id)).toEqual(changed);
      expect(await repo.replaceAllIfUnchanged(snapshot, [])).toBe(false);
      expect(await repo.replaceAllWithPlanIfUnchanged(snapshot, [], null, plan)).toBe(false);
      expect(await repo.list()).toEqual([changed]);
      expect(await repo.getPlan()).toBeNull();
    }
  });
});
