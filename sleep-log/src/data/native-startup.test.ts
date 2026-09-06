import { expect, it, vi } from 'vitest';
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock('@capacitor-community/sqlite', () => ({
  CapacitorSQLite: {
    checkConnectionsConsistency: async () => ({result: false}),
    createConnection: async () => { throw new Error('SQLite unavailable'); },
  },
}));
import { createSleepRepository } from './repository-factory';

it('does not silently switch to an empty database when native storage fails', async () => {
  await expect(createSleepRepository()).rejects.toThrow();
});
