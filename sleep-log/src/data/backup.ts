import type { SleepSegment, SleepKind, SleepStatus } from '../domain/sleep';

export interface SleepBackup { app: '眠记'; version: 1; exportedAt: string; segments: SleepSegment[]; }
export interface MergeConflict { current: SleepSegment; incoming: SleepSegment; }

export function createBackup(segments: SleepSegment[], exportedAt = new Date().toISOString()): string {
  return JSON.stringify({ app: '眠记', version: 1, exportedAt, segments } satisfies SleepBackup, null, 2);
}

const kinds: SleepKind[] = ['night', 'nap'];
const statuses: SleepStatus[] = ['active', 'completed', 'uncertain', 'invalid'];
const isString = (value: unknown): value is string => typeof value === 'string';
const isNullableString = (value: unknown): value is string | null => value === null || isString(value);
const segmentFields = ['id', 'kind', 'groupId', 'startAt', 'startTimezone', 'endAt', 'endTimezone', 'status', 'uncertainReason', 'createdAt', 'updatedAt', 'finishedAt', 'schemaVersion'] as const;
const isoTime = (value: unknown): value is string => isString(value)
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  && Number.isFinite(Date.parse(value));
const sameKeys = (value: Record<string, unknown>, allowed: readonly string[]) => {
  const keys = Object.keys(value).sort();
  return keys.length === allowed.length && keys.every((key, index) => key === [...allowed].sort()[index]);
};

function isSleepSegment(value: unknown): value is SleepSegment {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return sameKeys(item, segmentFields) && isString(item.id) && kinds.includes(item.kind as SleepKind) && isNullableString(item.groupId)
    && isoTime(item.startAt) && isString(item.startTimezone) && (item.endAt === null || isoTime(item.endAt))
    && (item.endTimezone === null || isString(item.endTimezone)) && statuses.includes(item.status as SleepStatus)
    && isNullableString(item.uncertainReason) && isoTime(item.createdAt) && isoTime(item.updatedAt)
    && (item.finishedAt === null || isoTime(item.finishedAt)) && item.schemaVersion === 1;
}

function isSleepBackup(value: unknown): value is SleepBackup {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return sameKeys(item, ['app', 'version', 'exportedAt', 'segments']) && item.app === '眠记' && item.version === 1 && isoTime(item.exportedAt)
    && Array.isArray(item.segments) && item.segments.every(isSleepSegment);
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

const fieldsWithoutId = segmentFields.filter((field) => field !== 'id');
const stableSegmentValue = (segment: SleepSegment, fields: readonly string[]) => fields
  .map((field) => [field, segment[field as keyof SleepSegment]] as const);
const fingerprint = (segment: SleepSegment) => JSON.stringify(stableSegmentValue(segment, fieldsWithoutId));
const sameSegment = (left: SleepSegment, right: SleepSegment) => stableSegmentValue(left, segmentFields)
  .every(([field, value], index) => value === stableSegmentValue(right, segmentFields)[index][1]);

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
  return { merged: [...map.values()].sort((a, b) => a.startAt.localeCompare(b.startAt)), conflicts };
}

export function shouldRemindManualBackup(lastSuccessfulBackupAt: string | null, nowMs: number, days = 30): boolean {
  if (!lastSuccessfulBackupAt) return true;
  const lastMs = Date.parse(lastSuccessfulBackupAt);
  return !Number.isFinite(lastMs) || !Number.isFinite(nowMs) || nowMs - lastMs >= days * 24 * 60 * 60 * 1000;
}

function csvField(value: string | number | null): string {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

export function toCsv(segments: SleepSegment[]): string {
  const header = ['记录编号', '睡眠类型', '开始时间', '结束时间', '时长（分钟）', '分组编号', '状态', '不准确原因'];
  const rows = segments.map((segment) => [
    segment.id, segment.kind === 'night' ? '夜间睡眠' : '午睡', segment.startAt, segment.endAt,
    segment.endAt ? Math.round((Date.parse(segment.endAt) - Date.parse(segment.startAt)) / 60_000) : '',
    segment.groupId, segment.status, segment.uncertainReason,
  ].map((value) => csvField(value)).join(','));
  return `\ufeff${header.map((value) => csvField(value)).join(',')}\r\n${rows.join('\r\n')}\r\n`;
}
