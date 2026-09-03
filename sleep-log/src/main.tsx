import { createRoot } from 'react-dom/client';
import App from './App';
import { IndexedDbSleepRepository } from './data/repository';
// @ts-expect-error Vite bundles CSS imports; the app has no CSS module declarations.
import './styles.css';

const repository = new IndexedDbSleepRepository();
createRoot(document.getElementById('root')!).render(<App initialRepository={repository} />);
