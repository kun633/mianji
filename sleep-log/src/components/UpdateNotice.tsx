import type { SleepSegment } from '../domain/sleep';

export interface UpdateNoticeProps {
  needRefresh: boolean;
  activeSegment?: SleepSegment | null;
  applyUpdate: () => void;
}

export function UpdateNotice({ needRefresh, activeSegment, applyUpdate }: UpdateNoticeProps) {
  if (!needRefresh) return null;

  const isActive = Boolean(activeSegment && activeSegment.status === 'active');

  return (
    <aside className="update-notice-banner" role="status" aria-live="polite">
      <div className="update-notice-content">
        <strong className="update-title">发现新版本</strong>
        {isActive ? (
          <p className="update-desc">记录结束后可更新</p>
        ) : (
          <p className="update-desc">更新已就绪，点击刷新应用最新版本。</p>
        )}
      </div>
      {!isActive && (
        <button type="button" className="update-btn" onClick={applyUpdate}>
          立即更新
        </button>
      )}
    </aside>
  );
}
