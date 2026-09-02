import { useMemo, useRef, useState, useEffect } from 'react';
import type { SleepKind, SleepSegment } from '../domain/sleep';
import { buildStats, formatDuration, groupSleepSegments, type SleepGroup } from '../domain/stats';

export interface HistoryActions {
  changeKind(id: string, kind: SleepKind): Promise<void>;
  deleteSegment(id: string): Promise<void>;
}

export interface HistoryPageProps {
  segments: SleepSegment[];
  today: string;
  timezone: string;
  actions: HistoryActions;
}

const formatTime = (value: string | null, timezone?: string) => {
  if (!value) return '未知时间';
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(new Date(value));
};

function ConfirmDeleteDialog({
  title,
  body,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
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
        aria-labelledby="delete-dialog-title"
        onKeyDown={handleKeyDown}
      >
        <h2 id="delete-dialog-title">{title}</h2>
        <p>{body}</p>
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="danger-button" onClick={onConfirm}>
            确认删除
          </button>
        </div>
      </section>
    </div>
  );
}

export function HistoryPage({ segments, today, timezone, actions }: HistoryPageProps) {
  const [rangeDays, setRangeDays] = useState<7 | 30>(7);
  const [deletingSegment, setDeletingSegment] = useState<SleepSegment | null>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);

  const stats = useMemo(
    () => buildStats(segments, rangeDays, today, timezone),
    [segments, rangeDays, today, timezone]
  );

  const finishedSegments = useMemo(() => {
    return segments
      .filter((segment) => segment.status !== 'active')
      .sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt));
  }, [segments]);

  // Group all finished segments using groupSleepSegments so midnight-crossing nights are unified under the wake date
  const groupedByDate = useMemo(() => {
    const groups = groupSleepSegments(finishedSegments);
    const map = new Map<string, SleepGroup[]>();
    for (const group of groups) {
      const list = map.get(group.date) ?? [];
      list.push(group);
      map.set(group.date, list);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [finishedSegments]);

  const maxTotalMs = useMemo(() => {
    return Math.max(...stats.days.map((d) => d.totalMs), 8 * 3600 * 1000);
  }, [stats.days]);

  return (
    <main className="history-page">
      <div className="history-container">
        <header className="page-header">
          <p className="eyebrow">历史与统计</p>
          <h1>睡眠记录</h1>
        </header>

        {/* 统计切换与卡片 */}
        <section className="stats-section" aria-label="睡眠统计">
          <div className="range-toggle" role="group" aria-label="统计时间范围">
            <button
              type="button"
              className={rangeDays === 7 ? 'range-button active' : 'range-button'}
              aria-pressed={rangeDays === 7}
              onClick={() => setRangeDays(7)}
            >
              最近 7 天
            </button>
            <button
              type="button"
              className={rangeDays === 30 ? 'range-button active' : 'range-button'}
              aria-pressed={rangeDays === 30}
              onClick={() => setRangeDays(30)}
            >
              最近 30 天
            </button>
          </div>

          <div className="stats-summary-grid">
            <div className="stat-card">
              <span className="stat-label">平均夜间睡眠</span>
              <strong className="stat-value">{formatDuration(stats.averageNightMs)}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">平均午睡</span>
              <strong className="stat-value">{formatDuration(stats.averageNapMs)}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">平均每日总睡眠</span>
              <strong className="stat-value">{formatDuration(stats.averageTotalMs)}</strong>
            </div>
          </div>

          {stats.excludedCount > 0 && (
            <p className="excluded-notice">{stats.excludedCount} 条不准确记录未计入统计</p>
          )}

          {/* 柱状趋势 */}
          {stats.days.length > 0 && (
            <div className="chart-container" aria-label="每日睡眠时长柱状图">
              <div className="bar-chart">
                {stats.days.map((day) => {
                  const nightPct = Math.min(100, (day.nightMs / maxTotalMs) * 100);
                  const napPct = Math.min(100, (day.napMs / maxTotalMs) * 100);
                  const dateShort = day.date.slice(5);
                  return (
                    <div key={day.date} className="chart-col" title={`${day.date}: ${formatDuration(day.totalMs)}`}>
                      <span className="col-value">{formatDuration(day.totalMs)}</span>
                      <div className="col-bars">
                        {napPct > 0 && <div className="bar bar-nap" style={{ height: `${napPct}%` }} />}
                        {nightPct > 0 && <div className="bar bar-night" style={{ height: `${nightPct}%` }} />}
                      </div>
                      <span className="col-label">{dateShort}</span>
                    </div>
                  );
                })}
              </div>
              <div className="chart-legend">
                <span className="legend-item"><span className="legend-dot night-dot" />夜间</span>
                <span className="legend-item"><span className="legend-dot nap-dot" />午睡</span>
              </div>
            </div>
          )}
        </section>

        {/* 历史明细列表 */}
        <section className="history-list-section" aria-label="每日记录明细">
          <h2>每日记录</h2>
          {groupedByDate.length === 0 ? (
            <p className="empty-history-text">暂无历史睡眠记录</p>
          ) : (
            groupedByDate.map(([date, dateGroups]) => {
              const dayNightMs = dateGroups.filter((g) => g.kind === 'night').reduce((sum, g) => sum + g.totalMs, 0);
              const dayNapMs = dateGroups.filter((g) => g.kind === 'nap').reduce((sum, g) => sum + g.totalMs, 0);

              return (
                <div key={date} className="history-day-card">
                  <h3 className="history-date-title">{date}</h3>
                  <p className="day-total-summary">夜间 {formatDuration(dayNightMs)} · 午睡 {formatDuration(dayNapMs)} · 全天 {formatDuration(dayNightMs + dayNapMs)}</p>

                  {dateGroups.map((group) => {
                    const isNight = group.kind === 'night';
                    const isMulti = group.segments.length > 1;

                    return (
                      <div key={group.key} className={`history-record-group ${isNight ? 'night-record' : 'nap-record'}`}>
                        <div className="group-header">
                          <span className={`record-badge ${isNight ? 'night-badge' : 'nap-badge'}`}>
                            {isNight ? '夜间睡眠' : '午睡'}
                          </span>
                          <strong className="group-duration">{formatDuration(group.totalMs)}</strong>
                          {isMulti && <span className="multi-badge">{group.segments.length} 段合计</span>}
                        </div>

                        <div className="group-segments">
                          {group.segments.map((seg) => {
                            const segMs = seg.status === 'completed' && seg.endAt
                              ? Math.max(0, Date.parse(seg.endAt) - Date.parse(seg.startAt))
                              : 0;
                            const isUncertain = seg.status === 'uncertain';
                            const isInvalid = seg.status === 'invalid';
                            return (
                              <div key={seg.id} className="segment-row">
                                <div className="segment-info">
                                  <span className="segment-time">
                                    {formatTime(seg.startAt, seg.startTimezone)} — {formatTime(seg.endAt, seg.endTimezone ?? seg.startTimezone)}
                                  </span>
                                  <span className="segment-duration">({formatDuration(segMs)})</span>
                                  {isUncertain && (
                                    <span className="uncertain-tag" title={seg.uncertainReason ?? undefined}>
                                      时间可能不准确
                                    </span>
                                  )}
                                  {isInvalid && <span className="uncertain-tag">时间无效</span>}
                                </div>
                                <div className="segment-actions">
                                  <button
                                    type="button"
                                    className="action-link"
                                    onClick={() => void actions.changeKind(seg.id, isNight ? 'nap' : 'night')}
                                  >
                                    {isNight ? '改为午睡' : '改为夜间睡眠'}
                                  </button>
                                  <button
                                    type="button"
                                    className="action-link danger-link"
                                    onClick={(event) => {
                                      deleteTriggerRef.current = event.currentTarget;
                                      setDeletingSegment(seg);
                                    }}
                                  >
                                    删除
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </section>
      </div>

      {/* 删除确认对话框 */}
      {deletingSegment && (
        <ConfirmDeleteDialog
          title="确认删除该记录？"
          body={`删除该条 ${
            deletingSegment.kind === 'night' ? '夜间睡眠' : '午睡'
          }（${formatDuration(
            deletingSegment.endAt
              ? Date.parse(deletingSegment.endAt) - Date.parse(deletingSegment.startAt)
              : 0
          )}），此操作无法撤销。`}
          onConfirm={() => {
            const id = deletingSegment.id;
            setDeletingSegment(null);
            void actions.deleteSegment(id);
          }}
          onCancel={() => {
            setDeletingSegment(null);
            deleteTriggerRef.current?.focus();
          }}
        />
      )}
    </main>
  );
}
