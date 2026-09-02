export type SleepKind = 'night' | 'nap';
export type SleepStatus = 'active' | 'completed' | 'uncertain' | 'invalid';

export interface SleepSegment {
  id: string;
  kind: SleepKind;
  groupId: string | null;
  startAt: string;
  startTimezone: string;
  endAt: string | null;
  endTimezone: string | null;
  status: SleepStatus;
  uncertainReason: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  schemaVersion: 1;
}

export function createSegment(input: { id: string; kind: SleepKind; groupId: string | null; now: string; timezone: string }): SleepSegment {
  return { id: input.id, kind: input.kind, groupId: input.groupId, startAt: input.now, startTimezone: input.timezone, endAt: null, endTimezone: null, status: 'active', uncertainReason: null, createdAt: input.now, updatedAt: input.now, finishedAt: null, schemaVersion: 1 };
}

export function resetStart(segment: SleepSegment, now: string, timezone: string): SleepSegment {
  if (segment.status !== 'active') throw new Error('completed timestamps are immutable');
  return { ...segment, startAt: now, startTimezone: timezone, updatedAt: now };
}

export function finishSegment(segment: SleepSegment, now: string, timezone: string): SleepSegment {
  if (segment.status !== 'active') throw new Error('segment is not active');
  const status: SleepStatus = Date.parse(now) < Date.parse(segment.startAt) ? 'invalid' : 'completed';
  return { ...segment, endAt: now, endTimezone: timezone, status, finishedAt: now, updatedAt: now };
}

export function undoFinish(segment: SleepSegment, now: string): SleepSegment {
  if (!segment.finishedAt || segment.status !== 'completed') throw new Error('segment cannot be undone');
  if (Date.parse(now) - Date.parse(segment.finishedAt) > 60_000) throw new Error('undo window expired');
  return { ...segment, endAt: null, endTimezone: null, status: 'active', finishedAt: null, updatedAt: now };
}

export function markUncertain(segment: SleepSegment, reason: string): SleepSegment {
  if (!segment.endAt) throw new Error('active segment cannot be marked uncertain');
  return { ...segment, status: 'uncertain', uncertainReason: reason, updatedAt: segment.endAt };
}

export function durationMs(segment: SleepSegment): number | null {
  return segment.endAt ? Math.max(0, Date.parse(segment.endAt) - Date.parse(segment.startAt)) : null;
}
