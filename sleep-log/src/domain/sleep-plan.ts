import type { SleepSegment } from './sleep';

export interface SleepPlan {
  startedOn: string;
  baselineWakeMinutes: number;
  targetWakeMinutes: 450;
  sleepOpportunityMinutes: 570;
  stepMinutes: 25;
  stepDays: 3;
  pausedOn: string | null;
  pausedDays: number;
}

const dayNumber = (date: string) => Math.floor(Date.parse(`${date}T00:00:00.000Z`) / 86400000);
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : Math.round((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2);
};

export function startSleepPlan(segments: SleepSegment[], today: string): SleepPlan {
  const wakeMinutes = segments
    .filter((segment) => segment.kind === 'night' && segment.status === 'completed' && segment.endAt)
    .sort((a, b) => Date.parse(b.endAt!) - Date.parse(a.endAt!))
    .slice(0, 7)
    .map((segment) => {
      const date = new Date(segment.endAt!);
      const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: segment.endTimezone ?? segment.startTimezone }).formatToParts(date);
      return Number(parts.find((part) => part.type === 'hour')?.value) * 60 + Number(parts.find((part) => part.type === 'minute')?.value);
    });
  if (wakeMinutes.length === 0) throw new Error('需要至少一段有效夜间记录才能开始计划');
  return {
    startedOn: today,
    baselineWakeMinutes: Math.max(450, median(wakeMinutes)),
    targetWakeMinutes: 450,
    sleepOpportunityMinutes: 570,
    stepMinutes: 25,
    stepDays: 3,
    pausedOn: null,
    pausedDays: 0,
  };
}

export function sleepPlanForDate(plan: SleepPlan, date: string) {
  const end = plan.pausedOn && dayNumber(date) > dayNumber(plan.pausedOn) ? plan.pausedOn : date;
  const days = Math.max(0, dayNumber(end) - dayNumber(plan.startedOn) - plan.pausedDays);
  const wakeMinutes = Math.max(plan.targetWakeMinutes, plan.baselineWakeMinutes - Math.floor(days / plan.stepDays) * plan.stepMinutes);
  return { wakeMinutes, bedtimeMinutes: (wakeMinutes - plan.sleepOpportunityMinutes + 1440) % 1440, days, paused: Boolean(plan.pausedOn) };
}

export function pauseSleepPlan(plan: SleepPlan, date: string): SleepPlan {
  return plan.pausedOn ? plan : { ...plan, pausedOn: date };
}

export function resumeSleepPlan(plan: SleepPlan, date: string): SleepPlan {
  if (!plan.pausedOn) return plan;
  return { ...plan, pausedOn: null, pausedDays: plan.pausedDays + Math.max(0, dayNumber(date) - dayNumber(plan.pausedOn)) };
}

export function isSleepPlan(value: unknown): value is SleepPlan {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  const keys = ['startedOn', 'baselineWakeMinutes', 'targetWakeMinutes', 'sleepOpportunityMinutes', 'stepMinutes', 'stepDays', 'pausedOn', 'pausedDays'];
  const validDate = (date: unknown): date is string => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(`${date}T00:00:00.000Z`)) &&
    new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) === date;
  return Object.keys(p).length === keys.length && keys.every((key) => key in p) &&
    validDate(p.startedOn) &&
    Number.isInteger(p.baselineWakeMinutes) && (p.baselineWakeMinutes as number) >= 450 && (p.baselineWakeMinutes as number) < 1440 &&
    p.targetWakeMinutes === 450 && p.sleepOpportunityMinutes === 570 && p.stepMinutes === 25 && p.stepDays === 3 &&
    (p.pausedOn === null || (validDate(p.pausedOn) && dayNumber(p.pausedOn) >= dayNumber(p.startedOn))) &&
    Number.isInteger(p.pausedDays) && (p.pausedDays as number) >= 0;
}
