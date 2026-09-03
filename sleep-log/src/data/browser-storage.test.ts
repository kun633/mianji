import { describe, expect, it, vi } from 'vitest';
import {
  checkStorageProtection,
  requestAndCheckStorageProtection,
  requestStorageProtection,
} from './browser-storage';

describe('browser storage protection', () => {
  it('reports whether the browser has granted protection', async () => {
    expect(await checkStorageProtection({ persisted: async () => true })).toBe('granted');
    expect(await checkStorageProtection({ persisted: async () => false })).toBe('not-granted');
  });

  it('reports unsupported and unknown states without claiming protection', async () => {
    expect(await checkStorageProtection(undefined)).toBe('unsupported');
    expect(await checkStorageProtection({
      persisted: async () => { throw new Error('blocked'); },
    })).toBe('unknown');
  });

  it('requests protection only through the supplied browser API', async () => {
    expect(await requestStorageProtection({ persist: async () => true })).toBe(true);
    expect(await requestStorageProtection({ persist: async () => false })).toBe(false);
    expect(await requestStorageProtection(undefined)).toBe(false);
  });

  it('rechecks the real protection state after requesting it', async () => {
    const storage = {
      persist: vi.fn().mockResolvedValue(false),
      persisted: vi.fn().mockResolvedValue(true),
    };

    expect(await requestAndCheckStorageProtection(storage)).toBe('granted');
    expect(storage.persist).toHaveBeenCalledOnce();
    expect(storage.persisted).toHaveBeenCalledOnce();
  });
});
