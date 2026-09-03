import { createRoot } from 'react-dom/client';
import App from './App';
import { createSleepRepository } from './data/repository-factory';
// @ts-expect-error Vite bundles CSS imports; the app has no CSS module declarations.
import './styles.css';

void createSleepRepository().then((repository) => {
  createRoot(document.getElementById('root')!).render(<App initialRepository={repository} />);
});

