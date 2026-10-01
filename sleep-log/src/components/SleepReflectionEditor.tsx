import { useState, type FormEvent } from 'react';
import type { NightAwakeningBand, SleepOnsetBand, SleepReflection, SleepSegment } from '../domain/sleep';

export function SleepReflectionEditor({ segment, onSave }: { segment: SleepSegment; onSave: (id: string, value: SleepReflection) => Promise<void> }) {
  const previous = segment.reflection;
  const [onsetBand, setOnsetBand] = useState<SleepOnsetBand | ''>(previous?.sleepOnsetBand ?? '');
  const [awakeningBand, setAwakeningBand] = useState<NightAwakeningBand | ''>(previous?.nightAwakeningBand ?? '');
  const [alarm, setAlarm] = useState(previous?.alarmUsed === null || previous?.alarmUsed === undefined ? '' : String(previous.alarmUsed));
  const [wake, setWake] = useState(previous?.wakeEnergy?.toString() ?? '');
  const [daytime, setDaytime] = useState(previous?.daytimeEnergy?.toString() ?? '');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setMessage('');
    try {
      const value: SleepReflection = {
        ...previous,
        // Older records may have an exact estimate; a category must not replace or synthesize it.
        sleepOnsetAt: previous?.sleepOnsetAt ?? null,
        alarmUsed: alarm === '' ? null : alarm === 'true',
        wakeEnergy: wake === '' ? null : Number(wake),
        daytimeEnergy: daytime === '' ? null : Number(daytime),
      };
      if (onsetBand) value.sleepOnsetBand = onsetBand;
      else delete value.sleepOnsetBand;
      if (awakeningBand) value.nightAwakeningBand = awakeningBand;
      else delete value.nightAwakeningBand;
      await onSave(segment.id, value);
      setMessage('补记已保存');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存未成功，请重试');
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="reflection-form" onSubmit={(event) => void submit(event)} aria-label="睡眠补记">
      <p className="hint-text">随手估计即可，可留空或选“不确定”；原始记录时间不会改变。</p>
      <label>大约多久睡着
        <select value={onsetBand} onChange={(event) => setOnsetBand(event.target.value as SleepOnsetBand | '')}>
          <option value="">未记录</option>
          <option value="under_15">15 分钟内</option>
          <option value="15_to_30">15–30 分钟</option>
          <option value="30_to_60">30–60 分钟</option>
          <option value="over_60">超过 1 小时</option>
          <option value="unknown">不确定</option>
        </select>
      </label>
      <label>夜里醒来情况
        <select value={awakeningBand} onChange={(event) => setAwakeningBand(event.target.value as NightAwakeningBand | '')}>
          <option value="">未记录</option>
          <option value="none">没有</option>
          <option value="one_or_two">1–2 次</option>
          <option value="multiple_or_long">多次或醒来较久</option>
          <option value="unknown">不确定</option>
        </select>
      </label>
      <label>是否被闹钟叫醒
        <select value={alarm} onChange={(event) => setAlarm(event.target.value)}>
          <option value="">未记录</option><option value="true">是</option><option value="false">否</option>
        </select>
      </label>
      <label>醒后精神
        <select value={wake} onChange={(event) => setWake(event.target.value)}>
          <option value="">未记录</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} / 5</option>)}
        </select>
      </label>
      <label>白天精神（可以稍后补填）
        <select value={daytime} onChange={(event) => setDaytime(event.target.value)}>
          <option value="">未记录</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} / 5</option>)}
        </select>
      </label>
      <button type="submit" disabled={pending}>{pending ? '保存中…' : '保存补记'}</button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
