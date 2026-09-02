import { useState, type ChangeEvent } from 'react';
import {
  createBackup,
  mergeBackup,
  parseBackup,
  shouldRemindManualBackup,
  toCsv,
  type MergeConflict,
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
  exportJson(): void;
  exportCsv(): void;
  restore(segments: SleepSegment[]): Promise<void>;
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
  const [resolutions, setResolutions] = useState<Record<string, 'keep-current' | 'use-backup'>>({});
  const [persistentGranted, setPersistentGranted] = useState<boolean | undefined>(
    model.isPersistentStorageGranted
  );
  const [operationMessage, setOperationMessage] = useState<string | null>(null);

  const needsManualReminder = shouldRemindManualBackup(
    model.status.lastSuccessfulBackupAt,
    Date.now()
  );

  const handleFileSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError(null);
    setBackupFile(null);
    setConflicts([]);
    setResolutions({});
    setOperationMessage(null);

    try {
      const text = await file.text();
      const parsed = parseBackup(text);
      setBackupFile(parsed);

      const mergeResult = mergeBackup(model.segments, parsed.segments);
      setConflicts(mergeResult.conflicts);

      // Default all conflicts to keep-current
      const initialResolutions: Record<string, 'keep-current' | 'use-backup'> = {};
      for (const c of mergeResult.conflicts) {
        initialResolutions[c.current.id] = 'keep-current';
      }
      setResolutions(initialResolutions);
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

    // Resolve conflicts
    const map = new Map(model.segments.map((s) => [s.id, s]));
    for (const segment of backupFile.segments) {
      const existing = map.get(segment.id);
      if (existing) {
        const choice = resolutions[segment.id];
        if (choice === 'use-backup') {
          map.set(segment.id, segment);
        }
      } else {
        map.set(segment.id, segment);
      }
    }

    const finalSegments = Array.from(map.values()).sort((a, b) =>
      a.startAt.localeCompare(b.startAt)
    );

    try {
      await actions.restore(finalSegments);
      setBackupFile(null);
      setConflicts([]);
      setResolutions({});
      setOperationMessage('备份恢复成功！');
    } catch (err) {
      setParseError(err instanceof Error ? err.message : '恢复备份失败');
    }
  };

  const handleRequestStorage = async () => {
    const result = await actions.requestPersistentStorage();
    setPersistentGranted(result);
    setOperationMessage(result ? '已成功开启持久化存储' : '浏览器未授予持久化存储权限');
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

  return (
    <main className="settings-page">
      <div className="settings-container">
        <header className="page-header">
          <p className="eyebrow">设置与数据</p>
          <h1>数据管理</h1>
        </header>

        {operationMessage && <div className="toast-message">{operationMessage}</div>}

        {/* 自动备份状态与文件夹 */}
        <section className="settings-section" aria-label="自动备份状态">
          <h2>手机自动备份</h2>
          <div className="status-card">
            <div className="status-row">
              <span className="status-label">备份支持能力</span>
              <strong className="status-badge">
                {model.capability === 'folder-auto' ? '自动备份可用' : '需要手动备份'}
              </strong>
            </div>

            <div className="status-row">
              <span className="status-label">最近自动备份</span>
              <span>
                {model.status.lastSuccessfulBackupAt
                  ? formatChineseDate(model.status.lastSuccessfulBackupAt, timezone)
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
            {model.status.state === 'manual-only' && (
              <p className="hint-text">当前环境不支持授权文件夹，建议定期手动导出备份。</p>
            )}
            {needsManualReminder && (
              <p className="warning-text">距离上次备份已超过 30 天，建议导出备份</p>
            )}

            {model.capability === 'folder-auto' && (
              <button
                type="button"
                className="full-button primary-action-btn"
                onClick={() => void actions.chooseFolder()}
              >
                {model.status.state === 'ready' ? '更改自动备份文件夹' : '选择自动备份文件夹'}
              </button>
            )}
          </div>
        </section>

        {/* 备份导出与导入 */}
        <section className="settings-section" aria-label="数据备份与恢复">
          <h2>数据备份与恢复</h2>
          <div className="button-group">
            <button
              type="button"
              className="export-btn"
              onClick={() => actions.exportJson()}
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
                          记录 {c.current.id.slice(0, 8)}：
                          {c.current.kind === 'night' ? '当前为夜间' : '当前为午睡'} vs{' '}
                          {c.incoming.kind === 'night' ? '备份为夜间' : '备份为午睡'}
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
                      setResolutions({});
                    }}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => void handleConfirmRestore()}
                  >
                    确认恢复
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* 持久化存储 */}
        <section className="settings-section" aria-label="本地存储保障">
          <h2>本地持久化存储</h2>
          <div className="storage-card">
            <p className="hint-text">
              请求浏览器为“眠记”提供持久化存储，降低因手机空间不足被浏览器自动清理的风险。
            </p>
            <div className="storage-status">
              <span>当前状态：</span>
              <strong>{persistentGranted ? '已开启持久化存储' : '未开启持久化存储'}</strong>
            </div>
            <button
              type="button"
              className="action-btn"
              onClick={() => void handleRequestStorage()}
            >
              请求持久化存储
            </button>
          </div>
        </section>

        {/* 重要说明与版本 */}
        <section className="settings-section info-section" aria-label="关于与说明">
          <h2>重要数据保护说明</h2>
          <div className="info-card">
            <p>1. 数据默认存储在本机浏览器的 IndexedDB 数据库中。</p>
            <p>2. 清理浏览器数据或卸载浏览器可能会清除本地记录。</p>
            <p>3. 授权手机文件夹后，每次记录变更均会自动写入独立备份文件，不受网页缓存清除影响。</p>
            <p>4. 建议偶尔将 JSON 备份文件复制保存到其他存储设备。</p>
          </div>
          <div className="app-version">
            <span>应用版本：0.1.0 (PWA 离线版)</span>
          </div>
        </section>
      </div>
    </main>
  );
}
