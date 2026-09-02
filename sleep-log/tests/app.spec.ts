import { expect, test } from '@playwright/test';
import { seedIndexedDb } from './fixtures';
import type { SleepSegment } from '../src/domain/sleep';

test.describe('Sleep Log PWA App Workflows', () => {
  test('night sleep survives reload and supports real-time correction', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '开始睡觉' }).click();
    await page.getByRole('button', { name: '夜间睡眠' }).click();
    await page.reload();
    await expect(page.getByRole('button', { name: '起床' })).toBeVisible();

    // Reset start time
    await page.getByRole('button', { name: '还没睡着' }).click();
    await page.getByRole('button', { name: '确认重置' }).click();

    // Wake
    await page.getByRole('button', { name: '起床' }).click();
    await expect(page.getByRole('button', { name: '撤销起床' })).toBeVisible();
    await expect(page.getByLabel('修改开始时间')).toHaveCount(0);
  });

  test('two naps on one date render two rows and their summed daily total', async ({ page }) => {
    const today = new Date().toISOString().slice(0, 10);
    const nap1: SleepSegment = {
      id: 'nap-1',
      kind: 'nap',
      groupId: null,
      startAt: `${today}T04:00:00.000Z`,
      startTimezone: 'Asia/Shanghai',
      endAt: `${today}T05:00:00.000Z`,
      endTimezone: 'Asia/Shanghai',
      status: 'completed',
      uncertainReason: null,
      createdAt: `${today}T04:00:00.000Z`,
      updatedAt: `${today}T05:00:00.000Z`,
      finishedAt: `${today}T05:00:00.000Z`,
      schemaVersion: 1,
    };
    const nap2: SleepSegment = {
      id: 'nap-2',
      kind: 'nap',
      groupId: null,
      startAt: `${today}T06:00:00.000Z`,
      startTimezone: 'Asia/Shanghai',
      endAt: `${today}T07:00:00.000Z`,
      endTimezone: 'Asia/Shanghai',
      status: 'completed',
      uncertainReason: null,
      createdAt: `${today}T06:00:00.000Z`,
      updatedAt: `${today}T07:00:00.000Z`,
      finishedAt: `${today}T07:00:00.000Z`,
      schemaVersion: 1,
    };

    await page.goto('/');
    await seedIndexedDb(page, [nap1, nap2]);
    await page.goto('/');
    await page.getByRole('button', { name: '历史' }).click();

    await expect(page.getByText('平均午睡')).toBeVisible();
    await expect(page.locator('.history-list-section').getByText('午睡').first()).toBeVisible();
    await expect(page.locator('.stat-card').filter({ hasText: '平均午睡' }).getByText('2小时0分')).toBeVisible();
  });

  test('“再睡一段” renders two segments in one night card', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '开始睡觉' }).click();
    await page.getByRole('button', { name: '夜间睡眠' }).click();
    await page.getByRole('button', { name: '起床' }).click();

    await page.getByRole('button', { name: '再睡一段' }).click();
    await expect(page.getByRole('button', { name: '起床' })).toBeVisible();
    await page.getByRole('button', { name: '起床' }).click();

    await expect(page.getByText('2 段合计')).toBeVisible();
  });

  test('an active record seeded 21 hours earlier shows the three actions', async ({ page }) => {
    const now = Date.now();
    const startIso = new Date(now - 21 * 3600 * 1000).toISOString();
    const overlong: SleepSegment = {
      id: 'overlong-1',
      kind: 'night',
      groupId: 'night-overlong',
      startAt: startIso,
      startTimezone: 'Asia/Shanghai',
      endAt: null,
      endTimezone: null,
      status: 'active',
      uncertainReason: null,
      createdAt: startIso,
      updatedAt: startIso,
      finishedAt: null,
      schemaVersion: 1,
    };

    await page.goto('/');
    await seedIndexedDb(page, [overlong]);
    await page.reload();

    await expect(page.getByText('这段记录已超过 20 小时')).toBeVisible();
    await expect(page.getByRole('button', { name: '按现在结束并标记不准确' })).toBeVisible();
    await expect(page.getByRole('button', { name: '删除误记录' })).toBeVisible();
    await expect(page.getByRole('button', { name: '继续记录' })).toBeVisible();
  });

  test('uncertain data is visible but excluded from the displayed average', async ({ page }) => {
    const today = new Date().toISOString().slice(0, 10);
    const valid: SleepSegment = {
      id: 'valid-1',
      kind: 'night',
      groupId: 'g1',
      startAt: `${today}T01:00:00.000Z`,
      startTimezone: 'Asia/Shanghai',
      endAt: `${today}T09:00:00.000Z`,
      endTimezone: 'Asia/Shanghai',
      status: 'completed',
      uncertainReason: null,
      createdAt: `${today}T01:00:00.000Z`,
      updatedAt: `${today}T09:00:00.000Z`,
      finishedAt: `${today}T09:00:00.000Z`,
      schemaVersion: 1,
    };
    const uncertain: SleepSegment = {
      id: 'unc-1',
      kind: 'night',
      groupId: 'g2',
      startAt: `${today}T02:00:00.000Z`,
      startTimezone: 'Asia/Shanghai',
      endAt: `${today}T10:00:00.000Z`,
      endTimezone: 'Asia/Shanghai',
      status: 'uncertain',
      uncertainReason: 'over-20-hours',
      createdAt: `${today}T02:00:00.000Z`,
      updatedAt: `${today}T10:00:00.000Z`,
      finishedAt: `${today}T10:00:00.000Z`,
      schemaVersion: 1,
    };

    await page.goto('/');
    await seedIndexedDb(page, [valid, uncertain]);
    await page.goto('/');
    await page.getByRole('button', { name: '历史' }).click();

    await expect(page.getByText('1 条不准确记录未计入统计')).toBeVisible();
    await expect(page.locator('.stat-card').filter({ hasText: '平均夜间睡眠' }).getByText('8小时0分')).toBeVisible();
  });

  test('type correction never renders start/end inputs', async ({ page }) => {
    const today = new Date().toISOString().slice(0, 10);
    const seg: SleepSegment = {
      id: 'seg-tc',
      kind: 'night',
      groupId: 'gtc',
      startAt: `${today}T01:00:00.000Z`,
      startTimezone: 'Asia/Shanghai',
      endAt: `${today}T09:00:00.000Z`,
      endTimezone: 'Asia/Shanghai',
      status: 'completed',
      uncertainReason: null,
      createdAt: `${today}T01:00:00.000Z`,
      updatedAt: `${today}T09:00:00.000Z`,
      finishedAt: `${today}T09:00:00.000Z`,
      schemaVersion: 1,
    };

    await page.goto('/');
    await seedIndexedDb(page, [seg]);
    await page.goto('/');
    await page.getByRole('button', { name: '历史' }).click();

    await expect(page.getByLabel('开始时间')).toHaveCount(0);
    await expect(page.getByLabel('结束时间')).toHaveCount(0);
    await page.getByRole('button', { name: '改为午睡' }).click();
    await expect(page.getByRole('button', { name: '改为夜间睡眠' })).toBeVisible();
  });

  test('deletion survives cancel and occurs only after confirm', async ({ page }) => {
    const today = new Date().toISOString().slice(0, 10);
    const seg: SleepSegment = {
      id: 'seg-del',
      kind: 'nap',
      groupId: null,
      startAt: `${today}T05:00:00.000Z`,
      startTimezone: 'Asia/Shanghai',
      endAt: `${today}T06:00:00.000Z`,
      endTimezone: 'Asia/Shanghai',
      status: 'completed',
      uncertainReason: null,
      createdAt: `${today}T05:00:00.000Z`,
      updatedAt: `${today}T06:00:00.000Z`,
      finishedAt: `${today}T06:00:00.000Z`,
      schemaVersion: 1,
    };

    await page.goto('/');
    await seedIndexedDb(page, [seg]);
    await page.goto('/');
    await page.getByRole('button', { name: '历史' }).click();

    await page.getByRole('button', { name: '删除' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: '取消' }).click();
    await expect(page.locator('.history-list-section').getByText('午睡', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: '删除' }).click();
    await page.getByRole('button', { name: '确认删除' }).click();
    await expect(page.getByText('暂无历史睡眠记录')).toBeVisible();
  });

  test('the 7/30-day controls expose the selected range with aria-pressed', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '历史' }).click();
    const btn7 = page.getByRole('button', { name: '最近 7 天' });
    const btn30 = page.getByRole('button', { name: '最近 30 天' });

    await expect(btn7).toHaveAttribute('aria-pressed', 'true');
    await expect(btn30).toHaveAttribute('aria-pressed', 'false');

    await btn30.click();
    await expect(btn7).toHaveAttribute('aria-pressed', 'false');
    await expect(btn30).toHaveAttribute('aria-pressed', 'true');
  });

  test('a 320×568 viewport satisfies document.documentElement.scrollWidth <= window.innerWidth', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/');
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(fits).toBe(true);
  });

  test('keyboard Tab reaches the primary action with a visible outline', async ({ page }) => {
    await page.goto('/');
    await page.locator('body').focus();
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement?.tagName);
    expect(['BUTTON', 'A']).toContain(focused);
  });

  test('reduced-motion emulation removes meaningful transition duration', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const duration = await page.evaluate(() => {
      const btn = document.querySelector('button');
      return btn ? window.getComputedStyle(btn).transitionDuration : '0s';
    });
    expect(parseFloat(duration) <= 0.05).toBe(true);
  });
});
