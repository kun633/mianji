import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadTodayModel } from '../App';
import { TodayPage, type TodayActions, type TodayModel } from './TodayPage';
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

  it('continues a finished night as another segment', () => {
    const actions = makeActions();
    render(<TodayPage model={completedModel} actions={actions} />);
    fireEvent.click(screen.getByRole('button', { name: '再睡一段' }));
    expect(actions.continueNight).toHaveBeenCalledWith('segment-1');
  });

  it('includes every completed segment in the night group total', () => {
    const actions = makeActions();
    const second = makeSegment({ id: 'segment-2', startAt: '2026-09-03T07:00:00.000Z', endAt: '2026-09-03T08:30:00.000Z', finishedAt: '2026-09-03T08:30:00.000Z', updatedAt: '2026-09-03T08:30:00.000Z' });
    render(<TodayPage model={{ ...completedModel, groupSegments: [completedModel.segment, second] }} actions={actions} />);
    expect(screen.getByText('2 段合计')).toBeInTheDocument();
    expect(screen.getByText('10小时0分')).toBeInTheDocument();
  });

  it('does not offer continue-night for a finished nap', () => {
    const actions = makeActions();
    render(<TodayPage model={{ ...completedModel, segment: makeSegment({ kind: 'nap', groupId: null }) }} actions={actions} />);
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
    const service = { getActive: vi.fn().mockResolvedValue(active), isOverlong: vi.fn().mockReturnValue(false) };
    const repository = { list: vi.fn().mockResolvedValue([active]) };
    const model = await loadTodayModel(service, repository, Date.parse('2026-09-03T06:30:00.000Z'));
    expect(model.state).toBe('active');
    expect(model.state === 'active' && model.segment.id).toBe('segment-1');
  });

  it('restores the latest finished record with its same-group segments and undo window', async () => {
    const older = makeSegment({ id: 'older', groupId: 'old-night', endAt: '2026-09-02T23:00:00.000Z', finishedAt: '2026-09-02T23:00:00.000Z', updatedAt: '2026-09-02T23:00:00.000Z' });
    const latest = makeSegment({ id: 'latest', startAt: '2026-09-03T05:00:00.000Z', endAt: '2026-09-03T06:00:00.000Z', finishedAt: '2026-09-03T06:00:00.000Z', updatedAt: '2026-09-03T06:00:00.000Z' });
    const sameNight = makeSegment({ id: 'same-night', startAt: '2026-09-03T06:30:00.000Z', endAt: '2026-09-03T07:30:00.000Z', finishedAt: '2026-09-03T07:30:00.000Z', updatedAt: '2026-09-03T07:30:00.000Z' });
    const service = { getActive: vi.fn().mockResolvedValue(undefined), isOverlong: vi.fn().mockReturnValue(false) };
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
    const service = { getActive: vi.fn().mockResolvedValue(undefined), isOverlong: vi.fn().mockReturnValue(false) };
    const repository = { list: vi.fn().mockResolvedValue([uncertain]) };
    const model = await loadTodayModel(service, repository, Date.parse('2026-09-03T07:30:30.000Z'));
    expect(model.state).toBe('finished');
    if (model.state === 'finished') {
      expect(model.segment.status).toBe('uncertain');
      expect(model.groupSegments).toHaveLength(1);
      expect(model.undoUntil).toBe('2026-09-03T07:31:00.000Z');
    }
  });
});
