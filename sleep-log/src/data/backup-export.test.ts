import { describe, it, expect } from 'vitest';
import { createBackup, parseBackup, toCsv } from './backup';
import type { SleepSegment } from '../domain/sleep';

describe('Backup Export Verification (JSON & CSV)', () => {
  const sampleSegments: SleepSegment[] = [
    {
      id: 'seg-1',
      kind: 'night',
      groupId: 'grp-1',
      startAt: '2026-09-05T23:00:00Z',
      startTimezone: 'Asia/Shanghai',
      endAt: '2026-09-06T07:00:00Z',
      endTimezone: 'Asia/Shanghai',
      status: 'completed',
      uncertainReason: null,
      createdAt: '2026-09-05T23:00:00Z',
      updatedAt: '2026-09-06T07:00:00Z',
      finishedAt: '2026-09-06T07:00:00Z',
      schemaVersion: 1,
    },
    {
      id: 'seg-2',
      kind: 'nap',
      groupId: null,
      startAt: '2026-09-06T13:00:00Z',
      startTimezone: 'Asia/Shanghai',
      endAt: '2026-09-06T13:45:00Z',
      endTimezone: 'Asia/Shanghai',
      status: 'completed',
      uncertainReason: null,
      createdAt: '2026-09-06T13:00:00Z',
      updatedAt: '2026-09-06T13:45:00Z',
      finishedAt: '2026-09-06T13:45:00Z',
      schemaVersion: 1,
    },
  ];

  it('generates CSV with UTF-8 BOM, chinese header, and correct row contents', () => {
    const csv = toCsv(sampleSegments);
    // Must start with UTF-8 BOM
    expect(csv.startsWith('\ufeff')).toBe(true);
    // Must contain Chinese headers
    expect(csv).toContain('"记录编号","睡眠类型","开始时间","结束时间","时长（分钟）","分组编号","状态","不准确原因"');
    // Must contain segment rows
    expect(csv).toContain('"seg-1","夜间睡眠","2026-09-05T23:00:00Z","2026-09-06T07:00:00Z","480","grp-1","completed",""');
    expect(csv).toContain('"seg-2","午睡","2026-09-06T13:00:00Z","2026-09-06T13:45:00Z","45","","completed",""');
  });

  it('roundtrips JSON backup serialization and parseBackup validation', () => {
    const jsonStr = createBackup(sampleSegments, '2026-09-06T08:00:00Z');
    const parsed = parseBackup(jsonStr);
    expect(parsed.app).toBe('眠记');
    expect(parsed.version).toBe(1);
    expect(parsed.segments).toHaveLength(2);
    expect(parsed.segments[0].id).toBe('seg-1');
    expect(parsed.segments[1].id).toBe('seg-2');
  });
});
