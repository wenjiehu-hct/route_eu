import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { COMPLIANCE_PROFILES, getComplianceProfile } from '../constants/compliance.js';
import { buildProjectReport } from '../services/compliance.js';
import { createId } from '../services/utils.js';

const STORAGE_KEY = 'routePlannerCompliance.v1';

export const useComplianceStore = defineStore('compliance', () => {
  const saved = loadState();
  const projects = ref(saved.projects);
  const activeProjectId = ref(saved.activeProjectId || saved.projects[0]?.id || null);
  const activeProject = computed(() => projects.value.find(project => project.id === activeProjectId.value) || null);

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1,
      activeProjectId: activeProjectId.value,
      projects: projects.value,
    }));
  }

  function createProject(profileId = COMPLIANCE_PROFILES[0].id) {
    const profile = getComplianceProfile(profileId);
    const project = {
      id: createId('test-project'),
      name: `${profile.name} · ${new Date().toLocaleDateString('zh-CN')}`,
      profileId: profile.id,
      market: profile.market,
      vehicle: '',
      owner: '',
      status: 'planning',
      routeIds: [],
      results: {},
      notes: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    projects.value.unshift(project);
    activeProjectId.value = project.id;
    persist();
    return project;
  }

  function deleteProject(projectId) {
    projects.value = projects.value.filter(project => project.id !== projectId);
    if (activeProjectId.value === projectId) activeProjectId.value = projects.value[0]?.id || null;
    persist();
  }

  function duplicateProject(projectId) {
    const source = projects.value.find(project => project.id === projectId);
    if (!source) return;
    const copy = JSON.parse(JSON.stringify(source));
    copy.id = createId('test-project');
    copy.name = `${source.name}（副本）`;
    copy.status = 'planning';
    copy.createdAt = new Date().toISOString();
    copy.updatedAt = copy.createdAt;
    projects.value.unshift(copy);
    activeProjectId.value = copy.id;
    persist();
  }

  function selectProject(projectId) {
    activeProjectId.value = projectId;
    persist();
  }

  function updateProject(updates) {
    const project = activeProject.value;
    if (!project) return;
    Object.assign(project, updates, { updatedAt: new Date().toISOString() });
    persist();
  }

  function setProfile(profileId) {
    const profile = getComplianceProfile(profileId);
    updateProject({ profileId: profile.id, market: profile.market });
  }

  function toggleRoute(routeId, selected) {
    const project = activeProject.value;
    if (!project) return;
    const routeIds = new Set(project.routeIds || []);
    if (selected) routeIds.add(routeId);
    else routeIds.delete(routeId);
    updateProject({ routeIds: [...routeIds] });
  }

  function assignAllRoutes(routeIds) {
    updateProject({ routeIds: [...new Set(routeIds)] });
  }

  function assignRoutesToProject(projectId, routeIds) {
    const project = projects.value.find(item => item.id === projectId);
    if (!project) return;
    project.routeIds = [...new Set([...(project.routeIds || []), ...routeIds])];
    project.updatedAt = new Date().toISOString();
    persist();
  }

  function setScenarioResult(scenarioId, updates) {
    const project = activeProject.value;
    if (!project) return;
    project.results = {
      ...(project.results || {}),
      [scenarioId]: {
        status: 'not_started',
        routeId: '',
        actualCount: null,
        notes: '',
        evidence: '',
        ...(project.results?.[scenarioId] || {}),
        ...updates,
        updatedAt: new Date().toISOString(),
      },
    };
    project.updatedAt = new Date().toISOString();
    persist();
  }

  function replaceState(backup) {
    const nextProjects = Array.isArray(backup?.projects) ? backup.projects : [];
    projects.value = nextProjects;
    activeProjectId.value = nextProjects.some(project => project.id === backup?.activeProjectId)
      ? backup.activeProjectId
      : nextProjects[0]?.id || null;
    persist();
  }

  function exportProject(projectId, routes) {
    const project = projects.value.find(item => item.id === projectId);
    if (!project) return;
    const report = buildProjectReport(project, routes);
    const blob = new Blob([report], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${safeFilename(project.name)}-${new Date().toISOString().slice(0, 10)}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return {
    projects,
    activeProjectId,
    activeProject,
    profiles: COMPLIANCE_PROFILES,
    createProject,
    deleteProject,
    duplicateProject,
    selectProject,
    updateProject,
    setProfile,
    toggleRoute,
    assignAllRoutes,
    assignRoutesToProject,
    setScenarioResult,
    replaceState,
    exportProject,
  };
});

function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (raw && Array.isArray(raw.projects)) return raw;
  } catch {
    // Corrupted local data is ignored; route data remains unaffected.
  }
  return { projects: [], activeProjectId: null };
}

function safeFilename(value) {
  return String(value || 'compliance-report').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
}
