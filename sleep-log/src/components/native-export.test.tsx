import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const bridge = vi.hoisted(() => ({
  nativeExportFile: vi.fn(),
  checkPendingNativeAction: async () => null,
  publishWidgetState: async () => {},
  openNativeAppSettings: async () => {},
}));
vi.mock('../native/platform', () => ({isNativeApp: () => true}));
vi.mock('../native/widget-bridge', () => bridge);
import App from '../App';
import { IndexedDbSleepRepository, deleteSleepDatabase } from '../data/repository';
import { IndexedDbBackupSettingsRepository, deleteBackupSettingsDatabase } from '../data/file-backup';

afterEach(async () => { cleanup(); await deleteSleepDatabase(); await deleteBackupSettingsDatabase(); });

it('cancelling native JSON export does not record a successful backup', async () => {
  bridge.nativeExportFile.mockResolvedValue({success: false, cancelled: true});
  render(<App initialRepository={new IndexedDbSleepRepository()} />);
  fireEvent.click(await screen.findByRole('button', {name: '设置'}));
  fireEvent.click(await screen.findByRole('button', {name: '导出完整备份 (JSON)'}));
  await screen.findByText('已取消导出，未保存备份。');
  expect((await new IndexedDbBackupSettingsRepository().getStatus()).lastManualExportAt).toBeNull();
});

it('native write failure shows an error without recording a successful backup', async () => {
  bridge.nativeExportFile.mockRejectedValue(new Error('磁盘已满'));
  render(<App initialRepository={new IndexedDbSleepRepository()} />);
  fireEvent.click(await screen.findByRole('button', {name: '设置'}));
  fireEvent.click(await screen.findByRole('button', {name: '导出完整备份 (JSON)'}));
  await screen.findByText('磁盘已满');
  expect((await new IndexedDbBackupSettingsRepository().getStatus()).lastManualExportAt).toBeNull();
});

it('exports fresh records and marks success only after native saving finishes', async () => {
  let finish!: (value: unknown) => void;
  bridge.nativeExportFile.mockImplementation(() => new Promise(resolve => {finish = resolve;}));
  const repo = new IndexedDbSleepRepository();
  render(<App initialRepository={repo} />);
  fireEvent.click(await screen.findByRole('button', {name: '设置'}));
  await screen.findByRole('button', {name: '导出完整备份 (JSON)'});
  // A record changed after the Settings snapshot was rendered.
  const now = new Date().toISOString();
  await repo.save({id:'fresh',kind:'nap',groupId:null,startAt:now,startTimezone:'Asia/Shanghai',endAt:null,endTimezone:null,status:'active',uncertainReason:null,createdAt:now,updatedAt:now,finishedAt:null,schemaVersion:1});
  fireEvent.click(screen.getByRole('button', {name: '导出完整备份 (JSON)'}));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  const sent = bridge.nativeExportFile.mock.lastCall![0];
  expect(JSON.parse(sent.content).segments[0].id).toBe('fresh');
  expect((await new IndexedDbBackupSettingsRepository().getStatus()).lastManualExportAt).toBeNull();
  finish({success:true,savedPath:'backup.json'});
  await screen.findByText(/已保存【backup.json】/);
  expect((await new IndexedDbBackupSettingsRepository().getStatus()).lastManualExportAt).toBeTruthy();
});
