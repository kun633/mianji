import { expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ exportFile: vi.fn() }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => native,
}));
import { nativeExportFile } from './widget-bridge';

it('reports native save errors instead of falling back to an unsupported web download', async () => {
  native.exportFile.mockRejectedValue(new Error('存储空间不足'));
  await expect(nativeExportFile({content: '{}', filename: 'test.json', mimeType: 'application/json', title: 'test'}))
    .rejects.toThrow('存储空间不足');
});

it('keeps cancellation distinct from a successful save', async () => {
  native.exportFile.mockResolvedValue({success: false, cancelled: true});
  await expect(nativeExportFile({content: '{}', filename: 'test.json', mimeType: 'application/json', title: 'test'}))
    .resolves.toEqual({success: false, cancelled: true});
});
