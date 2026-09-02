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
  continueNight: vi.fn().mockResolvedValue(undefined),
  resolveOverlong: vi.fn().mockResolvedValue(undefined),
});

const makeHistoryActions = (): HistoryActions => ({
  changeKind: vi.fn().mockResolvedValue(undefined),
  deleteSegment: vi.fn().mockResolvedValue(undefined),
});

const makeSettingsActions = (): SettingsActions => ({
  chooseFolder: vi.fn().mockResolvedValue(undefined),
  exportJson: vi.fn(),
  exportCsv: vi.fn(),
  restore: vi.fn().mockResolvedValue(undefined),
  requestPersistentStorage: vi.fn().mockResolvedValue(true),
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
    status: { state: 'ready', lastSuccessfulBackupAt: '2026-09-02T14:00:00.000Z', message: null },
    segments: [sampleSegment],
    isPersistentStorageGranted: true,
  };

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
