import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Card, Chip, EmptyState, PageHeader, ProgressBar, StatCard, StatusBadge } from '../components/ui.jsx';
import { COMPLIANCE_SCENARIOS, getComplianceProfile } from '../constants/compliance.js';
import { flattenRoutes, formatDate } from '../services/portfolio.js';
import { ISSUE_STATUSES, RUN_STATUSES, getRunReadiness, getRunResourceConflicts, useComplianceStore } from '../stores/useComplianceStore.js';
import { useRoutePlannerStore } from '../stores/useRoutePlannerStore.js';

const RUN_LABELS = Object.fromEntries(RUN_STATUSES.map(item => [item.value, item.label]));
const ISSUE_LABELS = Object.fromEntries(ISSUE_STATUSES.map(item => [item.value, item.label]));
const ACTIVE_STATUSES = ['planned', 'ready', 'running', 'paused', 'review'];
const STATUS_ORDER = { running: 0, review: 1, ready: 2, paused: 3, planned: 4, completed: 5, cancelled: 6 };

export default function ExecutionCenterPage() {
  const store = useComplianceStore();
  const groups = useRoutePlannerStore(state => state.groups);
  const routes = flattenRoutes(groups);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const requestedView = params.get('view') === 'runs' ? 'board' : params.get('view');
  const [view, setView] = useState(['board', 'issues', 'calendar'].includes(requestedView) ? requestedView : 'board');
  const [projectFilter, setProjectFilter] = useState(params.get('project') || 'all');
  const [showCreate, setShowCreate] = useState(false);
  const allRuns = useMemo(() => store.projects.flatMap(project => project.testRuns.map(run => ({ ...run, project }))), [store.projects]);
  const allIssues = useMemo(() => store.projects.flatMap(project => project.issues.map(issue => ({ ...issue, project }))), [store.projects]);
  const activeRuns = allRuns.filter(run => run.status === 'running');
  const readyRuns = allRuns.filter(run => run.status === 'ready' && !getRunResourceConflicts(run, allRuns).length);
  const reviewRuns = allRuns.filter(run => run.status === 'review');
  const blockedRuns = allRuns.filter(run => ['planned', 'ready', 'paused'].includes(run.status) && (!getRunReadiness(run, routes).ready || getRunResourceConflicts(run, allRuns).length));
  const completedDistance = allRuns.filter(run => run.status === 'completed').reduce((sum, run) => sum + run.distance, 0);
  const switchView = value => { setView(value); setParams(value === 'board' ? {} : { view: value }); };

  return <div className="page-stack execution-center-page">
    <PageHeader eyebrow="TEST OPERATIONS CONTROL" title="测试执行中心" description="跨项目编排道路测试任务，管理人员、车辆、路线、准备阻塞、现场执行和工程复核。" actions={<><Link className="button button-secondary button-md" to="/projects">项目组合</Link>{!!store.projects.length && <Button variant="primary" onClick={() => setShowCreate(true)}>＋ 创建执行任务</Button>}</>} />
    <section className="stats-grid compact-stats">
      <StatCard icon="LIVE" label="现场执行中" value={activeRuns.length} detail="正在计时和记录证据的任务" tone="blue" />
      <StatCard icon="RDY" label="可以出车" value={readyRuns.length} detail="路线、车辆、人员和检查已就绪" tone="green" />
      <StatCard icon="REV" label="待工程复核" value={reviewRuns.length} detail="尚未计入正式完成结果" tone="violet" />
      <StatCard icon="BLK" label="准备阻塞" value={blockedRuns.length} detail={`累计归档 ${completedDistance.toFixed(1)} km`} tone={blockedRuns.length ? 'amber' : 'green'} />
    </section>

    {!store.projects.length ? <Card><EmptyState icon="EX" title="先建立测试项目" description="执行任务必须归属于项目，以保持法规范围、车辆版本、路线和证据上下文。" action={<Link className="button button-primary button-md" to="/projects?create=1">创建测试项目</Link>} /></Card> : <>
      {showCreate && <CreateExecutionPanel store={store} projects={store.projects} routes={routes} allRuns={allRuns} onCancel={() => setShowCreate(false)} onCreated={(projectId, runId) => navigate(`/execution/${projectId}/${runId}`)} />}
      <section className="execution-context-bar operations-context-bar">
        <div><span>项目范围</span><select value={projectFilter} onChange={event => setProjectFilter(event.target.value)}><option value="all">全部项目</option>{store.projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <nav><button className={view === 'board' ? 'active' : ''} onClick={() => switchView('board')}>任务运营台</button><button className={view === 'issues' ? 'active' : ''} onClick={() => switchView('issues')}>问题队列</button><button className={view === 'calendar' ? 'active' : ''} onClick={() => switchView('calendar')}>全局排期</button></nav>
      </section>
      {view === 'board' && <OperationsRunBoard runs={allRuns} routes={routes} projectFilter={projectFilter} store={store} navigate={navigate} />}
      {view === 'issues' && <OperationsIssueBoard issues={allIssues} routes={routes} projectFilter={projectFilter} />}
      {view === 'calendar' && <OperationsSchedule runs={allRuns.filter(run => projectFilter === 'all' || run.project.id === projectFilter)} issues={allIssues.filter(issue => projectFilter === 'all' || issue.project.id === projectFilter).filter(issue => !['verified', 'closed'].includes(issue.status))} routes={routes} />}
    </>}
  </div>;
}

function OperationsRunBoard({ runs, routes, projectFilter, store, navigate }) {
  const [status, setStatus] = useState('active');
  const [search, setSearch] = useState('');
  const visible = runs.filter(run => {
    const query = search.trim().toLowerCase();
    const matchesProject = projectFilter === 'all' || run.project.id === projectFilter;
    const matchesStatus = status === 'all' || (status === 'active' ? ACTIVE_STATUSES.includes(run.status) : run.status === status);
    const routeName = routes.find(route => route.id === run.routeId)?.name || '';
    const matchesSearch = !query || [run.name, run.project.name, run.driver, run.vehicle, routeName, run.testLead].join(' ').toLowerCase().includes(query);
    return matchesProject && matchesStatus && matchesSearch;
  }).sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || (a.date || '9999').localeCompare(b.date || '9999'));
  const start = run => { store.startTestRun(run.project.id, run.id); navigate(`/execution/${run.project.id}/${run.id}`); };
  return <Card className="operations-board" title="跨项目任务运营台" subtitle="任务状态由系统流程驱动，完成现场执行后必须经过工程复核">
    <div className="operations-toolbar"><div className="search-input"><span>⌕</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索任务、项目、路线、驾驶员或车辆" /></div><select value={status} onChange={event => setStatus(event.target.value)}><option value="active">当前工作队列</option><option value="all">全部状态</option>{RUN_STATUSES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select><span>显示 <strong>{visible.length}</strong> / {runs.length}</span></div>
    {!visible.length ? <EmptyState title="当前筛选下没有任务" description="调整项目、状态或搜索条件，或者创建新的测试执行任务。" /> : <div className="operations-run-list">{visible.map(run => {
      const route = routes.find(item => item.id === run.routeId);
      const readiness = getRunReadiness(run, routes);
      const conflicts = getRunResourceConflicts(run, runs);
      const overdue = run.date && run.date < new Date().toISOString().slice(0, 10) && ACTIVE_STATUSES.includes(run.status);
      return <article key={`${run.project.id}-${run.id}`} className={`operations-run-row status-${run.status}`}>
        <div className="operations-run-status"><StatusBadge value={run.status} labels={RUN_LABELS} />{overdue && <Chip tone="red">已逾期</Chip>}{run.riskLevel !== 'normal' && <Chip tone="amber">{run.riskLevel === 'controlled' ? '受控场地' : '较高风险'}</Chip>}</div>
        <div className="operations-run-main"><Link to={`/execution/${run.project.id}/${run.id}`}>{run.name}</Link><span>{run.project.name}</span><small>{run.objective || '测试目标待补充'}</small></div>
        <div className="operations-run-plan"><span>{formatDate(run.date)}</span><strong>{run.plannedStart || '--:--'}–{run.plannedEnd || '--:--'}</strong><small>{run.testLead || run.project.owner || '负责人待指派'}</small></div>
        <div className="operations-run-resource"><strong>{run.driver || '驾驶员待指派'}</strong><span>{run.vehicle || '车辆待分配'}</span>{conflicts.length ? <small className="text-danger">{conflicts.join('、')}</small> : <small>资源无冲突</small>}</div>
        <div className="operations-run-route"><strong>{route?.name || '路线待分配'}</strong><span>{route ? `${((route.stats?.distance || 0) / 1000).toFixed(1)} km` : '—'} · {run.scenarioIds.length} 个场景</span><ProgressBar value={run.scenarioIds.length ? concludedScenarioCount(run) / run.scenarioIds.length * 100 : 0} tone="green" /></div>
        <div className="operations-run-action">{renderOperationsAction(run, readiness, conflicts, start)}<small>{run.status === 'review' ? `提交于 ${formatDate(run.submittedAt)}` : readiness.ready ? '任务准备完成' : `缺少 ${readiness.missing.length} 项准备条件`}</small></div>
      </article>;
    })}</div>}
  </Card>;
}

function renderOperationsAction(run, readiness, conflicts, start) {
  const link = `/execution/${run.project.id}/${run.id}`;
  if (run.status === 'running') return <Link className="button button-primary button-sm" to={link}>进入现场</Link>;
  if (run.status === 'review') return <Link className="button button-primary button-sm" to={link}>工程复核</Link>;
  if (run.status === 'completed') return <Link className="button button-secondary button-sm" to={link}>查看归档</Link>;
  if (run.status === 'cancelled') return <Link className="button button-secondary button-sm" to={link}>查看任务</Link>;
  if (readiness.ready && !conflicts.length) return <Button variant="primary" size="sm" onClick={() => start(run)}>{run.status === 'paused' ? '继续执行' : '开始任务'}</Button>;
  return <Link className="button button-secondary button-sm" to={link}>处理准备阻塞</Link>;
}

function CreateExecutionPanel({ store, projects, routes, allRuns, onCancel, onCreated }) {
  const initialProject = projects.find(item => item.id === store.activeProjectId) || projects[0];
  const defaultRoute = routes.find(route => initialProject.routeIds.includes(route.id));
  const defaultProfile = getComplianceProfile(initialProject.profileId);
  const [form, setForm] = useState({ projectId: initialProject.id, name: `${initialProject.name} · 道路测试`, date: new Date().toISOString().slice(0, 10), plannedStart: '09:00', plannedEnd: '12:00', routeId: defaultRoute?.id || '', driver: '', vehicle: initialProject.vehicle, testLead: initialProject.owner, reviewer: '', riskLevel: 'normal', objective: '', scenarioIds: defaultProfile.scenarios.slice(0, 3) });
  const project = projects.find(item => item.id === form.projectId) || initialProject;
  const profile = getComplianceProfile(project.profileId);
  const update = (field, value) => setForm(current => ({ ...current, [field]: value }));
  const changeProject = projectId => {
    const next = projects.find(item => item.id === projectId);
    const nextProfile = getComplianceProfile(next.profileId);
    const route = routes.find(item => next.routeIds.includes(item.id));
    setForm(current => ({ ...current, projectId, name: `${next.name} · 道路测试`, routeId: route?.id || '', vehicle: next.vehicle, testLead: next.owner, scenarioIds: nextProfile.scenarios.slice(0, 3) }));
  };
  const toggleScenario = id => update('scenarioIds', form.scenarioIds.includes(id) ? form.scenarioIds.filter(value => value !== id) : [...form.scenarioIds, id]);
  const conflicts = getRunResourceConflicts({ ...form, id: 'new-run', project }, allRuns);
  const create = () => {
    const { projectId, ...values } = form;
    const run = store.addTestRun(projectId, values);
    if (form.routeId && !project.routeIds.includes(form.routeId)) store.assignRoutesToProject(projectId, [form.routeId]);
    onCreated(projectId, run.id);
  };
  return <section className="create-execution-panel">
    <header><div><span>MISSION DISPATCH</span><h2>创建道路测试执行任务</h2><p>先完成任务编排，再进入行前检查和现场执行。</p></div><button onClick={onCancel}>×</button></header>
    <div className="form-grid"><label className="field"><span>所属项目</span><select value={form.projectId} onChange={event => changeProject(event.target.value)}>{projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="field span-2"><span>任务名称</span><input value={form.name} onChange={event => update('name', event.target.value)} /></label><label className="field"><span>执行日期</span><input type="date" value={form.date} onChange={event => update('date', event.target.value)} /></label><label className="field"><span>计划开始</span><input type="time" value={form.plannedStart} onChange={event => update('plannedStart', event.target.value)} /></label><label className="field"><span>计划结束</span><input type="time" value={form.plannedEnd} onChange={event => update('plannedEnd', event.target.value)} /></label><label className="field"><span>测试路线</span><select value={form.routeId} onChange={event => update('routeId', event.target.value)}><option value="">未分配</option>{routes.map(route => <option key={route.id} value={route.id}>{route.name}{project.routeIds.includes(route.id) ? '' : '（创建后加入项目）'}</option>)}</select></label><label className="field"><span>驾驶员</span><input value={form.driver} onChange={event => update('driver', event.target.value)} /></label><label className="field"><span>车辆 / 版本</span><input value={form.vehicle} onChange={event => update('vehicle', event.target.value)} /></label><label className="field"><span>测试负责人</span><input value={form.testLead} onChange={event => update('testLead', event.target.value)} /></label><label className="field"><span>复核人</span><input value={form.reviewer} onChange={event => update('reviewer', event.target.value)} /></label><label className="field"><span>风险等级</span><select value={form.riskLevel} onChange={event => update('riskLevel', event.target.value)}><option value="normal">常规道路测试</option><option value="elevated">较高风险 / 专项交底</option><option value="controlled">仅限封闭或受控场地</option></select></label><label className="field span-2"><span>测试目标与验收边界</span><textarea rows="3" value={form.objective} onChange={event => update('objective', event.target.value)} placeholder="说明验证目标、通过条件、禁止事项和必要证据" /></label></div>
    <div className="scenario-picker"><strong>本次执行场景</strong><div>{profile.scenarios.map(id => <label key={id}><input type="checkbox" checked={form.scenarioIds.includes(id)} onChange={() => toggleScenario(id)} /><span>{COMPLIANCE_SCENARIOS[id]?.name || id}</span></label>)}</div></div>
    {!!conflicts.length && <div className="notice notice-amber">资源冲突：{conflicts.join('、')}。可以创建任务，但开始前应调整排期或资源。</div>}
    <div className="toolbar-row"><Button variant="primary" onClick={create}>创建并进入准备</Button><Button onClick={onCancel}>取消</Button></div>
  </section>;
}

function OperationsIssueBoard({ issues, routes, projectFilter }) {
  const [status, setStatus] = useState('open');
  const visible = issues.filter(issue => (projectFilter === 'all' || issue.project.id === projectFilter) && (status === 'all' || (status === 'open' ? !['verified', 'closed'].includes(issue.status) : issue.status === status))).sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity));
  return <Card title="跨项目问题队列" subtitle="问题处理保留在所属项目中，执行中心负责风险排序和运营跟踪" actions={<select value={status} onChange={event => setStatus(event.target.value)}><option value="open">待闭环</option><option value="all">全部问题</option>{ISSUE_STATUSES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select>}>
    {!visible.length ? <EmptyState title="没有匹配的问题" description="现场登记的问题会自动关联任务、场景和路线。" /> : <div className="operations-issue-list">{visible.map(issue => <article key={`${issue.project.id}-${issue.id}`}><i className={`severity-dot severity-${issue.severity}`} /><div><Link to={`/projects/${issue.project.id}/issues`}>{issue.title}</Link><span>{issue.project.name} · {routes.find(route => route.id === issue.routeId)?.name || '未关联路线'}</span></div><strong>{issue.assignee || '未指派'}</strong><time>{formatDate(issue.dueDate)}</time><StatusBadge value={issue.status} labels={ISSUE_LABELS} /><Link to={`/projects/${issue.project.id}/issues`}>处理 →</Link></article>)}</div>}
  </Card>;
}

function OperationsSchedule({ runs, issues, routes }) {
  const events = [
    ...runs.map(run => ({ id: run.id, date: run.date, type: 'run', title: run.name, project: run.project, status: run.status, route: routes.find(route => route.id === run.routeId)?.name || '路线待分配', owner: run.driver || '驾驶员待指派', time: `${run.plannedStart || '--:--'}–${run.plannedEnd || '--:--'}` })),
    ...issues.filter(issue => issue.dueDate).map(issue => ({ id: issue.id, date: issue.dueDate, type: 'issue', title: issue.title, project: issue.project, status: issue.status, route: routes.find(route => route.id === issue.routeId)?.name || '未关联路线', owner: issue.assignee || '负责人待指派', time: '问题截止' })),
  ].filter(item => item.date).sort((a, b) => a.date.localeCompare(b.date));
  return <Card title="跨项目运营排期" subtitle="汇总测试窗口、车辆驾驶员安排和问题关闭节点" actions={<span className="calendar-legend"><i className="run" /> 测试执行 <i className="issue" /> 问题节点</span>}>
    {!events.length ? <EmptyState title="还没有可展示的排期" description="为测试任务设置日期和时间，或为问题设置计划关闭日期。" /> : <div className="schedule-table"><div className="schedule-head"><span>日期</span><span>类型</span><span>任务</span><span>项目</span><span>路线 / 时间</span><span>负责人</span><span>状态</span></div>{events.map(item => <div className="schedule-row" key={`${item.type}-${item.id}`}><time>{formatDate(item.date)}</time><span className={`schedule-type ${item.type}`}>{item.type === 'run' ? '道路测试' : '问题关闭'}</span>{item.type === 'run' ? <Link className="schedule-task-link" to={`/execution/${item.project.id}/${item.id}`}>{item.title}</Link> : <Link className="schedule-task-link" to={`/projects/${item.project.id}/issues`}>{item.title}</Link>}<Link to={`/projects/${item.project.id}`}>{item.project.name}</Link><span>{item.route} · {item.time}</span><span>{item.owner}</span><StatusBadge value={item.status} labels={item.type === 'run' ? RUN_LABELS : ISSUE_LABELS} /></div>)}</div>}
  </Card>;
}

function concludedScenarioCount(run) {
  return run.scenarioIds.filter(id => ['passed', 'failed', 'blocked', 'not_applicable'].includes(run.scenarioResults?.[id]?.status)).length;
}

function severityWeight(value) { return ({ critical: 4, high: 3, medium: 2, low: 1 })[value] || 0; }
