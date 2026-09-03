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

export default function App({ initialRepository }: { initialRepository?: SleepRepository } = {}) {
  const repository = useMemo(() => initialRepository ?? new IndexedDbSleepRepository(), [initialRepository]);
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
  const [needRefresh, setNeedRefresh] = useState(false);
  const [updateSW, setUpdateSW] = useState<(() => Promise<void>) | null>(null);
  const [tick, setTick] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [appError, setAppError] = useState<string | null>(null);

  const backupWarning = (status: BackupStatus) => {
    if (status.state === 'write-failed') {
      return `自动备份未更新：${status.message || '请重新选择备份文件夹'}`;
    }
    if (status.state === 'needs-permission') {
      return '自动备份未更新，请重新授权文件夹';
    }
    return null;
  };

  const runMutation = async <T,>(operation: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return undefined;
      setAppError(error instanceof Error ? error.message : '操作失败，请重试');
      return undefined;
    }
  };

  const runVoidMutation = async (operation: () => Promise<void>): Promise<boolean> => {
    try {
      await operation();
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return false;
      setAppError(error instanceof Error ? error.message : '操作失败，请重试');
      return false;
    }
  };

  useEffect(() => {
    const updateFn = registerAppServiceWorker(() => setNeedRefresh(true));
    setUpdateSW(() => updateFn);
  }, []);

  useEffect(() => {
    if (!appError) return;
    const timer = window.setTimeout(() => setAppError(null), 6000);
    return () => window.clearTimeout(timer);
  }, [appError]);

  const refreshData = async () => {
    try {
      const list = await repository.list();
      const st = await settingsRepository.getStatus();
      const todayM = await loadTodayModel(service, repository);
      setSegments(list);
      setModel({ ...todayM, backupWarning: backupWarning(st) });
      setBackupStatus(st);
      setCapability(fileBackup.capability());
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '记录加载失败，请重试');
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
      const segment = await runMutation(() => service.start(kind));
      if (!segment) return;
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
      const segment = await runMutation(() => service.resetActiveStart());
      if (!segment) return;
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
      if (!await runVoidMutation(() => service.cancelActive())) return;
      setModel({ state: 'idle', lastNightMs: null, backupWarning: null });
      await refreshData();
    },
    wake: async () => {
      if (await runMutation(() => service.wake()) === undefined) return;
      await refreshData();
    },
    undoWake: async (id) => {
      const segment = await runMutation(() => service.undoWake(id));
      if (!segment) return;
      setModel({
        state: 'active',
        segment,
        elapsedMs: Date.now() - Date.parse(segment.startAt),
        overlong: service.isOverlong(segment),
        backupWarning: null,
      });
      await refreshData();
    },
    resumeActive: async (id) => {
      const segment = await runMutation(() => service.resumeActive(id));
      if (!segment) return;
      setModel({
        state: 'active',
        segment,
        elapsedMs: Math.max(0, Date.now() - Date.parse(segment.startAt)),
        overlong: service.isOverlong(segment),
        backupWarning: null,
      });
      await refreshData();
    },
    extendWake: async (id) => {
      const segment = await runMutation(() => service.extendWake(id));
      if (!segment) return;
      await refreshData();
    },
    continueNight: async (id) => {
      const segment = await runMutation(() => service.continueNight(id));
      if (!segment) return;
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
      const segment = await runMutation(() => service.resolveOverlong(action));
      if (segment === undefined && action !== 'delete') return;
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
      if (await runMutation(() => service.changeKind(id, kind))) await refreshData();
    },
    deleteSegment: async (id) => {
      if (!await runVoidMutation(() => service.deleteSegment(id))) return;
      await refreshData();
    },
  };

  const settingsActions: SettingsActions = {
    chooseFolder: async () => {
      await runMutation(async () => {
        const handle = await fileBackup.chooseFolder();
        await fileBackup.writeTo(handle, createBackup(segments, clock.nowIso()));
        await settingsRepository.setDirectory(handle);
        await backupTrigger.run();
        await refreshData();
      });
    },
    exportJson: async () => {
      const text = createBackup(segments, clock.nowIso());
      const dateStr = displayDate(clock.nowIso(), clock.timezone());
      downloadBackup(text, `眠记-备份-${dateStr}.json`);
      const status: BackupStatus = {
        ...backupStatus,
        lastManualExportAt: clock.nowIso(),
        lastSuccessfulBackupAt: clock.nowIso(),
      };
      await settingsRepository.setStatus(status);
      setBackupStatus(status);
    },
    exportCsv: () => {
      const text = toCsv(segments);
      const dateStr = displayDate(clock.nowIso(), clock.timezone());
      downloadBackup(text, `眠记-睡眠记录-${dateStr}.csv`, 'text/csv;charset=utf-8');
    },
    restore: async (expected, newSegments) => {
      if (!await repository.replaceAllIfUnchanged(expected, newSegments)) {
        throw new Error('记录已发生变化，请重新预览备份');
      }
      await backupTrigger.run();
      await refreshData();
    },
    requestPersistentStorage: async () => false,
  };

  const currentTodayDate = displayDate(clock.nowIso(), clock.timezone());
  const activeSegment = model?.state === 'active' ? model.segment : null;

  const settingsModel: SettingsModel = {
    capability,
    status: backupStatus,
    segments,
  };

  if (!model) {
    if (loadError) {
      return (
        <main className="today-page loading-view">
          <div className="today-state">
            <p className="error-text" role="alert">{loadError}</p>
            <button type="button" onClick={() => void refreshData()}>重试加载</button>
          </div>
        </main>
      );
    }
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
        {appError && (
          <div className="app-error-banner" role="alert">
            <span>{appError}</span>
            <button
              type="button"
              className="error-close-btn"
              onClick={() => setAppError(null)}
              aria-label="关闭错误提示"
            >
              ×
            </button>
          </div>
        )}
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
