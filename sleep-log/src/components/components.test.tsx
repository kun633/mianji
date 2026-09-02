import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
});
