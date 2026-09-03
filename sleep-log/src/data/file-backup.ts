import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { SleepRepository } from './repository';
import { createBackup } from './backup';

export type BackupCapability = 'folder-auto' | 'manual-only';
export interface BackupStatus {
  state: 'ready' | 'needs-permission' | 'write-failed' | 'manual-only';
  lastAutomaticBackupAt?: string | null;
  lastManualExportAt?: string | null;
  legacyBackupAt?: string | null;
  lastSuccessfulBackupAt?: string | null;
  message: string | null;
}
export interface BackupSettingsRepository {
  getDirectory(): Promise<FileSystemDirectoryHandle | null>;
  setDirectory(handle: FileSystemDirectoryHandle): Promise<void>;
  getStatus(): Promise<BackupStatus>;
  setStatus(status: BackupStatus): Promise<void>;
}

interface SettingsDb extends DBSchema {
  settings: { key: string; value: FileSystemDirectoryHandle | BackupStatus; };
}
const DB_NAME = 'mianji-sleep-log-settings';
const defaultStatus = (): BackupStatus => ({
  state: 'manual-only',
  lastAutomaticBackupAt: null,
  lastManualExportAt: null,
  legacyBackupAt: null,
  lastSuccessfulBackupAt: null,
  message: null,
});

async function connect(): Promise<IDBPDatabase<SettingsDb>> {
  return openDB<SettingsDb>(DB_NAME, 1, { upgrade: (db) => db.createObjectStore('settings') });
}
async function setting<T>(key: string, fallback: T): Promise<T> {
  const db = await connect();
  try { return (await db.get('settings', key) as T | undefined) ?? fallback; } finally { db.close(); }
}
async function saveSetting(key: string, value: FileSystemDirectoryHandle | BackupStatus): Promise<void> {
  const db = await connect();
  try { await db.put('settings', value, key); } finally { db.close(); }
}

export class IndexedDbBackupSettingsRepository implements BackupSettingsRepository {
  getDirectory() { return setting<FileSystemDirectoryHandle | null>('directory', null); }
  setDirectory(handle: FileSystemDirectoryHandle) { return saveSetting('directory', handle); }
  async getStatus() {
    const raw = await setting<BackupStatus>('status', defaultStatus());
    return {
      ...raw,
      lastAutomaticBackupAt: raw.lastAutomaticBackupAt ?? (raw.state === 'ready' ? raw.lastSuccessfulBackupAt : null),
      lastManualExportAt: raw.lastManualExportAt ?? null,
      legacyBackupAt: raw.lastSuccessfulBackupAt ?? null,
      lastSuccessfulBackupAt: raw.lastSuccessfulBackupAt ?? raw.lastAutomaticBackupAt ?? null,
    };
  }
  setStatus(status: BackupStatus) { return saveSetting('status', status); }
}
export async function deleteBackupSettingsDatabase() { await deleteDB(DB_NAME); }

export class BrowserFileBackup {
  constructor(private browser: Window) {}
  capability(): BackupCapability { return typeof this.browser.showDirectoryPicker === 'function' ? 'folder-auto' : 'manual-only'; }
  async chooseFolder(): Promise<FileSystemDirectoryHandle> {
    if (typeof this.browser.showDirectoryPicker !== 'function') throw new Error('目录备份不可用');
    return this.browser.showDirectoryPicker({ mode: 'readwrite' });
  }
  async writeTo(handle: FileSystemDirectoryHandle, text: string): Promise<void> {
    let writable: FileSystemWritableFileStream | undefined;
    try {
      const file = await handle.getFileHandle('眠记-自动备份.json', { create: true });
      writable = await file.createWritable();
      await writable.write(text); await writable.close();
    }
    catch (error) {
      await writable?.abort().catch(() => undefined);
      throw new Error('自动备份写入失败', { cause: error });
    }
  }
}

export async function replaceBackupDirectory(settings: BackupSettingsRepository, files: Pick<BrowserFileBackup, 'writeTo'>, candidate: FileSystemDirectoryHandle, text: string): Promise<void> {
  await files.writeTo(candidate, text);
  await settings.setDirectory(candidate);
}

export async function requestPersistentStorage(): Promise<boolean> {
  return navigator.storage?.persist ? navigator.storage.persist() : false;
}

export function downloadBackup(text: string, filename: string, mimeType = 'application/json;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const link = document.createElement('a');
  try {
    link.href = url;
    link.download = filename;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export interface BackupTrigger { run(): Promise<void>; }
export class AutoBackupTrigger implements BackupTrigger {
  constructor(private sleep: Pick<SleepRepository, 'list'>, private settings: BackupSettingsRepository, private files: BrowserFileBackup, private now: () => string) {}
  async run(): Promise<void> {
    let current: BackupStatus = defaultStatus();
    try {
      current = await this.settings.getStatus();
      const handle = await this.settings.getDirectory();
      if (!handle) {
        await this.settings.setStatus({ ...current, state: this.files.capability() === 'folder-auto' ? 'needs-permission' : 'manual-only', message: null });
        return;
      }
      const permission = await handle.queryPermission?.({ mode: 'readwrite' });
      if (permission && permission !== 'granted') {
        await this.settings.setStatus({ ...current, state: 'needs-permission', message: null });
        return;
      }
      await this.files.writeTo(handle, createBackup(await this.sleep.list(), this.now()));
      await this.settings.setStatus({
        ...current,
        state: 'ready',
        lastAutomaticBackupAt: this.now(),
        lastSuccessfulBackupAt: this.now(),
        message: null,
      });
    } catch (error) {
      await this.settings.setStatus({ ...current, state: 'write-failed', message: error instanceof Error ? error.message : '自动备份写入失败' }).catch(() => undefined);
    }
  }
}
