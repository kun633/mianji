import { useEffect, useRef, useState } from 'react';
import type { SleepKind, SleepSegment } from '../domain/sleep';
import { formatDuration } from '../domain/stats';

export type TodayModel =
  | { state: 'idle'; lastNightMs: number | null; backupWarning: string | null }
  | { state: 'active'; segment: SleepSegment; elapsedMs: number; overlong: boolean; backupWarning: string | null }
  | { state: 'finished'; segment: SleepSegment; groupSegments: SleepSegment[]; undoUntil: string; backupWarning: string | null };

export interface TodayActions {
  start(kind: SleepKind): Promise<void>;
  resetStart(): Promise<void>;
  cancel(): Promise<void>;
  wake(): Promise<void>;
  undoWake(id: string): Promise<void>;
  resumeActive(id: string): Promise<void>;
  extendWake(id: string): Promise<void>;
  continueNight(id: string): Promise<void>;
  resolveOverlong(action: 'finish-uncertain' | 'delete' | 'continue'): Promise<void>;
}

const formatTime = (value: string) => new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));

function ConfirmDialog({ title, body, confirmLabel, onConfirm, onCancel }: { title: string; body: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void }) {
  const dialogRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    const cancelBtn = dialogRef.current?.querySelector<HTMLButtonElement>('button');
    cancelBtn?.focus();
    return () => openerRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
    if (e.key === 'Tab' && dialogRef.current) {
      const buttons = dialogRef.current.querySelectorAll<HTMLButtonElement>('button');
      if (buttons.length === 0) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        onKeyDown={handleKeyDown}
      >
        <h2 id="dialog-title">{title}</h2>
        <p>{body}</p>
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>
            返回
          </button>
          <button type="button" className="danger-button" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function SleepTypeChooser({
  openerRef,
  onStart,
  onClose,
}: {
  openerRef?: React.RefObject<HTMLElement | null>;
  onStart: (kind: SleepKind) => Promise<void>;
  onClose: () => void;
}) {
  const pendingRef = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);
  const fallbackOpenerRef = useRef<HTMLElement | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    fallbackOpenerRef.current = document.activeElement as HTMLElement | null;
    const firstBtn = dialogRef.current?.querySelector<HTMLButtonElement>('button');
    firstBtn?.focus();
    return () => {
      const target = openerRef?.current || fallbackOpenerRef.current;
      target?.focus();
    };
  }, [openerRef]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
    if (e.key === 'Tab' && dialogRef.current) {
      const buttons = dialogRef.current.querySelectorAll<HTMLButtonElement>('button:not([disabled])');
      if (buttons.length === 0) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const start = async (kind: SleepKind) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    try {
      await onStart(kind);
      onClose();
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="bottom-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="type-title"
        onKeyDown={handleKeyDown}
      >
        <h2 id="type-title">选择记录类型</h2>
        <div className="type-options">
          <button
            type="button"
            className="type-button night-button"
            disabled={pending}
            onClick={() => void start('night')}
          >
            夜间睡眠
          </button>
          <button
            type="button"
            className="type-button nap-button"
            disabled={pending}
            onClick={() => void start('nap')}
          >
            午睡
          </button>
        </div>
      </section>
    </div>
  );
}

export function IdleView({ model, onStart }: { model: Extract<TodayModel, { state: 'idle' }>; onStart: (kind: SleepKind) => void }) {
  const [chooserOpen, setChooserOpen] = useState(false);
  const startButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="today-state idle-view">
      <p className="eyebrow">今天</p>
      <h1>记录此刻的睡眠</h1>
      <button
        ref={startButtonRef}
        type="button"
        className="primary-circle"
        onClick={() => setChooserOpen(true)}
      >
        开始睡觉
      </button>
      <p className="supporting-text">
        {model.lastNightMs === null ? '准备好时再开始记录' : `上次夜间睡眠 ${formatDuration(model.lastNightMs)}`}
      </p>
      {model.backupWarning && <p className="backup-warning" role="alert">{model.backupWarning}</p>}
      {chooserOpen && (
        <SleepTypeChooser
          openerRef={startButtonRef}
          onStart={async (kind) => onStart(kind)}
          onClose={() => setChooserOpen(false)}
        />
      )}
    </div>
  );
}

export function ActiveView({ model, actions }: { model: Extract<TodayModel, { state: 'active' }>; actions: TodayActions }) {
  const [confirmation, setConfirmation] = useState<'reset' | 'cancel' | null>(null);
  return (
    <div className="today-state active-view">
      <p className="eyebrow">{model.segment.kind === 'night' ? '夜间睡眠' : '午睡'} · 记录中</p>
      <p className="elapsed">{formatDuration(model.elapsedMs)}</p>
      <p className="supporting-text">从 {formatTime(model.segment.startAt)} 开始</p>
      <button type="button" className="primary-circle active-circle" onClick={() => void actions.wake()}>
        起床
      </button>
      <div className="secondary-actions">
        <button type="button" onClick={() => setConfirmation('reset')}>
          还没睡着
        </button>
        <button type="button" onClick={() => setConfirmation('cancel')}>
          取消本次记录
        </button>
      </div>
      {model.backupWarning && <p className="backup-warning" role="alert">{model.backupWarning}</p>}
      {model.overlong && <OverlongDialog actions={actions} />}
      {confirmation === 'reset' && (
        <ConfirmDialog
          title="重置开始时间？"
          body="开始时间会改为现在，之前的开始时间不会保留。"
          confirmLabel="确认重置"
          onCancel={() => setConfirmation(null)}
          onConfirm={() => {
            setConfirmation(null);
            void actions.resetStart();
          }}
        />
      )}
      {confirmation === 'cancel' && (
        <ConfirmDialog
          title="取消本次记录？"
          body="这条尚未结束的记录将被删除。"
          confirmLabel="确认取消"
          onCancel={() => setConfirmation(null)}
          onConfirm={() => {
            setConfirmation(null);
            void actions.cancel();
          }}
        />
      )}
    </div>
  );
}

export function OverlongDialog({ actions }: { actions: TodayActions }) {
  const dialogRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    const firstBtn = dialogRef.current?.querySelector<HTMLButtonElement>('button');
    firstBtn?.focus();
    return () => openerRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      void actions.resolveOverlong('continue');
    }
    if (e.key === 'Tab' && dialogRef.current) {
      const buttons = dialogRef.current.querySelectorAll<HTMLButtonElement>('button');
      if (buttons.length === 0) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="dialog overlong-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="overlong-title"
        onKeyDown={handleKeyDown}
      >
        <h2 id="overlong-title">这段记录已超过 20 小时</h2>
        <p>请确认如何处理，应用不会替你修改时间。</p>
        <button type="button" onClick={() => void actions.resolveOverlong('finish-uncertain')}>
          按现在结束并标记不准确
        </button>
        <button type="button" className="danger-button" onClick={() => void actions.resolveOverlong('delete')}>
          删除误记录
        </button>
        <button type="button" onClick={() => void actions.resolveOverlong('continue')}>
          继续记录
        </button>
      </section>
    </div>
  );
}

export function FinishedView({ model, actions }: { model: Extract<TodayModel, { state: 'finished' }>; actions: TodayActions }) {
  const [chooserOpen, setChooserOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<'resume' | 'extend' | null>(null);
  const newSleepButtonRef = useRef<HTMLButtonElement>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const canUndo = model.segment.status === 'completed' && Boolean(model.undoUntil) && Date.parse(model.undoUntil) >= now;
  const isRecentFinish = Boolean(model.segment.finishedAt) && (now - Date.parse(model.segment.finishedAt!)) < 12 * 3600 * 1000;
  const totalMs = model.groupSegments.reduce(
    (total, segment) => total + (segment.endAt ? Math.max(0, Date.parse(segment.endAt) - Date.parse(segment.startAt)) : 0),
    0
  );

  return (
    <div className="today-state finished-view">
      <p className="eyebrow">记录完成</p>
      <h1>{model.segment.kind === 'night' ? '夜间睡眠' : '午睡'}</h1>
      <div className="summary-card">
        <strong>{formatDuration(totalMs)}</strong>
        <span>{model.groupSegments.length > 1 ? `${model.groupSegments.length} 段合计` : '本次时长'}</span>
        <span>
          {formatTime(model.segment.startAt)} — {model.segment.endAt ? formatTime(model.segment.endAt) : '现在'}
        </span>
      </div>
      <div className="secondary-actions">
        {canUndo && <button type="button" onClick={() => void actions.undoWake(model.segment.id)}>撤销起床</button>}
        {isRecentFinish && !canUndo && (
          <>
            <button type="button" onClick={() => setConfirmation('extend')}>
              接续睡到现在
            </button>
            <button type="button" onClick={() => setConfirmation('resume')}>
              误按起床，继续睡觉
            </button>
          </>
        )}
        {model.segment.kind === 'night' && <button type="button" onClick={() => void actions.continueNight(model.segment.id)}>再睡一段</button>}
        <button ref={newSleepButtonRef} type="button" onClick={() => setChooserOpen(true)}>记录新的睡眠</button>
      </div>
      {model.backupWarning && <p className="backup-warning" role="alert">{model.backupWarning}</p>}
      {chooserOpen && (
        <SleepTypeChooser
          openerRef={newSleepButtonRef}
          onStart={actions.start}
          onClose={() => setChooserOpen(false)}
        />
      )}
      {confirmation === 'extend' && (
        <ConfirmDialog
          title="接续睡到现在？"
          body={`将起床时间更新为现在（${formatTime(new Date().toISOString())}），误按起床后接着睡的时间将自动补齐计入本次睡眠。`}
          confirmLabel="确认更新"
          onCancel={() => setConfirmation(null)}
          onConfirm={() => {
            setConfirmation(null);
            void actions.extendWake(model.segment.id);
          }}
        />
      )}
      {confirmation === 'resume' && (
        <ConfirmDialog
          title="继续睡觉？"
          body="将清除之前的起床时间，重新恢复为“记录中”状态，直到您下一次真正睡醒点击起床。"
          confirmLabel="确认恢复记录"
          onCancel={() => setConfirmation(null)}
          onConfirm={() => {
            setConfirmation(null);
            void actions.resumeActive(model.segment.id);
          }}
        />
      )}
    </div>
  );
}

export function TodayPage({ model, actions }: { model: TodayModel; actions: TodayActions }) {
  return (
    <main className="today-page">
      {model.state === 'idle' && <IdleView model={model} onStart={(kind) => void actions.start(kind)} />}
      {model.state === 'active' && <ActiveView model={model} actions={actions} />}
      {model.state === 'finished' && <FinishedView model={model} actions={actions} />}
    </main>
  );
}
