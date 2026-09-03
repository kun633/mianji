import { Capacitor } from '@capacitor/core';
import { IndexedDbSleepRepository, type SleepRepository } from './repository';
import { NativeSqliteSleepRepository, type SqliteAdapter } from './native-sqlite-repository';

export async function createSleepRepository(customAdapter?: SqliteAdapter): Promise<SleepRepository> {
  if (customAdapter) {
    const repo = new NativeSqliteSleepRepository(customAdapter);
    await repo.initialize();
    return repo;
  }
  if (!Capacitor.isNativePlatform()) {
    return new IndexedDbSleepRepository();
  }
  // Default to IndexedDb for environments where native sqlite bridge is not attached
  return new IndexedDbSleepRepository();
}
