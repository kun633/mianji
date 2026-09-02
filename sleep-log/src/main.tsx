import { createRoot } from 'react-dom/client';
import App from './App';
// @ts-expect-error Vite bundles CSS imports; the app has no CSS module declarations.
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);
