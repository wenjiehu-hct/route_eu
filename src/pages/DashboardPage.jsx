import { Link } from 'react-router-dom';
import { COMPLIANCE_SCENARIOS } from '../constants/compliance.js';
import { formatKm } from '../services/utils.js';
import { flattenRoutes, formatDate, getProjectMetrics, relativeTime } from '../services/portfolio.js';
import { useComplianceStore, PROJECT_STATUSES } from '../stores/useComplianceStore.js';
import { usePOIStore } from '../stores/usePOIStore.js';
import { useRoutePlannerStore } from '../stores/useRoutePlannerStore.js';
import { Card, EmptyState, PageHeader, ProgressBar, StatCard, StatusBadge } from '../components/ui.jsx';

const STATUS_LABELS = Object.fromEntries(PROJECT_STATUSES.map(item => [item.value, item.label]));

export default function DashboardPage() {
  const projects = useComplianceStore(state => state.projects);
  const groups = useRoutePlannerStore(state => state.groups);
  const pois = usePOIStore(state => state.pois);
  const routes = flattenRoutes(groups);
  const metrics = projects.map(project => ({ project, metrics: getProjectMetrics(project, routes) }));
  const activeProjects = projects.filter(project => !['completed'].includes(project.status)).length;
  const totalDistance = routes.reduce((sum, route) => sum + (route.stats?.distance || 0), 0);
  const completedRuns = projects.reduce((sum, project) => sum + project.testRuns.filter(run => run.status === 'completed').length, 0);
  const allIssues = projects.flatMap(project => project.issues.map(issue => ({ ...issue, project })));
  const openIssues = allIssues.filter(issue => !['closed', 'verified'].includes(issue.status));
  const activities = projects.flatMap(project => project.activities.map(activity => ({ ...activity, project }))).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 8);
  const upcoming = projects.flatMap(project => project.milestones.filter(item => item.status !== 'completed').map(item => ({ ...item, project }))).filter(item => item.dueDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 6);

  return <div className="page-stack dashboard-page">
    <PageHeader eyebrow="PORTFOLIO COMMAND CENTER" title="海外道路测试运营总览" description="把法规目标、路线资产、测试执行和问题闭环放在同一个运营视角下。" actions={<><Link className="button button-secondary button-md" to="/routes">查看路线资产</Link><Link className="button button-primary button-md" to="/projects?create=1">新建测试项目</Link></>} />

    <section className="stats-grid">
      <StatCard icon="PJ" label="在管测试项目" value={activeProjects} detail={`共 ${projects.length} 个项目`} tone="blue" />
      <StatCard icon="KM" label="路线资产里程" value={formatKm(totalDistance)} detail={`${routes.length} 条路线 · ${groups.length} 个分组`} tone="violet" />
      <StatCard icon="RUN" label="已完成测试执行" value={completedRuns} detail={`${projects.reduce((sum, project) => sum + project.testRuns.length, 0)} 个执行任务`} tone="green" />
      <StatCard icon="!" label="待闭环问题" value={openIssues.length} detail={`${openIssues.filter(issue => ['critical', 'high'].includes(issue.severity)).length} 个高优先级`} tone={openIssues.length ? 'amber' : 'green'} />
    </section>

    <section className="dashboard-grid dashboard-grid-primary">
      <Card className="portfolio-card" title="项目组合健康度" subtitle="按准备度、阶段与风险进行组合管理" actions={<Link to="/projects">全部项目 →</Link>}>
        {!metrics.length ? <EmptyState icon="PJ" title="建立第一个海外测试项目" description="选择法规模板并定义目标市场，平台将串联路线准备、执行和问题闭环。" action={<Link className="button button-primary button-md" to="/projects?create=1">创建项目</Link>} /> : <div className="portfolio-list">
          {metrics.slice(0, 6).map(({ project, metrics: item }) => <Link to={`/projects/${project.id}`} key={project.id} className="portfolio-row">
            <div className={`project-signal priority-${project.priority}`} />
            <div className="portfolio-main"><strong>{project.name}</strong><span>{project.market} · {project.vehicle || '车型待定义'} · {item.profile.type}</span><ProgressBar value={item.readiness} tone={item.readiness >= 70 ? 'green' : 'blue'} /></div>
            <div className="portfolio-kpi"><strong>{item.readiness}%</strong><span>准备度</span></div>
            <div className="portfolio-kpi"><strong>{item.assignedRoutes.length}</strong><span>路线</span></div>
            <div className="portfolio-kpi"><strong className={item.criticalIssues ? 'text-danger' : ''}>{item.openIssues.length}</strong><span>问题</span></div>
            <StatusBadge value={project.status} labels={STATUS_LABELS} />
          </Link>)}
        </div>}
      </Card>

      <Card className="attention-card" title="需要关注" subtitle="高风险问题与阻塞项" actions={<Link to="/execution?view=issues">问题中心 →</Link>}>
        {!openIssues.length ? <div className="healthy-state"><span>✓</span><strong>暂无待闭环问题</strong><p>新登记的问题会在这里按严重度集中展示。</p></div> : <div className="attention-list">
          {openIssues.sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity)).slice(0, 5).map(issue => <Link to={`/projects/${issue.project.id}/issues`} key={issue.id}>
            <i className={`severity-dot severity-${issue.severity}`} />
            <div><strong>{issue.title}</strong><span>{issue.project.name} · {issue.assignee || '未指派'}</span></div>
            <StatusBadge value={issue.severity} labels={{ critical: '严重', high: '高', medium: '中', low: '低' }} />
          </Link>)}
        </div>}
      </Card>
    </section>

    <section className="dashboard-grid dashboard-grid-secondary">
      <Card title="能力资产盘点" subtitle="当前工作区可直接复用的测试资源">
        <div className="capability-grid">
          <Link to="/routes"><span>RT</span><strong>{routes.length}</strong><small>测试路线</small><em>{formatKm(totalDistance)}</em></Link>
          <Link to="/regulations"><span>RG</span><strong>{useComplianceStore.getState().profiles.length}</strong><small>法规模板</small><em>{Object.keys(COMPLIANCE_SCENARIOS).length} 个场景</em></Link>
          <Link to="/routes/pois"><span>POI</span><strong>{pois.length}</strong><small>测试设施与标记</small><em>补能 / 停车 / 问题点</em></Link>
          <Link to="/execution"><span>EV</span><strong>{projects.reduce((sum, project) => sum + Object.values(project.results).filter(result => result.evidence).length, 0)}</strong><small>证据索引</small><em>日志 / 视频 / 问题单</em></Link>
        </div>
      </Card>

      <Card title="近期里程碑" subtitle="跨项目计划节点" actions={<Link to="/projects">项目计划 →</Link>}>
        {!upcoming.length ? <EmptyState title="暂无近期里程碑" description="进入项目设置日期后，这里会形成跨项目日程视图。" /> : <div className="timeline-list">
          {upcoming.map(item => <Link to={`/projects/${item.project.id}`} key={item.id}><time>{formatDate(item.dueDate)}</time><i /><div><strong>{item.name}</strong><span>{item.project.name} · {item.owner || '未指派'}</span></div></Link>)}
        </div>}
      </Card>

      <Card title="最近动态" subtitle="项目、执行和问题的关键变更">
        {!activities.length ? <EmptyState title="暂无项目动态" description="创建项目、测试任务或问题后，系统会自动记录关键动作。" /> : <div className="activity-feed">
          {activities.map(activity => <Link to={`/projects/${activity.project.id}`} key={activity.id}><span>{activityIcon(activity.type)}</span><div><strong>{activity.title}</strong><small>{activity.project.name}{activity.detail ? ` · ${activity.detail}` : ''}</small></div><time>{relativeTime(activity.createdAt)}</time></Link>)}
        </div>}
      </Card>
    </section>

    <section className="quick-launch">
      <div><span>QUICK LAUNCH</span><strong>开始下一项工作</strong></div>
      <Link to="/planning/manual"><i>WP</i><span><strong>添加 Waypoint 路线</strong><small>日常路线规划、途经点编辑与导航</small></span></Link>
      <Link to="/planning/area"><i>AR</i><span><strong>选区覆盖路线生成</strong><small>多边形批量生成低重复长路线</small></span></Link>
      <Link to="/execution"><i>EX</i><span><strong>安排测试执行</strong><small>驾驶员、车辆、场景和路线</small></span></Link>
      <Link to="/data"><i>BK</i><span><strong>备份工作区</strong><small>导出完整可迁移数据</small></span></Link>
    </section>
  </div>;
}

function severityWeight(value) { return ({ critical: 4, high: 3, medium: 2, low: 1 })[value] || 0; }
function activityIcon(type) { return ({ project_created: 'PJ', run_created: 'RUN', run_status: 'RUN', issue_created: '!', issue_status: '!', routes_assigned: 'RT', milestone_added: 'MS', scenario_updated: 'SC' })[type] || '·'; }
