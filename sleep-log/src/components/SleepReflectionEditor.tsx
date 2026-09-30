import { useState, type FormEvent } from 'react';
import type { SleepReflection, SleepSegment } from '../domain/sleep';

export function SleepReflectionEditor({ segment, onSave }: { segment: SleepSegment; onSave: (id: string, value: SleepReflection) => Promise<void> }) {
  const previous = segment.reflection;
  const initialMinutes = previous?.sleepOnsetAt
    ? String(Math.round((Date.parse(previous.sleepOnsetAt) - Date.parse(segment.startAt)) / 60000)) : '';
  const [minutes, setMinutes] = useState(initialMinutes);
  const [alarm, setAlarm] = useState(previous?.alarmUsed === null || previous?.alarmUsed === undefined ? '' : String(previous.alarmUsed));
  const [wake, setWake] = useState(previous?.wakeEnergy?.toString() ?? '');
  const [daytime, setDaytime] = useState(previous?.daytimeEnergy?.toString() ?? '');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const maxMinutes = segment.endAt ? Math.max(0, Math.floor((Date.parse(segment.endAt) - Date.parse(segment.startAt)) / 60000)) : 0;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setMessage('');
    try {
      const value: SleepReflection = {
        sleepOnsetAt: minutes === '' ? null : new Date(Date.parse(segment.startAt) + Number(minutes) * 60000).toISOString(),
        alarmUsed: alarm === '' ? null : alarm === 'true',
        wakeEnergy: wake === '' ? null : Number(wake),
        daytimeEnergy: daytime === '' ? null : Number(daytime),
      };
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
      <p className="hint-text">这些是回忆估计，原始记录时间不会改变。</p>
      <label>开始记录后大约多久睡着（分钟）
        <input type="number" min="0" max={maxMinutes} step="1" value={minutes} onChange={(event) => setMinutes(event.target.value)} placeholder="不确定可留空" />
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
