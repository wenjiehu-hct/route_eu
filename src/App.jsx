import { useEffect, useMemo, useRef, useState } from 'react';
import MapCanvas from './components/MapCanvas.jsx';
import ComplianceWorkbench from './components/ComplianceWorkbench.jsx';
import CoveragePlanner from './components/CoveragePlanner.jsx';
import RouteLibrary from './components/RouteLibrary.jsx';
import ManualRoute from './components/ManualRoute.jsx';
import POIEditor from './components/POIEditor.jsx';
import { Button } from './components/ui.jsx';
import { useComplianceStore } from './stores/useComplianceStore.js';
import { usePOIStore } from './stores/usePOIStore.js';
import { useRoutePlannerStore } from './stores/useRoutePlannerStore.js';

const LAYOUT_KEY = 'routePlannerVue.panelLayout.v1';
const TABS = [
  { value: 'compliance', label: '法规测试', icon: '⌁' },
  { value: 'coverage', label: '区域规划', icon: '⬡' },
  { value: 'routes', label: '路线库', icon: '≋' },
  { value: 'manual', label: '手工路线', icon: '⌘' },
  { value: 'poi', label: '标记点', icon: '◆' },
];

export default function App() {
  const saved = useMemo(() => loadLayout(), []);
  const [workspace, setWorkspace] = useState(saved.workspace || 'compliance');
  const [collapsed, setCollapsed] = useState(saved.collapsed || false);
  const [layout, setLayout] = useState({ x: saved.x ?? 16, y: saved.y ?? 16, width: saved.width ?? 540, height: saved.height ?? window.innerHeight - 32 });
  const status = useRoutePlannerStore(state => state.status);
  const groups = useRoutePlannerStore(state => state.groups);
  const pois = usePOIStore(state => state.pois);
  const projects = useComplianceStore(state => state.projects);
  const activeProjectId = useComplianceStore(state => state.activeProjectId);
  const fileRef = useRef(null);

  useEffect(() => { useRoutePlannerStore.getState().hydrateMissingStats(); }, []);
  useEffect(() => {
    const open = event => TABS.some(tab => tab.value === event.detail) && setWorkspace(event.detail);
    window.addEventListener('open-workspace', open);
    return () => window.removeEventListener('open-workspace', open);
  }, []);
  useEffect(() => {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ ...layout, workspace, collapsed }));
  }, [layout, workspace, collapsed]);
  useEffect(() => {
    const constrain = () => setLayout(value => ({
      x: Math.max(0, Math.min(value.x, window.innerWidth - Math.min(value.width, window.innerWidth))),
      y: Math.max(0, Math.min(value.y, window.innerHeight - 80)),
      width: Math.min(window.innerWidth, Math.max(360, Math.min(780, value.width))),
      height: Math.max(280, Math.min(value.height, window.innerHeight - 16)),
    }));
    constrain(); window.addEventListener('resize', constrain); return () => window.removeEventListener('resize', constrain);
  }, []);

  const beginDrag = event => {
    if (event.target.closest('button')) return;
    const start = { x: event.clientX, y: event.clientY, layout };
    const move = moveEvent => setLayout(current => ({ ...current, x: Math.max(0, Math.min(start.layout.x + moveEvent.clientX - start.x, window.innerWidth - current.width)), y: Math.max(0, Math.min(start.layout.y + moveEvent.clientY - start.y, window.innerHeight - 80)) }));
    const stop = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', stop); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', stop);
  };
  const beginResize = (event, axis) => {
    event.stopPropagation(); const start = { x: event.clientX, y: event.clientY, layout };
    const move = moveEvent => setLayout(value => ({ ...value, width: axis === 'x' ? Math.max(360, Math.min(780, start.layout.width + moveEvent.clientX - start.x)) : value.width, height: axis === 'y' ? Math.max(280, Math.min(window.innerHeight - value.y, start.layout.height + moveEvent.clientY - start.y)) : value.height }));
    const stop = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', stop); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', stop);
  };

  const exportBackup = () => useRoutePlannerStore.getState().exportData({ pois, compliance: { version: 1, activeProjectId, projects } });
  const importBackup = event => {
    const file = event.target.files?.[0]; if (!file) return;
    useRoutePlannerStore.getState().importData(file, backup => {
      if (Array.isArray(backup.pois)) usePOIStore.getState().replacePOIs(backup.pois);
      if (backup.compliance?.projects) useComplianceStore.getState().replaceState(backup.compliance);
    });
    event.target.value = '';
  };
  const chooseImport = () => {
    const routeCount = groups.flatMap(group => group.routes).length;
    if ((routeCount || pois.length || projects.length) && !window.confirm('导入备份会替换当前路线、收藏点和法规项目，确定继续吗？')) return;
    fileRef.current?.click();
  };

  return <main className="app-shell">
    <MapCanvas />
    <aside className={`workbench ${collapsed ? 'collapsed' : ''}`} style={{ left: layout.x, top: layout.y, width: layout.width, height: collapsed ? 'auto' : layout.height }}>
      <header className="workbench-header" onPointerDown={beginDrag}>
        <div className="brand-mark">RT</div>
        <div className="brand-copy"><strong>Global Road Test Studio</strong><span>海外法规道路测试平台</span></div>
        <Button size="sm" variant="ghost" onClick={() => setCollapsed(value => !value)}>{collapsed ? '展开' : '收起'}</Button>
      </header>
      {!collapsed && <>
        <nav className="workspace-nav">
          {TABS.map(tab => <button key={tab.value} className={workspace === tab.value ? 'active' : ''} onClick={() => setWorkspace(tab.value)}><i>{tab.icon}</i><span>{tab.label}</span></button>)}
        </nav>
        <div className="workbench-body">
          <div hidden={workspace !== 'compliance'}><ComplianceWorkbench /></div>
          <div hidden={workspace !== 'coverage'}><CoveragePlanner /></div>
          <div hidden={workspace !== 'routes'}><RouteLibrary /></div>
          <div hidden={workspace !== 'manual'}><ManualRoute /></div>
          <div hidden={workspace !== 'poi'}><POIEditor /></div>
        </div>
        <footer className="workbench-footer">
          <span title={status}>{status}</span>
          <div><Button size="sm" onClick={exportBackup}>导出备份</Button><Button size="sm" onClick={chooseImport}>导入</Button></div>
          <input ref={fileRef} type="file" accept=".json" hidden onChange={importBackup} />
        </footer>
        <div className="resize-handle resize-x" onPointerDown={event => beginResize(event, 'x')} />
        <div className="resize-handle resize-y" onPointerDown={event => beginResize(event, 'y')} />
      </>}
    </aside>
  </main>;
}

function loadLayout() {
  try { return JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}'); }
  catch { return {}; }
}
