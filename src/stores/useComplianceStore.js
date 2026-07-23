import { create } from 'zustand';
import { COMPLIANCE_PROFILES, getComplianceProfile } from '../constants/compliance.js';
import { buildProjectReport } from '../services/compliance.js';
import { createId } from '../services/utils.js';

const STORAGE_KEY = 'routePlannerCompliance.v1';
const saved = loadState();

export const useComplianceStore = create((set, get) => ({
  projects: saved.projects,
  activeProjectId: saved.activeProjectId || saved.projects[0]?.id || null,
  profiles: COMPLIANCE_PROFILES,
  createProject: (profileId = COMPLIANCE_PROFILES[0].id) => {
    const profile = getComplianceProfile(profileId);
    const project = { id: createId('test-project'), name: `${profile.name} · ${new Date().toLocaleDateString('zh-CN')}`, profileId: profile.id, market: profile.market, vehicle: '', owner: '', status: 'planning', routeIds: [], results: {}, notes: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    persist(set, { projects: [project, ...get().projects], activeProjectId: project.id });
    return project;
  },
  deleteProject: projectId => {
    const projects = get().projects.filter(project => project.id !== projectId);
    persist(set, { projects, activeProjectId: get().activeProjectId === projectId ? projects[0]?.id || null : get().activeProjectId });
  },
  duplicateProject: projectId => {
    const source = get().projects.find(project => project.id === projectId);
    if (!source) return;
    const copy = { ...JSON.parse(JSON.stringify(source)), id: createId('test-project'), name: `${source.name}（副本）`, status: 'planning', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    persist(set, { projects: [copy, ...get().projects], activeProjectId: copy.id });
  },
  selectProject: activeProjectId => persist(set, { projects: get().projects, activeProjectId }),
  updateProject: updates => {
    const projects = get().projects.map(project => project.id === get().activeProjectId ? { ...project, ...updates, updatedAt: new Date().toISOString() } : project);
    persist(set, { projects, activeProjectId: get().activeProjectId });
  },
  setProfile: profileId => {
    const profile = getComplianceProfile(profileId);
    get().updateProject({ profileId: profile.id, market: profile.market });
  },
  toggleRoute: (routeId, selected) => {
    const project = get().projects.find(item => item.id === get().activeProjectId);
    if (!project) return;
    const ids = new Set(project.routeIds || []);
    selected ? ids.add(routeId) : ids.delete(routeId);
    get().updateProject({ routeIds: [...ids] });
  },
  assignAllRoutes: routeIds => get().updateProject({ routeIds: [...new Set(routeIds)] }),
  assignRoutesToProject: (projectId, routeIds) => {
    const projects = get().projects.map(project => project.id === projectId ? { ...project, routeIds: [...new Set([...(project.routeIds || []), ...routeIds])], updatedAt: new Date().toISOString() } : project);
    persist(set, { projects, activeProjectId: get().activeProjectId });
  },
  setScenarioResult: (scenarioId, updates) => {
    const project = get().projects.find(item => item.id === get().activeProjectId);
    if (!project) return;
    get().updateProject({ results: { ...(project.results || {}), [scenarioId]: { status: 'not_started', routeId: '', actualCount: null, notes: '', evidence: '', ...(project.results?.[scenarioId] || {}), ...updates, updatedAt: new Date().toISOString() } } });
  },
  replaceState: backup => {
    const projects = Array.isArray(backup?.projects) ? backup.projects : [];
    const activeProjectId = projects.some(project => project.id === backup?.activeProjectId) ? backup.activeProjectId : projects[0]?.id || null;
    persist(set, { projects, activeProjectId });
  },
  exportProject: (projectId, routes) => {
    const project = get().projects.find(item => item.id === projectId);
    if (!project) return;
    const url = URL.createObjectURL(new Blob([buildProjectReport(project, routes)], { type: 'text/markdown;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `${safeFilename(project.name)}-${new Date().toISOString().slice(0, 10)}.md`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  },
}));

function loadState() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (value && Array.isArray(value.projects)) return value;
  } catch { /* ignore corrupted state */ }
  return { projects: [], activeProjectId: null };
}

function persist(set, state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, ...state }));
  set(state);
}

function safeFilename(value) {
  return String(value || 'compliance-report').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
}

