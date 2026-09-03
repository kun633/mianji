import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSegment } from '../domain/sleep';
import {
  AutoBackupTrigger, BrowserFileBackup, IndexedDbBackupSettingsRepository,
  replaceBackupDirectory,
  deleteBackupSettingsDatabase, downloadBackup, type BackupStatus,
} from './file-backup';

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await deleteBackupSettingsDatabase();
});

describe('browser file backup', () => {
  it('attaches the link, clicks it, removes it and revokes the URL later', () => {
    vi.useFakeTimers();
    const createObjectUrl = vi.fn(() => 'blob:test');
    const revokeObjectUrl = vi.fn();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: createObjectUrl,
      revokeObjectURL: revokeObjectUrl,
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const append = vi.spyOn(document.body, 'appendChild');
    const remove = vi.spyOn(HTMLElement.prototype, 'remove');

    downloadBackup('{}', '眠记.json');

    expect(append).toHaveBeenCalled();
    expect(click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalled();
    expect(revokeObjectUrl).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:test');
  });

  it('reports unsupported when no directory picker exists', () => {
    expect(new BrowserFileBackup(window).capability()).toBe('manual-only');
  });

  it('requires a callable directory picker and does not call a non-function', async () => {
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: 'not-a-function' });
    const adapter = new BrowserFileBackup(window);
    expect(adapter.capability()).toBe('manual-only');
    await expect(adapter.chooseFolder()).rejects.toThrow('目录备份不可用');
    Reflect.deleteProperty(window, 'showDirectoryPicker');
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

  it('keeps the previous directory until the replacement folder accepts a backup write', async () => {
    const previous = {} as FileSystemDirectoryHandle;
    const candidate = {
      getFileHandle: async () => ({
        createWritable: async () => ({ write: async () => { throw new Error('disk full'); }, abort: async () => undefined }),
      }),
    } as unknown as FileSystemDirectoryHandle;
    const settings: import('./file-backup').BackupSettingsRepository = {
      getDirectory: async () => previous,
      setDirectory: async () => { throw new Error('should not replace'); },
      getStatus: async () => ({ state: 'ready', lastSuccessfulBackupAt: null, message: null }),
      setStatus: async () => undefined,
    };
    const files = new BrowserFileBackup(window);

    await expect(replaceBackupDirectory(settings, files, candidate, '{"app":"眠记"}'))
      .rejects.toThrow('自动备份写入失败');
    expect(await settings.getDirectory()).toBe(previous);
  });

  it('stores directory handles and status in a separate settings store', async () => {
    const settings = new IndexedDbBackupSettingsRepository();
    const status: BackupStatus = {
      state: 'ready',
      lastAutomaticBackupAt: '2026-09-03T00:00:00.000Z',
      lastManualExportAt: '2026-09-02T00:00:00.000Z',
      lastSuccessfulBackupAt: '2026-09-03T00:00:00.000Z',
      message: null,
    };
    const handle = {} as FileSystemDirectoryHandle;
    await settings.setDirectory(handle);
    await settings.setStatus(status);
    expect(await settings.getDirectory()).toEqual(handle);
    expect(await settings.getStatus()).toMatchObject({
      state: 'ready',
      lastAutomaticBackupAt: '2026-09-03T00:00:00.000Z',
      lastManualExportAt: '2026-09-02T00:00:00.000Z',
      message: null,
    });
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
