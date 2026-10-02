import { describe, expect, it } from 'vitest';
import type { SleepSegment } from './sleep';
import { buildSleepInsights } from './sleep-insights';

const zone = 'Asia/Shanghai';
function segment(id: string, startAt: string, endAt: string, options: Partial<SleepSegment> = {}): SleepSegment {
  return {
    id, kind: 'night', groupId: id, startAt, startTimezone: zone, endAt,
    endTimezone: zone, status: 'completed', uncertainReason: null,
    createdAt: startAt, updatedAt: endAt, finishedAt: endAt, schemaVersion: 1,
    ...options,
  };
}
type Bands = { sleepOnsetBand?: 'under_15' | '15_to_30' | '30_to_60' | 'over_60' | 'unknown'; nightAwakeningBand?: 'none' | 'one_or_two' | 'multiple_or_long' | 'unknown' };
function withBands(value: SleepSegment, bands: Bands): SleepSegment {
  return { ...value, reflection: { sleepOnsetAt: null, alarmUsed: null, wakeEnergy: null, daytimeEnergy: null, ...bands } };
}

describe('buildSleepInsights', () => {
  it('returns explicit missing data and a stable empty window', () => {
    const result = buildSleepInsights([], 7, '2026-10-01', zone);
    expect(result).toMatchObject({
      rangeDays: 7, startDate: '2026-09-25', endDate: '2026-10-01',
      nights: { count: 0, completedDays: 0, nightly: [] },
      naps: { count: 0, days: 0, totalMinutes: 0 },
      onset: { sampleCount: 0, unknownCount: 0, missingCount: 0 },
      awakening: { sampleCount: 0, unknownCount: 0, missingCount: 0 },
      alarm: { yes: 0, no: 0, missingCount: 0 },
      wakeEnergy: { sampleCount: 0, average: null },
      daytimeEnergy: { sampleCount: 0, average: null },
      bedtimeRange: null, wakeTimeRange: null,
      completeness: { excludedSegments: 0, excludedGroups: 0, undatedGroups: 0, undatedSegments: 0 },
    });
    expect(result.messages).toEqual([{ text: expect.stringContaining('不足'), sampleCount: 0 }]);
  });

  it('groups multipart nights once by final local wake date, without counting gaps or overlaps', () => {
    const a = segment('a', '2026-09-30T14:00:00Z', '2026-09-30T16:00:00Z', { groupId: 'g' });
    const overlap = segment('b', '2026-09-30T15:30:00Z', '2026-09-30T16:30:00Z', { groupId: 'g' });
    const b = segment('c', '2026-09-30T18:00:00Z', '2026-10-01T00:00:00Z', { groupId: 'g' });
    const result = buildSleepInsights([b, overlap, a], 7, '2026-10-01', zone);
    expect(result.nights).toMatchObject({ count: 1, completedDays: 1 });
    expect(result.nights.nightly).toEqual([{
      groupId: 'g', date: '2026-10-01', durationMinutes: 510,
      bedtimeMinute: 22 * 60, wakeMinute: 8 * 60,
    }]);
    expect(result.onset.missingCount).toBe(1);
  });

  it('uses inclusive 7/30-day boundaries, final local wake dates, and keeps naps separate', () => {
    const at7 = segment('seven', '2026-09-24T15:00:00Z', '2026-09-24T23:00:00Z', { groupId: null });
    const at30 = segment('thirty', '2026-08-31T15:00:00Z', '2026-08-31T23:00:00Z');
    const older = segment('old', '2026-08-30T15:00:00Z', '2026-08-30T23:00:00Z');
    const nap = segment('nap', '2026-10-01T05:00:00Z', '2026-10-01T05:30:00Z', { kind: 'nap', groupId: null });
    const all = [at7, at30, older, nap];
    expect(buildSleepInsights(all, 7, '2026-10-01', zone)).toMatchObject({ nights: { count: 1 }, naps: { count: 1, days: 1, totalMinutes: 30 } });
    expect(buildSleepInsights(all, 30, '2026-10-01', zone)).toMatchObject({ startDate: '2026-09-02', nights: { count: 1 } });
    // 30 days including October 1 begins September 2; September 1 is excluded.
    expect(buildSleepInsights([segment('edge', '2026-09-01T15:00:00Z', '2026-09-01T23:00:00Z')], 30, '2026-10-01', zone).nights.count).toBe(1);
  });

  it('excludes an entire mixed-status group and malformed durations; counts exclusion explicitly', () => {
    const okay = segment('a', '2026-09-30T14:00:00Z', '2026-09-30T16:00:00Z', { groupId: 'mixed' });
    const uncertain = segment('b', '2026-09-30T18:00:00Z', '2026-10-01T00:00:00Z', { groupId: 'mixed', status: 'uncertain' });
    const invalid = segment('bad', '2026-10-01T02:00:00Z', '2026-10-01T01:00:00Z');
    const active = segment('active', '2026-09-30T22:00:00Z', '2026-10-01T01:00:00Z', { status: 'active', endAt: null });
    const result = buildSleepInsights([okay, uncertain, invalid, active], 7, '2026-10-01', zone);
    expect(result.nights.count).toBe(0);
    expect(result.completeness).toMatchObject({ excludedGroups: 2, excludedSegments: 2 });
  });

  it('uses the analysis timezone for both window inclusion and clock minutes near a travel boundary', () => {
    const boundary = segment('boundary', '2026-09-24T14:00:00Z', '2026-09-24T16:30:00Z');
    const travel = segment('travel', '2026-09-30T14:00:00Z', '2026-09-30T16:30:00Z', {
      startTimezone: 'America/Los_Angeles', endTimezone: 'Asia/Tokyo',
    });
    const shanghai = buildSleepInsights([boundary, travel], 7, '2026-10-01', zone);
    expect(shanghai.nights.nightly).toEqual([
      { groupId: 'boundary', date: '2026-09-25', durationMinutes: 150, bedtimeMinute: 22 * 60, wakeMinute: 30 },
      { groupId: 'travel', date: '2026-10-01', durationMinutes: 150, bedtimeMinute: 22 * 60, wakeMinute: 30 },
    ]);
    const losAngeles = buildSleepInsights([boundary, travel], 7, '2026-10-01', 'America/Los_Angeles');
    expect(losAngeles.nights.nightly).toEqual([
      { groupId: 'travel', date: '2026-09-30', durationMinutes: 150, bedtimeMinute: 7 * 60, wakeMinute: 9 * 60 + 30 },
    ]);
  });

  it('does not call an unfinished continuation an inaccurate record', () => {
    const finished = segment('finished', '2026-09-30T14:00:00Z', '2026-09-30T16:00:00Z', { groupId: 'continuation' });
    const active = segment('active', '2026-09-30T18:00:00Z', '2026-09-30T20:00:00Z', { groupId: 'continuation', status: 'active', endAt: null });
    const result = buildSleepInsights([finished, active], 7, '2026-10-01', zone);
    expect(result.nights.count).toBe(0);
    expect(result.completeness.excludedGroups).toBe(0);
  });

  it('counts malformed timestamp groups in range as exclusions when a date can be inferred', () => {
    const badEnd = segment('bad-end', '2026-09-30T14:00:00Z', 'not-a-date');
    const badStart = segment('bad-start', 'not-a-date', '2026-10-01T00:00:00Z');
    const bothBad = segment('both-bad', 'not-a-date', 'also-not-a-date');
    const old = segment('old', '2026-09-20T14:00:00Z', 'bad');
    const validPart = segment('part', '2026-09-30T14:00:00Z', '2026-09-30T16:00:00Z', { groupId: 'mixed' });
    const malformedPart = segment('bad-part', 'bad', '2026-10-01T00:00:00Z', { groupId: 'mixed' });
    const result = buildSleepInsights([badEnd, badStart, bothBad, old, validPart, malformedPart], 7, '2026-10-01', zone);
    expect(result.nights.count).toBe(0);
    expect(result.completeness).toMatchObject({ excludedGroups: 3, excludedSegments: 3, undatedGroups: 1, undatedSegments: 1 });
  });

  it('counts only answered reflections, with unknown distinct from missing', () => {
    const empty = withBands(segment('empty', '2026-09-28T15:00:00Z', '2026-09-28T23:00:00Z'), {});
    const unknown = withBands(segment('unknown', '2026-09-29T15:00:00Z', '2026-09-29T23:00:00Z'), {
      sleepOnsetBand: 'unknown', nightAwakeningBand: 'unknown',
    });
    const absent = segment('absent', '2026-09-30T15:00:00Z', '2026-09-30T23:00:00Z');
    const result = buildSleepInsights([empty, unknown, absent], 7, '2026-10-01', zone);
    expect(result.completeness).toMatchObject({ nightsWithoutReflection: 2, nightsWithReflection: 1 });
    expect(result.onset).toMatchObject({ counts: { unknown: 1 }, sampleCount: 0, unknownCount: 1, missingCount: 2 });
    expect(result.awakening).toMatchObject({ counts: { unknown: 1 }, sampleCount: 0, unknownCount: 1, missingCount: 2 });
  });

  it('retains the denominator without calling a single co-occurrence multiple records', () => {
    const records = Array.from({ length: 3 }, (_, i) => {
      const start = new Date(Date.UTC(2026, 8, 27 + i, 15));
      const entry = withBands(segment(`paired${i}`, start.toISOString(), new Date(start.getTime() + 8 * 3600000).toISOString()), {
        sleepOnsetBand: i === 0 ? 'over_60' : 'under_15',
      });
      entry.reflection = { ...entry.reflection!, wakeEnergy: i === 0 ? 2 : 4 };
      return entry;
    });
    const result = buildSleepInsights(records, 7, '2026-10-01', zone);
    const message = result.messages.find((item) => item.text.includes('同时出现'));
    expect(message).toMatchObject({ sampleCount: 3, text: expect.stringContaining('1/3晚') });
    expect(message?.text).not.toContain('多次记录');
  });

  it('counts each reflection category once per night, ignores missing/invalid scores, and computes averages', () => {
    const first = withBands(segment('a', '2026-09-29T15:00:00Z', '2026-09-29T23:00:00Z'), { sleepOnsetBand: '30_to_60', nightAwakeningBand: 'multiple_or_long' });
    first.reflection = { ...first.reflection!, wakeEnergy: 2, daytimeEnergy: 4, alarmUsed: true };
    const second = withBands(segment('b', '2026-09-30T15:00:00Z', '2026-09-30T23:00:00Z'), { sleepOnsetBand: 'over_60', nightAwakeningBand: 'none' });
    second.reflection = { ...second.reflection!, wakeEnergy: 4, daytimeEnergy: 0, alarmUsed: false };
    const third = segment('c', '2026-09-28T15:00:00Z', '2026-09-28T23:00:00Z');
    const result = buildSleepInsights([first, second, third], 7, '2026-10-01', zone);
    expect(result.onset).toMatchObject({ counts: { '30_to_60': 1, over_60: 1 }, sampleCount: 2, missingCount: 1 });
    expect(result.awakening).toMatchObject({ counts: { multiple_or_long: 1, none: 1 }, sampleCount: 2, missingCount: 1 });
    expect(result.alarm).toEqual({ yes: 1, no: 1, missingCount: 1 });
    expect(result.wakeEnergy).toEqual({ sampleCount: 2, missingCount: 1, average: 3 });
    expect(result.daytimeEnergy).toEqual({ sampleCount: 1, missingCount: 2, average: 4 });
    expect(result.messages.every((message) => message.text.includes('不足'))).toBe(true);
  });

  it('emits threshold evidence only with sufficient denominators and reports co-occurrence without causality', () => {
    const nights = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(Date.UTC(2026, 8, 24 + i, 15 + (i % 2) * 2));
      const start = date.toISOString();
      const end = new Date(date.getTime() + (i < 3 ? 6 : 8) * 3600000).toISOString();
      const value = withBands(segment(`n${i}`, start, end), {
        sleepOnsetBand: i < 2 ? '30_to_60' : '15_to_30',
        nightAwakeningBand: i < 3 ? 'multiple_or_long' : 'none',
      });
      value.reflection = { ...value.reflection!, wakeEnergy: i < 3 ? 2 : 4 };
      return value;
    });
    const result = buildSleepInsights(nights, 7, '2026-10-01', zone);
    expect(result.messages.map((message) => message.text).join(' ')).toMatch(/夜醒.*3\/7/);
    expect(result.messages.some((message) => message.text.includes('入睡耗时30分钟以上'))).toBe(false);
    expect(result.messages.filter((message) => message.text.includes('时刻波动'))).toHaveLength(2);
    const triggered = result.messages.filter((message) => !message.text.includes('不足'));
    expect(triggered.every((message) => message.text.includes('近期多次记录显示') && message.text.includes('2026-09-25～2026-10-01'))).toBe(true);
    expect(triggered.find((message) => message.text.includes('开始记录时刻'))).toMatchObject({ sampleCount: 7 });
    expect(triggered.some((message) => message.text.includes('就寝时刻'))).toBe(false);
    expect(result.messages.map((message) => message.text).join(' ')).toMatch(/3晚的记录时长/);
    expect(result.messages.map((message) => message.text).join(' ')).toContain('同时');
    expect(result.messages.map((message) => message.text).join(' ')).not.toMatch(/导致|诊断|疾病/);
    expect(result.messages.some((message) => message.sampleCount === 7)).toBe(true);
  });

  it('uses strict onset/awakening thresholds and excludes unknown from informative samples', () => {
    const dates = Array.from({ length: 5 }, (_, i) => {
      const start = new Date(Date.UTC(2026, 8, 25 + i, 15));
      return withBands(segment(`threshold${i}`, start.toISOString(), new Date(start.getTime() + 8 * 3600000).toISOString()), {
        sleepOnsetBand: i < 2 ? 'over_60' : i === 4 ? 'unknown' : 'under_15',
        nightAwakeningBand: i < 2 ? 'multiple_or_long' : 'one_or_two',
      });
    });
    const result = buildSleepInsights(dates, 7, '2026-10-01', zone);
    expect(result.onset).toMatchObject({ counts: { unknown: 1, over_60: 2, under_15: 2 }, sampleCount: 4, missingCount: 0 });
    expect(result.messages.some((m) => m.text.includes('入睡耗时30分钟以上'))).toBe(false); // 2/4 is not > half
    expect(result.messages.some((m) => m.text.includes('多次或较长夜醒'))).toBe(false); // 2/5 is not > 40%
    const positive = buildSleepInsights(dates.slice(0, 3), 7, '2026-10-01', zone);
    expect(positive.messages.some((m) => m.text.includes('入睡耗时30分钟以上') && m.sampleCount === 3)).toBe(true);
    expect(positive.messages.some((m) => m.text.includes('多次或较长夜醒') && m.sampleCount === 3)).toBe(true);
    expect(positive.messages.filter((m) => !m.text.includes('不足')).every((m) => m.text.includes('近期多次记录显示') && m.text.includes('2/3晚'))).toBe(true);
    const insufficient = buildSleepInsights(dates.slice(0, 2), 7, '2026-10-01', zone);
    expect(insufficient.messages.every((m) => m.text.includes('不足'))).toBe(true);
  });

  it('uses the shortest circular clock arc across midnight rather than a linear range', () => {
    const dates = Array.from({ length: 7 }, (_, i) => {
      const start = new Date(Date.UTC(2026, 8, 24 + i, i % 2 ? 16 : 15, 30));
      return segment(`clock${i}`, start.toISOString(), new Date(start.getTime() + 8 * 3600000).toISOString());
    });
    const result = buildSleepInsights(dates, 7, '2026-10-01', zone);
    expect(result.bedtimeRange).toEqual({ startMinute: 23 * 60 + 30, endMinute: 30, spanMinutes: 60, sampleCount: 7 });
    expect(result.wakeTimeRange?.spanMinutes).toBe(60);
    expect(result.messages.some((message) => message.text.includes('波动'))).toBe(false);
  });
});
