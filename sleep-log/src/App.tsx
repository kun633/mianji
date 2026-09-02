import { useEffect, useMemo, useState } from 'react';
import { AutoBackupTrigger, BrowserFileBackup, IndexedDbBackupSettingsRepository } from './data/file-backup';
import { IndexedDbSleepRepository, type SleepRepository } from './data/repository';
import type { SleepSegment } from './domain/sleep';
import { SleepService } from './services/sleep-service';
import { TodayPage, type TodayActions, type TodayModel } from './components/TodayPage';

const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const clock = { nowIso: () => new Date().toISOString(), timezone };

type TodayService = Pick<SleepService, 'getActive' | 'isOverlong'>;

export function buildFinishedModel(segments: SleepSegment[], now = Date.now()): TodayModel {
  const completed = segments.filter((segment) => segment.status === 'completed' && segment.endAt && segment.finishedAt);
  const latest = [...completed].sort((left, right) => Date.parse(right.finishedAt!) - Date.parse(left.finishedAt!))[0];
  if (!latest) return { state: 'idle', lastNightMs: null, backupWarning: null };
  const groupSegments = completed
    .filter((segment) => latest.groupId ? segment.groupId === latest.groupId : segment.id === latest.id)
    .sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt));
  return {
    state: 'finished',
    segment: latest,
    groupSegments,
    undoUntil: new Date(Date.parse(latest.finishedAt!) + 60_000).toISOString(),
    backupWarning: null,
  };
}

export async function loadTodayModel(service: TodayService, repository: Pick<SleepRepository, 'list'>, now = Date.now()): Promise<TodayModel> {
  const active = await service.getActive();
  if (active) return { state: 'active', segment: active, elapsedMs: Math.max(0, now - Date.parse(active.startAt)), overlong: service.isOverlong(active), backupWarning: null };
  return buildFinishedModel(await repository.list(), now);
}

export default function App() {
  const repository = useMemo(() => new IndexedDbSleepRepository(), []);
  const service = useMemo(() => new SleepService(repository, clock, () => crypto.randomUUID(), new AutoBackupTrigger(repository, new IndexedDbBackupSettingsRepository(), new BrowserFileBackup(window), clock.nowIso)), [repository]);
  const [model, setModel] = useState<TodayModel | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { const timer = window.setInterval(() => setTick((value) => value + 1), 30_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { void loadTodayModel(service, repository).then(setModel); }, [service, repository, tick]);
  const actions: TodayActions = {
    start: async (kind) => { const segment = await service.start(kind); setModel({ state: 'active', segment, elapsedMs: 0, overlong: false, backupWarning: null }); },
    resetStart: async () => { const segment = await service.resetActiveStart(); setModel({ state: 'active', segment, elapsedMs: 0, overlong: false, backupWarning: null }); },
    cancel: async () => { await service.cancelActive(); setModel({ state: 'idle', lastNightMs: null, backupWarning: null }); },
    wake: async () => { await service.wake(); setModel(await loadTodayModel(service, repository)); },
    undoWake: async (id) => { const segment = await service.undoWake(id); setModel({ state: 'active', segment, elapsedMs: Date.now() - Date.parse(segment.startAt), overlong: service.isOverlong(segment), backupWarning: null }); },
    continueNight: async (id) => { const segment = await service.continueNight(id); setModel({ state: 'active', segment, elapsedMs: 0, overlong: false, backupWarning: null }); },
    resolveOverlong: async (action) => { const segment = await service.resolveOverlong(action); if (!segment) setModel({ state: 'idle', lastNightMs: null, backupWarning: null }); else if (action === 'continue') setModel({ state: 'active', segment, elapsedMs: Date.now() - Date.parse(segment.startAt), overlong: true, backupWarning: null }); else setModel({ state: 'finished', segment, groupSegments: [segment], undoUntil: '', backupWarning: null }); },
  };
  return model ? <TodayPage model={model} actions={actions} /> : <main className="today-page loading-view" aria-busy="true"><p>正在加载记录…</p></main>;
}
