import { useMemo, useState } from 'react';
import type { SleepKind, SleepSegment } from '../domain/sleep';
import { buildStats, displayDate } from '../domain/stats';

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

const formatDuration = (milliseconds: number | null) => {
  if (milliseconds === null || milliseconds === undefined) return '0分';
  const minutes = Math.max(0, Math.round(milliseconds / 60_000));
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours === 0) return `${remainingMinutes}分`;
  return `${hours}小时${remainingMinutes}分`;
};

const formatTime = (value: string | null) => {
  if (!value) return '未知时间';
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
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
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title">
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

  const stats = useMemo(
    () => buildStats(segments, rangeDays, today, timezone),
    [segments, rangeDays, today, timezone]
  );

  const finishedSegments = useMemo(() => {
    return segments
      .filter((segment) => segment.status !== 'active')
      .sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt));
  }, [segments]);

  // Group finished segments by wake/display date
  const groupedByDate = useMemo(() => {
    const map = new Map<string, SleepSegment[]>();
    for (const segment of finishedSegments) {
      const dateKey = segment.endAt
        ? displayDate(segment.endAt, segment.endTimezone ?? timezone)
        : displayDate(segment.startAt, segment.startTimezone ?? timezone);
      const list = map.get(dateKey) ?? [];
      list.push(segment);
      map.set(dateKey, list);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [finishedSegments, timezone]);

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
            groupedByDate.map(([date, dateSegments]) => {
              const nightGroups = new Map<string, SleepSegment[]>();
              const naps: SleepSegment[] = [];

              for (const seg of dateSegments) {
                if (seg.kind === 'night') {
                  const gId = seg.groupId ?? seg.id;
                  const list = nightGroups.get(gId) ?? [];
                  list.push(seg);
                  nightGroups.set(gId, list);
                } else {
                  naps.push(seg);
                }
              }

              return (
                <div key={date} className="history-day-card">
                  <h3 className="history-date-title">{date}</h3>

                  {/* Night sleep groups */}
                  {Array.from(nightGroups.entries()).map(([gId, groupList]) => {
                    const groupTotalMs = groupList.reduce(
                      (acc, s) => acc + (s.endAt ? Date.parse(s.endAt) - Date.parse(s.startAt) : 0),
                      0
                    );
                    const isMulti = groupList.length > 1;

                    return (
                      <div key={gId} className="history-record-group night-record">
                        <div className="group-header">
                          <span className="record-badge night-badge">夜间睡眠</span>
                          <strong className="group-duration">{formatDuration(groupTotalMs)}</strong>
                          {isMulti && <span className="multi-badge">{groupList.length} 段合计</span>}
                        </div>

                        <div className="group-segments">
                          {groupList.map((seg) => {
                            const segMs = seg.endAt ? Date.parse(seg.endAt) - Date.parse(seg.startAt) : 0;
                            const isUncertain = seg.status === 'uncertain';
                            return (
                              <div key={seg.id} className="segment-row">
                                <div className="segment-info">
                                  <span className="segment-time">
                                    {formatTime(seg.startAt)} — {formatTime(seg.endAt)}
                                  </span>
                                  <span className="segment-duration">({formatDuration(segMs)})</span>
                                  {isUncertain && (
                                    <span className="uncertain-tag" title={seg.uncertainReason ?? undefined}>
                                      时间可能不准确
                                    </span>
                                  )}
                                </div>
                                <div className="segment-actions">
                                  <button
                                    type="button"
                                    className="action-link"
                                    onClick={() => void actions.changeKind(seg.id, 'nap')}
                                  >
                                    改为午睡
                                  </button>
                                  <button
                                    type="button"
                                    className="action-link danger-link"
                                    onClick={() => setDeletingSegment(seg)}
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

                  {/* Naps */}
                  {naps.map((seg) => {
                    const segMs = seg.endAt ? Date.parse(seg.endAt) - Date.parse(seg.startAt) : 0;
                    const isUncertain = seg.status === 'uncertain';
                    return (
                      <div key={seg.id} className="history-record-group nap-record">
                        <div className="group-header">
                          <span className="record-badge nap-badge">午睡</span>
                          <strong className="group-duration">{formatDuration(segMs)}</strong>
                        </div>
                        <div className="segment-row">
                          <div className="segment-info">
                            <span className="segment-time">
                              {formatTime(seg.startAt)} — {formatTime(seg.endAt)}
                            </span>
                            {isUncertain && (
                              <span className="uncertain-tag" title={seg.uncertainReason ?? undefined}>
                                时间可能不准确
                              </span>
                            )}
                          </div>
                          <div className="segment-actions">
                            <button
                              type="button"
                              className="action-link"
                              onClick={() => void actions.changeKind(seg.id, 'night')}
                            >
                              改为夜间睡眠
                            </button>
                            <button
                              type="button"
                              className="action-link danger-link"
                              onClick={() => setDeletingSegment(seg)}
                            >
                              删除
                            </button>
                          </div>
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
          onCancel={() => setDeletingSegment(null)}
        />
      )}
    </main>
  );
}
