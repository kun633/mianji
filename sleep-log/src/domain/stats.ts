import { durationMs, type SleepSegment } from './sleep';

export interface SleepStats {
  days: Array<{ date: string; nightMs: number; napMs: number; totalMs: number }>;
  averageNightMs: number;
  averageNapMs: number;
  averageTotalMs: number;
  excludedCount: number;
}

export function displayDate(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

export function buildStats(segments: SleepSegment[], rangeDays: 7 | 30, today: string, timezone: string): SleepStats {
  const anchor = new Date(`${today}T12:00:00.000Z`);
  const allowed = new Set(Array.from({ length: rangeDays }, (_, index) => {
    const date = new Date(anchor);
    date.setUTCDate(date.getUTCDate() - index);
    return date.toISOString().slice(0, 10);
  }));
  const totals = new Map<string, { date: string; nightMs: number; napMs: number; totalMs: number }>();
  let excludedCount = 0;

  for (const segment of segments) {
    if (!segment.endAt) continue;
    const date = displayDate(segment.endAt, timezone);
    if (!allowed.has(date)) continue;
    if (segment.status !== 'completed') {
      excludedCount += 1;
      continue;
    }
    const ms = durationMs(segment) ?? 0;
    const day = totals.get(date) ?? { date, nightMs: 0, napMs: 0, totalMs: 0 };
    if (segment.kind === 'night') day.nightMs += ms;
    else day.napMs += ms;
    day.totalMs += ms;
    totals.set(date, day);
  }

  const days = [...totals.values()].sort((a, b) => a.date.localeCompare(b.date));
  const average = (values: number[]) => values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;

  return {
    days,
    averageNightMs: average(days.map((day) => day.nightMs).filter(Boolean)),
    averageNapMs: average(days.map((day) => day.napMs).filter(Boolean)),
    averageTotalMs: average(days.map((day) => day.totalMs).filter(Boolean)),
    excludedCount,
  };
}
