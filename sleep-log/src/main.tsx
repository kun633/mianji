import { createRoot } from 'react-dom/client';
import App from './App';

const stylesheet = document.createElement('link');
stylesheet.rel = 'stylesheet';
stylesheet.href = '/src/styles.css';
document.head.appendChild(stylesheet);

createRoot(document.getElementById('root')!).render(<App />);
