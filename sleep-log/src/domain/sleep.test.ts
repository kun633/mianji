import { describe, expect, it } from 'vitest';
import {
  createSegment, durationMs, finishSegment, markUncertain,
  resetStart, undoFinish,
} from './sleep';

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
