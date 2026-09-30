import { describe, expect, it } from 'vitest';
import { createSegment, finishSegment } from './sleep';
import { isSleepPlan, pauseSleepPlan, resumeSleepPlan, sleepPlanForDate, startSleepPlan } from './sleep-plan';

const night = (id: string, wake: string) => finishSegment(
  createSegment({ id, kind: 'night', groupId: id, now: new Date(Date.parse(wake) - 9 * 3600000).toISOString(), timezone: 'Asia/Shanghai' }),
  wake, 'Asia/Shanghai',
);

describe('gradual sleep plan', () => {
  it('starts from the median of recent wakes and shifts every three days', () => {
    const plan = startSleepPlan([
      night('a', '2026-09-27T02:00:00.000Z'), night('b', '2026-09-28T02:20:00.000Z'), night('c', '2026-09-29T02:40:00.000Z'),
    ], '2026-09-30');
    expect(plan.baselineWakeMinutes).toBe(620);
    expect(sleepPlanForDate(plan, '2026-09-30').wakeMinutes).toBe(620);
    expect(sleepPlanForDate(plan, '2026-10-03').wakeMinutes).toBe(595);
    expect(sleepPlanForDate(plan, '2026-11-30').wakeMinutes).toBe(450);
  });

  it('freezes while paused and resumes without losing days', () => {
    const plan = startSleepPlan([
      night('a', '2026-09-27T02:00:00.000Z'), night('b', '2026-09-28T02:20:00.000Z'), night('c', '2026-09-29T02:40:00.000Z'),
    ], '2026-09-30');
    const paused = pauseSleepPlan(plan, '2026-10-02');
    expect(sleepPlanForDate(paused, '2026-10-10').wakeMinutes).toBe(620);
    expect(sleepPlanForDate(resumeSleepPlan(paused, '2026-10-10'), '2026-10-11').wakeMinutes).toBe(595);
  });

  it('accepts one valid night and rejects invalid backup dates', () => {
    const plan = startSleepPlan([night('a', '2026-09-27T02:00:00.000Z')], '2026-09-30');
    expect(plan.baselineWakeMinutes).toBe(600);
    expect(isSleepPlan({ ...plan, startedOn: '2026-02-30' })).toBe(false);
    expect(isSleepPlan({ ...plan, pausedOn: '2026-09-29' })).toBe(false);
  });
});
