import { useMemo, useRef, useState, useEffect } from 'react';
import type { SleepKind, SleepSegment } from '../domain/sleep';
import { buildStats, formatDuration, groupSleepSegments, type SleepGroup } from '../domain/stats';
import { buildReflectionComparison } from '../domain/stats';
import type { SleepReflection } from '../domain/sleep';
import { SleepReflectionEditor } from './SleepReflectionEditor';
import { sleepPlanForDate, type SleepPlan } from '../domain/sleep-plan';
import { buildSleepInsights } from '../domain/sleep-insights';

export interface HistoryActions {
  changeKind(id: string, kind: SleepKind): Promise<void>;
  deleteSegment(id: string): Promise<void>;
  saveReflection(id: string, value: SleepReflection): Promise<void>;
  startPlan(): Promise<void>;
  pausePlan(): Promise<void>;
  resumePlan(): Promise<void>;
  restartPlan(): Promise<void>;
}

export interface HistoryPageProps {
  segments: SleepSegment[];
  today: string;
  timezone: string;
  actions: HistoryActions;
  plan?: SleepPlan | null;
}

const formatTime = (value: string | null, timezone?: string) => {
  if (!value) return '未知时间';
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(new Date(value));
};

const formatClockMinute = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const onsetLabels: Record<string, string> = { under_15: '不到 15 分钟', '15_to_30': '约 15–30 分钟', '30_to_60': '约 30–60 分钟', over_60: '超过 1 小时', unknown: '记不清' };
const awakeningLabels: Record<string, string> = { none: '没有', one_or_two: '一两次', multiple_or_long: '多次或醒了很久', unknown: '记不清' };

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

export function HistoryPage({ segments, today, timezone, actions, plan = null }: HistoryPageProps) {
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
  const comparison = useMemo(() => buildReflectionComparison(segments), [segments]);
  const insights = useMemo(() => buildSleepInsights(segments, rangeDays, today, timezone), [segments, rangeDays, today, timezone]);
  const planToday = plan ? sleepPlanForDate(plan, today) : null;
  const formatClock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

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
              <span className="stat-label">平均夜间记录时长</span>
              <strong className="stat-value">{formatDuration(stats.averageNightMs)}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">平均午睡记录时长</span>
              <strong className="stat-value">{formatDuration(stats.averageNapMs)}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">平均每日记录时长</span>
              <strong className="stat-value">{formatDuration(stats.averageTotalMs)}</strong>
            </div>
          </div>

          {stats.excludedCount > 0 && (
            <p className="excluded-notice">{stats.excludedCount} 条不准确记录未计入统计</p>
          )}

          {/* 柱状趋势 */}
          {stats.days.length > 0 && (
            <div className="chart-container" aria-label="每日记录时长柱状图">
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

        <section className="stats-section" aria-label="睡眠趋势与提示">
          <h2>睡眠趋势与提示</h2>
          <p className="hint-text">{insights.startDate} 至 {insights.endDate} · {insights.nights.count} 晚有效记录，覆盖 {insights.nights.completedDays} 天；记录时长不是实际睡眠时长。这些提示不是医学诊断。</p>
          <div className="stats-summary-grid">
            <div className="stat-card"><span className="stat-label">夜间平均记录时长</span><strong className="stat-value">{insights.nights.averageDurationMinutes === null ? '未记录' : formatDuration(insights.nights.averageDurationMinutes * 60_000)}</strong></div>
            <div className="stat-card"><span className="stat-label">午睡</span><strong className="stat-value">{insights.naps.count} 次 · {insights.naps.days} 天</strong><span>共 {formatDuration(insights.naps.totalMinutes * 60_000)}</span></div>
            <div className="stat-card"><span className="stat-label">记录时间范围</span><span>开始记录 {insights.bedtimeRange ? `${formatClockMinute(insights.bedtimeRange.startMinute)}–${formatClockMinute(insights.bedtimeRange.endMinute)}（跨度 ${Math.round(insights.bedtimeRange.spanMinutes)} 分）` : '未记录'}</span><span>结束记录 {insights.wakeTimeRange ? `${formatClockMinute(insights.wakeTimeRange.startMinute)}–${formatClockMinute(insights.wakeTimeRange.endMinute)}（跨度 ${Math.round(insights.wakeTimeRange.spanMinutes)} 分）` : '未记录'}</span></div>
          </div>
          <p className="hint-text">入睡区间（已知 {insights.onset.sampleCount} 晚，未填 {insights.onset.missingCount} 晚）：{Object.entries(insights.onset.counts).map(([key, value]) => `${onsetLabels[key] ?? key} ${value}`).join(' · ') || '暂无'}</p>
          <p className="hint-text">夜间醒来（已知 {insights.awakening.sampleCount} 晚，未填 {insights.awakening.missingCount} 晚）：{Object.entries(insights.awakening.counts).map(([key, value]) => `${awakeningLabels[key] ?? key} ${value}`).join(' · ') || '暂无'}</p>
          <p className="hint-text">闹钟：是 {insights.alarm.yes} 晚、否 {insights.alarm.no} 晚、未填 {insights.alarm.missingCount} 晚；醒后精神 {insights.wakeEnergy.sampleCount} 条{insights.wakeEnergy.average === null ? '' : `，均分 ${insights.wakeEnergy.average.toFixed(1)}/5`}；白天精神 {insights.daytimeEnergy.sampleCount} 条{insights.daytimeEnergy.average === null ? '' : `，均分 ${insights.daytimeEnergy.average.toFixed(1)}/5`}。</p>
          <p className="hint-text">{insights.completeness.nightsWithReflection} 晚有补记、{insights.completeness.nightsWithoutReflection} 晚无补记；{insights.completeness.excludedGroups} 组不准确记录未纳入分析。</p>
          <ul aria-label="证据式提示">{insights.messages.map((message, index) => <li key={`${index}-${message.text}`}>{message.text}（样本 {message.sampleCount}）</li>)}</ul>
        </section>

        <section className="stats-section" aria-label="记录时长与精神对照">
          <h2>记录时长与精神对照</h2>
          <p className="hint-text">仅比较有效夜间记录；记录时长不等于实际睡着的时间，评分也不能单独说明需要睡多久。</p>
          <div className="stats-summary-grid comparison-grid">
            {comparison.map((bucket) => (
              <div className="stat-card comparison-card" key={bucket.label}>
                <span className="stat-label">{bucket.label} · {bucket.count} 夜</span>
                <span className="comparison-score">醒后精神 · {bucket.wakeCount} 条评分 <strong>{bucket.wakeCount < 3 ? '样本不足' : `${bucket.averageWakeEnergy!.toFixed(1)} / 5`}</strong></span>
                <span className="comparison-score">白天精神 · {bucket.dayCount} 条评分 <strong>{bucket.dayCount < 3 ? '样本不足' : `${bucket.averageDaytimeEnergy!.toFixed(1)} / 5`}</strong></span>
              </div>
            ))}
          </div>
        </section>

        <section className="stats-section" aria-label="渐进作息计划">
          <h2>渐进作息计划</h2>
          {plan && planToday ? (
            <div className="plan-card">
              <p>建议起床 {formatClock(planToday.wakeMinutes)} · 建议开始睡眠机会 {formatClock(planToday.bedtimeMinutes)}</p>
              <p className="hint-text">每 3 天提前约 25 分钟，逐步接近 07:30；保留 9 小时 30 分钟的睡眠机会。坚持规律，结合精神状态观察，不必强求每天完全一致。</p>
              {planToday.paused ? <button type="button" onClick={() => void actions.resumePlan()}>继续计划</button> : <button type="button" onClick={() => void actions.pausePlan()}>暂停计划</button>}
              <button type="button" onClick={() => void actions.restartPlan()}>按近期记录重新开始</button>
            </div>
          ) : (
            <div className="plan-card">
              <p className="hint-text">从最近 7 段有效夜间记录的起床时间中位数出发；至少需要 1 段有效记录。记录越多，起点越有参考价值。</p>
              <button type="button" onClick={() => void actions.startPlan()}>开始渐进计划</button>
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
                                {isNight && seg.status === 'completed' && (
                                  <details className="reflection-card">
                                    <summary>{seg.reflection ? '修改补记' : '补记精神状态'}</summary>
                                    <SleepReflectionEditor key={seg.id} segment={seg} onSave={actions.saveReflection} />
                                  </details>
                                )}
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
