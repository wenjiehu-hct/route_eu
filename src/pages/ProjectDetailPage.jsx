import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import ComplianceWorkbench from '../components/ComplianceWorkbench.jsx';
import EvidenceManager from '../components/EvidenceManager.jsx';
import { Button, Card, EmptyState, PageHeader, ProgressBar, StatusBadge } from '../components/ui.jsx';
import { COMPLIANCE_SCENARIOS, getComplianceProfile } from '../constants/compliance.js';
import { bestRouteForScenario } from '../services/compliance.js';
import { flattenRoutes, formatDate, getProjectMetrics, relativeTime } from '../services/portfolio.js';
import { formatKm } from '../services/utils.js';
import { ISSUE_STATUSES, PRIORITIES, PROJECT_PHASES, PROJECT_STATUSES, RUN_STATUSES, getRunReadiness, useComplianceStore } from '../stores/useComplianceStore.js';
import { useCoveragePlannerStore } from '../stores/useCoveragePlannerStore.js';
import { useRoutePlannerStore } from '../stores/useRoutePlannerStore.js';

const TABS = [
  { value: 'overview', label: '项目总览' },
  { value: 'compliance', label: '法规与路线' },
  { value: 'runs', label: '测试执行' },
  { value: 'issues', label: '问题闭环' },
  { value: 'activity', label: '活动记录' },
];
const STATUS_LABELS = Object.fromEntries(PROJECT_STATUSES.map(item => [item.value, item.label]));
const PHASE_LABELS = Object.fromEntries(PROJECT_PHASES.map(item => [item.value, item.label]));
const PRIORITY_LABELS = Object.fromEntries(PRIORITIES.map(item => [item.value, item.label]));
const RUN_LABELS = Object.fromEntries(RUN_STATUSES.map(item => [item.value, item.label]));
const ISSUE_LABELS = Object.fromEntries(ISSUE_STATUSES.map(item => [item.value, item.label]));

export default function ProjectDetailPage() {
  const { projectId, tab = 'overview' } = useParams();
  const navigate = useNavigate();
  const store = useComplianceStore();
  const groups = useRoutePlannerStore(state => state.groups);
  const routes = flattenRoutes(groups);
  const project = store.projects.find(item => item.id === projectId);

  useEffect(() => { if (project && store.activeProjectId !== project.id) store.selectProject(project.id); }, [project?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!project) return <div className="page-stack"><PageHeader title="项目不存在" description="该项目可能已被删除，或备份中不包含此项目。" /><EmptyState title="无法打开项目" action={<Link className="button button-primary button-md" to="/projects">返回项目列表</Link>} /></div>;
  if (!TABS.some(item => item.value === tab)) return <Navigate to={`/projects/${project.id}/overview`} replace />;

  const metrics = getProjectMetrics(project, routes);
  const profile = getComplianceProfile(project.profileId);
  const setTab = value => navigate(`/projects/${project.id}/${value}`);
  const openWaypointPlanner = () => { useCoveragePlannerStore.getState().setComplianceContext(project.id); navigate('/planning/manual'); };
  const openAreaPlanner = () => { useCoveragePlannerStore.getState().configureForCompliance(project.profileId, project.id); navigate('/planning/area'); };

  return <div className="page-stack project-detail-page">
    <PageHeader eyebrow={`${profile.type} · ${project.market}`} title={project.name} description={`${project.vehicle || '车型/版本待定义'} · ${project.owner || '负责人待指派'} · 更新于 ${formatDate(project.updatedAt)}`} actions={<><Button onClick={() => store.exportProjectCsv(project.id, routes)}>导出执行 CSV</Button><Button onClick={() => store.exportProject(project.id, routes)}>导出项目报告</Button><Button onClick={openAreaPlanner}>选区覆盖生成</Button><Button variant="primary" onClick={openWaypointPlanner}>＋ 添加 Waypoint 路线</Button></>}>
      <div className="header-badges"><StatusBadge value={project.status} labels={STATUS_LABELS} /><StatusBadge value={project.phase} labels={PHASE_LABELS} /><StatusBadge value={project.priority} labels={PRIORITY_LABELS} tone={project.priority === 'critical' ? 'red' : project.priority === 'high' ? 'amber' : 'neutral'} /></div>
    </PageHeader>

    <section className="project-command-strip">
      <div className="readiness-gauge" style={{ '--progress': `${metrics.readiness * 3.6}deg` }}><span><strong>{metrics.readiness}</strong><small>项目准备度</small></span></div>
      <div><span>场景完成</span><strong>{metrics.completedScenarios}/{metrics.scenarioCount}</strong><ProgressBar value={metrics.scenarioCount ? metrics.completedScenarios / metrics.scenarioCount * 100 : 0} /></div>
      <div><span>路线资产</span><strong>{metrics.assignedRoutes.length} 条 · {formatKm(metrics.assignedDistance)}</strong><small>已关联到当前项目</small></div>
      <div><span>测试执行</span><strong>{metrics.completedRuns}/{project.testRuns.length}</strong><small>已完成 / 全部任务</small></div>
      <div><span>待闭环问题</span><strong className={metrics.criticalIssues ? 'text-danger' : ''}>{metrics.openIssues.length}</strong><small>{metrics.criticalIssues} 个高风险</small></div>
    </section>

    <nav className="project-tabs">{TABS.map(item => <button key={item.value} className={tab === item.value ? 'active' : ''} onClick={() => setTab(item.value)}>{item.label}{item.value === 'runs' && <span>{project.testRuns.length}</span>}{item.value === 'issues' && <span>{metrics.openIssues.length}</span>}</button>)}</nav>

    {tab === 'overview' && <ProjectOverview project={project} metrics={metrics} store={store} navigate={navigate} openWaypointPlanner={openWaypointPlanner} openAreaPlanner={openAreaPlanner} />}
    {tab === 'compliance' && <div className="embedded-workbench"><ComplianceWorkbench /></div>}
    {tab === 'runs' && <TestRunsPanel project={project} routes={routes} store={store} />}
    {tab === 'issues' && <IssuesPanel project={project} routes={routes} store={store} />}
    {tab === 'activity' && <ActivityPanel project={project} />}
  </div>;
}

function ProjectOverview({ project, metrics, store, navigate, openWaypointPlanner, openAreaPlanner }) {
  const update = (field, value) => store.updateProjectById(project.id, { [field]: value });
  const assignedRoutes = metrics.assignedRoutes;
  const nextMilestones = project.milestones.filter(item => item.status !== 'completed').slice(0, 4);
  return <div className="project-overview-grid">
    <div className="project-main-column">
      <Card title="项目定义" subtitle="冻结项目边界、目标市场与交付责任">
        <div className="form-grid project-definition-form">
          <label className="field span-2"><span>项目名称</span><input value={project.name} onChange={event => update('name', event.target.value)} /></label>
          <label className="field"><span>项目状态</span><select value={project.status} onChange={event => update('status', event.target.value)}>{PROJECT_STATUSES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label className="field"><span>阶段</span><select value={project.phase} onChange={event => update('phase', event.target.value)}>{PROJECT_PHASES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label className="field"><span>优先级</span><select value={project.priority} onChange={event => update('priority', event.target.value)}>{PRIORITIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label className="field"><span>负责人</span><input value={project.owner} onChange={event => update('owner', event.target.value)} /></label>
          <label className="field"><span>目标市场</span><input value={project.market} onChange={event => update('market', event.target.value)} /></label>
          <label className="field"><span>车型 / 软件 / 地图版本</span><input value={project.vehicle} onChange={event => update('vehicle', event.target.value)} /></label>
          <label className="field"><span>开始日期</span><input type="date" value={project.startDate} onChange={event => update('startDate', event.target.value)} /></label>
          <label className="field"><span>计划结束</span><input type="date" value={project.endDate} onChange={event => update('endDate', event.target.value)} /></label>
          <label className="field span-2"><span>标签（逗号分隔）</span><input value={project.tags.join(', ')} onChange={event => update('tags', event.target.value.split(/[,，]/).map(value => value.trim()).filter(Boolean))} placeholder="例如：MY26, ISA, 德国, 地图版本验证" /></label>
          <label className="field span-2"><span>项目说明与决策记录</span><textarea rows="4" value={project.notes} onChange={event => update('notes', event.target.value)} placeholder="记录范围假设、法规版本、限制条件和关键决策" /></label>
        </div>
      </Card>

      <Card title="测试路线包" subtitle={`${assignedRoutes.length} 条路线已关联，覆盖 ${formatKm(metrics.assignedDistance)}`} actions={<Button size="sm" onClick={() => navigate(`/projects/${project.id}/compliance`)}>管理路线与场景</Button>}>
        {!assignedRoutes.length ? <EmptyState icon="RT" title="项目还没有测试路线" description="通常通过 Waypoint 添加常规测试路线；需要区域采集时再使用多边形覆盖生成。" action={<div className="empty-actions"><Button variant="primary" onClick={openWaypointPlanner}>添加 Waypoint 路线</Button><Button onClick={openAreaPlanner}>选区覆盖生成</Button></div>} /> : <div className="assigned-route-grid">
          {assignedRoutes.slice(0, 6).map(route => <button key={route.id} onClick={() => { useRoutePlannerStore.getState().locateRoute(route.id); navigate('/routes'); }}><i style={{ background: route.color }} /><div><strong>{route.name}</strong><span>{formatKm(route.stats?.distance || 0)} · {topRoadTypes(route)}</span></div><em>查看地图 →</em></button>)}
        </div>}
      </Card>
    </div>

    <aside className="project-side-column">
      <Card title="交付概况">
        <div className="delivery-kpis">
          <span><small>场景完成率</small><strong>{metrics.scenarioCount ? Math.round(metrics.completedScenarios / metrics.scenarioCount * 100) : 0}%</strong></span>
          <span><small>测试任务</small><strong>{project.testRuns.length}</strong></span>
          <span><small>高风险问题</small><strong className={metrics.criticalIssues ? 'text-danger' : ''}>{metrics.criticalIssues}</strong></span>
          <span><small>证据记录</small><strong>{Object.values(project.results).filter(result => result.evidence).length}</strong></span>
        </div>
      </Card>

      <Card title="项目里程碑" subtitle="可按项目实际交付流程调整" actions={<Button size="sm" onClick={() => store.addMilestone(project.id)}>＋ 添加</Button>}>
        <div className="milestone-list">{project.milestones.map(item => <article key={item.id} className={item.status === 'completed' ? 'completed' : ''}>
          <button className="milestone-check" onClick={() => store.updateMilestone(project.id, item.id, { status: item.status === 'completed' ? 'pending' : 'completed' })}>{item.status === 'completed' ? '✓' : ''}</button>
          <div><input value={item.name} onChange={event => store.updateMilestone(project.id, item.id, { name: event.target.value })} /><span><input type="date" value={item.dueDate} onChange={event => store.updateMilestone(project.id, item.id, { dueDate: event.target.value })} /><input value={item.owner} placeholder="负责人" onChange={event => store.updateMilestone(project.id, item.id, { owner: event.target.value })} /></span></div>
          <button className="delete-icon" onClick={() => store.deleteMilestone(project.id, item.id)}>×</button>
        </article>)}</div>
        {!project.milestones.length && <EmptyState title="暂无里程碑" action={<Button onClick={() => store.addMilestone(project.id)}>添加里程碑</Button>} />}
      </Card>

      <Card title="下一步建议" subtitle="基于当前项目数据自动判断">
        <div className="next-actions">
          {!assignedRoutes.length && <button onClick={openWaypointPlanner}><span>1</span><div><strong>添加常规 Waypoint 路线</strong><small>当前没有关联路线</small></div></button>}
          {assignedRoutes.length > 0 && !project.testRuns.length && <button onClick={() => navigate(`/projects/${project.id}/runs`)}><span>1</span><div><strong>创建首次测试执行</strong><small>路线已准备，尚未排期</small></div></button>}
          {metrics.openIssues.length > 0 && <button onClick={() => navigate(`/projects/${project.id}/issues`)}><span>!</span><div><strong>推进问题闭环</strong><small>{metrics.openIssues.length} 个问题待处理</small></div></button>}
          {nextMilestones.slice(0, 2).map((item, index) => <button key={item.id}><span>{index + 2}</span><div><strong>{item.name}</strong><small>{item.dueDate ? formatDate(item.dueDate) : '日期待设置'} · {item.owner || '未指派'}</small></div></button>)}
          {assignedRoutes.length > 0 && project.testRuns.length > 0 && !metrics.openIssues.length && !nextMilestones.length && <div className="healthy-state compact"><span>✓</span><strong>项目状态良好</strong><p>当前没有系统识别出的待办。</p></div>}
        </div>
      </Card>
    </aside>
  </div>;
}

export function TestRunsPanel({ project, routes, store, compact = false }) {
  const navigate = useNavigate();
  const [editingId, setEditingId] = useState(null);
  const [filter, setFilter] = useState('all');
  const projectRoutes = routes.filter(route => project.routeIds.includes(route.id));
  const profile = getComplianceProfile(project.profileId);
  const visibleRuns = project.testRuns.filter(run => filter === 'all' || run.status === filter);
  const add = () => { const run = store.addTestRun(project.id, { routeId: projectRoutes[0]?.id || '', vehicle: project.vehicle, scenarioIds: profile.scenarios.slice(0, 3) }); setEditingId(run.id); };
  const openRun = run => navigate(`/execution/${project.id}/${run.id}`);
  const startRun = run => { store.startTestRun(project.id, run.id); openRun(run); };
  const renderRunAction = (run, readiness) => {
    if (run.status === 'running') return <Link className="button button-primary button-sm" to={`/execution/${project.id}/${run.id}`}>进入现场会话</Link>;
    if (run.status === 'completed') return <Link className="button button-secondary button-sm" to={`/execution/${project.id}/${run.id}`}>查看执行记录</Link>;
    if (run.status === 'cancelled') return <Link className="button button-secondary button-sm" to={`/execution/${project.id}/${run.id}`}>查看任务</Link>;
    if (readiness.ready) return <Button variant="primary" size="sm" onClick={() => startRun(run)}>{run.status === 'paused' ? '继续任务' : '开始任务'}</Button>;
    return <Link className="button button-primary button-sm" to={`/execution/${project.id}/${run.id}`}>完成准备 · 还差 {readiness.missing.length} 项</Link>;
  };
  const generate = () => {
    if (!projectRoutes.length) return alert('请先为项目分配至少一条测试路线。');
    const alreadyPlanned = new Set(project.testRuns.filter(run => !['completed', 'cancelled'].includes(run.status)).flatMap(run => run.scenarioIds));
    const pending = profile.scenarios.filter(id => !['passed', 'not_applicable'].includes(project.results?.[id]?.status) && !alreadyPlanned.has(id));
    if (!pending.length) return alert('所有未完成场景都已安排测试任务。');
    const grouped = new Map();
    pending.forEach((id, index) => {
      const assignedId = project.results?.[id]?.routeId;
      const recommended = assignedId ? projectRoutes.find(route => route.id === assignedId) : bestRouteForScenario(projectRoutes, id)?.route;
      const route = recommended || projectRoutes[index % projectRoutes.length];
      if (!grouped.has(route.id)) grouped.set(route.id, { route, scenarioIds: [] });
      grouped.get(route.id).scenarioIds.push(id);
    });
    const date = new Date().toISOString().slice(0, 10);
    store.addTestRuns(project.id, [...grouped.values()].map(({ route, scenarioIds }, index) => ({ name: `${route.name} · 场景任务 ${index + 1}`, routeId: route.id, date, vehicle: project.vehicle, scenarioIds })));
  };
  return <Card className="execution-panel" title="测试执行计划" subtitle="把路线、车辆、驾驶员、场景和现场记录组织为可追踪任务" actions={<><Button size={compact ? 'sm' : 'md'} onClick={generate}>按未完成场景生成计划</Button><Button variant="primary" size={compact ? 'sm' : 'md'} onClick={add}>＋ 新建测试执行</Button></>}>
    <div className="execution-toolbar"><div>{RUN_STATUSES.map(item => <button key={item.value} className={filter === item.value ? 'active' : ''} onClick={() => setFilter(item.value)}>{item.label}<span>{project.testRuns.filter(run => run.status === item.value).length}</span></button>)}<button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>全部<span>{project.testRuns.length}</span></button></div></div>
    {!visibleRuns.length ? <EmptyState icon="RUN" title="没有测试执行任务" description="创建任务并分配路线、驾驶员、车辆和测试场景。" action={<Button variant="primary" onClick={add}>创建首个任务</Button>} /> : <div className="run-list">
      {visibleRuns.map(run => {
        const readiness = getRunReadiness(run, routes);
        return <article key={run.id} className={`run-card ${editingId === run.id ? 'editing' : ''}`}>
        <header><div><time>{run.date || '日期待定'}</time><strong>{run.name}</strong><span>{routes.find(route => route.id === run.routeId)?.name || '路线待分配'} · {run.driver || '驾驶员待指派'}</span></div><StatusBadge value={run.status} labels={RUN_LABELS} /></header>
        <div className="run-summary"><span><small>车辆/版本</small><strong>{run.vehicle || project.vehicle || '未设置'}</strong></span><span><small>天气</small><strong>{run.weather || '未记录'}</strong></span><span><small>里程</small><strong>{run.distance ? `${run.distance} km` : '待回填'}</strong></span><span><small>测试场景</small><strong>{run.scenarioIds.length}</strong></span></div>
        {!['running', 'completed'].includes(run.status) && <div className={`run-readiness ${readiness.ready ? 'ready' : ''}`}><div><span>任务准备度</span><strong>{readiness.completed}/{readiness.total}</strong></div><ProgressBar value={readiness.completed / readiness.total * 100} tone={readiness.ready ? 'green' : 'blue'} /><small>{readiness.ready ? '路线、人员、车辆和行前检查均已就绪' : readiness.missing.slice(0, 3).map(item => item.label).join(' · ')}</small></div>}
        {editingId === run.id && <RunEditor project={project} run={run} routes={routes} store={store} />}
        <footer>{renderRunAction(run, readiness)}<Button size="sm" onClick={() => setEditingId(editingId === run.id ? null : run.id)}>{editingId === run.id ? '收起编辑' : '编辑任务'}</Button>{run.status === 'running' && <Button size="sm" onClick={() => store.pauseTestRun(project.id, run.id)}>暂停</Button>}<Button size="sm" variant="danger" onClick={() => { if (window.confirm(`删除测试任务“${run.name}”？`)) store.deleteTestRun(project.id, run.id); }}>删除</Button></footer>
      </article>;
      })}
    </div>}
  </Card>;
}

function RunEditor({ project, run, routes, store }) {
  const profile = getComplianceProfile(project.profileId);
  const update = (field, value) => store.updateTestRun(project.id, run.id, { [field]: value });
  const selectRoute = routeId => {
    update('routeId', routeId);
    if (routeId && !project.routeIds.includes(routeId)) store.assignRoutesToProject(project.id, [routeId]);
  };
  const toggleScenario = id => update('scenarioIds', run.scenarioIds.includes(id) ? run.scenarioIds.filter(value => value !== id) : [...run.scenarioIds, id]);
  return <div className="run-editor">
    <div className="form-grid">
      <label className="field span-2"><span>任务名称</span><input value={run.name} onChange={event => update('name', event.target.value)} /></label>
      <label className="field"><span>计划/执行日期</span><input type="date" value={run.date} onChange={event => update('date', event.target.value)} /></label>
      <label className="field"><span>状态</span><select value={run.status} onChange={event => update('status', event.target.value)}>{RUN_STATUSES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <label className="field"><span>测试路线</span><select value={run.routeId} onChange={event => selectRoute(event.target.value)}><option value="">未分配</option>{routes.map(route => <option key={route.id} value={route.id}>{route.name}{project.routeIds.includes(route.id) ? '' : '（选择后加入项目）'}</option>)}</select></label>
      <label className="field"><span>驾驶员</span><input value={run.driver} onChange={event => update('driver', event.target.value)} /></label>
      <label className="field"><span>车辆 / 版本</span><input value={run.vehicle} onChange={event => update('vehicle', event.target.value)} /></label>
      <label className="field"><span>天气 / 路况</span><input value={run.weather} onChange={event => update('weather', event.target.value)} placeholder="晴 / 12°C / 干燥" /></label>
      <label className="field"><span>实测里程（km）</span><input type="number" min="0" value={run.distance || ''} onChange={event => update('distance', Number(event.target.value) || 0)} /></label>
      <label className="field span-2"><span>现场记录</span><textarea rows="3" value={run.notes} onChange={event => update('notes', event.target.value)} placeholder="记录异常、数据包、真值采集和测试限制" /></label>
    </div>
    <div className="scenario-picker"><strong>本次执行场景</strong><div>{profile.scenarios.map(id => <label key={id}><input type="checkbox" checked={run.scenarioIds.includes(id)} onChange={() => toggleScenario(id)} /><span>{COMPLIANCE_SCENARIOS[id]?.name || id}</span></label>)}</div></div>
    <EvidenceManager projectId={project.id} ownerType="run" ownerId={run.id} attachments={run.attachments} onChange={attachments => update('attachments', attachments)} />
  </div>;
}

export function IssuesPanel({ project, routes, store, compact = false }) {
  const [editingId, setEditingId] = useState(null);
  const [filter, setFilter] = useState('open');
  const projectRoutes = routes.filter(route => project.routeIds.includes(route.id));
  const visible = project.issues.filter(issue => filter === 'all' || (filter === 'open' ? !['closed', 'verified'].includes(issue.status) : issue.status === filter));
  const add = () => { const issue = store.addIssue(project.id); setEditingId(issue.id); };
  return <Card className="issues-panel" title="测试问题与闭环" subtitle="从道路复现到修复验证，保留路线、场景和证据上下文" actions={<Button variant="primary" size={compact ? 'sm' : 'md'} onClick={add}>＋ 登记问题</Button>}>
    <div className="issue-board-summary"><button className={filter === 'open' ? 'active' : ''} onClick={() => setFilter('open')}><strong>{project.issues.filter(issue => !['closed', 'verified'].includes(issue.status)).length}</strong><span>待闭环</span></button><button className={filter === 'investigating' ? 'active' : ''} onClick={() => setFilter('investigating')}><strong>{project.issues.filter(issue => issue.status === 'investigating').length}</strong><span>分析中</span></button><button className={filter === 'verified' ? 'active' : ''} onClick={() => setFilter('verified')}><strong>{project.issues.filter(issue => issue.status === 'verified').length}</strong><span>已验证</span></button><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}><strong>{project.issues.length}</strong><span>全部</span></button></div>
    {!visible.length ? <EmptyState icon="!" title="当前视图没有问题" description="现场发现异常后，可关联路线和法规场景并记录证据索引。" action={<Button variant="primary" onClick={add}>登记问题</Button>} /> : <div className="issue-list">
      {visible.sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity)).map(issue => <article key={issue.id} className={`issue-card severity-border-${issue.severity}`}>
        <header><div><span className={`severity-label severity-${issue.severity}`}>{({ critical: '严重', high: '高', medium: '中', low: '低' })[issue.severity]}</span><strong>{issue.title}</strong></div><StatusBadge value={issue.status} labels={ISSUE_LABELS} /></header>
        <p>{issue.description || '尚未填写问题描述。'}</p>
        <div className="issue-meta"><span>负责人：{issue.assignee || '未指派'}</span><span>测试任务：{project.testRuns.find(run => run.id === issue.runId)?.name || '未关联'}</span><span>路线：{projectRoutes.find(route => route.id === issue.routeId)?.name || '未关联'}</span><span>截止：{formatDate(issue.dueDate)}</span></div>
        {issue.evidence && <div className="evidence-line"><strong>证据</strong><span>{issue.evidence}</span></div>}
        {editingId === issue.id && <IssueEditor project={project} issue={issue} routes={projectRoutes} store={store} />}
        <footer><Button size="sm" onClick={() => setEditingId(editingId === issue.id ? null : issue.id)}>{editingId === issue.id ? '收起编辑' : '编辑问题'}</Button>{issue.status === 'resolved' && <Button size="sm" variant="primary" onClick={() => { if (!issue.resolution.trim()) return alert('验证前请先填写解决方案或修复版本。'); store.updateIssue(project.id, issue.id, { status: 'verified' }); }}>验证通过</Button>}<Button size="sm" variant="danger" onClick={() => { if (window.confirm(`删除问题“${issue.title}”？`)) store.deleteIssue(project.id, issue.id); }}>删除</Button></footer>
      </article>)}
    </div>}
  </Card>;
}

function IssueEditor({ project, issue, routes, store }) {
  const profile = getComplianceProfile(project.profileId);
  const update = (field, value) => store.updateIssue(project.id, issue.id, { [field]: value });
  return <div className="issue-editor form-grid">
    <label className="field span-2"><span>问题标题</span><input value={issue.title} onChange={event => update('title', event.target.value)} /></label>
    <label className="field"><span>严重度</span><select value={issue.severity} onChange={event => update('severity', event.target.value)}>{PRIORITIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
    <label className="field"><span>状态</span><select value={issue.status} onChange={event => update('status', event.target.value)}>{ISSUE_STATUSES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
    <label className="field"><span>负责人</span><input value={issue.assignee} onChange={event => update('assignee', event.target.value)} /></label>
    <label className="field"><span>计划关闭日期</span><input type="date" value={issue.dueDate} onChange={event => update('dueDate', event.target.value)} /></label>
    <label className="field"><span>关联路线</span><select value={issue.routeId} onChange={event => update('routeId', event.target.value)}><option value="">未关联</option>{routes.map(route => <option key={route.id} value={route.id}>{route.name}</option>)}</select></label>
    <label className="field"><span>关联测试任务</span><select value={issue.runId} onChange={event => update('runId', event.target.value)}><option value="">未关联</option>{project.testRuns.map(run => <option key={run.id} value={run.id}>{run.name}</option>)}</select></label>
    <label className="field"><span>关联场景</span><select value={issue.scenarioId} onChange={event => update('scenarioId', event.target.value)}><option value="">未关联</option>{profile.scenarios.map(id => <option key={id} value={id}>{COMPLIANCE_SCENARIOS[id]?.name || id}</option>)}</select></label>
    <label className="field span-2"><span>问题描述 / 复现步骤</span><textarea rows="4" value={issue.description} onChange={event => update('description', event.target.value)} /></label>
    <label className="field span-2"><span>根因分析</span><textarea rows="3" value={issue.rootCause} onChange={event => update('rootCause', event.target.value)} placeholder="记录数据分析结论、触发条件和影响范围" /></label>
    <label className="field span-2"><span>解决方案 / 软件版本</span><textarea rows="3" value={issue.resolution} onChange={event => update('resolution', event.target.value)} placeholder="记录修复措施、代码/标定/地图版本和回归范围" /></label>
    <label className="field span-2"><span>验证结论</span><textarea rows="2" value={issue.verificationNotes} onChange={event => update('verificationNotes', event.target.value)} placeholder="记录复测任务、结果和关闭依据" /></label>
    <label className="field span-2"><span>证据索引</span><input value={issue.evidence} onChange={event => update('evidence', event.target.value)} placeholder="日志 ID、视频文件、问题单或云盘链接" /></label>
    <div className="span-2"><EvidenceManager projectId={project.id} ownerType="issue" ownerId={issue.id} attachments={issue.attachments} onChange={attachments => update('attachments', attachments)} /></div>
  </div>;
}

function ActivityPanel({ project }) {
  return <Card title="项目活动记录" subtitle="关键业务动作由系统自动记录，便于追踪项目演进">
    {!project.activities.length ? <EmptyState title="暂无活动记录" /> : <div className="project-activity-timeline">{project.activities.map(activity => <article key={activity.id}><i>{activityIcon(activity.type)}</i><div><strong>{activity.title}</strong><span>{activity.detail}</span></div><time>{relativeTime(activity.createdAt)}<small>{new Date(activity.createdAt).toLocaleString('zh-CN')}</small></time></article>)}</div>}
  </Card>;
}

function topRoadTypes(route) {
  const labels = { motorway: '高速', trunk: '快速路', primary: '主干道', secondary: '次干道', tertiary: '支路', residential: '居住区' };
  return Object.entries(route.stats?.roadTypeDistances || {}).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([type]) => labels[type.replace(/_link$/, '')] || type).join(' / ') || '类型待分析';
}
function severityWeight(value) { return ({ critical: 4, high: 3, medium: 2, low: 1 })[value] || 0; }
function activityIcon(type) { return ({ project_created: 'PJ', run_created: 'RUN', run_status: 'RUN', issue_created: '!', issue_status: '!', routes_assigned: 'RT', milestone_added: 'MS', scenario_updated: 'SC' })[type] || '·'; }
