import type { SleepRepository } from '../data/repository';
import {
  createSegment,
  finishSegment,
  markUncertain,
  resetStart,
  undoFinish,
  type SleepKind,
  type SleepSegment,
} from '../domain/sleep';
import { displayDate } from '../domain/stats';

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
    if (await this.repo.getActive()) throw new Error('已有正在记录的睡眠');
    const now = this.clock.nowIso();
    const segment = createSegment({
      id: this.newId(),
      kind,
      groupId: kind === 'night' ? groupId ?? this.newId() : null,
      now,
      timezone: this.clock.timezone(),
    });
    await this.repo.save(segment);
    await this.backup.run();
    return segment;
  }

  async resetActiveStart() {
    const active = await this.requireActive();
    const value = resetStart(active, this.clock.nowIso(), this.clock.timezone());
    await this.repo.save(value);
    await this.backup.run();
    return value;
  }

  async cancelActive() {
    const active = await this.requireActive();
    await this.repo.remove(active.id);
    await this.backup.run();
  }

  async wake() {
    const active = await this.requireActive();
    const value = finishSegment(active, this.clock.nowIso(), this.clock.timezone());
    await this.repo.save(value);
    await this.backup.run();
    return value;
  }

  async undoWake(id: string) {
    const value = await this.requireById(id);
    const undone = undoFinish(value, this.clock.nowIso());
    await this.repo.save(undone);
    await this.backup.run();
    return undone;
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
    const sameWakeDateNight = all.find((item) => (
      item.id !== id
      && item.kind === 'night'
      && item.endAt
      && current.endAt
      && displayDate(item.endAt, item.endTimezone ?? item.startTimezone)
        === displayDate(current.endAt, current.endTimezone ?? current.startTimezone)
    ));
    const changed = {
      ...current,
      kind,
      groupId: kind === 'nap' ? null : sameWakeDateNight?.groupId ?? this.newId(),
      updatedAt: this.clock.nowIso(),
    };
    await this.repo.save(changed);
    await this.backup.run();
    return changed;
  }

  async deleteSegment(id: string) {
    const current = await this.requireById(id);
    if (current.status === 'active') throw new Error('请使用取消本次记录');
    await this.repo.remove(id);
    await this.backup.run();
  }

  async resolveOverlong(action: 'finish-uncertain' | 'delete' | 'continue') {
    const active = await this.requireActive();
    if (!this.isOverlong(active)) throw new Error('记录尚未超过20小时');
    if (action === 'continue') return active;
    if (action === 'delete') {
      await this.repo.remove(active.id);
      await this.backup.run();
      return null;
    }
    const ended = markUncertain(
      finishSegment(active, this.clock.nowIso(), this.clock.timezone()),
      'over-20-hours',
    );
    await this.repo.save(ended);
    await this.backup.run();
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
}
