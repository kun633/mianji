import { DBSchema, deleteDB, IDBPDatabase, openDB } from 'idb';
import type { SleepSegment } from '../domain/sleep';
import type { SleepPlan } from '../domain/sleep-plan';

interface SleepDb extends DBSchema {
  segments: {
    key: string;
    value: SleepSegment;
    indexes: { 'by-status': SleepSegment['status']; 'by-start': string };
  };
  plan: { key: string; value: SleepPlan | null };
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
  getPlan?(): Promise<SleepPlan | null>;
  savePlan?(plan: SleepPlan | null): Promise<void>;
  replaceAllWithPlanIfUnchanged?(expected: SleepSegment[], segments: SleepSegment[], expectedPlan: SleepPlan | null, plan: SleepPlan | null): Promise<boolean>;
}

const DB_NAME = 'mianji-sleep-log';
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

async function connect(): Promise<IDBPDatabase<SleepDb>> {
  return openDB<SleepDb>(DB_NAME, 2, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const store = db.createObjectStore('segments', { keyPath: 'id' });
        store.createIndex('by-status', 'status');
        store.createIndex('by-start', 'startAt');
      }
      if (oldVersion < 2) db.createObjectStore('plan');
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
  async getPlan(): Promise<SleepPlan | null> { return withDatabase(async (db) => (await db.get('plan', 'current')) ?? null); }
  async savePlan(plan: SleepPlan | null): Promise<void> {
    await withDatabase(async (db) => { await db.put('plan', plan, 'current'); });
  }
  async replaceAllWithPlanIfUnchanged(expected: SleepSegment[], segments: SleepSegment[], expectedPlan: SleepPlan | null, plan: SleepPlan | null) {
    return withDatabase(async (db) => {
      const tx = db.transaction(['segments', 'plan'], 'readwrite');
      const current = await tx.objectStore('segments').getAll();
      const currentPlan = (await tx.objectStore('plan').get('current')) ?? null;
      if (!sameSnapshot(current, expected) || JSON.stringify(currentPlan) !== JSON.stringify(expectedPlan)) {
        await tx.done;
        return false;
      }
      await tx.objectStore('segments').clear();
      for (const segment of segments) await tx.objectStore('segments').put(segment);
      await tx.objectStore('plan').put(plan, 'current');
      await tx.done;
      return true;
    });
  }
}

export async function deleteSleepDatabase() { await deleteDB(DB_NAME); }
