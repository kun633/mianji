import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { HistoryPage } from './HistoryPage';
import type { SleepSegment } from '../domain/sleep';

describe('sleep insight presentation', () => {
  afterEach(() => cleanup());
  it('shows the analysis window, sample completeness and a non-diagnostic caveat', () => {
    const segment: SleepSegment = {
      id: 'night-1', kind: 'night', groupId: 'night-1', startAt: '2026-09-30T14:00:00.000Z',
      startTimezone: 'Asia/Shanghai', endAt: '2026-09-30T22:00:00.000Z', endTimezone: 'Asia/Shanghai',
      status: 'completed', uncertainReason: null, createdAt: '2026-09-30T14:00:00.000Z',
      updatedAt: '2026-09-30T22:00:00.000Z', finishedAt: '2026-09-30T22:00:00.000Z', schemaVersion: 1,
      reflection: { sleepOnsetAt: null, alarmUsed: true, wakeEnergy: 2, daytimeEnergy: 3,
        sleepOnsetBand: '30_to_60', nightAwakeningBand: 'one_or_two' },
    };
    const actions = Object.fromEntries(['changeKind', 'deleteSegment', 'saveReflection', 'startPlan', 'pausePlan', 'resumePlan', 'restartPlan'].map((key) => [key, vi.fn()])) as unknown as Parameters<typeof HistoryPage>[0]['actions'];
    render(<HistoryPage segments={[segment]} today="2026-10-01" timezone="Asia/Shanghai" actions={actions} />);
    const analysis = screen.getByRole('region', { name: '睡眠趋势与提示' });
    expect(analysis).toHaveTextContent('1 晚');
    expect(analysis).toHaveTextContent('样本不足');
    expect(analysis).toHaveTextContent('不是医学诊断');
    expect(analysis).toHaveTextContent('夜间醒来');
  });

  it('counts known, explicitly unknown and unanswered nights separately in both categories', () => {
    const base: SleepSegment = {
      id: 'known', kind: 'night', groupId: 'known', startAt: '2026-09-28T14:00:00.000Z',
      startTimezone: 'Asia/Shanghai', endAt: '2026-09-28T22:00:00.000Z', endTimezone: 'Asia/Shanghai',
      status: 'completed', uncertainReason: null, createdAt: '2026-09-28T14:00:00.000Z',
      updatedAt: '2026-09-28T22:00:00.000Z', finishedAt: '2026-09-28T22:00:00.000Z', schemaVersion: 1,
      reflection: { sleepOnsetAt: null, alarmUsed: null, wakeEnergy: null, daytimeEnergy: null,
        sleepOnsetBand: 'under_15', nightAwakeningBand: 'none' },
    };
    const unknown: SleepSegment = { ...base, id: 'unknown', groupId: 'unknown',
      startAt: '2026-09-29T14:00:00.000Z', endAt: '2026-09-29T22:00:00.000Z',
      reflection: { ...base.reflection!, sleepOnsetBand: 'unknown', nightAwakeningBand: 'unknown' } };
    const blank: SleepSegment = { ...base, id: 'blank', groupId: 'blank',
      startAt: '2026-09-30T14:00:00.000Z', endAt: '2026-09-30T22:00:00.000Z',
      reflection: { sleepOnsetAt: '2026-09-30T14:30:00.000Z', alarmUsed: null, wakeEnergy: null, daytimeEnergy: null } };
    const actions = Object.fromEntries(['changeKind', 'deleteSegment', 'saveReflection', 'startPlan', 'pausePlan', 'resumePlan', 'restartPlan'].map((key) => [key, vi.fn()])) as unknown as Parameters<typeof HistoryPage>[0]['actions'];
    render(<HistoryPage segments={[base, unknown, blank]} today="2026-10-01" timezone="Asia/Shanghai" actions={actions} />);
    const analysis = screen.getByRole('region', { name: '睡眠趋势与提示' });
    expect(analysis).toHaveTextContent('入睡区间（已知 1 晚，记不清 1 晚，未填写 1 晚）');
    expect(analysis).toHaveTextContent('夜间醒来（已知 1 晚，记不清 1 晚，未填写 1 晚）');
    expect(analysis).toHaveTextContent('日期和时刻均按当前分析时区 Asia/Shanghai 统计');
    expect(analysis).not.toHaveTextContent('结束记录时区归属');
  });
});
