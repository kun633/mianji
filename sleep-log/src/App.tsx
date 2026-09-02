import { useEffect, useMemo, useState } from 'react';
import { AutoBackupTrigger, BrowserFileBackup, IndexedDbBackupSettingsRepository } from './data/file-backup';
import { IndexedDbSleepRepository } from './data/repository';
import { durationMs, type SleepSegment } from './domain/sleep';
import { SleepService } from './services/sleep-service';
import { TodayPage, type TodayActions, type TodayModel } from './components/TodayPage';

const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const clock = { nowIso: () => new Date().toISOString(), timezone };

export default function App() {
  const repository = useMemo(() => new IndexedDbSleepRepository(), []);
  const service = useMemo(() => new SleepService(repository, clock, () => crypto.randomUUID(), new AutoBackupTrigger(repository, new IndexedDbBackupSettingsRepository(), new BrowserFileBackup(window), clock.nowIso)), [repository]);
  const [model, setModel] = useState<TodayModel>({ state: 'idle', lastNightMs: null, backupWarning: null });
  const [tick, setTick] = useState(0);
  useEffect(() => { const timer = window.setInterval(() => setTick((value) => value + 1), 30_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { void service.getActive().then((active) => { if (active) setModel({ state: 'active', segment: active, elapsedMs: Date.now() - Date.parse(active.startAt), overlong: service.isOverlong(active), backupWarning: null }); }); }, [service, tick]);
  const actions: TodayActions = {
    start: async (kind) => { const segment = await service.start(kind); setModel({ state: 'active', segment, elapsedMs: 0, overlong: false, backupWarning: null }); },
    resetStart: async () => { const segment = await service.resetActiveStart(); setModel({ state: 'active', segment, elapsedMs: 0, overlong: false, backupWarning: null }); },
    cancel: async () => { await service.cancelActive(); setModel({ state: 'idle', lastNightMs: null, backupWarning: null }); },
    wake: async () => { const segment = await service.wake(); setModel({ state: 'finished', segment, groupSegments: [segment], undoUntil: new Date(Date.parse(segment.finishedAt ?? segment.endAt ?? '') + 60_000).toISOString(), backupWarning: null }); },
    undoWake: async (id) => { const segment = await service.undoWake(id); setModel({ state: 'active', segment, elapsedMs: Date.now() - Date.parse(segment.startAt), overlong: service.isOverlong(segment), backupWarning: null }); },
    continueNight: async (id) => { const segment = await service.continueNight(id); setModel({ state: 'active', segment, elapsedMs: 0, overlong: false, backupWarning: null }); },
    resolveOverlong: async (action) => { const segment = await service.resolveOverlong(action); if (!segment) setModel({ state: 'idle', lastNightMs: null, backupWarning: null }); else if (action === 'continue') setModel({ state: 'active', segment, elapsedMs: Date.now() - Date.parse(segment.startAt), overlong: true, backupWarning: null }); else setModel({ state: 'finished', segment, groupSegments: [segment], undoUntil: '', backupWarning: null }); },
  };
  return <TodayPage model={model} actions={actions} />;
}

export { durationMs, type SleepSegment };
