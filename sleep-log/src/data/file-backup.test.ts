import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { createSegment } from '../domain/sleep';
import {
  AutoBackupTrigger, BrowserFileBackup, IndexedDbBackupSettingsRepository,
  deleteBackupSettingsDatabase, type BackupStatus,
} from './file-backup';

afterEach(async () => { await deleteBackupSettingsDatabase(); });

describe('browser file backup', () => {
  it('reports unsupported when no directory picker exists', () => {
    expect(new BrowserFileBackup(window).capability()).toBe('manual-only');
  });

  it('does not lose local data when external writing fails', async () => {
    const failingHandle = {
      getFileHandle: async () => ({
        createWritable: async () => ({ write: async () => { throw new Error('disk full'); }, close: async () => undefined, abort: async () => undefined }),
      }),
    } as unknown as FileSystemDirectoryHandle;
    const adapter = new BrowserFileBackup(window);
    await expect(adapter.writeTo(failingHandle, '{"version":1}')).rejects.toThrow('自动备份写入失败');
  });

  it('stores directory handles and status in a separate settings store', async () => {
    const settings = new IndexedDbBackupSettingsRepository();
    const status: BackupStatus = { state: 'ready', lastSuccessfulBackupAt: '2026-09-03T00:00:00.000Z', message: null };
    const handle = {} as FileSystemDirectoryHandle;
    await settings.setDirectory(handle);
    await settings.setStatus(status);
    expect(await settings.getDirectory()).toEqual(handle);
    expect(await settings.getStatus()).toEqual(status);
  });

  it('records external failures without rejecting the local mutation trigger', async () => {
    const segment = createSegment({ id: 'nap-1', kind: 'nap', groupId: null, now: '2026-09-02T05:00:00.000Z', timezone: 'Asia/Shanghai' });
    const sleep = { list: async () => [segment] };
    const settings = new IndexedDbBackupSettingsRepository();
    await settings.setDirectory({} as FileSystemDirectoryHandle);
    const files = { capability: () => 'folder-auto' as const, writeTo: async () => { throw new Error('自动备份写入失败'); } } as unknown as BrowserFileBackup;
    await expect(new AutoBackupTrigger(sleep, settings, files, () => '2026-09-03T00:00:00.000Z').run()).resolves.toBeUndefined();
    expect((await settings.getStatus()).state).toBe('write-failed');
  });

  it('swallows directory lookup failures so local mutations remain successful', async () => {
    const settings: import('./file-backup').BackupSettingsRepository = {
      getDirectory: async () => { throw new Error('settings unavailable'); },
      setDirectory: async () => undefined,
      getStatus: async () => ({ state: 'ready', lastSuccessfulBackupAt: null, message: null }),
      setStatus: async () => undefined,
    };
    const files = { capability: () => 'folder-auto' as const } as BrowserFileBackup;
    await expect(new AutoBackupTrigger({ list: async () => [] }, settings, files, () => 'now').run()).resolves.toBeUndefined();
  });
});
