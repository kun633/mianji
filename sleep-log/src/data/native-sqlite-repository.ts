import type { SleepSegment } from '../domain/sleep';
import type { SleepRepository } from './repository';

export interface SqliteAdapter {
  execute(sql: string, values?: unknown[]): Promise<void>;
  query<T>(sql: string, values?: unknown[]): Promise<T[]>;
  transaction<T>(operation: () => Promise<T>): Promise<T>;
}

const segmentFields: Array<keyof SleepSegment> = [
  'id', 'kind', 'groupId', 'startAt', 'startTimezone', 'endAt', 'endTimezone',
  'status', 'uncertainReason', 'createdAt', 'updatedAt', 'finishedAt', 'schemaVersion',
];

const sameSnapshot = (left: SleepSegment[], right: SleepSegment[]) => {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort((a, b) => a.id.localeCompare(b.id));
  const sortedRight = [...right].sort((a, b) => a.id.localeCompare(b.id));
  return sortedLeft.every((segment, index) => segmentFields.every(
    (field) => segment[field] === sortedRight[index][field],
  ));
};

export class NativeSqliteSleepRepository implements SleepRepository {
  constructor(private readonly db: SqliteAdapter) {}

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
        schemaVersion INTEGER NOT NULL
      );
    `);
    await this.db.execute(`CREATE INDEX IF NOT EXISTS idx_segments_start ON sleep_segments(startAt);`);
    await this.db.execute(`CREATE INDEX IF NOT EXISTS idx_segments_status ON sleep_segments(status);`);
  }

  async get(id: string): Promise<SleepSegment | undefined> {
    const rows = await this.db.query<SleepSegment>(
      'SELECT * FROM sleep_segments WHERE id = ? LIMIT 1',
      [id]
    );
    return rows[0];
  }

  async list(): Promise<SleepSegment[]> {
    return this.db.query<SleepSegment>(
      'SELECT * FROM sleep_segments ORDER BY startAt ASC'
    );
  }

  async getActive(): Promise<SleepSegment | undefined> {
    const rows = await this.db.query<SleepSegment>(
      "SELECT * FROM sleep_segments WHERE status = 'active' LIMIT 1"
    );
    return rows[0];
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
        status, uncertainReason, createdAt, updatedAt, finishedAt, schemaVersion
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        segment.id,
        segment.kind,
        segment.groupId,
        segment.startAt,
        segment.startTimezone,
        segment.endAt,
        segment.endTimezone,
        segment.status,
        segment.uncertainReason,
        segment.createdAt,
        segment.updatedAt,
        segment.finishedAt,
        segment.schemaVersion,
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
}
