import type { SleepReflection, SleepSegment } from './sleep';

// Keep this slice independent of the reflection editor; the optional bands are
// read structurally until SleepReflection itself gains these fields.
export type SleepOnsetBand = 'under_15' | '15_to_30' | '30_to_60' | 'over_60' | 'unknown';
export type NightAwakeningBand = 'none' | 'one_or_two' | 'multiple_or_long' | 'unknown';
type InsightReflection = SleepReflection & {
  sleepOnsetBand?: SleepOnsetBand | null;
  nightAwakeningBand?: NightAwakeningBand | null;
};

export interface InsightDistribution<Band extends string = string> {
  counts: Record<Band, number>;
  /** Informative responses only; 'unknown' is counted in counts but excluded here. */
  sampleCount: number;
  missingCount: number;
}
export interface InsightScore {
  sampleCount: number;
  missingCount: number;
  average: number | null;
}
export interface CircularClockRange {
  startMinute: number;
  endMinute: number;
  spanMinutes: number;
  sampleCount: number;
}
export interface NightlyInsight {
  groupId: string;
  date: string;
  /** Recorded intervals only; gaps are not assumed to be sleep. */
  durationMinutes: number;
  bedtimeMinute: number;
  wakeMinute: number;
}
export interface SleepInsights {
  rangeDays: 7 | 30;
  startDate: string;
  endDate: string;
  nights: { count: number; completedDays: number; averageDurationMinutes: number | null; nightly: NightlyInsight[] };
  naps: { count: number; days: number; totalMinutes: number; averageDurationMinutes: number | null };
  onset: InsightDistribution<SleepOnsetBand>;
  awakening: InsightDistribution<NightAwakeningBand>;
  alarm: { yes: number; no: number; missingCount: number };
  wakeEnergy: InsightScore;
  daytimeEnergy: InsightScore;
  bedtimeRange: CircularClockRange | null;
  wakeTimeRange: CircularClockRange | null;
  completeness: {
    excludedGroups: number;
    excludedSegments: number;
    nightsWithoutReflection: number;
    nightsWithReflection: number;
  };
  messages: Array<{ text: string; sampleCount: number }>;
}

const DAY_MS = 86_400_000;
function localParts(iso: string, timezone: string): { date: string; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const part = (key: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === key)!.value;
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    minute: Number(part('hour')) * 60 + Number(part('minute')),
  };
}

function clockRange(values: number[]): CircularClockRange | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  let largestGap = -1;
  let gapIndex = 0;
  for (let i = 0; i < sorted.length; i++) {
    const gap = (sorted[(i + 1) % sorted.length] + (i === sorted.length - 1 ? 1440 : 0)) - sorted[i];
    if (gap > largestGap) { largestGap = gap; gapIndex = i; }
  }
  return {
    startMinute: sorted[(gapIndex + 1) % sorted.length], endMinute: sorted[gapIndex],
    spanMinutes: 1440 - largestGap, sampleCount: values.length,
  };
}

function recordedMinutes(segments: SleepSegment[]): number {
  const intervals = segments.map((segment) => [Date.parse(segment.startAt), Date.parse(segment.endAt!)] as const)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let from = intervals[0][0];
  let to = intervals[0][1];
  for (const [start, end] of intervals.slice(1)) {
    if (start <= to) to = Math.max(to, end);
    else { total += to - from; from = start; to = end; }
  }
  return (total + to - from) / 60_000;
}

function distribution<Band extends string>(bands: readonly Band[]): InsightDistribution<Band> {
  return { counts: Object.fromEntries(bands.map((band) => [band, 0])) as Record<Band, number>, sampleCount: 0, missingCount: 0 };
}
function addBand<Band extends string>(target: InsightDistribution<Band>, value: Band | null | undefined) {
  if (!value) { target.missingCount++; return; }
  target.counts[value] = (target.counts[value] ?? 0) + 1;
  if (value !== 'unknown') target.sampleCount++;
}
function score(values: Array<number | null>): InsightScore {
  const present = values.filter((value): value is number => value !== null);
  return {
    sampleCount: present.length, missingCount: values.length - present.length,
    average: present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : null,
  };
}
function validScore(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5 ? value : null;
}
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Pure, inclusive local-calendar window: today and the preceding 6 or 29 days. */
export function buildSleepInsights(segments: SleepSegment[], rangeDays: 7 | 30, today: string, timezone: string): SleepInsights {
  const dateAnchor = Date.parse(`${today}T00:00:00.000Z`);
  const startDate = new Date(dateAnchor - (rangeDays - 1) * DAY_MS).toISOString().slice(0, 10);
  const grouped = new Map<string, SleepSegment[]>();
  for (const segment of segments) {
    const key = `${segment.kind}:${segment.kind === 'night' ? segment.groupId ?? segment.id : segment.id}`;
    const members = grouped.get(key) ?? [];
    members.push(segment);
    grouped.set(key, members);
  }

  const nights: NightlyInsight[] = [];
  const napDates = new Set<string>();
  let napCount = 0;
  let napMinutes = 0;
  let excludedGroups = 0;
  let excludedSegments = 0;
  const onset = distribution(['under_15', '15_to_30', '30_to_60', 'over_60', 'unknown'] as const);
  const awakening = distribution(['none', 'one_or_two', 'multiple_or_long', 'unknown'] as const);
  const alarm = { yes: 0, no: 0, missingCount: 0 };
  const wakeScores: Array<number | null> = [];
  const dayScores: Array<number | null> = [];
  const paired: Array<{ wake: number | null; day: number | null; onset?: SleepOnsetBand | null; awakening?: NightAwakeningBand | null }> = [];
  let nightsWithoutReflection = 0;

  for (const [key, members] of grouped) {
    const sorted = [...members].sort((a, b) => Date.parse(a.endAt ?? a.startAt) - Date.parse(b.endAt ?? b.startAt));
    const final = sorted[sorted.length - 1];
    const lastEnd = final.endAt ?? final.startAt;
    if (!Number.isFinite(Date.parse(lastEnd))) continue;
    const date = localParts(lastEnd, final.endTimezone ?? final.startTimezone ?? timezone).date;
    if (date < startDate || date > today) continue;
    const valid = sorted.every((s) => s.status === 'completed' && s.endAt !== null &&
      Number.isFinite(Date.parse(s.startAt)) && Number.isFinite(Date.parse(s.endAt)) &&
      Date.parse(s.endAt) > Date.parse(s.startAt));
    if (!valid) {
      // Active records have no final wake yet, so they are not a completed group.
      if (!sorted.some((s) => s.status === 'active')) {
        excludedGroups++;
        excludedSegments += sorted.filter((s) => s.status === 'uncertain' || s.status === 'invalid' ||
          (s.status === 'completed' && (!s.endAt || Date.parse(s.endAt) <= Date.parse(s.startAt) ||
            !Number.isFinite(Date.parse(s.startAt)) || !Number.isFinite(Date.parse(s.endAt))))).length;
      }
      continue;
    }

    const minutes = recordedMinutes(sorted);
    if (final.kind === 'nap') {
      napCount++;
      napDates.add(date);
      napMinutes += minutes;
      continue;
    }

    const first = [...sorted].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))[0];
    nights.push({
      groupId: key.slice('night:'.length), date, durationMinutes: minutes,
      bedtimeMinute: localParts(first.startAt, first.startTimezone ?? timezone).minute,
      wakeMinute: localParts(lastEnd, final.endTimezone ?? final.startTimezone ?? timezone).minute,
    });
    // Each answer is taken at most once per night, from its latest segment with
    // that answer; a later partial reflection must not erase an earlier answer.
    const reflections = sorted.map((s) => s.reflection as InsightReflection | undefined).reverse();
    if (reflections.every((r) => !r)) nightsWithoutReflection++;
    const field = <K extends keyof InsightReflection>(name: K): InsightReflection[K] | undefined =>
      reflections.find((r) => r?.[name] !== null && r?.[name] !== undefined)?.[name];
    const onsetBand = field('sleepOnsetBand');
    const awakeningBand = field('nightAwakeningBand');
    addBand(onset, onsetBand);
    addBand(awakening, awakeningBand);
    const alarmValue = field('alarmUsed');
    if (alarmValue === true) alarm.yes++;
    else if (alarmValue === false) alarm.no++;
    else alarm.missingCount++;
    const wake = validScore(field('wakeEnergy'));
    const day = validScore(field('daytimeEnergy'));
    wakeScores.push(wake);
    dayScores.push(day);
    paired.push({ wake, day, onset: onsetBand, awakening: awakeningBand });
  }

  nights.sort((a, b) => a.date.localeCompare(b.date) || a.groupId.localeCompare(b.groupId));
  const bedtimeRange = clockRange(nights.map((night) => night.bedtimeMinute));
  const wakeTimeRange = clockRange(nights.map((night) => night.wakeMinute));
  const messages: SleepInsights['messages'] = [];
  const window = `${startDate}～${today}`;
  if (nights.length === 0) messages.push({ text: `${window}：有效夜间记录不足，暂无可分析样本（0晚）。`, sampleCount: 0 });
  else {
    const slowOnset = (onset.counts['30_to_60'] ?? 0) + (onset.counts.over_60 ?? 0);
    if (onset.sampleCount < 3) messages.push({ text: `${window}：入睡耗时回答不足3晚（${onset.sampleCount}晚），暂不判断趋势。`, sampleCount: onset.sampleCount });
    else if (slowOnset > onset.sampleCount / 2) messages.push({ text: `近期多次记录显示（${window}）：入睡耗时30分钟以上的回答为${slowOnset}/${onset.sampleCount}晚。`, sampleCount: onset.sampleCount });
    const frequent = awakening.counts.multiple_or_long ?? 0;
    if (awakening.sampleCount < 3) messages.push({ text: `${window}：夜醒回答不足3晚（${awakening.sampleCount}晚），暂不判断趋势。`, sampleCount: awakening.sampleCount });
    else if (frequent > awakening.sampleCount * 0.4) messages.push({ text: `近期多次记录显示（${window}）：多次或较长夜醒的回答为${frequent}/${awakening.sampleCount}晚。`, sampleCount: awakening.sampleCount });
    if (nights.length >= 7) {
      if (bedtimeRange && bedtimeRange.spanMinutes > 90) messages.push({ text: `近期多次记录显示（${window}）：${nights.length}晚的开始记录时刻波动范围为${bedtimeRange.spanMinutes}分钟。`, sampleCount: nights.length });
      if (wakeTimeRange && wakeTimeRange.spanMinutes > 90) messages.push({ text: `近期多次记录显示（${window}）：${nights.length}晚的结束记录时刻波动范围为${wakeTimeRange.spanMinutes}分钟。`, sampleCount: nights.length });
      const baseline = median(nights.map((night) => night.durationMinutes));
      const shorter = nights.filter((night) => baseline - night.durationMinutes >= 90).length;
      if (shorter >= 3) messages.push({ text: `近期多次记录显示（${window}）：${nights.length}晚中有${shorter}晚的记录时长比中位数短至少90分钟。`, sampleCount: nights.length });
    }
    const coObserved = paired.filter((r) => (r.wake !== null || r.day !== null) &&
      ((onset.sampleCount >= 3 && r.onset !== undefined && r.onset !== null && r.onset !== 'unknown') ||
        (awakening.sampleCount >= 3 && r.awakening !== undefined && r.awakening !== null && r.awakening !== 'unknown')));
    const pairedCount = coObserved.length;
    const lowTogether = coObserved.filter((r) =>
      ((r.wake !== null && r.wake <= 2) || (r.day !== null && r.day <= 2)) &&
      ((onset.sampleCount >= 3 && (r.onset === '30_to_60' || r.onset === 'over_60')) ||
        (awakening.sampleCount >= 3 && r.awakening === 'multiple_or_long'))).length;
    if (pairedCount < 3) messages.push({
      text: `${window}：能量评分与入睡/夜醒回答同时存在的样本不足3晚（${pairedCount}晚），暂不判断共同出现情况。`,
      sampleCount: pairedCount,
    });
    else if (lowTogether > 0) messages.push({
      text: `近期多次记录显示（${window}）：${pairedCount}晚有能量评分及入睡/夜醒回答，其中${lowTogether}/${pairedCount}晚低能量（1～2分）与较慢入睡或多次/较长夜醒同时出现；仅为共同出现的记录。`,
      sampleCount: pairedCount,
    });
  }

  return {
    rangeDays, startDate, endDate: today,
    nights: {
      count: nights.length, completedDays: new Set(nights.map((night) => night.date)).size,
      averageDurationMinutes: nights.length ? nights.reduce((sum, night) => sum + night.durationMinutes, 0) / nights.length : null,
      nightly: nights,
    },
    naps: { count: napCount, days: napDates.size, totalMinutes: napMinutes, averageDurationMinutes: napCount ? napMinutes / napCount : null },
    onset, awakening, alarm,
    wakeEnergy: score(wakeScores), daytimeEnergy: score(dayScores),
    bedtimeRange, wakeTimeRange,
    completeness: { excludedGroups, excludedSegments, nightsWithoutReflection, nightsWithReflection: nights.length - nightsWithoutReflection },
    messages,
  };
}
