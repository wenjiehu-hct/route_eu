import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'leaflet/dist/leaflet.css';
import './styles/main.css';
import App from './App.jsx';
import { initializeLocalWorkspace, startLocalWorkspacePersistence } from './services/localWorkspaceDatabase.js';

const root = document.getElementById('root');
root.innerHTML = '<div class="app-loading"><span class="spinner"></span><strong>正在打开本地工作区…</strong></div>';

initializeLocalWorkspace().catch(() => {}).finally(() => {
  createRoot(root).render(<StrictMode><App /></StrictMode>);
  startLocalWorkspacePersistence();
});
