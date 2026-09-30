import { describe, expect, it } from 'vitest';
import { createSegment, finishSegment, saveReflection } from './sleep';
import { buildReflectionComparison } from './stats';

const done = (id: string, hours: number, energy: number) => {
  const start = '2026-09-02T14:00:00.000Z';
  return saveReflection(
    finishSegment(createSegment({ id, kind: 'night', groupId: id, now: start, timezone: 'Asia/Shanghai' }), new Date(Date.parse(start) + hours * 3600000).toISOString(), 'Asia/Shanghai'),
    { sleepOnsetAt: null, alarmUsed: null, wakeEnergy: energy, daytimeEnergy: energy },
    '2026-09-03T08:00:00.000Z',
  );
};

describe('sleep reflection', () => {
  it('preserves timestamps and validates an estimated sleep onset', () => {
    const segment = done('a', 9, 4);
    const updated = saveReflection(segment, { ...segment.reflection!, sleepOnsetAt: '2026-09-02T14:30:00.000Z' }, '2026-09-03T09:00:00.000Z');
    expect(updated.startAt).toBe(segment.startAt);
    expect(updated.endAt).toBe(segment.endAt);
    expect(updated.reflection?.sleepOnsetAt).toBe('2026-09-02T14:30:00.000Z');
    expect(() => saveReflection(segment, { ...segment.reflection!, sleepOnsetAt: '2026-09-02T13:00:00.000Z' }, '2026-09-03T09:00:00.000Z')).toThrow();
  });

  it('compares only reviewed completed nights and labels samples', () => {
    const result = buildReflectionComparison([done('eight', 8, 2), done('nine', 9, 4), done('ten', 10, 5)]);
    expect(result.map((bucket) => [bucket.label, bucket.count, bucket.averageWakeEnergy])).toEqual([
      ['8～不足9小时', 1, 2], ['9小时及以上', 2, 4.5],
    ]);
  });
});
