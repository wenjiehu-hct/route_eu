import { lazy, Suspense } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import PlatformShell from './components/PlatformShell.jsx';

const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'));
const ProjectsPage = lazy(() => import('./pages/ProjectsPage.jsx'));
const ProjectDetailPage = lazy(() => import('./pages/ProjectDetailPage.jsx'));
const ExecutionCenterPage = lazy(() => import('./pages/ExecutionCenterPage.jsx'));
const RouteAssetsPage = lazy(() => import('./pages/RouteWorkspacePages.jsx').then(module => ({ default: module.RouteAssetsPage })));
const PlanningCenterPage = lazy(() => import('./pages/RouteWorkspacePages.jsx').then(module => ({ default: module.PlanningCenterPage })));
const RegulationLibraryPage = lazy(() => import('./pages/KnowledgeDataPages.jsx').then(module => ({ default: module.RegulationLibraryPage })));
const DataCenterPage = lazy(() => import('./pages/KnowledgeDataPages.jsx').then(module => ({ default: module.DataCenterPage })));

export default function App() {
  return <HashRouter>
    <Suspense fallback={<div className="app-loading"><span className="spinner" /><strong>正在加载工作空间…</strong></div>}>
      <Routes>
        <Route element={<PlatformShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/:projectId/:tab?" element={<ProjectDetailPage />} />
          <Route path="routes/:tab?" element={<RouteAssetsPage />} />
          <Route path="planning/:mode?" element={<PlanningCenterPage />} />
          <Route path="execution" element={<ExecutionCenterPage />} />
          <Route path="regulations" element={<RegulationLibraryPage />} />
          <Route path="data" element={<DataCenterPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  </HashRouter>;
}
