import { createRoot } from 'react-dom/client';
import App from './App';
import { createSleepRepository } from './data/repository-factory';
// @ts-expect-error Vite bundles CSS imports; the app has no CSS module declarations.
import './styles.css';

const container = document.getElementById('root')!;
const status = document.createElement('main');
status.style.cssText = 'padding:48px 24px;line-height:1.8';
status.setAttribute('role', 'status');
status.textContent = '正在打开眠记，请稍候…';
container.replaceChildren(status);
const showFailure = (message: string) => {
  status.textContent = message + ' 请关闭应用后重新打开；请勿卸载或清除数据，以免丢失历史记录。';
};
// Keep waiting for the original connection, never start concurrent retries.
const timer = window.setTimeout(() => showFailure('本地数据读取时间过长。'), 15_000);
void createSleepRepository().then((repository) => {
  window.clearTimeout(timer);
  createRoot(container).render(<App initialRepository={repository} />);
}).catch(() => {
  window.clearTimeout(timer);
  showFailure('本地数据库暂时无法打开。');
});

