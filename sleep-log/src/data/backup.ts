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

function isSleepSegment(value: unknown): value is SleepSegment {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return isString(item.id) && kinds.includes(item.kind as SleepKind) && isNullableString(item.groupId)
    && isString(item.startAt) && isString(item.startTimezone) && isNullableString(item.endAt)
    && isNullableString(item.endTimezone) && statuses.includes(item.status as SleepStatus)
    && isNullableString(item.uncertainReason) && isString(item.createdAt) && isString(item.updatedAt)
    && isNullableString(item.finishedAt) && item.schemaVersion === 1;
}

function isSleepBackup(value: unknown): value is SleepBackup {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return item.app === '眠记' && item.version === 1 && isString(item.exportedAt)
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

const fingerprint = (segment: SleepSegment) => JSON.stringify({
  kind: segment.kind, groupId: segment.groupId, startAt: segment.startAt,
  endAt: segment.endAt, status: segment.status, uncertainReason: segment.uncertainReason,
});

export function mergeBackup(current: SleepSegment[], incoming: SleepSegment[]) {
  const map = new Map(current.map((segment) => [segment.id, segment]));
  const seen = new Set(current.map(fingerprint));
  const conflicts: MergeConflict[] = [];
  for (const segment of incoming) {
    const existing = map.get(segment.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(segment)) {
      conflicts.push({ current: existing, incoming: segment });
    } else if (!existing && !seen.has(fingerprint(segment))) {
      map.set(segment.id, segment);
      seen.add(fingerprint(segment));
    }
  }
  return { merged: [...map.values()].sort((a, b) => a.startAt.localeCompare(b.startAt)), conflicts };
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
