export type SleepKind = 'night' | 'nap';
export type SleepStatus = 'active' | 'completed' | 'uncertain' | 'invalid';

export interface SleepReflection {
  sleepOnsetAt: string | null;
  alarmUsed: boolean | null;
  wakeEnergy: number | null;
  daytimeEnergy: number | null;
}

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
  reflection?: SleepReflection;
}

export function saveReflection(segment: SleepSegment, reflection: SleepReflection, now: string): SleepSegment {
  if (segment.kind !== 'night' || segment.status !== 'completed' || !segment.endAt) {
    throw new Error('只能补记已完成的夜间睡眠');
  }
  const validEnergy = (value: number | null) => value === null || (Number.isInteger(value) && value >= 1 && value <= 5);
  if (!validEnergy(reflection.wakeEnergy) || !validEnergy(reflection.daytimeEnergy) ||
      (reflection.alarmUsed !== null && typeof reflection.alarmUsed !== 'boolean')) {
    throw new Error('补记评分无效');
  }
  if (reflection.sleepOnsetAt !== null) {
    const onset = Date.parse(reflection.sleepOnsetAt);
    if (!Number.isFinite(onset) || onset < Date.parse(segment.startAt) || onset > Date.parse(segment.endAt)) {
      throw new Error('估计入睡时间应在开始与起床时间之间');
    }
  }
  return { ...segment, reflection: { ...reflection }, updatedAt: now };
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
  const elapsed = Date.parse(now) - Date.parse(segment.finishedAt);
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 60_000) throw new Error('undo window expired');
  return { ...segment, endAt: null, endTimezone: null, status: 'active', finishedAt: null, updatedAt: now, reflection: undefined };
}

export function markUncertain(segment: SleepSegment, reason: string): SleepSegment {
  if (!segment.endAt) throw new Error('active segment cannot be marked uncertain');
  return { ...segment, status: 'uncertain', uncertainReason: reason, updatedAt: segment.endAt, reflection: undefined };
}

export function resumeSegment(segment: SleepSegment, now: string): SleepSegment {
  if (segment.status !== 'completed' && segment.status !== 'uncertain') {
    throw new Error('只有已完成的记录可以恢复为记录中');
  }
  return {
    ...segment,
    endAt: null,
    endTimezone: null,
    status: 'active',
    finishedAt: null,
    uncertainReason: null,
    updatedAt: now,
    reflection: undefined,
  };
}

export function extendWake(segment: SleepSegment, now: string, timezone: string): SleepSegment {
  if (segment.status !== 'completed' && segment.status !== 'uncertain') {
    throw new Error('记录尚未完成');
  }
  if (Date.parse(now) < Date.parse(segment.startAt)) {
    throw new Error('当前时间早于开始时间');
  }
  return {
    ...segment,
    endAt: now,
    endTimezone: timezone,
    status: 'completed',
    finishedAt: now,
    updatedAt: now,
    reflection: undefined,
  };
}

export function durationMs(segment: SleepSegment): number | null {
  return segment.endAt ? Math.max(0, Date.parse(segment.endAt) - Date.parse(segment.startAt)) : null;
}

