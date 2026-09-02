import { useEffect, useMemo, useState } from 'react';
import {
  AutoBackupTrigger,
  BrowserFileBackup,
  downloadBackup,
  IndexedDbBackupSettingsRepository,
  requestPersistentStorage,
  type BackupCapability,
  type BackupStatus,
} from './data/file-backup';
import { createBackup, toCsv } from './data/backup';
import { IndexedDbSleepRepository, type SleepRepository } from './data/repository';
import type { SleepSegment } from './domain/sleep';
import { displayDate } from './domain/stats';
import { SleepService } from './services/sleep-service';
import { TodayPage, type TodayActions, type TodayModel } from './components/TodayPage';
import { HistoryPage, type HistoryActions } from './components/HistoryPage';
import { SettingsPage, type SettingsActions, type SettingsModel } from './components/SettingsPage';
import { UpdateNotice } from './components/UpdateNotice';
import { registerAppServiceWorker } from './pwa/register';

const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
const clock = { nowIso: () => new Date().toISOString(), timezone };

type TodayService = Pick<SleepService, 'getActive' | 'isOverlong'>;

export function buildFinishedModel(segments: SleepSegment[], now = Date.now()): TodayModel {
  const finished = segments.filter(
    (segment) =>
      (segment.status === 'completed' || segment.status === 'uncertain') &&
      segment.endAt &&
      segment.finishedAt
  );
  const latest = [...finished].sort(
    (left, right) => Date.parse(right.finishedAt!) - Date.parse(left.finishedAt!)
  )[0];
  if (!latest) return { state: 'idle', lastNightMs: null, backupWarning: null };
  const groupSegments = finished
    .filter((segment) =>
      latest.groupId ? segment.groupId === latest.groupId : segment.id === latest.id
    )
    .sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt));
  return {
    state: 'finished',
    segment: latest,
    groupSegments,
    undoUntil:
      latest.status === 'completed'
        ? new Date(Date.parse(latest.finishedAt!) + 60_000).toISOString()
        : '',
    backupWarning: null,
  };
}

export async function loadTodayModel(
  service: TodayService,
  repository: Pick<SleepRepository, 'list'>,
  now = Date.now()
): Promise<TodayModel> {
  const active = await service.getActive();
  if (active) {
    return {
      state: 'active',
      segment: active,
      elapsedMs: Math.max(0, now - Date.parse(active.startAt)),
      overlong: service.isOverlong(active),
      backupWarning: null,
    };
  }
  return buildFinishedModel(await repository.list(), now);
}

export type TabKey = 'today' | 'history' | 'settings';

export default function App() {
  const repository = useMemo(() => new IndexedDbSleepRepository(), []);
  const settingsRepository = useMemo(() => new IndexedDbBackupSettingsRepository(), []);
  const fileBackup = useMemo(() => new BrowserFileBackup(window), []);
  const backupTrigger = useMemo(
    () => new AutoBackupTrigger(repository, settingsRepository, fileBackup, clock.nowIso),
    [repository, settingsRepository, fileBackup]
  );
  const service = useMemo(
    () => new SleepService(repository, clock, () => crypto.randomUUID(), backupTrigger),
    [repository, backupTrigger]
  );

  const [tab, setTab] = useState<TabKey>('today');
  const [model, setModel] = useState<TodayModel | null>(null);
  const [segments, setSegments] = useState<SleepSegment[]>([]);
  const [backupStatus, setBackupStatus] = useState<BackupStatus>({
    state: 'manual-only',
    lastSuccessfulBackupAt: null,
    message: null,
  });
  const [capability, setCapability] = useState<BackupCapability>('manual-only');
  const [isPersistent, setIsPersistent] = useState<boolean>(false);
  const [needRefresh, setNeedRefresh] = useState(false);
  const [updateSW, setUpdateSW] = useState<(() => Promise<void>) | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const updateFn = registerAppServiceWorker(() => setNeedRefresh(true));
    setUpdateSW(() => updateFn);
  }, []);

  const refreshData = async () => {
    const list = await repository.list();
    setSegments(list);
    const todayM = await loadTodayModel(service, repository);
    setModel(todayM);
    const st = await settingsRepository.getStatus();
    setBackupStatus(st);
    setCapability(fileBackup.capability());
    if (navigator.storage?.persisted) {
      navigator.storage.persisted().then(setIsPersistent).catch(() => undefined);
    }
  };

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void refreshData();
  }, [service, repository, tick]);

  const todayActions: TodayActions = {
    start: async (kind) => {
      const segment = await service.start(kind);
      setModel({
        state: 'active',
        segment,
        elapsedMs: 0,
        overlong: false,
        backupWarning: null,
      });
      await refreshData();
    },
    resetStart: async () => {
      const segment = await service.resetActiveStart();
      setModel({
        state: 'active',
        segment,
        elapsedMs: 0,
        overlong: false,
        backupWarning: null,
      });
      await refreshData();
    },
    cancel: async () => {
      await service.cancelActive();
      setModel({ state: 'idle', lastNightMs: null, backupWarning: null });
      await refreshData();
    },
    wake: async () => {
      await service.wake();
      await refreshData();
    },
    undoWake: async (id) => {
      const segment = await service.undoWake(id);
      setModel({
        state: 'active',
        segment,
        elapsedMs: Date.now() - Date.parse(segment.startAt),
        overlong: service.isOverlong(segment),
        backupWarning: null,
      });
      await refreshData();
    },
    continueNight: async (id) => {
      const segment = await service.continueNight(id);
      setModel({
        state: 'active',
        segment,
        elapsedMs: 0,
        overlong: false,
        backupWarning: null,
      });
      await refreshData();
    },
    resolveOverlong: async (action) => {
      const segment = await service.resolveOverlong(action);
      if (!segment) {
        setModel({ state: 'idle', lastNightMs: null, backupWarning: null });
      } else if (action === 'continue') {
        setModel({
          state: 'active',
          segment,
          elapsedMs: Date.now() - Date.parse(segment.startAt),
          overlong: true,
          backupWarning: null,
        });
      } else {
        setModel({
          state: 'finished',
          segment,
          groupSegments: [segment],
          undoUntil: '',
          backupWarning: null,
        });
      }
      await refreshData();
    },
  };

  const historyActions: HistoryActions = {
    changeKind: async (id, kind) => {
      await service.changeKind(id, kind);
      await refreshData();
    },
    deleteSegment: async (id) => {
      await service.deleteSegment(id);
      await refreshData();
    },
  };

  const settingsActions: SettingsActions = {
    chooseFolder: async () => {
      const handle = await fileBackup.chooseFolder();
      await settingsRepository.setDirectory(handle);
      await backupTrigger.run();
      await refreshData();
    },
    exportJson: () => {
      const text = createBackup(segments, clock.nowIso());
      const dateStr = displayDate(clock.nowIso(), clock.timezone());
      downloadBackup(text, `眠记-备份-${dateStr}.json`);
    },
    exportCsv: () => {
      const text = toCsv(segments);
      const dateStr = displayDate(clock.nowIso(), clock.timezone());
      downloadBackup(text, `眠记-睡眠记录-${dateStr}.csv`);
    },
    restore: async (newSegments) => {
      await repository.replaceAll(newSegments);
      await backupTrigger.run();
      await refreshData();
    },
    requestPersistentStorage: async () => {
      const granted = await requestPersistentStorage();
      setIsPersistent(granted);
      return granted;
    },
  };

  const currentTodayDate = displayDate(clock.nowIso(), clock.timezone());
  const activeSegment = model?.state === 'active' ? model.segment : null;

  const settingsModel: SettingsModel = {
    capability,
    status: backupStatus,
    segments,
    isPersistentStorageGranted: isPersistent,
  };

  if (!model) {
    return (
      <main className="today-page loading-view" aria-busy="true">
        <p>正在加载记录…</p>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <UpdateNotice
        needRefresh={needRefresh}
        activeSegment={activeSegment}
        applyUpdate={() => void updateSW?.()}
      />
      <div className="app-content">
        {tab === 'today' && <TodayPage model={model} actions={todayActions} />}
        {tab === 'history' && (
          <HistoryPage
            segments={segments}
            today={currentTodayDate}
            timezone={clock.timezone()}
            actions={historyActions}
          />
        )}
        {tab === 'settings' && (
          <SettingsPage
            model={settingsModel}
            timezone={clock.timezone()}
            actions={settingsActions}
          />
        )}
      </div>

      <nav aria-label="主要页面" className="bottom-nav">
        <button
          type="button"
          className={tab === 'today' ? 'nav-item active' : 'nav-item'}
          aria-current={tab === 'today' ? 'page' : undefined}
          onClick={() => setTab('today')}
        >
          今天
        </button>
        <button
          type="button"
          className={tab === 'history' ? 'nav-item active' : 'nav-item'}
          aria-current={tab === 'history' ? 'page' : undefined}
          onClick={() => setTab('history')}
        >
          历史
        </button>
        <button
          type="button"
          className={tab === 'settings' ? 'nav-item active' : 'nav-item'}
          aria-current={tab === 'settings' ? 'page' : undefined}
          onClick={() => setTab('settings')}
        >
          设置
        </button>
      </nav>
    </div>
  );
}
