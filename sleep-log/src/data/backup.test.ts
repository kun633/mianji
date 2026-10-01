import { describe, expect, it } from 'vitest';
import { createSegment, type SleepSegment } from '../domain/sleep';
import type { SleepPlan } from '../domain/sleep-plan';
import { createBackup, mergeBackup, parseBackup, resolveBackupMerge, shouldRemindManualBackup, toCsv } from './backup';

const completedNight: SleepSegment = {
  ...createSegment({ id: 'night-1', kind: 'night', groupId: 'group-1', now: '2026-09-02T14:46:00.000Z', timezone: 'Asia/Shanghai' }),
  endAt: '2026-09-02T22:08:00.000Z', endTimezone: 'Asia/Shanghai', status: 'completed',
  finishedAt: '2026-09-02T22:08:00.000Z', updatedAt: '2026-09-02T22:08:00.000Z',
};

describe('versioned sleep backups', () => {
  it('round-trips a versioned backup', () => {
    const text = createBackup([completedNight], '2026-09-03T00:00:00.000Z');
    expect(parseBackup(text).segments).toEqual([completedNight]);
    expect(JSON.parse(text)).toMatchObject({ app: '眠记', version: 2, plan: null });
  });

  it('accepts old backups and keeps new reflections in JSON and CSV', () => {
    const oldBackup = JSON.stringify({ app: '眠记', version: 1, exportedAt: '2026-09-03T00:00:00.000Z', segments: [completedNight] });
    expect(parseBackup(oldBackup).segments[0].reflection).toBeUndefined();
    const reflected = { ...completedNight, reflection: { sleepOnsetAt: null, alarmUsed: false, wakeEnergy: 4, daytimeEnergy: 3 } };
    expect(parseBackup(createBackup([reflected])).segments).toEqual([reflected]);
    expect(toCsv([reflected])).toContain('醒后精神');
    expect(toCsv([reflected])).toContain('白天精神');
  });

  it('round-trips optional bands and absent onset in both v1 and v2 without migration', () => {
    const reflection = { alarmUsed: false, wakeEnergy: 4, daytimeEnergy: 3,
      sleepOnsetBand: 'under_15' as const, nightAwakeningBand: 'none' as const };
    const segment = { ...completedNight, reflection };
    for (const version of [1, 2]) {
      const envelope = version === 1
        ? { app: '眠记', version, exportedAt: completedNight.updatedAt, segments: [segment] }
        : JSON.parse(createBackup([segment]));
      expect(parseBackup(JSON.stringify(envelope)).segments).toEqual([segment]);
    }
    expect(parseBackup(createBackup([{ ...completedNight, reflection: { sleepOnsetAt: '2026-09-02T15:00:00.000Z', ...reflection } }])).segments[0].reflection?.sleepOnsetAt).toBe('2026-09-02T15:00:00.000Z');
  });

  it('strictly validates band values and unknown reflection keys', () => {
    const base = { alarmUsed: null, wakeEnergy: null, daytimeEnergy: null };
    for (const reflection of [
      { ...base, sleepOnsetBand: 'bad' }, { ...base, nightAwakeningBand: null },
      { ...base, sleepOnsetBand: 15 }, { ...base, extra: true },
    ]) {
      expect(() => parseBackup(createBackup([{ ...completedNight, reflection: reflection as unknown as SleepSegment['reflection'] }]))).toThrow('备份文件格式不正确');
    }
    expect(parseBackup(createBackup([{ ...completedNight, reflection: { ...base, sleepOnsetBand: 'unknown', nightAwakeningBand: 'unknown' } }])).segments[0].reflection).toMatchObject({ sleepOnsetBand: 'unknown', nightAwakeningBand: 'unknown' });
  });

  it('distinguishes absent and present optional fields for conflicts and duplicate fingerprints', () => {
    const base = { ...completedNight, reflection: { alarmUsed: null, wakeEnergy: null, daytimeEnergy: null } };
    const withBand = { ...base, reflection: { ...base.reflection, sleepOnsetBand: 'unknown' as const } };
    expect(mergeBackup([base], [withBand]).conflicts).toEqual([{ current: base, incoming: withBand }]);
    expect(mergeBackup([base], [{ ...withBand, id: 'another' }]).merged).toHaveLength(2);
    const awakening = { ...base, reflection: { ...base.reflection, nightAwakeningBand: 'none' as const } };
    expect(mergeBackup([base], [awakening]).conflicts).toHaveLength(1);
    expect(mergeBackup([base], [{ ...awakening, id: 'awakening' }]).merged).toHaveLength(2);
    expect(mergeBackup([withBand], [{ ...withBand, id: 'duplicate', reflection: {
      sleepOnsetBand: 'unknown' as const, daytimeEnergy: null, wakeEnergy: null, alarmUsed: null,
    } }]).merged).toEqual([withBand]);
  });

  it('appends four band columns with codes and labels while retaining BOM and CRLF', () => {
    const csv = toCsv([{ ...completedNight, reflection: {
      alarmUsed: null, wakeEnergy: null, daytimeEnergy: null,
      sleepOnsetBand: '15_to_30', nightAwakeningBand: 'multiple_or_long',
    } }, completedNight]);
    const [header, first, second] = csv.slice(1).trimEnd().split('\r\n');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(header).toMatch(/"入睡区间编码","入睡区间","夜间醒来编码","夜间醒来情况"$/);
    expect(first).toMatch(/"15_to_30","15–30 分钟","multiple_or_long","多次或醒来较久"$/);
    expect(second).toMatch(/"","","",""$/);
    expect(first.split(',')).toHaveLength(header.split(',').length);
  });

  it('round-trips a paused plan in v2 but rejects malformed plan data', () => {
    const plan: SleepPlan = { startedOn: '2026-09-30', baselineWakeMinutes: 620, targetWakeMinutes: 450, sleepOpportunityMinutes: 570, stepMinutes: 25, stepDays: 3, pausedOn: '2026-10-02', pausedDays: 0 };
    const text = createBackup([completedNight], '2026-10-03T00:00:00.000Z', plan);
    const parsed = parseBackup(text);
    expect(parsed.version).toBe(2);
    if (parsed.version === 2) expect(parsed.plan).toEqual(plan);
    expect(() => parseBackup(text.replace('"stepMinutes": 25', '"stepMinutes": 0'))).toThrow('备份文件格式不正确');
  });

  it('rejects invalid reflections and treats different ratings as restore conflicts', () => {
    const reflection = { sleepOnsetAt: null, alarmUsed: false, wakeEnergy: 4, daytimeEnergy: 3 };
    const reflected = { ...completedNight, reflection };
    expect(() => parseBackup(createBackup([{ ...reflected, reflection: { ...reflection, wakeEnergy: 6 } }]))).toThrow('备份文件格式不正确');
    expect(() => parseBackup(createBackup([{ ...reflected, reflection: { ...reflection, sleepOnsetAt: '2026-09-03T12:00:00.000Z' } }]))).toThrow('备份文件格式不正确');
    const changed = { ...reflected, reflection: { ...reflection, daytimeEnergy: 2 } };
    expect(mergeBackup([reflected], [changed]).conflicts).toEqual([{ current: reflected, incoming: changed }]);
    expect(mergeBackup([reflected], [{ ...reflected, reflection: {
      daytimeEnergy: 3, wakeEnergy: 4, alarmUsed: false, sleepOnsetAt: null,
    } }]).conflicts).toEqual([]);
  });

  it('rejects malformed or unsupported backup schemas', () => {
    expect(() => parseBackup('{}')).toThrow('备份文件格式不正确');
    expect(() => parseBackup(JSON.stringify({ app: '眠记', version: 2, exportedAt: 'now', segments: [] }))).toThrow('备份文件格式不正确');
    expect(() => parseBackup(JSON.stringify({ app: '眠记', version: 1, exportedAt: 'now', segments: [{ ...completedNight, status: 'broken' }] }))).toThrow('备份文件格式不正确');
    expect(() => parseBackup(JSON.stringify({ app: '眠记', version: 1, exportedAt: '2026-09-03T00:00:00.000Z', segments: [{ ...completedNight, startAt: 'not-a-date' }] }))).toThrow('备份文件格式不正确');
    expect(() => parseBackup(JSON.stringify({ app: '眠记', version: 1, exportedAt: '2026-09-03T00:00:00.000Z', segments: [{ ...completedNight, extra: true }] }))).toThrow('备份文件格式不正确');
  });

  it('rejects calendar-invalid ISO timestamps without rejecting valid timezone forms', () => {
    for (const timestamp of ['2026-02-30T12:00:00.000Z', '2026-01-01T24:00:00.000Z', '2026-01-01T23:60:00Z', '2026-01-01T23:59:60+08:00']) {
      expect(() => parseBackup(createBackup([{ ...completedNight, startAt: timestamp }]))).toThrow('备份文件格式不正确');
    }
    expect(parseBackup(createBackup([{ ...completedNight, startAt: '2026-02-28T23:59:59Z' }])).segments[0].startAt).toBe('2026-02-28T23:59:59Z');
    expect(parseBackup(createBackup([{ ...completedNight, startAt: '2026-01-01T12:34:56.123+08:00' }])).segments[0].startAt).toBe('2026-01-01T12:34:56.123+08:00');
  });

  it('deduplicates exact records but stops on same-id conflicts', () => {
    expect(mergeBackup([completedNight], [completedNight])).toEqual({ merged: [completedNight], conflicts: [] });
    const duplicateWithNewId = { ...completedNight, id: 'imported-copy' };
    expect(mergeBackup([completedNight], [duplicateWithNewId]).merged).toEqual([completedNight]);
    const changed = { ...completedNight, kind: 'nap' as const, groupId: null };
    expect(mergeBackup([completedNight], [changed]).conflicts).toEqual([{ current: completedNight, incoming: changed }]);
  });

  it('resolves conflicts on top of the deduplicated merge base', () => {
    const duplicateWithNewId = { ...completedNight, id: 'imported-copy' };
    const conflict = { ...completedNight, kind: 'nap' as const, groupId: null };
    const merge = mergeBackup([completedNight], [duplicateWithNewId, conflict]);

    expect(resolveBackupMerge(merge.merged, merge.conflicts, { 'night-1': 'use-backup' })).toEqual([conflict]);
  });

  it('rejects backups containing more than one active segment', () => {
    const first = createSegment({ id: 'active-1', kind: 'night', groupId: 'night-active', now: '2026-09-03T00:00:00.000Z', timezone: 'Asia/Shanghai' });
    const second = createSegment({ id: 'active-2', kind: 'nap', groupId: null, now: '2026-09-03T01:00:00.000Z', timezone: 'Asia/Shanghai' });
    expect(() => parseBackup(createBackup([first, second]))).toThrow('备份文件格式不正确');
  });

  it('blocks a restore preview that would combine different active records', () => {
    const current = createSegment({ id: 'current-active', kind: 'night', groupId: 'current', now: '2026-09-03T00:00:00.000Z', timezone: 'Asia/Shanghai' });
    const incoming = createSegment({ id: 'backup-active', kind: 'night', groupId: 'backup', now: '2026-09-03T01:00:00.000Z', timezone: 'Asia/Shanghai' });
    expect(() => mergeBackup([current], [incoming])).toThrow('合并后会出现两条“记录中”的记录');
    expect(mergeBackup([current], [completedNight]).merged).toEqual([completedNight, current]);
  });

  it('blocks a conflict resolution that would create a second active record', () => {
    const current = createSegment({ id: 'current-active', kind: 'night', groupId: 'current', now: '2026-09-03T00:00:00.000Z', timezone: 'Asia/Shanghai' });
    const backupActive = createSegment({ id: completedNight.id, kind: 'night', groupId: 'backup', now: '2026-09-03T01:00:00.000Z', timezone: 'Asia/Shanghai' });
    const result = mergeBackup([current, completedNight], [backupActive]);
    expect(result.conflicts).toEqual([{ current: completedNight, incoming: backupActive }]);
    expect(resolveBackupMerge(result.merged, result.conflicts, { [completedNight.id]: 'keep-current' })).toEqual(result.merged);
    expect(() => resolveBackupMerge(result.merged, result.conflicts, { [completedNight.id]: 'use-backup' })).toThrow('合并后会出现两条“记录中”的记录');
  });

  it('does not deduplicate records whose non-id fields differ', () => {
    const changedTimezone = { ...completedNight, id: 'timezone-copy', startTimezone: 'UTC' };
    const changedMetadata = { ...completedNight, id: 'metadata-copy', updatedAt: '2026-09-04T00:00:00.000Z' };
    expect(mergeBackup([], [completedNight, changedTimezone, changedMetadata]).merged).toEqual([completedNight, changedTimezone, changedMetadata]);
  });

  it('compares same-id records by stable fields rather than JSON key order', () => {
    const reordered = {
      schemaVersion: completedNight.schemaVersion, updatedAt: completedNight.updatedAt,
      finishedAt: completedNight.finishedAt, uncertainReason: completedNight.uncertainReason,
      status: completedNight.status, endTimezone: completedNight.endTimezone,
      endAt: completedNight.endAt, startTimezone: completedNight.startTimezone,
      startAt: completedNight.startAt, groupId: completedNight.groupId,
      kind: completedNight.kind, id: completedNight.id, createdAt: completedNight.createdAt,
    };
    expect(mergeBackup([completedNight], [reordered])).toEqual({ merged: [completedNight], conflicts: [] });
  });

  it('does not call an unexported backup older than 30 days', () => {
    expect(shouldRemindManualBackup(null, Date.UTC(2026, 8, 3))).toBe(false);
  });

  it('reminds only when a successful manual export is older than 30 days', () => {
    const now = Date.parse('2026-10-03T00:00:00.000Z');
    expect(shouldRemindManualBackup('2026-09-03T00:00:00.000Z', now)).toBe(true);
    expect(shouldRemindManualBackup('2026-09-04T00:00:00.000Z', now)).toBe(false);
    expect(shouldRemindManualBackup('not-a-date', now)).toBe(true);
  });

  it('exports one escaped CSV row per segment', () => {
    const csv = toCsv([{ ...completedNight, uncertainReason: 'a,"reason"' }]);
    expect(csv).toContain('夜间睡眠');
    expect(csv).toContain('"a,""reason"""');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.trimEnd().split('\r\n')).toHaveLength(2);
  });
});
