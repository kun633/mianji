import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AutoBackupTrigger,
  BrowserFileBackup,
  downloadBackup,
  IndexedDbBackupSettingsRepository,
  type BackupCapability,
  type BackupStatus,
} from './data/file-backup';
import {
  checkStorageProtection,
  requestAndCheckStorageProtection,
  type StorageProtectionState,
} from './data/browser-storage';
import { createBackup, toCsv } from './data/backup';
import { IndexedDbSleepRepository, type SleepRepository } from './data/repository';
import type { SleepSegment } from './domain/sleep';
import type { SleepReflection } from './domain/sleep';
import { pauseSleepPlan, resumeSleepPlan, startSleepPlan, type SleepPlan } from './domain/sleep-plan';
import { displayDate } from './domain/stats';
import { SleepService } from './services/sleep-service';
import { TodayPage, type TodayActions, type TodayModel } from './components/TodayPage';
import { HistoryPage, type HistoryActions } from './components/HistoryPage';
import { SettingsPage, type SettingsActions, type SettingsModel } from './components/SettingsPage';
import { UpdateNotice } from './components/UpdateNotice';
import { registerAppServiceWorker } from './pwa/register';
import { publishWidgetState, nativeExportFile, checkPendingNativeAction } from './native/widget-bridge';
import { isNativeApp } from './native/platform';

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
  const [plan, setPlan] = useState<SleepPlan | null>(null);
  const [backupStatus, setBackupStatus] = useState<BackupStatus>({
    state: 'manual-only',
    lastSuccessfulBackupAt: null,
    message: null,
  });
  const [capability, setCapability] = useState<BackupCapability>('manual-only');
  const [storageProtection, setStorageProtection] = useState<StorageProtectionState>('checking');
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
    let active = true;
    void checkStorageProtection().then((state) => {
      if (active) setStorageProtection(state);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!appError) return;
    const timer = window.setTimeout(() => setAppError(null), 6000);
    return () => window.clearTimeout(timer);
  }, [appError]);

  const refreshData = async () => {
    try {
      const list = await repository.list();
      const currentPlan = await repository.getPlan?.() ?? null;
      const st = await settingsRepository.getStatus();
      const todayM = await loadTodayModel(service, repository);
      setSegments(list);
      setPlan(currentPlan);
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

  useEffect(() => {
    if (!model) return;
    if (model.state === 'active') {
      const elapsedMinutes = Math.floor((Date.now() - Date.parse(model.segment.startAt)) / 60000);
      const hours = Math.floor(elapsedMinutes / 60);
      const minutes = elapsedMinutes % 60;
      const timeStr = hours > 0 ? `${hours}小时${minutes}分` : `${minutes}分钟`;
      void publishWidgetState({
        state: 'active',
        headline: model.segment.kind === 'night' ? '夜间睡眠中' : '午睡中',
        subline: `已睡 ${timeStr}`,
        actionType: 'wake',
        updatedAt: clock.nowIso(),
        startTimeMs: Date.parse(model.segment.startAt),
      });
    } else if (model.state === 'finished') {
      void publishWidgetState({
        state: 'finished',
        headline: '刚睡醒',
        subline: '睡眠已结束',
        actionType: 'view',
        updatedAt: clock.nowIso(),
      });
    } else {
      void publishWidgetState({
        state: 'idle',
        headline: '准备入睡',
        subline: '点击开始记录睡眠',
        actionType: 'start',
        updatedAt: clock.nowIso(),
      });
    }
  }, [model]);

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
    saveReflection: async (id, value) => {
      await service.saveReflection(id, value);
      await refreshData();
    },
  };

  const todayActionsRef = useRef(todayActions);
  todayActionsRef.current = todayActions;

  useEffect(() => {
    const handleNativeShortcut = async () => {
      const action = await checkPendingNativeAction();
      if (action === 'wake') {
        await todayActionsRef.current.wake();
      }
    };
    void handleNativeShortcut();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void handleNativeShortcut();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onVisibilityChange);
    };
  }, []);

  const historyActions: HistoryActions = {
    changeKind: async (id, kind) => {
      if (await runMutation(() => service.changeKind(id, kind))) await refreshData();
    },
    deleteSegment: async (id) => {
      if (!await runVoidMutation(() => service.deleteSegment(id))) return;
      await refreshData();
    },
    saveReflection: async (id: string, value: SleepReflection) => {
      await service.saveReflection(id, value);
      await refreshData();
    },
    startPlan: async () => {
      await runVoidMutation(async () => {
        await repository.savePlan?.(startSleepPlan(await repository.list(), displayDate(clock.nowIso(), clock.timezone())));
        await backupTrigger.run();
        await refreshData();
      });
    },
    pausePlan: async () => {
      if (!plan) return;
      await runVoidMutation(async () => {
        await repository.savePlan?.(pauseSleepPlan(plan, displayDate(clock.nowIso(), clock.timezone())));
        await backupTrigger.run();
        await refreshData();
      });
    },
    resumePlan: async () => {
      if (!plan) return;
      await runVoidMutation(async () => {
        await repository.savePlan?.(resumeSleepPlan(plan, displayDate(clock.nowIso(), clock.timezone())));
        await backupTrigger.run();
        await refreshData();
      });
    },
    restartPlan: async () => {
      await runVoidMutation(async () => {
        await repository.savePlan?.(startSleepPlan(await repository.list(), displayDate(clock.nowIso(), clock.timezone())));
        await backupTrigger.run();
        await refreshData();
      });
    },
  };

  const settingsActions: SettingsActions = {
    chooseFolder: async () => {
      await runMutation(async () => {
        const handle = await fileBackup.chooseFolder();
        await fileBackup.writeTo(handle, createBackup(await repository.list(), clock.nowIso(), await repository.getPlan?.() ?? null));
        await settingsRepository.setDirectory(handle);
        await backupTrigger.run();
        await refreshData();
      });
    },
    exportJson: async () => {
      const text = createBackup(await repository.list(), clock.nowIso(), await repository.getPlan?.() ?? null);
      const dateStr = displayDate(clock.nowIso(), clock.timezone());
      const filename = `眠记-备份-${dateStr}.json`;
      let feedbackMsg = '备份文件已生成并下载到您的设备。';

      if (isNativeApp()) {
        const res = await nativeExportFile({
          content: text,
          filename,
          mimeType: 'application/json',
          title: '导出眠记完整备份 (JSON)',
        });
        if (res?.cancelled) return '已取消导出，未保存备份。';
        if (!res?.success) throw new Error('备份未成功保存，请重试');
        feedbackMsg = `✓ 已保存【${res.savedPath || filename}】到您选择的位置。`;
      } else {
        downloadBackup(text, filename);
      }

      const status: BackupStatus = {
        ...backupStatus,
        lastManualExportAt: clock.nowIso(),
        lastSuccessfulBackupAt: clock.nowIso(),
      };
      await settingsRepository.setStatus(status);
      setBackupStatus(status);
      return feedbackMsg;
    },
    exportCsv: async () => {
      const text = toCsv(await repository.list());
      const dateStr = displayDate(clock.nowIso(), clock.timezone());
      const filename = `眠记-睡眠记录-${dateStr}.csv`;
      let feedbackMsg = '表格文件已生成并下载到您的设备。';

      if (isNativeApp()) {
        const res = await nativeExportFile({
          content: text,
          filename,
          mimeType: 'text/csv',
          title: '导出眠记睡眠记录表格 (CSV)',
        });
        if (res?.cancelled) return '已取消导出，未保存表格。';
        if (!res?.success) throw new Error('表格未成功保存，请重试');
        feedbackMsg = `✓ 已保存【${res.savedPath || filename}】到您选择的位置。`;
      } else {
        downloadBackup(text, filename, 'text/csv;charset=utf-8');
      }
      return feedbackMsg;
    },
    restore: async (expected, newSegments, expectedPlan, newPlan) => {
      const restored = repository.replaceAllWithPlanIfUnchanged
        ? await repository.replaceAllWithPlanIfUnchanged(expected, newSegments, expectedPlan ?? null, newPlan ?? null)
        : await repository.replaceAllIfUnchanged(expected, newSegments);
      if (!restored) {
        throw new Error('记录已发生变化，请重新预览备份');
      }
      await backupTrigger.run();
      await refreshData();
    },
    requestStorageProtection: async () => {
      setStorageProtection(await requestAndCheckStorageProtection());
    },
  };

  const currentTodayDate = displayDate(clock.nowIso(), clock.timezone());
  const activeSegment = model?.state === 'active' ? model.segment : null;

  const settingsModel: SettingsModel = {
    capability,
    status: backupStatus,
    segments,
    plan,
    storageProtection,
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
            plan={plan}
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
