import { describe, expect, it } from 'vitest';
import { IndexedDbSleepRepository } from './repository';
import { NativeSqliteSleepRepository } from './native-sqlite-repository';
import { createSleepRepository } from './repository-factory';

describe('createSleepRepository', () => {
  it('returns IndexedDbSleepRepository on web', async () => {
    const repo = await createSleepRepository();
    expect(repo).toBeInstanceOf(IndexedDbSleepRepository);
  });

  it('can create NativeSqliteSleepRepository with a provided adapter', async () => {
    const fakeAdapter = {
      execute: async () => {},
      query: async () => [],
      transaction: async (op: any) => op(),
    };
    const repo = await createSleepRepository(fakeAdapter);
    expect(repo).toBeInstanceOf(NativeSqliteSleepRepository);
  });
});
