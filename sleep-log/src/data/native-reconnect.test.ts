import { expect, it, vi } from 'vitest';
const sqlite = vi.hoisted(() => ({
  checkConnectionsConsistency: async () => ({ result: true }),
  isDBOpen: async () => ({ result: true }),
  createConnection: async () => { throw new Error('connection already exists'); },
  execute: async () => ({}),
  query: async () => ({values: [{id: 'existing-record'}]}),
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock('@capacitor-community/sqlite', () => ({ CapacitorSQLite: sqlite }));
import { createSleepRepository } from './repository-factory';

it('reuses the native connection after a webview reload and still reads records', async () => {
  const repo = await createSleepRepository();
  expect(await repo.list()).toEqual([{id: 'existing-record'}]);
});
