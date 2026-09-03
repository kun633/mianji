import { describe, expect, it, vi } from 'vitest';
import { publishWidgetState } from './widget-bridge';

describe('publishWidgetState', () => {
  it('formats the idle payload and delegates to the native bridge', async () => {
    const bridge = { send: vi.fn().mockResolvedValue(undefined) };
    await publishWidgetState(
      {
        state: 'idle',
        headline: '准备入睡',
        subline: '昨晚睡眠 7小时30分',
        actionType: 'start',
        updatedAt: '2026-09-03T00:00:00.000Z',
      },
      bridge
    );
    expect(bridge.send).toHaveBeenCalledWith(
      expect.objectContaining({ headline: '准备入睡', actionType: 'start' })
    );
  });

  it('handles fallbacks gracefully when no bridge is passed', async () => {
    await expect(
      publishWidgetState({
        state: 'active',
        headline: '睡眠进行中',
        subline: '已睡 1小时15分',
        actionType: 'wake',
        updatedAt: '2026-09-03T01:15:00.000Z',
      })
    ).resolves.toBeUndefined();
  });
});
