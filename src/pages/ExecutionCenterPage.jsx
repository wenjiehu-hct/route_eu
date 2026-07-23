import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { IssuesPanel, TestRunsPanel } from './ProjectDetailPage.jsx';
import { Card, EmptyState, PageHeader, StatCard, StatusBadge } from '../components/ui.jsx';
import { flattenRoutes, formatDate } from '../services/portfolio.js';
import { ISSUE_STATUSES, RUN_STATUSES, useComplianceStore } from '../stores/useComplianceStore.js';
import { useRoutePlannerStore } from '../stores/useRoutePlannerStore.js';

const RUN_LABELS = Object.fromEntries(RUN_STATUSES.map(item => [item.value, item.label]));
const ISSUE_LABELS = Object.fromEntries(ISSUE_STATUSES.map(item => [item.value, item.label]));

export default function ExecutionCenterPage() {
  const store = useComplianceStore();
  const groups = useRoutePlannerStore(state => state.groups);
  const routes = flattenRoutes(groups);
  const [params, setParams] = useSearchParams();
  const requestedView = params.get('view');
  const [view, setView] = useState(['runs', 'issues', 'calendar'].includes(requestedView) ? requestedView : 'runs');
  const [projectId, setProjectId] = useState(store.activeProjectId || store.projects[0]?.id || '');
  const project = store.projects.find(item => item.id === projectId) || store.projects[0];
  const allRuns = useMemo(() => store.projects.flatMap(item => item.testRuns.map(run => ({ ...run, project: item }))), [store.projects]);
  const allIssues = useMemo(() => store.projects.flatMap(item => item.issues.map(issue => ({ ...issue, project: item }))), [store.projects]);
  const today = new Date().toISOString().slice(0, 10);
  const upcomingRuns = allRuns.filter(run => run.status === 'planned' && (!run.date || run.date >= today));
  const activeRuns = allRuns.filter(run => run.status === 'running');
  const openIssues = allIssues.filter(issue => !['verified', 'closed'].includes(issue.status));
  const completedDistance = allRuns.filter(run => run.status === 'completed').reduce((sum, run) => sum + run.distance, 0);
  const switchView = value => { setView(value); setParams(value === 'runs' ? {} : { view: value }); };

  return <div className="page-stack execution-center-page">
    <PageHeader eyebrow="TEST OPERATIONS" title="测试执行中心" description="统一管理测试排期、现场执行、里程回填、问题登记和修复验证。" actions={project && <Link className="button button-secondary button-md" to={`/projects/${project.id}`}>打开当前项目</Link>} />
    <section className="stats-grid compact-stats">
      <StatCard icon="NOW" label="执行中" value={activeRuns.length} detail="正在进行的道路测试" tone="blue" />
      <StatCard icon="NEXT" label="待执行" value={upcomingRuns.length} detail="已计划的测试任务" tone="violet" />
      <StatCard icon="KM" label="累计实测里程" value={`${completedDistance.toFixed(1)} km`} detail={`${allRuns.filter(run => run.status === 'completed').length} 个已完成任务`} tone="green" />
      <StatCard icon="!" label="待闭环问题" value={openIssues.length} detail={`${openIssues.filter(issue => ['critical', 'high'].includes(issue.severity)).length} 个高风险`} tone={openIssues.length ? 'amber' : 'green'} />
    </section>

    {!store.projects.length ? <Card><EmptyState icon="EX" title="先建立测试项目" description="执行任务和问题必须归属于项目，以保持法规范围、路线和证据上下文。" action={<Link className="button button-primary button-md" to="/projects?create=1">创建测试项目</Link>} /></Card> : <>
      <section className="execution-context-bar">
        <div><span>当前项目上下文</span><select value={project?.id || ''} onChange={event => { setProjectId(event.target.value); store.selectProject(event.target.value); }}>{store.projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <nav><button className={view === 'runs' ? 'active' : ''} onClick={() => switchView('runs')}>测试任务</button><button className={view === 'issues' ? 'active' : ''} onClick={() => switchView('issues')}>问题闭环</button><button className={view === 'calendar' ? 'active' : ''} onClick={() => switchView('calendar')}>全局排期</button></nav>
      </section>
      {view === 'runs' && <TestRunsPanel project={project} routes={routes} store={store} />}
      {view === 'issues' && <IssuesPanel project={project} routes={routes} store={store} />}
      {view === 'calendar' && <OperationsSchedule runs={allRuns} issues={openIssues} routes={routes} />}
    </>}
  </div>;
}

function OperationsSchedule({ runs, issues, routes }) {
  const events = [
    ...runs.map(run => ({ id: run.id, date: run.date, type: 'run', title: run.name, project: run.project, status: run.status, route: routes.find(route => route.id === run.routeId)?.name || '路线待分配', owner: run.driver || '驾驶员待指派' })),
    ...issues.filter(issue => issue.dueDate).map(issue => ({ id: issue.id, date: issue.dueDate, type: 'issue', title: issue.title, project: issue.project, status: issue.status, route: routes.find(route => route.id === issue.routeId)?.name || '未关联路线', owner: issue.assignee || '负责人待指派' })),
  ].filter(item => item.date).sort((a, b) => a.date.localeCompare(b.date));
  return <Card title="跨项目运营排期" subtitle="按日期汇总测试执行与问题关闭计划" actions={<span className="calendar-legend"><i className="run" /> 测试执行 <i className="issue" /> 问题节点</span>}>
    {!events.length ? <EmptyState title="还没有可展示的排期" description="为测试任务设置日期，或为问题设置计划关闭日期。" /> : <div className="schedule-table">
      <div className="schedule-head"><span>日期</span><span>类型</span><span>任务</span><span>项目</span><span>路线 / 上下文</span><span>负责人</span><span>状态</span></div>
      {events.map(item => <div className="schedule-row" key={`${item.type}-${item.id}`}><time>{formatDate(item.date)}</time><span className={`schedule-type ${item.type}`}>{item.type === 'run' ? '道路测试' : '问题关闭'}</span>{item.type === 'run' ? <Link className="schedule-task-link" to={`/execution/${item.project.id}/${item.id}`}>{item.title}</Link> : <Link className="schedule-task-link" to={`/projects/${item.project.id}/issues`}>{item.title}</Link>}<Link to={`/projects/${item.project.id}`}>{item.project.name}</Link><span>{item.route}</span><span>{item.owner}</span><StatusBadge value={item.status} labels={item.type === 'run' ? RUN_LABELS : ISSUE_LABELS} /></div>)}
    </div>}
  </Card>;
}
