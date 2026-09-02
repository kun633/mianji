import { describe, expect, it } from 'vitest';
import {
  createSegment, durationMs, finishSegment, markUncertain,
  resetStart, undoFinish,
} from './sleep';
import type { SleepKind, SleepSegment } from './sleep';
import { buildStats } from './stats';

function completed(id: string, kind: SleepKind, groupId: string | null, startAt: string, endAt: string, timezone = 'Asia/Shanghai'): SleepSegment {
  return {
    id, kind, groupId, startAt, startTimezone: timezone,
    endAt, endTimezone: timezone, status: 'completed', uncertainReason: null,
    createdAt: startAt, updatedAt: endAt, finishedAt: endAt, schemaVersion: 1,
  };
}

describe('sleep state transitions', () => {
  it('records the clicked time and resets it only while active', () => {
    const initial = createSegment({
      id: 'seg-1', kind: 'night', groupId: 'night-1',
      now: '2026-09-02T14:46:00.000Z', timezone: 'Asia/Shanghai',
    });
    const reset = resetStart(initial, '2026-09-02T15:08:00.000Z', 'Asia/Shanghai');
    expect(reset.startAt).toBe('2026-09-02T15:08:00.000Z');
    expect(() => resetStart(finishSegment(reset, '2026-09-02T22:08:00.000Z', 'Asia/Shanghai'), '2026-09-02T15:10:00.000Z', 'Asia/Shanghai')).toThrow('completed timestamps are immutable');
  });

  it('allows undo at zero seconds and exactly 60 seconds', () => {
    const active = createSegment({ id: 'seg-1', kind: 'night', groupId: 'night-1', now: '2026-09-02T15:00:00.000Z', timezone: 'Asia/Shanghai' });
    const done = finishSegment(active, '2026-09-02T22:00:00.000Z', 'Asia/Shanghai');
    expect(undoFinish(done, '2026-09-02T22:00:00.000Z').status).toBe('active');
    expect(undoFinish(done, '2026-09-02T22:01:00.000Z').status).toBe('active');
  });

  it('rejects undo before finish and after 60 seconds', () => {
    const active = createSegment({ id: 'seg-1', kind: 'night', groupId: 'night-1', now: '2026-09-02T15:00:00.000Z', timezone: 'Asia/Shanghai' });
    const done = finishSegment(active, '2026-09-02T22:00:00.000Z', 'Asia/Shanghai');
    expect(() => undoFinish(done, '2026-09-02T21:59:59.999Z')).toThrow('undo window expired');
    expect(() => undoFinish(done, '2026-09-02T22:01:00.001Z')).toThrow('undo window expired');
  });

  it('rejects undo when elapsed time is not finite', () => {
    const active = createSegment({ id: 'seg-1', kind: 'night', groupId: 'night-1', now: '2026-09-02T15:00:00.000Z', timezone: 'Asia/Shanghai' });
    const done = finishSegment(active, '2026-09-02T22:00:00.000Z', 'Asia/Shanghai');
    expect(() => undoFinish(done, 'not-a-timestamp')).toThrow('undo window expired');
  });

  it('keeps uncertain data visible but calculates its raw duration', () => {
    const active = createSegment({ id: 'seg-2', kind: 'nap', groupId: null, now: '2026-09-02T05:00:00.000Z', timezone: 'Asia/Shanghai' });
    const uncertain = markUncertain(finishSegment(active, '2026-09-02T06:00:00.000Z', 'Asia/Shanghai'), 'forgot-to-stop');
    expect(uncertain.status).toBe('uncertain');
    expect(durationMs(uncertain)).toBe(3_600_000);
  });
});

describe('sleep statistics', () => {
  it('sums night segments, keeps naps separate, and excludes uncertain data', () => {
    const segments = [
      completed('n1', 'night', 'g1', '2026-09-02T15:00:00.000Z', '2026-09-02T18:00:00.000Z'),
      completed('n2', 'night', 'g1', '2026-09-02T18:30:00.000Z', '2026-09-02T22:30:00.000Z'),
      completed('p1', 'nap', null, '2026-09-03T05:00:00.000Z', '2026-09-03T05:30:00.000Z'),
      { ...completed('bad', 'night', 'g2', '2026-09-01T15:00:00.000Z', '2026-09-01T22:00:00.000Z'), status: 'uncertain' as const },
    ];
    const result = buildStats(segments, 7, '2026-09-03', 'Asia/Shanghai');
    expect(result.days.find((day) => day.date === '2026-09-03')).toEqual({ date: '2026-09-03', nightMs: 25_200_000, napMs: 1_800_000, totalMs: 27_000_000 });
    expect(result.excludedCount).toBe(1);
    expect(result.averageNightMs).toBe(25_200_000);
  });

  it('retains two nap history rows while summing their daily duration', () => {
    const segments = [
      completed('p1', 'nap', null, '2026-09-03T02:00:00.000Z', '2026-09-03T02:20:00.000Z'),
      completed('p2', 'nap', null, '2026-09-03T05:00:00.000Z', '2026-09-03T05:30:00.000Z'),
    ];
    const result = buildStats(segments, 7, '2026-09-03', 'Asia/Shanghai');
    expect(segments).toHaveLength(2);
    expect(result.days).toEqual([{ date: '2026-09-03', nightMs: 0, napMs: 3_000_000, totalMs: 3_000_000 }]);
  });

  it('archives by wake date in the requested timezone and omits missing days from averages', () => {
    const segments = [
      completed('night', 'night', 'g1', '2026-09-01T16:00:00.000Z', '2026-09-02T16:30:00.000Z'),
      completed('nap', 'nap', null, '2026-09-01T03:00:00.000Z', '2026-09-01T04:00:00.000Z'),
    ];
    const result = buildStats(segments, 7, '2026-09-03', 'Asia/Shanghai');
    expect(result.days.map((day) => day.date)).toEqual(['2026-09-01', '2026-09-03']);
    expect(result.averageNightMs).toBe(88_200_000);
    expect(result.averageNapMs).toBe(3_600_000);
    expect(result.averageTotalMs).toBe(45_900_000);
  });

  it('groups a split night on the final segment wake date across midnight', () => {
    const segments = [
      completed('early', 'night', 'split-night', '2026-09-01T13:00:00.000Z', '2026-09-01T15:30:00.000Z'),
      completed('final', 'night', 'split-night', '2026-09-01T17:00:00.000Z', '2026-09-01T22:00:00.000Z'),
    ];

    const result = buildStats(segments, 7, '2026-09-02', 'Asia/Shanghai');

    expect(result.days).toEqual([{ date: '2026-09-02', nightMs: 27_000_000, napMs: 0, totalMs: 27_000_000 }]);
  });

  it('excludes invalid negative durations instead of subtracting from totals', () => {
    const valid = completed('valid', 'night', 'night-with-invalid', '2026-09-01T14:00:00.000Z', '2026-09-01T16:00:00.000Z');
    const invalid = { ...completed('invalid', 'night', 'night-with-invalid', '2026-09-01T18:00:00.000Z', '2026-09-01T17:00:00.000Z'), status: 'invalid' as const };

    const result = buildStats([valid, invalid], 7, '2026-09-02', 'Asia/Shanghai');

    expect(result.days).toEqual([{ date: '2026-09-02', nightMs: 7_200_000, napMs: 0, totalMs: 7_200_000 }]);
    expect(result.excludedCount).toBe(1);
  });
});
