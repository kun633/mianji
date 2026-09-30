import type { SleepSegment } from '../domain/sleep';
import type { SleepRepository } from './repository';
import type { SleepPlan } from '../domain/sleep-plan';

export interface SqliteAdapter {
  execute(sql: string, values?: unknown[]): Promise<void>;
  query<T>(sql: string, values?: unknown[]): Promise<T[]>;
  transaction<T>(operation: () => Promise<T>): Promise<T>;
}

const segmentFields: Array<keyof SleepSegment> = [
  'id', 'kind', 'groupId', 'startAt', 'startTimezone', 'endAt', 'endTimezone',
  'status', 'uncertainReason', 'createdAt', 'updatedAt', 'finishedAt', 'schemaVersion',
];
const reflectionFields = ['sleepOnsetAt', 'alarmUsed', 'wakeEnergy', 'daytimeEnergy'] as const;
const sameReflection = (left: SleepSegment['reflection'], right: SleepSegment['reflection']) =>
  left === right || (left !== undefined && right !== undefined &&
    reflectionFields.every((field) => left[field] === right[field]));

const sameSnapshot = (left: SleepSegment[], right: SleepSegment[]) => {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort((a, b) => a.id.localeCompare(b.id));
  const sortedRight = [...right].sort((a, b) => a.id.localeCompare(b.id));
  return sortedLeft.every((segment, index) =>
    segmentFields.every((field) => segment[field] === sortedRight[index][field]) &&
    sameReflection(segment.reflection, sortedRight[index].reflection));
};

export class NativeSqliteSleepRepository implements SleepRepository {
  constructor(private readonly db: SqliteAdapter) {}

  private decode(row: SleepSegment & { reflectionJson?: string | null }): SleepSegment {
    const { reflectionJson, ...segment } = row;
    return reflectionJson ? { ...segment, reflection: JSON.parse(reflectionJson) } : segment;
  }

  async initialize(): Promise<void> {
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS sleep_segments (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        groupId TEXT,
        startAt TEXT NOT NULL,
        startTimezone TEXT NOT NULL,
        endAt TEXT,
        endTimezone TEXT,
        status TEXT NOT NULL,
        uncertainReason TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        finishedAt TEXT,
        schemaVersion INTEGER NOT NULL,
        reflectionJson TEXT
      );
    `);
    const columns = await this.db.query<{ name: string }>('PRAGMA table_info(sleep_segments)');
    if (!columns.some((column) => column.name === 'reflectionJson')) {
      await this.db.execute('ALTER TABLE sleep_segments ADD COLUMN reflectionJson TEXT');
    }
    await this.db.execute('CREATE TABLE IF NOT EXISTS sleep_plan (id INTEGER PRIMARY KEY, value TEXT)');
    await this.db.execute(`CREATE INDEX IF NOT EXISTS idx_segments_start ON sleep_segments(startAt);`);
    await this.db.execute(`CREATE INDEX IF NOT EXISTS idx_segments_status ON sleep_segments(status);`);
  }

  async get(id: string): Promise<SleepSegment | undefined> {
    const rows = await this.db.query<SleepSegment>(
      'SELECT * FROM sleep_segments WHERE id = ? LIMIT 1',
      [id]
    );
    return rows[0] ? this.decode(rows[0]) : undefined;
  }

  async list(): Promise<SleepSegment[]> {
    const rows = await this.db.query<SleepSegment>(
      'SELECT * FROM sleep_segments ORDER BY startAt ASC'
    );
    return rows.map((row) => this.decode(row));
  }

  async getActive(): Promise<SleepSegment | undefined> {
    const rows = await this.db.query<SleepSegment>(
      "SELECT * FROM sleep_segments WHERE status = 'active' LIMIT 1"
    );
    return rows[0] ? this.decode(rows[0]) : undefined;
  }

  async createActiveIfNone(segment: SleepSegment): Promise<boolean> {
    return this.db.transaction(async () => {
      const active = await this.db.query<{ id: string }>(
        "SELECT id FROM sleep_segments WHERE status = 'active' LIMIT 1"
      );
      if (active.length > 0) {
        return false;
      }
      await this.save(segment);
      return true;
    });
  }

  async save(segment: SleepSegment): Promise<void> {
    await this.db.execute(
      `INSERT OR REPLACE INTO sleep_segments (
        id, kind, groupId, startAt, startTimezone, endAt, endTimezone,
        status, uncertainReason, createdAt, updatedAt, finishedAt, schemaVersion, reflectionJson
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        segment.id,
        segment.kind,
        segment.groupId ?? null,
        segment.startAt,
        segment.startTimezone,
        segment.endAt ?? null,
        segment.endTimezone ?? null,
        segment.status,
        segment.uncertainReason ?? null,
        segment.createdAt,
        segment.updatedAt,
        segment.finishedAt ?? null,
        segment.schemaVersion,
        segment.reflection ? JSON.stringify(segment.reflection) : null,
      ]
    );
  }

  async remove(id: string): Promise<void> {
    await this.db.execute('DELETE FROM sleep_segments WHERE id = ?', [id]);
  }

  async replaceAll(segments: SleepSegment[]): Promise<void> {
    await this.db.transaction(async () => {
      await this.db.execute('DELETE FROM sleep_segments');
      for (const segment of segments) {
        await this.save(segment);
      }
    });
  }

  async replaceAllIfUnchanged(expected: SleepSegment[], segments: SleepSegment[]): Promise<boolean> {
    return this.db.transaction(async () => {
      const current = await this.list();
      if (!sameSnapshot(current, expected)) {
        return false;
      }
      await this.db.execute('DELETE FROM sleep_segments');
      for (const segment of segments) {
        await this.save(segment);
      }
      return true;
    });
  }

  async getPlan(): Promise<SleepPlan | null> {
    const rows = await this.db.query<{ value: string | null }>('SELECT value FROM sleep_plan WHERE id = 1 LIMIT 1');
    return rows[0]?.value ? JSON.parse(rows[0].value) as SleepPlan : null;
  }

  async savePlan(plan: SleepPlan | null): Promise<void> {
    await this.db.execute('INSERT OR REPLACE INTO sleep_plan (id, value) VALUES (1, ?)', [plan ? JSON.stringify(plan) : null]);
  }

  async replaceAllWithPlanIfUnchanged(expected: SleepSegment[], segments: SleepSegment[], expectedPlan: SleepPlan | null, plan: SleepPlan | null): Promise<boolean> {
    return this.db.transaction(async () => {
      if (!sameSnapshot(await this.list(), expected) || JSON.stringify(await this.getPlan()) !== JSON.stringify(expectedPlan)) return false;
      await this.db.execute('DELETE FROM sleep_segments');
      for (const segment of segments) await this.save(segment);
      await this.savePlan(plan);
      return true;
    });
  }
}
