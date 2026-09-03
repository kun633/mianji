import { durationMs, type SleepSegment } from './sleep';

export interface SleepGroup {
  key: string;
  kind: SleepSegment['kind'];
  date: string;
  timezone: string;
  segments: SleepSegment[];
  totalMs: number;
}

export interface SleepStats {
  days: Array<{ date: string; nightMs: number; napMs: number; totalMs: number }>;
  averageNightMs: number;
  averageNapMs: number;
  averageTotalMs: number;
  excludedCount: number;
}

export const formatDuration = (milliseconds: number | null): string => {
  if (milliseconds === null || milliseconds <= 0) return '0分';
  const totalMinutes = Math.round(milliseconds / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}分`;
  return `${hours}小时${minutes}分`;
};

export function displayDate(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

function segmentDurationForTotals(segment: SleepSegment): number {
  if (segment.status !== 'completed' || !segment.endAt) return 0;
  const milliseconds = Date.parse(segment.endAt) - Date.parse(segment.startAt);
  return Number.isFinite(milliseconds) && milliseconds >= 0 ? milliseconds : 0;
}

/** Groups night segments by their explicit group and assigns the group's date
 * from its final segment. Naps remain one group per segment. */
export function groupSleepSegments(segments: SleepSegment[]): SleepGroup[] {
  const grouped = new Map<string, SleepSegment[]>();
  for (const segment of segments) {
    if (segment.status === 'active') continue;
    const key = segment.kind === 'night'
      ? `night:${segment.groupId ?? segment.id}`
      : `nap:${segment.id}`;
    const list = grouped.get(key) ?? [];
    list.push(segment);
    grouped.set(key, list);
  }

  return [...grouped.entries()].map(([key, values]) => {
    const ordered = [...values].sort((left, right) => {
      const leftTime = Date.parse(left.endAt ?? left.startAt);
      const rightTime = Date.parse(right.endAt ?? right.startAt);
      return leftTime - rightTime || left.startAt.localeCompare(right.startAt);
    });
    const final = ordered[ordered.length - 1];
    const finalTimezone = final.endTimezone ?? final.startTimezone;
    return {
      key,
      kind: final.kind,
      date: displayDate(final.endAt ?? final.startAt, finalTimezone),
      timezone: finalTimezone,
      segments: ordered,
      totalMs: ordered.reduce((sum, segment) => sum + segmentDurationForTotals(segment), 0),
    };
  }).sort((left, right) => right.date.localeCompare(left.date) || left.key.localeCompare(right.key));
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

  for (const group of groupSleepSegments(segments)) {
    if (!allowed.has(group.date)) continue;
    excludedCount += group.segments.filter((segment) => segment.status !== 'completed').length;
    if (group.totalMs === 0) continue;
    const day = totals.get(group.date) ?? { date: group.date, nightMs: 0, napMs: 0, totalMs: 0 };
    if (group.kind === 'night') day.nightMs += group.totalMs;
    else day.napMs += group.totalMs;
    day.totalMs += group.totalMs;
    totals.set(group.date, day);
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
