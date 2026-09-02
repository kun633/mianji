import { describe, expect, it } from 'vitest';
import { createSegment, type SleepSegment } from '../domain/sleep';
import { createBackup, mergeBackup, parseBackup, toCsv } from './backup';

const completedNight: SleepSegment = {
  ...createSegment({ id: 'night-1', kind: 'night', groupId: 'group-1', now: '2026-09-02T14:46:00.000Z', timezone: 'Asia/Shanghai' }),
  endAt: '2026-09-02T22:08:00.000Z', endTimezone: 'Asia/Shanghai', status: 'completed',
  finishedAt: '2026-09-02T22:08:00.000Z', updatedAt: '2026-09-02T22:08:00.000Z',
};

describe('versioned sleep backups', () => {
  it('round-trips a versioned backup', () => {
    const text = createBackup([completedNight], '2026-09-03T00:00:00.000Z');
    expect(parseBackup(text).segments).toEqual([completedNight]);
    expect(JSON.parse(text)).toMatchObject({ app: '眠记', version: 1 });
  });

  it('rejects malformed or unsupported backup schemas', () => {
    expect(() => parseBackup('{}')).toThrow('备份文件格式不正确');
    expect(() => parseBackup(JSON.stringify({ app: '眠记', version: 2, exportedAt: 'now', segments: [] }))).toThrow('备份文件格式不正确');
    expect(() => parseBackup(JSON.stringify({ app: '眠记', version: 1, exportedAt: 'now', segments: [{ ...completedNight, status: 'broken' }] }))).toThrow('备份文件格式不正确');
  });

  it('deduplicates exact records but stops on same-id conflicts', () => {
    expect(mergeBackup([completedNight], [completedNight])).toEqual({ merged: [completedNight], conflicts: [] });
    const duplicateWithNewId = { ...completedNight, id: 'imported-copy' };
    expect(mergeBackup([completedNight], [duplicateWithNewId]).merged).toEqual([completedNight]);
    const changed = { ...completedNight, kind: 'nap' as const, groupId: null };
    expect(mergeBackup([completedNight], [changed]).conflicts).toEqual([{ current: completedNight, incoming: changed }]);
  });

  it('exports one escaped CSV row per segment', () => {
    const csv = toCsv([{ ...completedNight, uncertainReason: 'a,"reason"' }]);
    expect(csv).toContain('夜间睡眠');
    expect(csv).toContain('"a,""reason"""');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.trimEnd().split('\r\n')).toHaveLength(2);
  });
});
