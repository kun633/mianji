import { expect, it, vi } from 'vitest';
vi.mock('./data/repository-factory', () => ({
  createSleepRepository: () => new Promise(() => {}),
}));

it('shows loading then safe recovery instructions when database startup stalls', async () => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="root"></div>';
  await import('./main');
  expect(document.body.textContent).toContain('正在打开');
  await vi.advanceTimersByTimeAsync(15000);
  expect(document.body.textContent).toContain('请勿卸载');
  vi.useRealTimers();
});
