import { expect, test } from '@playwright/test';

test.describe('Backup and Recovery E2E', () => {
  test('recovers after site data is cleared', async ({ browser }, testInfo) => {
    const first = await browser.newContext();
    const page = await first.newPage();
    await page.goto('/');

    // Record a nap
    await page.getByRole('button', { name: '开始睡觉' }).click();
    await page.getByRole('button', { name: '午睡' }).click();
    await page.getByRole('button', { name: '起床' }).click();

    // Export backup
    await page.getByRole('button', { name: '设置' }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出完整备份 (JSON)' }).click();
    const download = await downloadPromise;
    const backupPath = testInfo.outputPath('mianji-backup.json');
    await download.saveAs(backupPath);
    await first.close();

    // Open a fresh browser context with empty IndexedDB
    const restored = await browser.newContext();
    const restoredPage = await restored.newPage();
    await restoredPage.goto('/');

    // Navigate to Settings
    await restoredPage.getByRole('button', { name: '设置' }).click();
    await restoredPage.getByLabel('选择备份文件').setInputFiles(backupPath);
    await expect(restoredPage.getByText(/1 条记录/)).toBeVisible();
    await restoredPage.getByRole('button', { name: '确认恢复' }).click();

    // Verify recovery
    await restoredPage.getByRole('button', { name: '历史' }).click();
    await expect(restoredPage.locator('.history-list-section').getByText('午睡', { exact: true })).toBeVisible();

    await restored.close();
  });

  test('manual JSON export updates the manual-backup reminder timestamp', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '设置' }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出完整备份 (JSON)' }).click();
    await downloadPromise;

    const lastSuccessfulBackupAt = await page.evaluate(async () => {
      return new Promise<string | null>((resolve, reject) => {
        const request = indexedDB.open('mianji-sleep-log-settings', 1);
        request.onsuccess = () => {
          const db = request.result;
          const get = db.transaction('settings').objectStore('settings').get('status');
          get.onsuccess = () => { db.close(); resolve(get.result?.lastSuccessfulBackupAt ?? null); };
          get.onerror = () => { db.close(); reject(get.error); };
        };
        request.onerror = () => reject(request.error);
      });
    });
    expect(lastSuccessfulBackupAt).not.toBeNull();
  });
});
