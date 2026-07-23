import { create } from 'zustand';
import { COMPLIANCE_PROFILES, getComplianceProfile } from '../constants/compliance.js';
import { buildProjectReport } from '../services/compliance.js';
import { createId } from '../services/utils.js';

const STORAGE_KEY = 'routePlannerCompliance.v1';
const clone = value => JSON.parse(JSON.stringify(value));
const now = () => new Date().toISOString();

export const PROJECT_STATUSES = [
  { value: 'planning', label: '规划中' },
  { value: 'running', label: '执行中' },
  { value: 'paused', label: '已暂停' },
  { value: 'completed', label: '已完成' },
];

export const PROJECT_PHASES = [
  { value: 'concept', label: '概念验证' },
  { value: 'development', label: '开发验证' },
  { value: 'validation', label: '系统验证' },
  { value: 'homologation', label: '认证准备' },
];

export const PRIORITIES = [
  { value: 'critical', label: '紧急' },
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '低' },
];

export const RUN_STATUSES = [
  { value: 'planned', label: '待执行' },
  { value: 'running', label: '执行中' },
  { value: 'completed', label: '已完成' },
  { value: 'cancelled', label: '已取消' },
];

export const ISSUE_STATUSES = [
  { value: 'open', label: '待处理' },
  { value: 'investigating', label: '分析中' },
  { value: 'resolved', label: '已解决' },
  { value: 'verified', label: '已验证' },
  { value: 'closed', label: '已关闭' },
];

const saved = loadState();

export const useComplianceStore = create((set, get) => ({
  projects: saved.projects,
  activeProjectId: saved.activeProjectId || saved.projects[0]?.id || null,
  profiles: COMPLIANCE_PROFILES,

  createProject: (profileId = COMPLIANCE_PROFILES[0].id, seed = {}) => {
    const profile = getComplianceProfile(profileId);
    const timestamp = now();
    const project = normalizeProject({
      id: createId('test-project'),
      name: `${profile.name} · ${new Date().toLocaleDateString('zh-CN')}`,
      profileId: profile.id,
      market: profile.market,
      markets: [profile.market],
      vehicle: '', owner: '', status: 'planning', priority: 'medium', phase: 'concept',
      routeIds: [], results: {}, notes: '', tags: [], milestones: defaultMilestones(),
      testRuns: [], issues: [], activities: [], createdAt: timestamp, updatedAt: timestamp,
      ...seed,
    });
    project.activities.unshift(createActivity('project_created', '创建了测试项目', project.name));
    persist(set, { projects: [project, ...get().projects], activeProjectId: project.id });
    return project;
  },

  deleteProject: projectId => {
    const projects = get().projects.filter(project => project.id !== projectId);
    persist(set, { projects, activeProjectId: get().activeProjectId === projectId ? projects[0]?.id || null : get().activeProjectId });
  },

  duplicateProject: projectId => {
    const source = get().projects.find(project => project.id === projectId);
    if (!source) return null;
    const timestamp = now();
    const copy = normalizeProject({
      ...clone(source), id: createId('test-project'), name: `${source.name}（副本）`, status: 'planning',
      testRuns: [], issues: [], results: {}, activities: [], createdAt: timestamp, updatedAt: timestamp,
    });
    copy.activities.unshift(createActivity('project_created', '复制创建了测试项目', source.name));
    persist(set, { projects: [copy, ...get().projects], activeProjectId: copy.id });
    return copy;
  },

  selectProject: activeProjectId => persist(set, { projects: get().projects, activeProjectId }),
  updateProject: updates => get().updateProjectById(get().activeProjectId, updates),
  updateProjectById: (projectId, updates) => updateProjectCollection(get, set, projectId, project => ({ ...project, ...updates, updatedAt: now() })),

  setProfile: profileId => {
    const profile = getComplianceProfile(profileId);
    get().updateProject({ profileId: profile.id, market: profile.market, markets: [profile.market] });
  },

  toggleRoute: (routeId, selected) => {
    const project = get().projects.find(item => item.id === get().activeProjectId);
    if (!project) return;
    const ids = new Set(project.routeIds || []);
    selected ? ids.add(routeId) : ids.delete(routeId);
    get().updateProject({ routeIds: [...ids] });
  },

  assignAllRoutes: routeIds => get().updateProject({ routeIds: [...new Set(routeIds)] }),
  assignRoutesToProject: (projectId, routeIds) => updateProjectCollection(get, set, projectId, project => {
    const nextIds = [...new Set([...(project.routeIds || []), ...routeIds])];
    return withActivity({ ...project, routeIds: nextIds, updatedAt: now() }, 'routes_assigned', `加入了 ${routeIds.length} 条路线`, '路线资产已关联到项目');
  }),

  setScenarioResult: (scenarioId, updates) => {
    const project = get().projects.find(item => item.id === get().activeProjectId);
    if (!project) return;
    const previous = project.results?.[scenarioId] || {};
    const record = { status: 'not_started', routeId: '', actualCount: null, notes: '', evidence: '', ...previous, ...updates, updatedAt: now() };
    let next = { ...project, results: { ...(project.results || {}), [scenarioId]: record }, updatedAt: now() };
    if (updates.status && updates.status !== previous.status && updates.status !== 'not_started') {
      next = withActivity(next, 'scenario_updated', '更新了场景执行结果', `${scenarioId} · ${updates.status}`);
    }
    replaceProject(get, set, next);
  },

  addMilestone: (projectId, values = {}) => {
    const milestone = { id: createId('milestone'), name: '新里程碑', dueDate: '', owner: '', status: 'pending', ...values };
    updateProjectCollection(get, set, projectId, project => withActivity({ ...project, milestones: [...project.milestones, milestone], updatedAt: now() }, 'milestone_added', '新增了里程碑', milestone.name));
    return milestone;
  },
  updateMilestone: (projectId, milestoneId, updates) => updateProjectCollection(get, set, projectId, project => ({ ...project, milestones: project.milestones.map(item => item.id === milestoneId ? { ...item, ...updates } : item), updatedAt: now() })),
  deleteMilestone: (projectId, milestoneId) => updateProjectCollection(get, set, projectId, project => ({ ...project, milestones: project.milestones.filter(item => item.id !== milestoneId), updatedAt: now() })),

  addTestRun: (projectId, values = {}) => {
    const timestamp = now();
    const run = {
      id: createId('test-run'), name: `道路测试 ${new Date().toLocaleDateString('zh-CN')}`, routeId: '', date: timestamp.slice(0, 10),
      driver: '', vehicle: '', weather: '', status: 'planned', distance: 0, scenarioIds: [], notes: '',
      createdAt: timestamp, updatedAt: timestamp, ...values,
    };
    updateProjectCollection(get, set, projectId, project => withActivity({ ...project, testRuns: [run, ...project.testRuns], updatedAt: timestamp }, 'run_created', '创建了测试执行', run.name));
    return run;
  },
  updateTestRun: (projectId, runId, updates) => updateProjectCollection(get, set, projectId, project => {
    const previous = project.testRuns.find(run => run.id === runId);
    let next = { ...project, testRuns: project.testRuns.map(run => run.id === runId ? { ...run, ...updates, updatedAt: now() } : run), updatedAt: now() };
    if (updates.status && updates.status !== previous?.status) next = withActivity(next, 'run_status', '更新了测试执行状态', `${previous?.name || '测试执行'} · ${updates.status}`);
    return next;
  }),
  deleteTestRun: (projectId, runId) => updateProjectCollection(get, set, projectId, project => ({ ...project, testRuns: project.testRuns.filter(run => run.id !== runId), updatedAt: now() })),

  addIssue: (projectId, values = {}) => {
    const timestamp = now();
    const issue = {
      id: createId('issue'), title: '新问题', severity: 'medium', status: 'open', routeId: '', scenarioId: '', assignee: '',
      description: '', evidence: '', dueDate: '', createdAt: timestamp, updatedAt: timestamp, ...values,
    };
    updateProjectCollection(get, set, projectId, project => withActivity({ ...project, issues: [issue, ...project.issues], updatedAt: timestamp }, 'issue_created', '登记了测试问题', issue.title));
    return issue;
  },
  updateIssue: (projectId, issueId, updates) => updateProjectCollection(get, set, projectId, project => {
    const previous = project.issues.find(issue => issue.id === issueId);
    let next = { ...project, issues: project.issues.map(issue => issue.id === issueId ? { ...issue, ...updates, updatedAt: now() } : issue), updatedAt: now() };
    if (updates.status && updates.status !== previous?.status) next = withActivity(next, 'issue_status', '更新了问题状态', `${previous?.title || '测试问题'} · ${updates.status}`);
    return next;
  }),
  deleteIssue: (projectId, issueId) => updateProjectCollection(get, set, projectId, project => ({ ...project, issues: project.issues.filter(issue => issue.id !== issueId), updatedAt: now() })),

  addActivity: (projectId, type, title, detail = '') => updateProjectCollection(get, set, projectId, project => withActivity(project, type, title, detail)),

  replaceState: backup => {
    const projects = Array.isArray(backup?.projects) ? backup.projects.map(normalizeProject) : [];
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

export function normalizeProject(raw = {}) {
  const profile = getComplianceProfile(raw.profileId);
  const timestamp = raw.createdAt || now();
  const market = raw.market || profile.market;
  return {
    id: raw.id || createId('test-project'),
    name: raw.name || '未命名测试项目',
    profileId: profile.id,
    market,
    markets: Array.isArray(raw.markets) && raw.markets.length ? raw.markets : market ? [market] : [],
    vehicle: raw.vehicle || '', owner: raw.owner || '', status: raw.status || 'planning',
    priority: raw.priority || 'medium', phase: raw.phase || 'concept', startDate: raw.startDate || '', endDate: raw.endDate || '',
    routeIds: Array.isArray(raw.routeIds) ? raw.routeIds : [], results: raw.results && typeof raw.results === 'object' ? raw.results : {},
    notes: raw.notes || '', tags: Array.isArray(raw.tags) ? raw.tags : [],
    milestones: Array.isArray(raw.milestones) ? raw.milestones.map((item, index) => ({ id: item.id || createId(`milestone-${index}`), name: item.name || '里程碑', dueDate: item.dueDate || '', owner: item.owner || '', status: item.status || 'pending' })) : [],
    testRuns: Array.isArray(raw.testRuns) ? raw.testRuns.map(normalizeRun) : [],
    issues: Array.isArray(raw.issues) ? raw.issues.map(normalizeIssue) : [],
    activities: Array.isArray(raw.activities) ? raw.activities : [],
    createdAt: timestamp, updatedAt: raw.updatedAt || timestamp,
  };
}

function normalizeRun(run = {}) {
  const timestamp = run.createdAt || now();
  return { id: run.id || createId('test-run'), name: run.name || '道路测试', routeId: run.routeId || '', date: run.date || '', driver: run.driver || '', vehicle: run.vehicle || '', weather: run.weather || '', status: run.status || 'planned', distance: Number(run.distance) || 0, scenarioIds: Array.isArray(run.scenarioIds) ? run.scenarioIds : [], notes: run.notes || '', createdAt: timestamp, updatedAt: run.updatedAt || timestamp };
}

function normalizeIssue(issue = {}) {
  const timestamp = issue.createdAt || now();
  return { id: issue.id || createId('issue'), title: issue.title || '测试问题', severity: issue.severity || 'medium', status: issue.status || 'open', routeId: issue.routeId || '', scenarioId: issue.scenarioId || '', assignee: issue.assignee || '', description: issue.description || '', evidence: issue.evidence || '', dueDate: issue.dueDate || '', createdAt: timestamp, updatedAt: issue.updatedAt || timestamp };
}

function defaultMilestones() {
  return [
    { id: createId('milestone'), name: '测试范围冻结', dueDate: '', owner: '', status: 'pending' },
    { id: createId('milestone'), name: '路线与车辆就绪', dueDate: '', owner: '', status: 'pending' },
    { id: createId('milestone'), name: '道路测试完成', dueDate: '', owner: '', status: 'pending' },
    { id: createId('milestone'), name: '问题关闭与报告签发', dueDate: '', owner: '', status: 'pending' },
  ];
}

function createActivity(type, title, detail = '') {
  return { id: createId('activity'), type, title, detail, createdAt: now() };
}

function withActivity(project, type, title, detail = '') {
  return { ...project, activities: [createActivity(type, title, detail), ...(project.activities || [])].slice(0, 100), updatedAt: now() };
}

function updateProjectCollection(get, set, projectId, updater) {
  if (!projectId) return;
  const projects = get().projects.map(project => project.id === projectId ? normalizeProject(updater(project)) : project);
  persist(set, { projects, activeProjectId: get().activeProjectId });
}

function replaceProject(get, set, nextProject) {
  const projects = get().projects.map(project => project.id === nextProject.id ? normalizeProject(nextProject) : project);
  persist(set, { projects, activeProjectId: get().activeProjectId });
}

function loadState() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (value && Array.isArray(value.projects)) {
      const projects = value.projects.map(normalizeProject);
      const state = { projects, activeProjectId: projects.some(project => project.id === value.activeProjectId) ? value.activeProjectId : projects[0]?.id || null };
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, ...state }));
      return state;
    }
  } catch { /* ignore corrupted state */ }
  return { projects: [], activeProjectId: null };
}

function persist(set, state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, ...state }));
  set(state);
}

function safeFilename(value) {
  return String(value || 'compliance-report').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
}
