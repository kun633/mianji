import { IndexedDbSleepRepository, type SleepRepository } from './repository';
import type { SqliteAdapter } from './native-sqlite-repository';

export async function createSleepRepository(_customAdapter?: SqliteAdapter): Promise<SleepRepository> {
  return new IndexedDbSleepRepository();
}
