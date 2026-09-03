import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadTodayModel } from '../App';
import { TodayPage, type TodayActions, type TodayModel } from './TodayPage';
import { HistoryPage, type HistoryActions } from './HistoryPage';
import { SettingsPage, type SettingsActions, type SettingsModel } from './SettingsPage';
import { createBackup } from '../data/backup';
import type { SleepSegment } from '../domain/sleep';

const makeSegment = (overrides: Partial<SleepSegment> = {}): SleepSegment => ({
  id: 'segment-1',
  kind: 'night',
  groupId: 'night-1',
  startAt: '2026-09-02T22:00:00.000Z',
  startTimezone: 'Asia/Shanghai',
  endAt: '2026-09-03T06:30:00.000Z',
  endTimezone: 'Asia/Shanghai',
  status: 'completed',
  uncertainReason: null,
  createdAt: '2026-09-02T22:00:00.000Z',
  updatedAt: '2026-09-03T06:30:00.000Z',
  finishedAt: '2026-09-03T06:30:00.000Z',
  schemaVersion: 1,
  ...overrides,
});

const makeActions = (): TodayActions => ({
  start: vi.fn().mockResolvedValue(undefined),
  resetStart: vi.fn().mockResolvedValue(undefined),
  cancel: vi.fn().mockResolvedValue(undefined),
  wake: vi.fn().mockResolvedValue(undefined),
  undoWake: vi.fn().mockResolvedValue(undefined),
  resumeActive: vi.fn().mockResolvedValue(undefined),
  extendWake: vi.fn().mockResolvedValue(undefined),
  continueNight: vi.fn().mockResolvedValue(undefined),
  resolveOverlong: vi.fn().mockResolvedValue(undefined),
});

const makeHistoryActions = (): HistoryActions => ({
  changeKind: vi.fn().mockResolvedValue(undefined),
  deleteSegment: vi.fn().mockResolvedValue(undefined),
});

const makeSettingsActions = (): SettingsActions => ({
  chooseFolder: vi.fn().mockResolvedValue(undefined),
  exportJson: vi.fn().mockResolvedValue(undefined),
  exportCsv: vi.fn().mockResolvedValue(undefined),
  restore: vi.fn().mockResolvedValue(undefined),
  requestStorageProtection: vi.fn().mockResolvedValue(undefined),
});

const idleModel: TodayModel = { state: 'idle', lastNightMs: null, backupWarning: null };
const activeModel: TodayModel = {
  state: 'active',
  segment: makeSegment({ endAt: null, finishedAt: null, status: 'active' }),
  elapsedMs: 30 * 60 * 1000,
  overlong: false,
  backupWarning: null,
};
const completedModel: TodayModel = {
  state: 'finished',
  segment: makeSegment(),
  groupSegments: [makeSegment()],
  undoUntil: '2099-09-03T06:31:00.000Z',
  backupWarning: null,
};

describe('TodayPage', () => {
  afterEach(() => cleanup());

  it('starts night sleep from the single-button chooser', () => {
    const actions = makeActions();
    render(<TodayPage model={idleModel} actions={actions} />);
    fireEvent.click(screen.getByRole('button', { name: '开始睡觉' }));
    fireEvent.click(screen.getByRole('button', { name: '夜间睡眠' }));
    expect(actions.start).toHaveBeenCalledWith('night');
  });

  it('starts a nap from the type chooser', () => {
    const actions = makeActions();
    render(<TodayPage model={idleModel} actions={actions} />);
    fireEvent.click(screen.getByRole('button', { name: '开始睡觉' }));
    fireEvent.click(screen.getByRole('button', { name: '午睡' }));
    expect(actions.start).toHaveBeenCalledWith('nap');
  });

  it('resets the active start only after confirmation', () => {
    const actions = makeActions();
    render(<TodayPage model={activeModel} actions={actions} />);
    fireEvent.click(screen.getByRole('button', { name: '还没睡着' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(actions.resetStart).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认重置' }));
    expect(actions.resetStart).toHaveBeenCalledOnce();
  });

  it('cancels an active record only after confirmation', () => {
    const actions = makeActions();
    render(<TodayPage model={activeModel} actions={actions} />);
    fireEvent.click(screen.getByRole('button', { name: '取消本次记录' }));
    expect(actions.cancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认取消' }));
    expect(actions.cancel).toHaveBeenCalledOnce();
  });

  it('never offers historical time editing after finish and allows undo', () => {
    const actions = makeActions();
    render(<TodayPage model={completedModel} actions={actions} />);
    expect(screen.queryByRole('button', { name: /修改.*时间/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '撤销起床' }));
    expect(actions.undoWake).toHaveBeenCalledWith('segment-1');
  });

  it('does not offer undo for an uncertain finished record', () => {
    const actions = makeActions();
    const uncertain = makeSegment({ status: 'uncertain', uncertainReason: 'over-20-hours' });
    render(
      <TodayPage
        model={{ ...completedModel, segment: uncertain, groupSegments: [uncertain] }}
        actions={actions}
      />
    );
    expect(screen.queryByRole('button', { name: '撤销起床' })).not.toBeInTheDocument();
  });

  it('continues a finished night as another segment', () => {
    const actions = makeActions();
    render(<TodayPage model={completedModel} actions={actions} />);
    fireEvent.click(screen.getByRole('button', { name: '再睡一段' }));
    expect(actions.continueNight).toHaveBeenCalledWith('segment-1');
  });

  it('includes every completed segment in the night group total', () => {
    const actions = makeActions();
    const second = makeSegment({
      id: 'segment-2',
      startAt: '2026-09-03T07:00:00.000Z',
      endAt: '2026-09-03T08:30:00.000Z',
      finishedAt: '2026-09-03T08:30:00.000Z',
      updatedAt: '2026-09-03T08:30:00.000Z',
    });
    render(
      <TodayPage
        model={{ ...completedModel, groupSegments: [completedModel.segment, second] }}
        actions={actions}
      />
    );
    expect(screen.getByText('2 段合计')).toBeInTheDocument();
    expect(screen.getByText('10小时0分')).toBeInTheDocument();
  });

  it('does not offer continue-night for a finished nap', () => {
    const actions = makeActions();
    render(
      <TodayPage
        model={{ ...completedModel, segment: makeSegment({ kind: 'nap', groupId: null }) }}
        actions={actions}
      />
    );
    expect(screen.queryByRole('button', { name: '再睡一段' })).not.toBeInTheDocument();
  });

  it('offers extend-wake and resume-active after undo window expires and confirms them', () => {
    const actions = makeActions();
    const expiredFinishedModel: TodayModel = {
      ...completedModel,
      undoUntil: '2020-01-01T00:00:00.000Z',
      segment: makeSegment({ finishedAt: new Date(Date.now() - 3600_000).toISOString() }),
    };

    const { rerender } = render(<TodayPage model={expiredFinishedModel} actions={actions} />);
    expect(screen.queryByRole('button', { name: '撤销起床' })).not.toBeInTheDocument();

    // Test extend wake
    fireEvent.click(screen.getByRole('button', { name: '接续睡到现在' }));
    expect(screen.getByText('接续睡到现在？')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认更新' }));
    expect(actions.extendWake).toHaveBeenCalledWith('segment-1');

    // Test resume active
    rerender(<TodayPage model={expiredFinishedModel} actions={actions} />);
    fireEvent.click(screen.getByRole('button', { name: '误按起床，继续睡觉' }));
    expect(screen.getByText('继续睡觉？')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认恢复记录' }));
    expect(actions.resumeActive).toHaveBeenCalledWith('segment-1');
  });

  it('starts a fresh night or nap from a finished nap while keeping continue-night night-only', async () => {
    const actions = makeActions();
    const finishedNap = makeSegment({ kind: 'nap', groupId: null });
    render(
      <TodayPage
        model={{ ...completedModel, segment: finishedNap, groupSegments: [finishedNap] }}
        actions={actions}
      />
    );

    expect(screen.queryByRole('button', { name: '再睡一段' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '记录新的睡眠' }));
    fireEvent.click(screen.getByRole('button', { name: '夜间睡眠' }));
    expect(actions.start).toHaveBeenCalledWith('night');

    await waitFor(() => expect(screen.queryByRole('button', { name: '夜间睡眠' })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '记录新的睡眠' }));
    fireEvent.click(screen.getByRole('button', { name: '午睡' }));
    expect(actions.start).toHaveBeenCalledWith('nap');
  });

  it('shows a backup warning on the idle screen', () => {
    render(<TodayPage model={{ ...idleModel, backupWarning: '自动备份未更新，请重新授权文件夹' }} actions={makeActions()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('自动备份未更新，请重新授权文件夹');
  });

  it('focuses the type chooser and closes it with Escape', () => {
    render(<TodayPage model={idleModel} actions={makeActions()} />);
    fireEvent.click(screen.getByRole('button', { name: '开始睡觉' }));
    expect(screen.getByRole('button', { name: '夜间睡眠' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始睡觉' })).toHaveFocus();
  });

  it('does not submit a finished-screen start twice while it is pending', async () => {
    let resolveStart!: () => void;
    const actions = makeActions();
    actions.start = vi.fn(() => new Promise<void>((resolve) => { resolveStart = resolve; }));
    render(<TodayPage model={completedModel} actions={actions} />);

    fireEvent.click(screen.getByRole('button', { name: '记录新的睡眠' }));
    const nightButton = screen.getByRole('button', { name: '夜间睡眠' });
    fireEvent.click(nightButton);
    fireEvent.click(nightButton);

    expect(actions.start).toHaveBeenCalledOnce();
    expect(nightButton).toBeDisabled();
    resolveStart();
    await waitFor(() => expect(screen.queryByRole('button', { name: '夜间睡眠' })).not.toBeInTheDocument());
  });

  it('offers explicit choices for an overlong active record', () => {
    const actions = makeActions();
    render(<TodayPage model={{ ...activeModel, overlong: true }} actions={actions} />);
    fireEvent.click(screen.getByRole('button', { name: '按现在结束并标记不准确' }));
    expect(actions.resolveOverlong).toHaveBeenCalledWith('finish-uncertain');
    fireEvent.click(screen.getByRole('button', { name: '删除误记录' }));
    expect(actions.resolveOverlong).toHaveBeenCalledWith('delete');
    fireEvent.click(screen.getByRole('button', { name: '继续记录' }));
    expect(actions.resolveOverlong).toHaveBeenCalledWith('continue');
  });

  it('restores an active record instead of showing idle during initialization', async () => {
    const active = makeSegment({ endAt: null, finishedAt: null, status: 'active' });
    const service = {
      getActive: vi.fn().mockResolvedValue(active),
      isOverlong: vi.fn().mockReturnValue(false),
    };
    const repository = { list: vi.fn().mockResolvedValue([active]) };
    const model = await loadTodayModel(service, repository, Date.parse('2026-09-03T06:30:00.000Z'));
    expect(model.state).toBe('active');
    expect(model.state === 'active' && model.segment.id).toBe('segment-1');
  });

  it('restores the latest finished record with its same-group segments and undo window', async () => {
    const older = makeSegment({
      id: 'older',
      groupId: 'old-night',
      endAt: '2026-09-02T23:00:00.000Z',
      finishedAt: '2026-09-02T23:00:00.000Z',
      updatedAt: '2026-09-02T23:00:00.000Z',
    });
    const latest = makeSegment({
      id: 'latest',
      startAt: '2026-09-03T05:00:00.000Z',
      endAt: '2026-09-03T06:00:00.000Z',
      finishedAt: '2026-09-03T06:00:00.000Z',
      updatedAt: '2026-09-03T06:00:00.000Z',
    });
    const sameNight = makeSegment({
      id: 'same-night',
      startAt: '2026-09-03T06:30:00.000Z',
      endAt: '2026-09-03T07:30:00.000Z',
      finishedAt: '2026-09-03T07:30:00.000Z',
      updatedAt: '2026-09-03T07:30:00.000Z',
    });
    const service = {
      getActive: vi.fn().mockResolvedValue(undefined),
      isOverlong: vi.fn().mockReturnValue(false),
    };
    const repository = { list: vi.fn().mockResolvedValue([older, latest, sameNight]) };
    const model = await loadTodayModel(service, repository, Date.parse('2026-09-03T07:30:30.000Z'));
    expect(model.state).toBe('finished');
    if (model.state === 'finished') {
      expect(model.segment.id).toBe('same-night');
      expect(model.groupSegments.map((segment) => segment.id)).toEqual(['latest', 'same-night']);
      expect(model.undoUntil).toBe('2026-09-03T07:31:00.000Z');
    }
  });

  it('restores an uncertain overlong record as finished after refresh', async () => {
    const uncertain = makeSegment({
      id: 'overlong',
      status: 'uncertain',
      uncertainReason: 'over-20-hours',
      endAt: '2026-09-03T07:30:00.000Z',
      finishedAt: '2026-09-03T07:30:00.000Z',
      updatedAt: '2026-09-03T07:30:00.000Z',
    });
    const service = {
      getActive: vi.fn().mockResolvedValue(undefined),
      isOverlong: vi.fn().mockReturnValue(false),
    };
    const repository = { list: vi.fn().mockResolvedValue([uncertain]) };
    const model = await loadTodayModel(service, repository, Date.parse('2026-09-03T07:30:30.000Z'));
    expect(model.state).toBe('finished');
    if (model.state === 'finished') {
      expect(model.segment.status).toBe('uncertain');
      expect(model.groupSegments).toHaveLength(1);
      expect(model.undoUntil).toBe('');
    }
  });
});

describe('HistoryPage', () => {
  afterEach(() => cleanup());

  const completedNight = makeSegment({
    id: 'n-1',
    kind: 'night',
    startAt: '2026-09-02T14:00:00.000Z',
    endAt: '2026-09-02T22:00:00.000Z',
    finishedAt: '2026-09-02T22:00:00.000Z',
  });
  const uncertainNight = makeSegment({
    id: 'u-1',
    kind: 'night',
    status: 'uncertain',
    uncertainReason: 'over-20-hours',
    startAt: '2026-09-01T14:00:00.000Z',
    endAt: '2026-09-02T12:00:00.000Z',
    finishedAt: '2026-09-02T12:00:00.000Z',
  });

  it('shows excluded records without putting them in averages', () => {
    const actions = makeHistoryActions();
    render(
      <HistoryPage
        segments={[completedNight, uncertainNight]}
        today="2026-09-03"
        timezone="Asia/Shanghai"
        actions={actions}
      />
    );
    expect(screen.getByText('1 条不准确记录未计入统计')).toBeInTheDocument();
    expect(screen.getByText('时间可能不准确')).toBeInTheDocument();
  });

  it('allows type correction and deletion but no timestamp edit', () => {
    const actions = makeHistoryActions();
    render(
      <HistoryPage
        segments={[completedNight]}
        today="2026-09-03"
        timezone="Asia/Shanghai"
        actions={actions}
      />
    );
    expect(screen.queryByLabelText('开始时间')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '改为午睡' }));
    expect(actions.changeKind).toHaveBeenCalledWith(completedNight.id, 'nap');
  });

  it('confirms and deletes an erroneous record', () => {
    const actions = makeHistoryActions();
    render(
      <HistoryPage
        segments={[completedNight]}
        today="2026-09-03"
        timezone="Asia/Shanghai"
        actions={actions}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(actions.deleteSegment).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    expect(actions.deleteSegment).toHaveBeenCalledWith('n-1');
  });

  it('focuses the delete dialog and cancels it with Escape', () => {
    const actions = makeHistoryActions();
    render(<HistoryPage segments={[completedNight]} today="2026-09-03" timezone="Asia/Shanghai" actions={actions} />);
    const deleteButton = screen.getByRole('button', { name: '删除' });
    fireEvent.click(deleteButton);
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(deleteButton).toHaveFocus();
  });

  it('uses the stored timezone when showing a record created elsewhere', () => {
    const actions = makeHistoryActions();
    const newYorkNight = makeSegment({
      startAt: '2026-09-02T02:00:00.000Z',
      endAt: '2026-09-02T10:00:00.000Z',
      startTimezone: 'America/New_York',
      endTimezone: 'America/New_York',
      finishedAt: '2026-09-02T10:00:00.000Z',
    });
    render(<HistoryPage segments={[newYorkNight]} today="2026-09-02" timezone="Asia/Shanghai" actions={actions} />);

    expect(screen.getByText('2026-09-02')).toBeInTheDocument();
    expect(screen.getByText('22:00 — 06:00')).toBeInTheDocument();
  });

  it('keeps invalid records visible and out of night and day totals', () => {
    const actions = makeHistoryActions();
    const valid = makeSegment({ id: 'valid', groupId: 'mixed', startAt: '2026-09-02T14:00:00.000Z', endAt: '2026-09-02T16:00:00.000Z', finishedAt: '2026-09-02T16:00:00.000Z' });
    const invalid = makeSegment({ id: 'invalid', groupId: 'mixed', startAt: '2026-09-02T18:00:00.000Z', endAt: '2026-09-02T17:00:00.000Z', finishedAt: '2026-09-02T17:00:00.000Z', status: 'invalid' });
    render(<HistoryPage segments={[valid, invalid]} today="2026-09-03" timezone="Asia/Shanghai" actions={actions} />);

    expect(screen.getByText('时间无效')).toBeInTheDocument();
    expect(screen.getAllByText('2小时0分').length).toBeGreaterThan(0);
  });

  it('shows night, nap, and all-sleep totals for every history day', () => {
    const actions = makeHistoryActions();
    const night = makeSegment({ id: 'night-total', startAt: '2026-09-02T14:00:00.000Z', endAt: '2026-09-02T21:00:00.000Z', finishedAt: '2026-09-02T21:00:00.000Z' });
    const nap = makeSegment({ id: 'nap-total', kind: 'nap', groupId: null, startAt: '2026-09-03T04:00:00.000Z', endAt: '2026-09-03T04:30:00.000Z', finishedAt: '2026-09-03T04:30:00.000Z' });
    render(<HistoryPage segments={[night, nap]} today="2026-09-03" timezone="Asia/Shanghai" actions={actions} />);

    const day = screen.getByText('2026-09-03').closest('.history-day-card')!;
    expect(day).toHaveTextContent('夜间 7小时0分');
    expect(day).toHaveTextContent('午睡 30分');
    expect(day).toHaveTextContent('全天 7小时30分');
  });

  it('groups multi-segment night sleep crossing midnight under the final wake date', () => {
    const actions = makeHistoryActions();
    const seg1 = makeSegment({
      id: 'seg-1',
      groupId: 'cross-midnight',
      startAt: '2026-09-02T14:00:00.000Z',
      endAt: '2026-09-02T15:50:00.000Z',
      finishedAt: '2026-09-02T15:50:00.000Z',
    });
    const seg2 = makeSegment({
      id: 'seg-2',
      groupId: 'cross-midnight',
      startAt: '2026-09-02T16:30:00.000Z',
      endAt: '2026-09-02T22:30:00.000Z',
      finishedAt: '2026-09-02T22:30:00.000Z',
    });

    render(<HistoryPage segments={[seg1, seg2]} today="2026-09-03" timezone="Asia/Shanghai" actions={actions} />);

    expect(screen.getByText('2026-09-03')).toBeInTheDocument();
    expect(screen.queryByText('2026-09-02')).not.toBeInTheDocument();
    expect(screen.getByText('2 段合计')).toBeInTheDocument();
  });
});

describe('SettingsPage', () => {
  afterEach(() => cleanup());

  const sampleSegment = makeSegment({
    id: 's-1',
    startAt: '2026-09-02T14:00:00.000Z',
    endAt: '2026-09-02T22:30:00.000Z',
    finishedAt: '2026-09-02T22:30:00.000Z',
  });

  const settingsModel: SettingsModel = {
    capability: 'folder-auto',
    status: {
      state: 'ready',
      lastSuccessfulBackupAt: '2026-09-02T14:00:00.000Z',
      lastAutomaticBackupAt: '2026-09-02T14:00:00.000Z',
      lastManualExportAt: '2026-09-02T14:00:00.000Z',
      message: null,
    },
    segments: [sampleSegment],
    storageProtection: 'not-granted',
  };

  it('describes storage protection without promising permanent storage', () => {
    render(<SettingsPage model={settingsModel} timezone="Asia/Shanghai" actions={makeSettingsActions()} />);

    expect(screen.getByRole('heading', { name: '防自动清理保护' })).toBeInTheDocument();
    expect(screen.getByText(/不能防止主动清除网站数据/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '请求防自动清理保护' })).toBeInTheDocument();
    expect(screen.queryByText(/永久存储/)).not.toBeInTheDocument();
  });

  it('previews a restore before applying it', async () => {
    const actions = makeSettingsActions();
    const backupText = createBackup([sampleSegment]);
    const file = new File([backupText], 'mianji-backup.json', { type: 'application/json' });

    render(
      <SettingsPage model={settingsModel} timezone="Asia/Shanghai" actions={actions} />
    );

    const input = screen.getByLabelText('选择备份文件');
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText(/1 条记录，2026年9月2日至2026年9月3日/)).toBeInTheDocument();
    expect(actions.restore).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '确认恢复' }));
    await waitFor(() => {
      expect(actions.restore).toHaveBeenCalledOnce();
    });
    expect(actions.restore).toHaveBeenCalledWith(settingsModel.segments, [sampleSegment]);
  });

  it('restores the deduplicated preview instead of re-adding a different-id copy', async () => {
    const actions = makeSettingsActions();
    const duplicate = { ...sampleSegment, id: 'same-content-new-id' };
    const file = new File([createBackup([duplicate])], 'duplicate.json', { type: 'application/json' });
    render(<SettingsPage model={settingsModel} timezone="Asia/Shanghai" actions={actions} />);

    fireEvent.change(screen.getByLabelText('选择备份文件'), { target: { files: [file] } });
    await screen.findByText(/1 条记录/);
    fireEvent.click(screen.getByRole('button', { name: '确认恢复' }));

    await waitFor(() => expect(actions.restore).toHaveBeenCalledWith(settingsModel.segments, [sampleSegment]));
  });

  it('requires an explicit choice for every conflict and shows the differing times', async () => {
    const actions = makeSettingsActions();
    const secondCurrent = makeSegment({ id: 's-2', startAt: '2026-09-03T14:00:00.000Z', endAt: '2026-09-03T22:00:00.000Z', finishedAt: '2026-09-03T22:00:00.000Z' });
    const currentModel = { ...settingsModel, segments: [sampleSegment, secondCurrent] };
    const incoming = [
      { ...sampleSegment, startAt: '2026-09-02T15:00:00.000Z', endAt: '2026-09-02T23:30:00.000Z' },
      { ...secondCurrent, kind: 'nap' as const, groupId: null },
    ];
    const file = new File([createBackup(incoming)], 'conflicts.json', { type: 'application/json' });
    render(<SettingsPage model={currentModel} timezone="Asia/Shanghai" actions={actions} />);

    fireEvent.change(screen.getByLabelText('选择备份文件'), { target: { files: [file] } });
    const confirm = await screen.findByRole('button', { name: '确认恢复' });
    expect(confirm).toBeDisabled();
    expect(screen.queryAllByRole('radio', { checked: true })).toHaveLength(0);
    expect(screen.getByText(/当前：夜间睡眠，22:00 — 06:30/)).toBeInTheDocument();
    expect(screen.getByText(/备份：夜间睡眠，23:00 — 07:30/)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('radio', { name: '保留当前' })[0]);
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getAllByRole('radio', { name: '采用备份' })[1]);
    expect(confirm).toBeEnabled();
  });

  it('shows the stale-preview restore error without discarding the preview', async () => {
    const actions = makeSettingsActions();
    actions.restore = vi.fn().mockRejectedValue(new Error('记录已发生变化，请重新预览备份'));
    const file = new File([createBackup([sampleSegment])], 'stale.json', { type: 'application/json' });
    render(<SettingsPage model={settingsModel} timezone="Asia/Shanghai" actions={actions} />);

    fireEvent.change(screen.getByLabelText('选择备份文件'), { target: { files: [file] } });
    await screen.findByText(/1 条记录/);
    fireEvent.click(screen.getByRole('button', { name: '确认恢复' }));

    expect(await screen.findByText('记录已发生变化，请重新预览备份')).toBeInTheDocument();
    expect(screen.getByText('备份预览')).toBeInTheDocument();
  });

  it('exports JSON and CSV on button clicks', () => {
    const actions = makeSettingsActions();
    render(
      <SettingsPage model={settingsModel} timezone="Asia/Shanghai" actions={actions} />
    );

    fireEvent.click(screen.getByRole('button', { name: '导出完整备份 (JSON)' }));
    expect(actions.exportJson).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: '导出表格 (CSV)' }));
    expect(actions.exportCsv).toHaveBeenCalledOnce();
  });

  it.each([
    ['JSON', 'exportJson', '导出完整备份 (JSON)'],
    ['CSV', 'exportCsv', '导出表格 (CSV)'],
  ] as const)('shows %s export failures without leaving the settings page', async (_format, actionName, buttonName) => {
    const actions = makeSettingsActions();
    actions[actionName] = vi.fn().mockRejectedValue(new Error('导出失败，请重试'));
    render(<SettingsPage model={settingsModel} timezone="Asia/Shanghai" actions={actions} />);

    fireEvent.click(screen.getByRole('button', { name: buttonName }));

    expect(await screen.findByRole('alert')).toHaveTextContent('导出失败，请重试');
    expect(screen.getByRole('heading', { name: '数据备份与恢复' })).toBeInTheDocument();
  });

  it('shows an unexported state instead of an overdue warning in manual-only browsers', () => {
    render(
      <SettingsPage
        model={{
          ...settingsModel,
          capability: 'manual-only',
          status: { state: 'manual-only', message: null, lastManualExportAt: null },
        }}
        timezone="Asia/Shanghai"
        actions={makeSettingsActions()}
      />
    );
    expect(screen.getByText('尚未导出备份')).toBeInTheDocument();
    expect(screen.queryByText(/超过 30 天/)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '手机自动备份' })).not.toBeInTheDocument();
  });

  it('shows recent manual export date and overdue reminder when appropriate', () => {
    render(
      <SettingsPage
        model={{
          ...settingsModel,
          capability: 'folder-auto',
          status: {
            state: 'ready',
            message: null,
            lastManualExportAt: '2026-07-01T00:00:00.000Z',
            lastAutomaticBackupAt: '2026-09-03T00:00:00.000Z',
          },
        }}
        timezone="Asia/Shanghai"
        actions={makeSettingsActions()}
      />
    );
    expect(screen.getByText(/最近执行导出：2026年7月1日/)).toBeInTheDocument();
    expect(screen.getByText(/距离上次备份已超过 30 天/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '手机自动备份' })).toBeInTheDocument();
  });

  it('shows folder replacement errors without discarding the existing settings UI', async () => {
    const actions = makeSettingsActions();
    actions.chooseFolder = vi.fn().mockRejectedValue(new Error('自动备份写入失败'));
    render(<SettingsPage model={settingsModel} timezone="Asia/Shanghai" actions={actions} />);

    fireEvent.click(screen.getByRole('button', { name: '更改自动备份文件夹' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('自动备份写入失败');
    expect(screen.getByText('最近自动备份')).toBeInTheDocument();
  });

  it('renders feedback section and handles feedback submission and email copying', async () => {
    const actions = makeSettingsActions();
    render(<SettingsPage model={settingsModel} timezone="Asia/Shanghai" actions={actions} />);

    expect(screen.getByRole('heading', { name: '意见与反馈' })).toBeInTheDocument();
    expect(screen.getByText('2158403652@qq.com')).toBeInTheDocument();

    // Mock fetch for formsubmit
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });

    const textarea = screen.getByLabelText('反馈建议');
    expect(textarea).toHaveAttribute('maxlength', '1000');
    fireEvent.change(textarea, { target: { value: '希望增加深色模式' } });

    const contactInput = screen.getByLabelText('联系方式');
    expect(contactInput).toHaveAttribute('maxlength', '200');
    fireEvent.change(contactInput, { target: { value: 'test@example.com' } });

    fireEvent.click(screen.getByRole('button', { name: '提交反馈' }));

    expect(await screen.findByText(/感谢您的反馈/)).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://formsubmit.co/ajax/2158403652@qq.com',
      expect.objectContaining({ method: 'POST' })
    );

    // Test copy email
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });

    fireEvent.click(screen.getByRole('button', { name: '复制邮箱' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('2158403652@qq.com');
    expect(await screen.findByText('✓ 已复制')).toBeInTheDocument();

    globalThis.fetch = originalFetch;
  });

  it('explains exactly what feedback submission sends', () => {
    render(<SettingsPage model={settingsModel} timezone="Asia/Shanghai" actions={makeSettingsActions()} />);

    expect(screen.getByText(/不会附带或上传睡眠记录/)).toBeInTheDocument();
    expect(screen.getByText(/第三方邮件转发服务/)).toBeInTheDocument();
  });
});

import { UpdateNotice } from './UpdateNotice';

describe('UpdateNotice', () => {
  afterEach(() => cleanup());

  const activeNight = makeSegment({ endAt: null, finishedAt: null, status: 'active' });

  it('defers a waiting update while sleep is active', () => {
    const applyUpdate = vi.fn();
    render(<UpdateNotice needRefresh activeSegment={activeNight} applyUpdate={applyUpdate} />);
    expect(screen.getByText('记录结束后可更新')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '立即更新' })).not.toBeInTheDocument();
  });

  it('shows update action when no active sleep segment', () => {
    const applyUpdate = vi.fn();
    render(<UpdateNotice needRefresh activeSegment={null} applyUpdate={applyUpdate} />);
    expect(screen.getByRole('button', { name: '立即更新' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '立即更新' }));
    expect(applyUpdate).toHaveBeenCalledOnce();
  });
});
