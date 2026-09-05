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
import type { StorageProtectionState } from '../data/browser-storage';
import type { SleepSegment } from '../domain/sleep';
import { displayDate } from '../domain/stats';
import { isNativeApp } from '../native/platform';
import { openNativeAppSettings } from '../native/widget-bridge';

export interface SettingsModel {
  capability: BackupCapability;
  status: BackupStatus;
  segments: SleepSegment[];
  storageProtection: StorageProtectionState;
}

export interface SettingsActions {
  chooseFolder(): Promise<void>;
  exportJson(): Promise<string | void>;
  exportCsv(): Promise<string | void>;
  restore(expected: SleepSegment[], segments: SleepSegment[]): Promise<void>;
  requestStorageProtection(): Promise<void>;
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
  const isNative = isNativeApp();
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<{
    hasUpdate: boolean;
    message: string;
    latestVersion?: string;
    downloadUrl?: string;
  } | null>(null);
  const [pasteModalOpen, setPasteModalOpen] = useState(false);
  const [manualText, setManualText] = useState('');

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateStatus(null);
    try {
      const res = await fetch('https://api.github.com/repos/kun633/mianji/releases/latest', {
        headers: { Accept: 'application/vnd.github.v3+json' },
      });
      if (!res.ok) throw new Error('网络请求失败');
      const data = await res.json();
      const tagName: string = data.tag_name || '';
      const latestVer = tagName.replace(/^v/, '');
      const currentVer = '1.0.6';

      const compareVersions = (v1: string, v2: string) => {
        const p1 = v1.split('.').map(Number);
        const p2 = v2.split('.').map(Number);
        for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
          const n1 = p1[i] || 0;
          const n2 = p2[i] || 0;
          if (n1 > n2) return 1;
          if (n1 < n2) return -1;
        }
        return 0;
      };

      const assets = Array.isArray(data.assets) ? data.assets : [];
      const apkAsset = assets.find((a: { name?: string }) => typeof a.name === 'string' && a.name.endsWith('.apk'));
      const downloadUrl = (apkAsset as { browser_download_url?: string } | undefined)?.browser_download_url || (data.html_url as string) || 'https://github.com/kun633/mianji/releases';

      if (compareVersions(latestVer, currentVer) > 0) {
        setUpdateStatus({
          hasUpdate: true,
          message: `发现新版本 ${tagName}！点击下方按钮直接下载更新安装包。`,
          latestVersion: latestVer,
          downloadUrl,
        });
      } else {
        setUpdateStatus({
          hasUpdate: false,
          message: `✓ 当前已是最新版本 (v${currentVer})`,
        });
      }
    } catch {
      setUpdateStatus({
        hasUpdate: false,
        message: '检查更新未成功，请确认网络连接或梯子状态。您也可以直接访问 GitHub 仓库查看最新版本。',
        downloadUrl: 'https://github.com/kun633/mianji/releases',
      });
    } finally {
      setCheckingUpdate(false);
    }
  };

  useEffect(() => {
    if (!operationMessage) return;
    const timer = window.setTimeout(() => setOperationMessage(null), 5000);
    return () => window.clearTimeout(timer);
  }, [operationMessage]);

  const handleCopyEmail = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText('2158403652@qq.com');
      } else {
        throw new Error('No clipboard API');
      }
    } catch {
      try {
        const input = document.createElement('input');
        input.value = '2158403652@qq.com';
        input.setAttribute('readonly', '');
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
      } catch {
        setOperationMessage('复制失败，请手动复制：2158403652@qq.com');
        return;
      }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  const handleFeedbackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedbackText.trim()) return;

    setFeedbackSending(true);
    setFeedbackStatus(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const res = await fetch('https://formsubmit.co/ajax/2158403652@qq.com', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          '反馈建议': feedbackText.trim(),
          '联系方式': feedbackContact.trim() || '未填写',
          '提交时刻': new Date().toLocaleString('zh-CN'),
          _subject: '【眠记】收到新用户反馈',
          _captcha: 'false',
          _template: 'table',
        }),
      });
      clearTimeout(timeoutId);

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
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      const isTimeout = err instanceof Error && err.name === 'AbortError';
      setFeedbackStatus({
        type: 'error',
        message: isTimeout
          ? '网络连接超时，您可直接复制下方 QQ 邮箱与作者联系。'
          : '网络发送未成功，您可直接复制下方 QQ 邮箱与作者联系。',
      });
    } finally {
      setFeedbackSending(false);
    }
  };

  const showError = (error: unknown, fallback: string) => {
    setOperationMessage(error instanceof Error && error.message.trim() ? error.message : fallback);
  };

  const needsManualReminder = shouldRemindManualBackup(
    model.status.lastManualExportAt ?? null,
    Date.now()
  );

  const handleProcessBackupText = (text: string) => {
    setParseError(null);
    setBackupFile(null);
    setConflicts([]);
    setMergeBase([]);
    setPreviewSnapshot([]);
    setResolutions({});
    setOperationMessage(null);

    try {
      const trimmed = text.trim();
      if (!trimmed) {
        throw new Error('备份内容为空');
      }
      const parsed = parseBackup(trimmed);
      setBackupFile(parsed);

      const mergeResult = mergeBackup(model.segments, parsed.segments);
      setConflicts(mergeResult.conflicts);
      setMergeBase(mergeResult.merged);
      setPreviewSnapshot([...model.segments]);
      setOperationMessage('✓ 备份解析成功，请在下方预览并确认恢复');
    } catch (err) {
      setParseError(err instanceof Error ? err.message : '备份内容格式不正确，解析失败');
    }
  };

  const handleFileSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      handleProcessBackupText(text);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : '读取文件失败');
    } finally {
      e.target.value = '';
    }
  };

  const handlePasteFromClipboard = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
        const text = await navigator.clipboard.readText();
        if (text && text.trim().startsWith('{')) {
          handleProcessBackupText(text);
          return;
        }
      }
      setPasteModalOpen(true);
    } catch {
      setPasteModalOpen(true);
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

  const handleRequestStorageProtection = async () => {
    try { await actions.requestStorageProtection(); }
    catch (error) { showError(error, '无法请求防自动清理保护'); }
  };

  const handleExport = async (exportAction: () => Promise<string | void>) => {
    try {
      const msg = await exportAction();
      setOperationMessage(msg || '导出成功！已保存至您的设备。');
    }
    catch (error) { showError(error, '导出失败，请重试'); }
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

        {operationMessage && (
          <div className="toast-message" role="alert">
            <span>{operationMessage}</span>
            <button
              type="button"
              className="toast-close-btn"
              onClick={() => setOperationMessage(null)}
              aria-label="关闭提示"
            >
              ×
            </button>
          </div>
        )}

        <section className="settings-section" aria-label="防自动清理保护">
          <h2>防自动清理保护</h2>
          <div className="status-card">
            <div className="status-row">
              <span className="status-label">当前状态</span>
              <span>
                {isNative
                  ? '已获得原生沙箱持久保护'
                  : (
                    <>
                      {model.storageProtection === 'checking' && '正在检查浏览器保护状态…'}
                      {model.storageProtection === 'granted' && '已获得防自动清理保护'}
                      {model.storageProtection === 'not-granted' && '尚未获得防自动清理保护'}
                      {model.storageProtection === 'unsupported' && '当前浏览器不支持此项保护'}
                      {model.storageProtection === 'unknown' && '暂时无法确认保护状态'}
                    </>
                  )}
              </span>
            </div>
            <p className="hint-text">
              {isNative
                ? '在 Android 原生应用中，数据已存放在手机私有沙箱的 SQLite 本地数据库中，操作系统不会像清理浏览器缓存那样清理数据。'
                : '此保护只能降低浏览器因空间不足自动清理数据的风险，不能防止主动清除网站数据、卸载浏览器、换机或设备损坏。'}
            </p>
            {!isNative && (model.storageProtection === 'not-granted' || model.storageProtection === 'unknown') && (
              <button
                type="button"
                className="full-button primary-action-btn"
                onClick={() => void handleRequestStorageProtection()}
              >
                请求防自动清理保护
              </button>
            )}
          </div>
        </section>

        {/* 自动备份状态与文件夹 */}
        {!isNative && model.capability === 'folder-auto' && (
          <section className="settings-section" aria-label="自动备份状态">
            <h2>手机自动备份</h2>
            <div className="status-card">
              <p className="hint-text">
                授权文件夹后，每次记录变更会自动写入独立备份文件。请注意：在浏览器完全关闭时无法在后台自动写入。
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
              <span className="status-label">外部备份状态</span>
              <span>
                {model.status.lastManualExportAt
                  ? `最近执行导出：${formatChineseDate(model.status.lastManualExportAt, timezone)}`
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
              onClick={() => void handleExport(actions.exportJson)}
            >
              导出完整备份 (JSON)
            </button>
            <button
              type="button"
              className="export-btn"
              onClick={() => void handleExport(actions.exportCsv)}
            >
              导出表格 (CSV)
            </button>
          </div>

          <div className="restore-box">
            <h3>恢复备份 (JSON)</h3>
            <p className="hint-text">
              支持直接从手机本地文件导入，或从微信/QQ复制备份文本后一键粘贴恢复。
            </p>
            <div className="button-group restore-action-group">
              <label className="full-button primary-action-btn file-select-label" htmlFor="backup-file-input">
                📂 从本地文件选择备份
              </label>
              <button
                type="button"
                className="full-button export-btn"
                onClick={() => void handlePasteFromClipboard()}
              >
                📋 从剪贴板粘贴恢复
              </button>
              <button
                type="button"
                className="full-button export-btn"
                onClick={() => setPasteModalOpen(true)}
              >
                📝 手动粘贴备份文本
              </button>
            </div>
            <input
              id="backup-file-input"
              type="file"
              accept="application/json,text/plain,text/*,.json,*/*"
              style={{ display: 'none' }}
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
            <p className="hint-text">
              仅在您点击提交时，反馈内容、选填联系方式和提交时间会发送至第三方邮件转发服务；不会附带或上传睡眠记录。
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

        {/* 软件版本与检查更新 */}
        <section className="settings-section" aria-label="软件版本与更新">
          <h2>软件版本与更新</h2>
          <div className="status-card">
            <div className="status-row">
              <span className="status-label">当前运行版本</span>
              <span>v1.0.6 ({isNative ? 'Android 原生版' : 'Web 网页版'})</span>
            </div>
            <p className="hint-text">
              支持一键联网检测 GitHub 官方发布的最新版本，并可直接下载更新安装包（覆盖安装数据不丢失）。
            </p>
            {isNative && (
              <div style={{ marginTop: '0.6rem', padding: '0.6rem 0.8rem', background: 'rgba(59, 130, 246, 0.08)', borderRadius: '8px', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
                <p className="hint-text" style={{ margin: 0, color: '#60a5fa', fontWeight: 500 }}>
                  💡 锁屏免密使用设置说明：
                </p>
                <p className="hint-text" style={{ margin: '0.4rem 0', fontSize: '12px', lineHeight: 1.5 }}>
                  vivo 等手机系统默认限制第三方应用在锁屏上方浮动。若锁屏点亮后未直接显示，请点击下方按钮，在系统权限中允许【锁屏显示】（或“后台弹出界面”）。
                </p>
                <button
                  type="button"
                  className="full-button export-btn"
                  style={{ width: '100%', marginTop: '0.3rem', fontSize: '13px', padding: '6px 10px' }}
                  onClick={() => void openNativeAppSettings()}
                >
                  👉 点击跳转系统设置开启【锁屏显示】权限
                </button>
              </div>
            )}
            {updateStatus && (
              <p className={updateStatus.hasUpdate ? 'warning-text' : 'hint-text'} style={{ marginTop: '0.5rem', marginBottom: '0.5rem' }}>
                {updateStatus.message}
              </p>
            )}
            {updateStatus?.downloadUrl && (
              <a
                href={updateStatus.downloadUrl}
                target="_blank"
                rel="noreferrer"
                className="full-button primary-action-btn"
                style={{ display: 'block', textAlign: 'center', textDecoration: 'none', marginBottom: '0.5rem', color: '#ffffff' }}
              >
                {updateStatus.hasUpdate ? `立即下载新版本 (v${updateStatus.latestVersion})` : '前往 GitHub Releases 查看'}
              </a>
            )}
            <button
              type="button"
              className="full-button export-btn"
              onClick={() => void handleCheckUpdate()}
              disabled={checkingUpdate}
            >
              {checkingUpdate ? '正在检查更新…' : '检查新版本'}
            </button>
          </div>
        </section>

        {/* 重要说明与版本 */}
        <section className="settings-section info-section" aria-label="关于与说明">
          <h2>重要数据保护说明</h2>
          <div className="info-card">
            <p>1. 数据默认存储在本机的安全存储（Android 原生 SQLite / 浏览器 IndexedDB）中。</p>
            <p>2. 原生 App 受系统沙箱保护；若在网页端使用，清理浏览器数据可能会影响记录。</p>
            <p>3. 建议定期点击上方“导出完整备份 (JSON)”将数据保存到其他存储设备或云盘。</p>
            <p>4. 换机或清除数据后，可通过“恢复备份”随时完整导入历史记录。</p>
          </div>
          <div className="app-version">
            <span>应用版本：v1.0.6 ({isNative ? 'Android 原生版' : 'PWA 离线版'})</span>
          </div>
        </section>
      </div>

      {pasteModalOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="paste-dialog-title">
            <h2 id="paste-dialog-title">粘贴备份文本恢复</h2>
            <p>请将导出的 JSON 备份文本直接粘贴到下方：</p>
            <textarea
              className="feedback-textarea"
              rows={6}
              placeholder="在此处粘贴完整备份 JSON 文本（通常以 { 开头）..."
              value={manualText}
              onChange={(e) => setManualText(e.target.value)}
              aria-label="备份文本输入框"
            />
            <div className="dialog-actions">
              <button
                type="button"
                onClick={() => {
                  setPasteModalOpen(false);
                  setManualText('');
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={!manualText.trim()}
                onClick={() => {
                  handleProcessBackupText(manualText);
                  setPasteModalOpen(false);
                  setManualText('');
                }}
              >
                解析并预览
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
