import type { SleepSegment, SleepKind, SleepStatus } from '../domain/sleep';
import { isSleepPlan, type SleepPlan } from '../domain/sleep-plan';

export type SleepBackup =
  | { app: '眠记'; version: 1; exportedAt: string; segments: SleepSegment[] }
  | { app: '眠记'; version: 2; exportedAt: string; segments: SleepSegment[]; plan: SleepPlan | null };
export interface MergeConflict { current: SleepSegment; incoming: SleepSegment; }
export type ConflictResolution = 'keep-current' | 'use-backup';

export function createBackup(segments: SleepSegment[], exportedAt = new Date().toISOString(), plan: SleepPlan | null = null): string {
  return JSON.stringify({ app: '眠记', version: 2, exportedAt, segments, plan } satisfies SleepBackup, null, 2);
}

const kinds: SleepKind[] = ['night', 'nap'];
const statuses: SleepStatus[] = ['active', 'completed', 'uncertain', 'invalid'];
const isString = (value: unknown): value is string => typeof value === 'string';
const isNullableString = (value: unknown): value is string | null => value === null || isString(value);
const segmentFields = ['id', 'kind', 'groupId', 'startAt', 'startTimezone', 'endAt', 'endTimezone', 'status', 'uncertainReason', 'createdAt', 'updatedAt', 'finishedAt', 'schemaVersion'] as const;
const reflectionFields = ['sleepOnsetAt', 'alarmUsed', 'wakeEnergy', 'daytimeEnergy'];
const isoTime = (value: unknown): value is string => {
  if (!isString(value)) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth
    && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59
    && Number.isFinite(Date.parse(value));
};
const sameKeys = (value: Record<string, unknown>, allowed: readonly string[]) => {
  const keys = Object.keys(value).sort();
  return keys.length === allowed.length && keys.every((key, index) => key === [...allowed].sort()[index]);
};

function isSleepSegment(value: unknown): value is SleepSegment {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  const reflection = item.reflection;
  const validReflection = reflection === undefined || (reflection !== null && typeof reflection === 'object' &&
    sameKeys(reflection as Record<string, unknown>, reflectionFields) &&
    ((reflection as Record<string, unknown>).sleepOnsetAt === null || isoTime((reflection as Record<string, unknown>).sleepOnsetAt)) &&
    [null, true, false].includes((reflection as Record<string, unknown>).alarmUsed as null | boolean) &&
    ['wakeEnergy', 'daytimeEnergy'].every((key) => (reflection as Record<string, unknown>)[key] === null ||
      (Number.isInteger((reflection as Record<string, unknown>)[key]) && Number((reflection as Record<string, unknown>)[key]) >= 1 && Number((reflection as Record<string, unknown>)[key]) <= 5)));
  return sameKeys(item, reflection === undefined ? segmentFields : [...segmentFields, 'reflection']) && validReflection &&
    (reflection === undefined || (item.kind === 'night' && item.status === 'completed' && item.endAt !== null &&
      ((reflection as Record<string, unknown>).sleepOnsetAt === null ||
        (Date.parse((reflection as Record<string, unknown>).sleepOnsetAt as string) >= Date.parse(item.startAt as string) &&
         Date.parse((reflection as Record<string, unknown>).sleepOnsetAt as string) <= Date.parse(item.endAt as string))))) &&
    isString(item.id) && kinds.includes(item.kind as SleepKind) && isNullableString(item.groupId)
    && isoTime(item.startAt) && isString(item.startTimezone) && (item.endAt === null || isoTime(item.endAt))
    && (item.endTimezone === null || isString(item.endTimezone)) && statuses.includes(item.status as SleepStatus)
    && isNullableString(item.uncertainReason) && isoTime(item.createdAt) && isoTime(item.updatedAt)
    && (item.finishedAt === null || isoTime(item.finishedAt)) && item.schemaVersion === 1;
}

function isSleepBackup(value: unknown): value is SleepBackup {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  const envelopeValid = item.version === 1 ? sameKeys(item, ['app', 'version', 'exportedAt', 'segments'])
    : item.version === 2 && sameKeys(item, ['app', 'version', 'exportedAt', 'segments', 'plan']) && (item.plan === null || isSleepPlan(item.plan));
  return envelopeValid && item.app === '眠记' && isoTime(item.exportedAt)
    && Array.isArray(item.segments) && item.segments.every(isSleepSegment)
    && item.segments.filter((segment) => segment.status === 'active').length <= 1;
}

export function parseBackup(text: string): SleepBackup {
  try {
    const value: unknown = JSON.parse(text);
    if (!isSleepBackup(value)) throw new Error('invalid schema');
    return value;
  } catch {
    throw new Error('备份文件格式不正确');
  }
}

const fieldsWithoutId = [...segmentFields.filter((field) => field !== 'id'), 'reflection'];
const stableReflection = (reflection: SleepSegment['reflection']) => reflection
  ? reflectionFields.map((field) => reflection[field as keyof typeof reflection] ?? null)
  : null;
const stableSegmentValue = (segment: SleepSegment, fields: readonly string[]) => fields
  .map((field) => [field, field === 'reflection' ? stableReflection(segment.reflection) : segment[field as keyof SleepSegment]] as const);
const fingerprint = (segment: SleepSegment) => JSON.stringify(stableSegmentValue(segment, fieldsWithoutId));
const sameSegment = (left: SleepSegment, right: SleepSegment) => segmentFields.every((field) => left[field] === right[field]) &&
  JSON.stringify(stableReflection(left.reflection)) === JSON.stringify(stableReflection(right.reflection));
const ensureSingleActive = (segments: SleepSegment[]) => {
  if (segments.filter((segment) => segment.status === 'active').length > 1) {
    throw new Error('合并后会出现两条“记录中”的记录。请先结束当前记录，或在备份来源中结束另一条记录后重新导入。');
  }
};

export function mergeBackup(current: SleepSegment[], incoming: SleepSegment[]) {
  const map = new Map(current.map((segment) => [segment.id, segment]));
  const seen = new Set(current.map(fingerprint));
  const conflicts: MergeConflict[] = [];
  for (const segment of incoming) {
    const existing = map.get(segment.id);
    if (existing && !sameSegment(existing, segment)) {
      conflicts.push({ current: existing, incoming: segment });
    } else if (!existing && !seen.has(fingerprint(segment))) {
      map.set(segment.id, segment);
      seen.add(fingerprint(segment));
    }
  }
  const merged = [...map.values()].sort((a, b) => a.startAt.localeCompare(b.startAt));
  ensureSingleActive(merged);
  return { merged, conflicts };
}

export function resolveBackupMerge(
  merged: SleepSegment[],
  conflicts: MergeConflict[],
  resolutions: Record<string, ConflictResolution>,
): SleepSegment[] {
  const map = new Map(merged.map((segment) => [segment.id, segment]));
  for (const conflict of conflicts) {
    const choice = resolutions[conflict.current.id];
    if (!choice) throw new Error('存在未解决的冲突，请先选择处理方式');
    if (choice === 'use-backup') map.set(conflict.current.id, conflict.incoming);
  }
  const resolved = [...map.values()].sort((a, b) => a.startAt.localeCompare(b.startAt));
  ensureSingleActive(resolved);
  return resolved;
}

export function shouldRemindManualBackup(lastManualExportAt: string | null, nowMs: number, days = 30): boolean {
  if (!lastManualExportAt) return false;
  const lastMs = Date.parse(lastManualExportAt);
  return !Number.isFinite(lastMs) || !Number.isFinite(nowMs) || nowMs - lastMs >= days * 24 * 60 * 60 * 1000;
}

function csvField(value: string | number | null): string {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

export function toCsv(segments: SleepSegment[]): string {
  const header = ['记录编号', '睡眠类型', '开始时间', '结束时间', '时长（分钟）', '分组编号', '状态', '不准确原因', '估计入睡时间', '使用闹钟', '醒后精神', '白天精神'];
  const rows = segments.map((segment) => [
    segment.id, segment.kind === 'night' ? '夜间睡眠' : '午睡', segment.startAt, segment.endAt,
    segment.endAt ? Math.round((Date.parse(segment.endAt) - Date.parse(segment.startAt)) / 60_000) : '',
    segment.groupId, segment.status, segment.uncertainReason, segment.reflection?.sleepOnsetAt ?? null,
    segment.reflection?.alarmUsed === null || segment.reflection?.alarmUsed === undefined ? '' : segment.reflection.alarmUsed ? '是' : '否',
    segment.reflection?.wakeEnergy ?? null, segment.reflection?.daytimeEnergy ?? null,
  ].map((value) => csvField(value)).join(','));
  return `\ufeff${header.map((value) => csvField(value)).join(',')}\r\n${rows.join('\r\n')}\r\n`;
}
