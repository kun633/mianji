import { DBSchema, deleteDB, IDBPDatabase, openDB } from 'idb';
import type { SleepSegment } from '../domain/sleep';

interface SleepDb extends DBSchema {
  segments: {
    key: string;
    value: SleepSegment;
    indexes: { 'by-status': SleepSegment['status']; 'by-start': string };
  };
}

export interface SleepRepository {
  get(id: string): Promise<SleepSegment | undefined>;
  list(): Promise<SleepSegment[]>;
  getActive(): Promise<SleepSegment | undefined>;
  createActiveIfNone(segment: SleepSegment): Promise<boolean>;
  save(segment: SleepSegment): Promise<void>;
  remove(id: string): Promise<void>;
  replaceAll(segments: SleepSegment[]): Promise<void>;
  replaceAllIfUnchanged(expected: SleepSegment[], segments: SleepSegment[]): Promise<boolean>;
}

const DB_NAME = 'mianji-sleep-log';
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

async function connect(): Promise<IDBPDatabase<SleepDb>> {
  return openDB<SleepDb>(DB_NAME, 1, {
    upgrade(db) {
      const store = db.createObjectStore('segments', { keyPath: 'id' });
      store.createIndex('by-status', 'status');
      store.createIndex('by-start', 'startAt');
    },
  });
}

async function withDatabase<T>(operation: (db: IDBPDatabase<SleepDb>) => Promise<T>): Promise<T> {
  const db = await connect();
  try {
    return await operation(db);
  } finally {
    db.close();
  }
}

export class IndexedDbSleepRepository implements SleepRepository {
  async get(id: string) { return withDatabase((db) => db.get('segments', id)); }
  async list() { return withDatabase((db) => db.getAllFromIndex('segments', 'by-start')); }
  async getActive() { return withDatabase((db) => db.getFromIndex('segments', 'by-status', 'active')); }
  async createActiveIfNone(segment: SleepSegment) {
    return withDatabase(async (db) => {
      const tx = db.transaction('segments', 'readwrite');
      const active = await tx.store.index('by-status').get('active');
      if (active) {
        await tx.done;
        return false;
      }
      await tx.store.add(segment);
      await tx.done;
      return true;
    });
  }
  async save(segment: SleepSegment) { await withDatabase((db) => db.put('segments', segment)); }
  async remove(id: string) { await withDatabase((db) => db.delete('segments', id)); }
  async replaceAll(segments: SleepSegment[]) {
    await withDatabase(async (db) => {
      const tx = db.transaction('segments', 'readwrite');
      await tx.store.clear();
      for (const segment of segments) await tx.store.put(segment);
      await tx.done;
    });
  }
  async replaceAllIfUnchanged(expected: SleepSegment[], segments: SleepSegment[]) {
    return withDatabase(async (db) => {
      const tx = db.transaction('segments', 'readwrite');
      const current = await tx.store.getAll();
      if (!sameSnapshot(current, expected)) {
        await tx.done;
        return false;
      }
      await tx.store.clear();
      for (const segment of segments) await tx.store.put(segment);
      await tx.done;
      return true;
    });
  }
}

export async function deleteSleepDatabase() { await deleteDB(DB_NAME); }
