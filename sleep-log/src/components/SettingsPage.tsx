import { useState, useEffect, type ChangeEvent } from 'react';
import {
  createBackup,
  mergeBackup,
  parseBackup,
  resolveBackupMerge,
  shouldRemindManualBackup,
  toCsv,
  type MergeConflict,
  type ConflictResolution,
  type SleepBackup,
} from '../data/backup';
import type { BackupCapability, BackupStatus } from '../data/file-backup';
import type { SleepSegment } from '../domain/sleep';
import { displayDate } from '../domain/stats';

export interface SettingsModel {
  capability: BackupCapability;
  status: BackupStatus;
  segments: SleepSegment[];
  isPersistentStorageGranted?: boolean;
}

export interface SettingsActions {
  chooseFolder(): Promise<void>;
  exportJson(): Promise<void>;
  exportCsv(): void;
  restore(expected: SleepSegment[], segments: SleepSegment[]): Promise<void>;
  requestPersistentStorage(): Promise<boolean>;
}

export interface SettingsPageProps {
  model: SettingsModel;
  timezone: string;
  actions: SettingsActions;
}

function formatChineseDate(iso: string, timezone: string): string {
  const [year, month, day] = displayDate(iso, timezone).split('-').map(Number);
  return `${year}年${month}月${day}日`;
}

export function SettingsPage({ model, timezone, actions }: SettingsPageProps) {
  const [backupFile, setBackupFile] = useState<SleepBackup | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<MergeConflict[]>([]);
  const [mergeBase, setMergeBase] = useState<SleepSegment[]>([]);
  const [previewSnapshot, setPreviewSnapshot] = useState<SleepSegment[]>([]);
  const [resolutions, setResolutions] = useState<Record<string, ConflictResolution>>({});
  const [operationMessage, setOperationMessage] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackContact, setFeedbackContact] = useState('');
  const [feedbackSending, setFeedbackSending] = useState(false);
  const [feedbackStatus, setFeedbackStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCopyEmail = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText('2158403652@qq.com');
      } else {
        const input = document.createElement('input');
        input.value = '2158403652@qq.com';
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      setOperationMessage('复制失败，请手动复制：2158403652@qq.com');
    }
  };

  const handleFeedbackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedbackText.trim()) return;

    setFeedbackSending(true);
    setFeedbackStatus(null);

    try {
      const res = await fetch('https://formsubmit.co/ajax/2158403652@qq.com', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          '反馈建议': feedbackText.trim(),
          '联系方式': feedbackContact.trim() || '未填写',
          '提交时刻': new Date().toLocaleString('zh-CN'),
          _subject: '【眠记】收到新用户反馈',
        }),
      });

      if (res.ok) {
        setFeedbackStatus({
          type: 'success',
          message: '✓ 感谢您的反馈！内容已成功推送到作者邮箱。',
        });
        setFeedbackText('');
        setFeedbackContact('');
      } else {
        throw new Error('发送未成功');
      }
    } catch {
      setFeedbackStatus({
        type: 'error',
        message: '网络发送未成功，您可直接复制下方 QQ 邮箱与作者联系。',
      });
    } finally {
      setFeedbackSending(false);
    }
  };

  const showError = (error: unknown, fallback: string) => {
    setOperationMessage(error instanceof Error ? error.message : fallback);
  };

  const needsManualReminder = shouldRemindManualBackup(
    model.status.lastManualExportAt ?? null,
    Date.now()
  );

  const handleFileSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError(null);
    setBackupFile(null);
    setConflicts([]);
    setMergeBase([]);
    setPreviewSnapshot([]);
    setResolutions({});
    setOperationMessage(null);

    try {
      const text = await file.text();
      const parsed = parseBackup(text);
      setBackupFile(parsed);

      const mergeResult = mergeBackup(model.segments, parsed.segments);
      setConflicts(mergeResult.conflicts);
      setMergeBase(mergeResult.merged);
      setPreviewSnapshot([...model.segments]);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : '备份文件格式不正确');
    }
  };

  const handleConfirmRestore = async () => {
    if (!backupFile) return;

    // Check if any conflict is unresolved
    const hasUnresolved = conflicts.some((c) => !resolutions[c.current.id]);
    if (hasUnresolved) {
      setParseError('存在未解决的冲突，请先选择处理方式');
      return;
    }

    const finalSegments = resolveBackupMerge(mergeBase, conflicts, resolutions);

    try {
      await actions.restore(previewSnapshot, finalSegments);
      setBackupFile(null);
      setConflicts([]);
      setResolutions({});
      setOperationMessage('备份恢复成功！');
    } catch (err) {
      setParseError(err instanceof Error ? err.message : '恢复备份失败');
    }
  };

  const handleChooseFolder = async () => {
    try { await actions.chooseFolder(); }
    catch (error) { showError(error, '自动备份文件夹操作失败'); }
  };

  // Compute preview summary text
  const previewSummary = () => {
    if (!backupFile) return null;
    const count = backupFile.segments.length;
    if (count === 0) return '0 条记录';

    const dates = backupFile.segments.flatMap((s) => [s.startAt, ...(s.endAt ? [s.endAt] : [])]);
    const earliest = dates.reduce((min, cur) => (cur < min ? cur : min), dates[0]);
    const latest = dates.reduce((max, cur) => (cur > max ? cur : max), dates[0]);

    return `${count} 条记录，${formatChineseDate(earliest, timezone)}至${formatChineseDate(
      latest,
      timezone
    )}`;
  };

  const formatTime = (value: string | null, segmentTimezone: string) => value
    ? new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: segmentTimezone }).format(new Date(value))
    : '未结束';
  const conflictValue = (segment: SleepSegment) => `${segment.kind === 'night' ? '夜间睡眠' : '午睡'}，${formatTime(segment.startAt, segment.startTimezone)} — ${formatTime(segment.endAt, segment.endTimezone ?? segment.startTimezone)}`;
  const hasUnresolvedConflicts = conflicts.some((conflict) => !resolutions[conflict.current.id]);

  return (
    <main className="settings-page">
      <div className="settings-container">
        <header className="page-header">
          <p className="eyebrow">设置与数据</p>
          <h1>数据管理</h1>
        </header>

        {operationMessage && <div className="toast-message" role="alert">{operationMessage}</div>}

        {/* 自动备份状态与文件夹 */}
        {model.capability === 'folder-auto' && (
          <section className="settings-section" aria-label="自动备份状态">
            <h2>手机自动备份</h2>
            <div className="status-card">
              <p className="hint-text">
                授权手机文件夹后，每次记录变更会自动写入独立备份文件。请注意：在浏览器完全关闭时无法在后台自动写入。
              </p>
              <div className="status-row">
                <span className="status-label">最近自动备份</span>
                <span>
                  {model.status.lastAutomaticBackupAt || model.status.lastSuccessfulBackupAt
                    ? formatChineseDate(model.status.lastAutomaticBackupAt ?? model.status.lastSuccessfulBackupAt!, timezone)
                    : '暂无自动备份记录'}
                </span>
              </div>
              {model.status.state === 'needs-permission' && (
                <p className="warning-text">需要重新授权文件夹访问权限</p>
              )}
              {model.status.state === 'write-failed' && (
                <p className="error-text">
                  自动备份写入失败：{model.status.message || '未知错误'}
                </p>
              )}
              <button
                type="button"
                className="full-button primary-action-btn"
                onClick={() => void handleChooseFolder()}
              >
                {model.status.state === 'ready' ? '更改自动备份文件夹' : '选择自动备份文件夹'}
              </button>
            </div>
          </section>
        )}

        {/* 备份导出与导入 */}
        <section className="settings-section" aria-label="数据备份与恢复">
          <h2>数据备份与恢复</h2>
          <div className="status-card" style={{ marginBottom: '1rem' }}>
            <div className="status-row">
              <span className="status-label">导出备份状态</span>
              <span>
                {model.status.lastManualExportAt
                  ? `最近导出：${formatChineseDate(model.status.lastManualExportAt, timezone)}`
                  : '尚未导出备份'}
              </span>
            </div>
            {needsManualReminder && (
              <p className="warning-text" style={{ marginTop: '0.5rem' }}>
                距离上次备份已超过 30 天，建议导出备份
              </p>
            )}
          </div>
          <div className="button-group">
            <button
              type="button"
              className="export-btn"
              onClick={() => void actions.exportJson()}
            >
              导出完整备份 (JSON)
            </button>
            <button
              type="button"
              className="export-btn"
              onClick={() => actions.exportCsv()}
            >
              导出表格 (CSV)
            </button>
          </div>

          <div className="restore-box">
            <h3>恢复备份 (JSON)</h3>
            <label className="file-input-label" htmlFor="backup-file-input">
              选择备份文件
            </label>
            <input
              id="backup-file-input"
              type="file"
              accept=".json"
              aria-label="选择备份文件"
              onChange={(e) => void handleFileSelect(e)}
            />

            {parseError && <p className="error-text">{parseError}</p>}

            {backupFile && (
              <div className="restore-preview-card">
                <h4>备份预览</h4>
                <p className="preview-text">{previewSummary()}</p>

                {conflicts.length > 0 && (
                  <div className="conflicts-section">
                    <p className="warning-text">发现 {conflicts.length} 条记录存在同 ID 冲突：</p>
                    {conflicts.map((c) => (
                      <div key={c.current.id} className="conflict-item">
                        <p>
                          记录 {c.current.id.slice(0, 8)}：当前：{conflictValue(c.current)}；备份：{conflictValue(c.incoming)}
                        </p>
                        <div className="conflict-choices">
                          <label>
                            <input
                              type="radio"
                              name={`conflict-${c.current.id}`}
                              checked={resolutions[c.current.id] === 'keep-current'}
                              onChange={() =>
                                setResolutions((prev) => ({
                                  ...prev,
                                  [c.current.id]: 'keep-current',
                                }))
                              }
                            />
                            保留当前
                          </label>
                          <label>
                            <input
                              type="radio"
                              name={`conflict-${c.current.id}`}
                              checked={resolutions[c.current.id] === 'use-backup'}
                              onChange={() =>
                                setResolutions((prev) => ({
                                  ...prev,
                                  [c.current.id]: 'use-backup',
                                }))
                              }
                            />
                            采用备份
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="preview-actions">
                  <button
                    type="button"
                    className="danger-button"
                    onClick={() => {
                      setBackupFile(null);
                      setConflicts([]);
                      setMergeBase([]);
                      setPreviewSnapshot([]);
                      setResolutions({});
                    }}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={hasUnresolvedConflicts}
                    onClick={() => void handleConfirmRestore()}
                  >
                    确认恢复
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* 意见与反馈 */}
        <section className="settings-section" aria-label="意见与反馈">
          <h2>意见与反馈</h2>
          <div className="feedback-card">
            <p className="hint-text">
              “眠记”由作者独立开发。如果您遇到使用痛点、Bug 或有任何功能建议，欢迎随时反馈，作者会在第一时间跟进！
            </p>
            <form className="feedback-form" onSubmit={(e) => void handleFeedbackSubmit(e)}>
              <textarea
                className="feedback-textarea"
                rows={3}
                placeholder="写下您的建议、吐槽或遇到的问题..."
                maxLength={1000}
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                required
                aria-label="反馈建议"
              />
              <input
                type="text"
                className="feedback-contact-input"
                placeholder="您的联系方式（选填，如微信号/QQ/邮箱，方便回复）"
                maxLength={200}
                value={feedbackContact}
                onChange={(e) => setFeedbackContact(e.target.value)}
                aria-label="联系方式"
              />
              <button
                type="submit"
                className="action-btn primary-action-btn feedback-submit-btn"
                disabled={feedbackSending || !feedbackText.trim()}
              >
                {feedbackSending ? '正在发送中...' : '提交反馈'}
              </button>
            </form>
            {feedbackStatus && (
              <p
                className={feedbackStatus.type === 'success' ? 'feedback-success-text' : 'error-text'}
                role="alert"
              >
                {feedbackStatus.message}
              </p>
            )}
            <div className="feedback-direct-contact">
              <span className="hint-text">或直接联系作者 QQ 邮箱：</span>
              <div className="email-badge-row">
                <code className="email-code">2158403652@qq.com</code>
                <button
                  type="button"
                  className="copy-email-btn"
                  onClick={() => void handleCopyEmail()}
                >
                  {copied ? '✓ 已复制' : '复制邮箱'}
                </button>
                <a
                  href="mailto:2158403652@qq.com?subject=【眠记】睡眠记录使用反馈"
                  className="mailto-link-btn"
                >
                  发送邮件
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* 重要说明与版本 */}
        <section className="settings-section info-section" aria-label="关于与说明">
          <h2>重要数据保护说明</h2>
          <div className="info-card">
            <p>1. 数据默认存储在本机浏览器的 IndexedDB 数据库中。</p>
            <p>2. 网页版无法承诺永久锁定存储；若清理浏览器网站数据或卸载浏览器，可能会清除本地记录。</p>
            <p>3. 建议定期点击上方“导出完整备份 (JSON)”将数据保存到其他存储设备或云盘。</p>
            <p>4. 换机或清除数据后，可通过“恢复备份”随时完整导入历史记录。</p>
          </div>
          <div className="app-version">
            <span>应用版本：0.1.0 (PWA 离线版)</span>
          </div>
        </section>
      </div>
    </main>
  );
}
