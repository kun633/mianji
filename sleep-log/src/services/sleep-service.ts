import type { SleepRepository } from '../data/repository';
import {
  createSegment,
  finishSegment,
  markUncertain,
  resetStart,
  undoFinish,
  resumeSegment,
  extendWake,
  type SleepKind,
  type SleepSegment,
} from '../domain/sleep';
import { groupSleepSegments } from '../domain/stats';

export interface Clock {
  nowIso(): string;
  timezone(): string;
}

export interface BackupTrigger {
  run(): Promise<void>;
}

export class SleepService {
  constructor(
    private repo: SleepRepository,
    private clock: Clock,
    private newId: () => string,
    private backup: BackupTrigger,
  ) {}

  async getActive() {
    return this.repo.getActive();
  }

  async start(kind: SleepKind, groupId: string | null = null) {
    const now = this.clock.nowIso();
    const segment = createSegment({
      id: this.newId(),
      kind,
      groupId: kind === 'night' ? groupId ?? this.newId() : null,
      now,
      timezone: this.clock.timezone(),
    });
    if (!await this.repo.createActiveIfNone(segment)) throw new Error('已有正在记录的睡眠');
    await this.triggerBackup();
    return segment;
  }

  async resetActiveStart() {
    const active = await this.requireActive();
    const value = resetStart(active, this.clock.nowIso(), this.clock.timezone());
    await this.repo.save(value);
    await this.triggerBackup();
    return value;
  }

  async cancelActive() {
    const active = await this.requireActive();
    await this.repo.remove(active.id);
    await this.triggerBackup();
  }

  async wake() {
    const active = await this.requireActive();
    const value = finishSegment(active, this.clock.nowIso(), this.clock.timezone());
    await this.repo.save(value);
    await this.triggerBackup();
    return value;
  }

  async undoWake(id: string) {
    const value = await this.requireById(id);
    const undone = undoFinish(value, this.clock.nowIso());
    const active = await this.repo.getActive();
    if (active && active.id !== id) throw new Error('已有正在记录的睡眠');
    await this.repo.save(undone);
    await this.triggerBackup();
    return undone;
  }

  async resumeActive(id: string) {
    const value = await this.requireById(id);
    const active = await this.repo.getActive();
    if (active && active.id !== id) throw new Error('已有正在记录的睡眠');
    const resumed = resumeSegment(value, this.clock.nowIso());
    await this.repo.save(resumed);
    await this.triggerBackup();
    return resumed;
  }

  async extendWake(id: string) {
    const value = await this.requireById(id);
    const extended = extendWake(value, this.clock.nowIso(), this.clock.timezone());
    await this.repo.save(extended);
    await this.triggerBackup();
    return extended;
  }

  async continueNight(previousId: string) {
    const previous = await this.requireById(previousId);
    if (previous.kind !== 'night' || !previous.groupId) throw new Error('只能继续夜间睡眠');
    return this.start('night', previous.groupId);
  }

  async changeKind(id: string, kind: SleepKind) {
    const current = await this.requireById(id);
    if (current.status === 'active') throw new Error('记录中不能修改睡眠类型');
    const all = await this.repo.list();
    const currentDate = current.endAt
      ? groupSleepSegments([current])[0]?.date
      : null;
    const sameWakeDateNight = currentDate
      ? groupSleepSegments(all.filter((item) => item.id !== id))
        .find((group) => group.kind === 'night' && group.date === currentDate)
      : undefined;
    const changed = {
      ...current,
      kind,
      groupId: kind === 'nap' ? null : sameWakeDateNight?.segments[0]?.groupId ?? this.newId(),
      updatedAt: this.clock.nowIso(),
    };
    await this.repo.save(changed);
    await this.triggerBackup();
    return changed;
  }

  async deleteSegment(id: string) {
    const current = await this.requireById(id);
    if (current.status === 'active') throw new Error('请使用取消本次记录');
    await this.repo.remove(id);
    await this.triggerBackup();
  }

  async resolveOverlong(action: 'finish-uncertain' | 'delete' | 'continue') {
    const active = await this.requireActive();
    if (!this.isOverlong(active)) throw new Error('记录尚未超过20小时');
    if (action === 'continue') return active;
    if (action === 'delete') {
      await this.repo.remove(active.id);
      await this.triggerBackup();
      return null;
    }
    const ended = markUncertain(
      finishSegment(active, this.clock.nowIso(), this.clock.timezone()),
      'over-20-hours',
    );
    await this.repo.save(ended);
    await this.triggerBackup();
    return ended;
  }

  isOverlong(segment: SleepSegment) {
    return Date.parse(this.clock.nowIso()) - Date.parse(segment.startAt) > 72_000_000;
  }

  private async requireActive() {
    const value = await this.repo.getActive();
    if (!value) throw new Error('没有正在记录的睡眠');
    return value;
  }

  private async requireById(id: string) {
    const value = await this.repo.get(id);
    if (!value) throw new Error('睡眠记录不存在');
    return value;
  }

  private async triggerBackup() {
    try {
      await this.backup.run();
    } catch (error) {
      console.warn('睡眠记录备份失败', error);
    }
  }
}
