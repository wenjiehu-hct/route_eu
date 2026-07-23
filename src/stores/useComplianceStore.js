import { create } from 'zustand';
import { COMPLIANCE_PROFILES, getComplianceProfile } from '../constants/compliance.js';
import { buildProjectCsv, buildProjectReport } from '../services/compliance.js';
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
  { value: 'ready', label: '准备就绪' },
  { value: 'running', label: '执行中' },
  { value: 'paused', label: '已暂停' },
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
      regulatoryBaseline: defaultRegulatoryBaseline(profile),
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
    get().updateProject({ profileId: profile.id, market: profile.market, markets: [profile.market], regulatoryBaseline: defaultRegulatoryBaseline(profile) });
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
    const added = nextIds.length - project.routeIds.length;
    return added ? withActivity({ ...project, routeIds: nextIds, updatedAt: now() }, 'routes_assigned', `加入了 ${added} 条路线`, '路线资产已关联到项目') : project;
  }),
  removeRoutesFromProject: (projectId, routeIds) => updateProjectCollection(get, set, projectId, project => {
    const ids = new Set(routeIds);
    const nextIds = project.routeIds.filter(id => !ids.has(id));
    return nextIds.length === project.routeIds.length ? project : withActivity({ ...project, routeIds: nextIds, updatedAt: now() }, 'routes_removed', `移除了 ${project.routeIds.length - nextIds.length} 条路线`, '测试任务与历史记录保留路线引用');
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
      driver: '', vehicle: '', weather: '', status: 'planned', distance: 0, scenarioIds: [], scenarioResults: {}, notes: '',
      checklist: defaultRunChecklist(), checkpoints: [], attachments: [], startedAt: '', endedAt: '', startOdometer: null, endOdometer: null,
      createdAt: timestamp, updatedAt: timestamp, ...values,
    };
    updateProjectCollection(get, set, projectId, project => withActivity({ ...project, testRuns: [run, ...project.testRuns], updatedAt: timestamp }, 'run_created', '创建了测试执行', run.name));
    return run;
  },
  addTestRuns: (projectId, runValues = []) => {
    const timestamp = now();
    const runs = runValues.map(values => normalizeRun({ id: createId('test-run'), date: timestamp.slice(0, 10), vehicle: '', status: 'planned', ...values, createdAt: timestamp, updatedAt: timestamp }));
    if (!runs.length) return [];
    updateProjectCollection(get, set, projectId, project => withActivity({ ...project, testRuns: [...runs, ...project.testRuns], updatedAt: timestamp }, 'runs_created', `批量创建了 ${runs.length} 个测试任务`, '根据未完成测试场景生成'));
    return runs;
  },
  updateTestRun: (projectId, runId, updates) => updateProjectCollection(get, set, projectId, project => {
    const previous = project.testRuns.find(run => run.id === runId);
    let next = { ...project, testRuns: project.testRuns.map(run => run.id === runId ? syncRunReadinessStatus({ ...run, ...updates, updatedAt: now() }) : run), updatedAt: now() };
    if (updates.status && updates.status !== previous?.status) next = withActivity(next, 'run_status', '更新了测试执行状态', `${previous?.name || '测试执行'} · ${updates.status}`);
    return next;
  }),
  setRunScenarioResult: (projectId, runId, scenarioId, updates) => updateProjectCollection(get, set, projectId, project => ({ ...project, testRuns: project.testRuns.map(run => run.id === runId ? { ...run, scenarioResults: { ...run.scenarioResults, [scenarioId]: { status: 'not_started', notes: '', evidence: '', attachments: [], issueIds: [], ...(run.scenarioResults?.[scenarioId] || {}), ...updates, updatedAt: now() } }, updatedAt: now() } : run), updatedAt: now() })),
  toggleRunChecklist: (projectId, runId, checklistId, checked) => updateProjectCollection(get, set, projectId, project => ({ ...project, testRuns: project.testRuns.map(run => {
    if (run.id !== runId) return run;
    const checklist = run.checklist.map(item => item.id === checklistId ? { ...item, checked } : item);
    return syncRunReadinessStatus({ ...run, checklist, updatedAt: now() });
  }), updatedAt: now() })),
  addRunCheckpoint: (projectId, runId, values = {}) => {
    const checkpoint = { id: createId('checkpoint'), timestamp: now(), label: '现场记录', notes: '', lat: null, lon: null, ...values };
    updateProjectCollection(get, set, projectId, project => ({ ...project, testRuns: project.testRuns.map(run => run.id === runId ? { ...run, checkpoints: [checkpoint, ...run.checkpoints], updatedAt: now() } : run), updatedAt: now() }));
    return checkpoint;
  },
  deleteRunCheckpoint: (projectId, runId, checkpointId) => updateProjectCollection(get, set, projectId, project => ({ ...project, testRuns: project.testRuns.map(run => run.id === runId ? { ...run, checkpoints: run.checkpoints.filter(item => item.id !== checkpointId), updatedAt: now() } : run), updatedAt: now() })),
  startTestRun: (projectId, runId) => updateProjectCollection(get, set, projectId, project => {
    const run = project.testRuns.find(item => item.id === runId);
    if (!run || !getRunReadiness(run).ready) return project;
    const updated = { ...run, status: 'running', startedAt: run.startedAt || now(), endedAt: '', updatedAt: now() };
    return withActivity({ ...project, status: project.status === 'planning' ? 'running' : project.status, testRuns: project.testRuns.map(item => item.id === runId ? updated : item), updatedAt: now() }, 'run_started', '开始了道路测试', run.name);
  }),
  pauseTestRun: (projectId, runId) => updateProjectCollection(get, set, projectId, project => {
    const run = project.testRuns.find(item => item.id === runId);
    return run ? withActivity({ ...project, testRuns: project.testRuns.map(item => item.id === runId ? { ...item, status: 'paused', updatedAt: now() } : item), updatedAt: now() }, 'run_paused', '暂停了道路测试', run.name) : project;
  }),
  completeTestRun: (projectId, runId, updates = {}) => updateProjectCollection(get, set, projectId, project => completeRunInProject(project, runId, updates)),
  deleteTestRun: (projectId, runId) => updateProjectCollection(get, set, projectId, project => ({ ...project, testRuns: project.testRuns.filter(run => run.id !== runId), issues: project.issues.map(issue => issue.runId === runId ? { ...issue, runId: '' } : issue), updatedAt: now() })),

  addIssue: (projectId, values = {}) => {
    const timestamp = now();
    const issue = {
      id: createId('issue'), title: '新问题', severity: 'medium', status: 'open', routeId: '', runId: '', scenarioId: '', assignee: '',
      description: '', rootCause: '', resolution: '', verificationNotes: '', evidence: '', attachments: [], dueDate: '', resolvedAt: '', verifiedAt: '', createdAt: timestamp, updatedAt: timestamp, ...values,
    };
    updateProjectCollection(get, set, projectId, project => withActivity({ ...project, issues: [issue, ...project.issues], updatedAt: timestamp }, 'issue_created', '登记了测试问题', issue.title));
    return issue;
  },
  createIssueFromRun: (projectId, runId, scenarioId, values = {}) => {
    const timestamp = now();
    const project = get().projects.find(item => item.id === projectId);
    const run = project?.testRuns.find(item => item.id === runId);
    if (!project || !run) return null;
    const issue = normalizeIssue({ id: createId('issue'), title: '测试场景异常', severity: 'high', status: 'open', routeId: run.routeId, runId, scenarioId, assignee: project.owner, createdAt: timestamp, updatedAt: timestamp, ...values });
    updateProjectCollection(get, set, projectId, current => {
      const testRuns = current.testRuns.map(item => {
        if (item.id !== runId || !scenarioId) return item;
        const result = item.scenarioResults?.[scenarioId] || { status: 'failed', notes: '', evidence: '', attachments: [], issueIds: [] };
        return { ...item, scenarioResults: { ...item.scenarioResults, [scenarioId]: { ...result, issueIds: [...new Set([...(result.issueIds || []), issue.id])], updatedAt: timestamp } }, updatedAt: timestamp };
      });
      return withActivity({ ...current, testRuns, issues: [issue, ...current.issues], updatedAt: timestamp }, 'issue_created', '从测试执行登记了问题', issue.title);
    });
    return issue;
  },
  updateIssue: (projectId, issueId, updates) => updateProjectCollection(get, set, projectId, project => {
    const previous = project.issues.find(issue => issue.id === issueId);
    let next = { ...project, issues: project.issues.map(issue => issue.id === issueId ? { ...issue, ...updates, resolvedAt: updates.status === 'resolved' ? now() : issue.resolvedAt, verifiedAt: ['verified', 'closed'].includes(updates.status) ? now() : issue.verifiedAt, updatedAt: now() } : issue), updatedAt: now() };
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
  exportProjectCsv: (projectId, routes) => {
    const project = get().projects.find(item => item.id === projectId);
    if (!project) return;
    const url = URL.createObjectURL(new Blob([buildProjectCsv(project, routes)], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `${safeFilename(project.name)}-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click();
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
    regulatoryBaseline: normalizeRegulatoryBaseline(raw.regulatoryBaseline, profile),
    milestones: Array.isArray(raw.milestones) ? raw.milestones.map((item, index) => ({ id: item.id || createId(`milestone-${index}`), name: item.name || '里程碑', dueDate: item.dueDate || '', owner: item.owner || '', status: item.status || 'pending' })) : [],
    testRuns: Array.isArray(raw.testRuns) ? raw.testRuns.map(normalizeRun) : [],
    issues: Array.isArray(raw.issues) ? raw.issues.map(normalizeIssue) : [],
    activities: Array.isArray(raw.activities) ? raw.activities : [],
    createdAt: timestamp, updatedAt: raw.updatedAt || timestamp,
  };
}

export function getRunReadiness(run, routes) {
  const checklist = Array.isArray(run?.checklist) ? run.checklist : [];
  const routeExists = Boolean(run?.routeId) && (!Array.isArray(routes) || routes.some(route => route.id === run.routeId));
  const requirements = [
    { id: 'route', label: run?.routeId && !routeExists ? '已选路线资产不可用' : '分配测试路线', complete: routeExists },
    { id: 'driver', label: '填写驾驶员', complete: Boolean(run?.driver?.trim()) },
    { id: 'vehicle', label: '填写车辆 / 软件版本', complete: Boolean(run?.vehicle?.trim()) },
    ...checklist.map(item => ({ id: `checklist-${item.id}`, label: item.label, complete: Boolean(item.checked) })),
  ];
  const missing = requirements.filter(item => !item.complete);
  return {
    ready: requirements.length > 3 && missing.length === 0,
    completed: requirements.length - missing.length,
    total: requirements.length,
    missing,
    requirements,
  };
}

function normalizeRun(run = {}) {
  const timestamp = run.createdAt || now();
  return {
    id: run.id || createId('test-run'), name: run.name || '道路测试', routeId: run.routeId || '', date: run.date || '',
    driver: run.driver || '', vehicle: run.vehicle || '', weather: run.weather || '', status: run.status || 'planned', distance: Number(run.distance) || 0,
    scenarioIds: Array.isArray(run.scenarioIds) ? run.scenarioIds : [], scenarioResults: run.scenarioResults && typeof run.scenarioResults === 'object' ? run.scenarioResults : {},
    checklist: Array.isArray(run.checklist) && run.checklist.length ? run.checklist : defaultRunChecklist(),
    checkpoints: Array.isArray(run.checkpoints) ? run.checkpoints : [], attachments: Array.isArray(run.attachments) ? run.attachments : [],
    startedAt: run.startedAt || '', endedAt: run.endedAt || '', startOdometer: toNullableNumber(run.startOdometer), endOdometer: toNullableNumber(run.endOdometer),
    notes: run.notes || '', createdAt: timestamp, updatedAt: run.updatedAt || timestamp,
  };
}

function syncRunReadinessStatus(run) {
  if (!['planned', 'ready'].includes(run.status)) return run;
  return { ...run, status: getRunReadiness(run).ready ? 'ready' : 'planned' };
}

function normalizeIssue(issue = {}) {
  const timestamp = issue.createdAt || now();
  return { id: issue.id || createId('issue'), title: issue.title || '测试问题', severity: issue.severity || 'medium', status: issue.status || 'open', routeId: issue.routeId || '', runId: issue.runId || '', scenarioId: issue.scenarioId || '', assignee: issue.assignee || '', description: issue.description || '', rootCause: issue.rootCause || '', resolution: issue.resolution || '', verificationNotes: issue.verificationNotes || '', evidence: issue.evidence || '', attachments: Array.isArray(issue.attachments) ? issue.attachments : [], dueDate: issue.dueDate || '', resolvedAt: issue.resolvedAt || '', verifiedAt: issue.verifiedAt || '', createdAt: timestamp, updatedAt: issue.updatedAt || timestamp };
}

function defaultRunChecklist() {
  return [
    { id: 'vehicle', label: '车辆、轮胎、油量/电量状态已确认', checked: false },
    { id: 'software', label: '软件、地图和标定版本已记录', checked: false },
    { id: 'logging', label: '数据记录、摄像与时间同步已启动', checked: false },
    { id: 'route', label: '路线、备选路线和补能点已确认', checked: false },
    { id: 'safety', label: '驾驶员安全交底与当地规则已确认', checked: false },
  ];
}

function completeRunInProject(project, runId, updates) {
  const run = project.testRuns.find(item => item.id === runId);
  if (!run) return project;
  const endOdometer = toNullableNumber(updates.endOdometer ?? run.endOdometer);
  const startOdometer = toNullableNumber(updates.startOdometer ?? run.startOdometer);
  const calculatedDistance = startOdometer !== null && endOdometer !== null && endOdometer >= startOdometer ? Number((endOdometer - startOdometer).toFixed(1)) : Number(updates.distance ?? run.distance) || 0;
  const completedRun = { ...run, ...updates, status: 'completed', endedAt: updates.endedAt || now(), startOdometer, endOdometer, distance: calculatedDistance, updatedAt: now() };
  const results = { ...(project.results || {}) };
  completedRun.scenarioIds.forEach(scenarioId => {
    const runResult = completedRun.scenarioResults?.[scenarioId];
    if (!runResult || !['passed', 'failed', 'blocked', 'not_applicable'].includes(runResult.status)) return;
    const previous = results[scenarioId] || {};
    results[scenarioId] = {
      status: runResult.status,
      routeId: completedRun.routeId || previous.routeId || '',
      actualCount: (Number(previous.actualCount) || 0) + 1,
      notes: runResult.notes || previous.notes || '',
      evidence: runResult.evidence || previous.evidence || '',
      attachments: runResult.attachments || previous.attachments || [],
      sourceRunId: completedRun.id,
      runIds: [...new Set([...(previous.runIds || []), completedRun.id])],
      updatedAt: now(),
    };
  });
  return withActivity({ ...project, testRuns: project.testRuns.map(item => item.id === runId ? completedRun : item), results, updatedAt: now() }, 'run_completed', '完成了道路测试', `${run.name} · ${calculatedDistance || 0} km`);
}

function toNullableNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function defaultMilestones() {
  return [
    { id: createId('milestone'), name: '测试范围冻结', dueDate: '', owner: '', status: 'pending' },
    { id: createId('milestone'), name: '路线与车辆就绪', dueDate: '', owner: '', status: 'pending' },
    { id: createId('milestone'), name: '道路测试完成', dueDate: '', owner: '', status: 'pending' },
    { id: createId('milestone'), name: '问题关闭与报告签发', dueDate: '', owner: '', status: 'pending' },
  ];
}

function defaultRegulatoryBaseline(profile) {
  return { frozenAt: '', applicabilityDate: '', vehicleCategory: '', approvedBy: '', notes: '', references: profile.references.map(reference => ({ ...reference, version: '', status: 'draft' })) };
}

function normalizeRegulatoryBaseline(value, profile) {
  const baseline = value && typeof value === 'object' ? value : {};
  const references = Array.isArray(baseline.references) ? baseline.references : profile.references;
  return { frozenAt: baseline.frozenAt || '', applicabilityDate: baseline.applicabilityDate || '', vehicleCategory: baseline.vehicleCategory || '', approvedBy: baseline.approvedBy || '', notes: baseline.notes || '', references: references.map(reference => ({ label: reference.label || '', url: reference.url || '', version: reference.version || '', status: reference.status || 'draft' })) };
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
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, ...state })); } catch { /* IndexedDB remains the durable primary store */ }
  set(state);
}

function safeFilename(value) {
  return String(value || 'compliance-report').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
}
