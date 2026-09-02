import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SleepSegment } from '../domain/sleep';
import type { SleepRepository } from '../data/repository';
import { SleepService, type BackupTrigger, type Clock } from './sleep-service';

class MemorySleepRepository implements SleepRepository {
  private values = new Map<string, SleepSegment>();

  async get(id: string) { return this.values.get(id); }
  async list() { return [...this.values.values()]; }
  async getActive() { return [...this.values.values()].find((value) => value.status === 'active'); }
  async save(segment: SleepSegment) { this.values.set(segment.id, segment); }
  async remove(id: string) { this.values.delete(id); }
  async replaceAll(segments: SleepSegment[]) { this.values = new Map(segments.map((segment) => [segment.id, segment])); }
}

class MutableClock implements Clock {
  constructor(private value = '2026-09-02T15:00:00.000Z') {}
  nowIso() { return this.value; }
  timezone() { return 'Asia/Shanghai'; }
  set(value: string) { this.value = value; }
  advanceHours(hours: number) { this.value = new Date(Date.parse(this.value) + hours * 3_600_000).toISOString(); }
}

describe('SleepService', () => {
  let repo: MemorySleepRepository;
  let clock: MutableClock;
  let backupTrigger: BackupTrigger & { run: ReturnType<typeof vi.fn> };
  let service: SleepService;
  let nextId: number;

  beforeEach(() => {
    repo = new MemorySleepRepository();
    clock = new MutableClock();
    backupTrigger = { run: vi.fn().mockResolvedValue(undefined) };
    nextId = 1;
    service = new SleepService(repo, clock, () => `id-${nextId++}`, backupTrigger);
  });

  it('prevents a second active segment and links continued night sleep', async () => {
    await service.start('night');
    await expect(service.start('nap')).rejects.toThrow('已有正在记录的睡眠');
    const first = await service.wake();
    clock.set('2026-09-03T00:40:00.000Z');
    const second = await service.continueNight(first.id);
    expect(second.groupId).toBe(first.groupId);
  });

  it('backs up every successful mutation', async () => {
    await service.start('nap');
    await service.resetActiveStart();
    await service.wake();
    expect(backupTrigger.run).toHaveBeenCalledTimes(3);
  });

  it('marks a 20-hour active record uncertain only after user confirmation', async () => {
    await service.start('night');
    clock.advanceHours(21);
    const active = await service.getActive();
    expect(service.isOverlong(active!)).toBe(true);
    const ended = await service.resolveOverlong('finish-uncertain');
    expect(ended?.status).toBe('uncertain');
    expect(ended?.uncertainReason).toBe('over-20-hours');
  });

  it('cancels an active segment and backs up the deletion', async () => {
    const active = await service.start('nap');
    await service.cancelActive();
    expect(await repo.get(active.id)).toBeUndefined();
    expect(backupTrigger.run).toHaveBeenCalledTimes(2);
  });

  it('undoes a recent wake and rejects deleting or changing active records', async () => {
    const active = await service.start('nap');
    clock.advanceHours(1);
    const completed = await service.wake();
    const undone = await service.undoWake(completed.id);
    expect(undone.status).toBe('active');
    await expect(service.changeKind(active.id, 'night')).rejects.toThrow('记录中不能修改睡眠类型');
    await expect(service.deleteSegment(active.id)).rejects.toThrow('请使用取消本次记录');
  });

  it('groups a completed record changed to night with night sleep on the same wake date', async () => {
    const night = await service.start('night');
    clock.advanceHours(7);
    const completedNight = await service.wake();
    clock.set('2026-09-03T05:00:00.000Z');
    const nap = await service.start('nap');
    clock.advanceHours(1);
    await service.wake();
    const changed = await service.changeKind(nap.id, 'night');
    expect(changed.groupId).toBe(completedNight.groupId);
    expect(changed.groupId).toBe(night.groupId);
  });

  it('deletes completed records and resolves an overlong record by delete or continue', async () => {
    const completed = await service.start('nap');
    clock.advanceHours(1);
    await service.wake();
    await service.deleteSegment(completed.id);
    expect(await repo.get(completed.id)).toBeUndefined();

    const overlong = await service.start('night');
    clock.advanceHours(21);
    expect(await service.resolveOverlong('continue')).toEqual(overlong);
    expect(await service.getActive()).toEqual(overlong);
    await service.resolveOverlong('delete');
    expect(await service.getActive()).toBeUndefined();
  });
});
