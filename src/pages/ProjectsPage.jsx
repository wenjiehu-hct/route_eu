import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { getProjectMetrics, flattenRoutes, formatDate } from '../services/portfolio.js';
import { useComplianceStore, PRIORITIES, PROJECT_PHASES, PROJECT_STATUSES } from '../stores/useComplianceStore.js';
import { useRoutePlannerStore } from '../stores/useRoutePlannerStore.js';
import { Button, Card, EmptyState, PageHeader, ProgressBar, StatusBadge } from '../components/ui.jsx';

const STATUS_LABELS = Object.fromEntries(PROJECT_STATUSES.map(item => [item.value, item.label]));
const PHASE_LABELS = Object.fromEntries(PROJECT_PHASES.map(item => [item.value, item.label]));
const PRIORITY_LABELS = Object.fromEntries(PRIORITIES.map(item => [item.value, item.label]));

export default function ProjectsPage() {
  const store = useComplianceStore();
  const groups = useRoutePlannerStore(state => state.groups);
  const routes = flattenRoutes(groups);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [market, setMarket] = useState('all');
  const [view, setView] = useState('table');
  const showCreate = params.get('create') === '1';
  const markets = [...new Set(store.projects.map(project => project.market).filter(Boolean))];
  const projects = useMemo(() => store.projects.filter(project => {
    const query = search.trim().toLowerCase();
    const matched = !query || [project.name, project.market, project.vehicle, project.owner, ...project.tags].join(' ').toLowerCase().includes(query);
    return matched && (status === 'all' || project.status === status) && (market === 'all' || project.market === market);
  }), [store.projects, search, status, market]);

  return <div className="page-stack">
    <PageHeader eyebrow="PROGRAM PORTFOLIO" title="海外测试项目" description="以项目为核心管理法规范围、车辆版本、路线准备、测试执行、证据与问题关闭。" actions={<Button variant="primary" onClick={() => setParams({ create: '1' })}>＋ 新建项目</Button>} />

    {showCreate && <CreateProjectPanel store={store} initialProfileId={params.get('profile')} onCancel={() => setParams({})} onCreated={project => navigate(`/projects/${project.id}`)} />}

    <Card className="project-catalog-card">
      <div className="catalog-toolbar">
        <div className="search-input"><span>⌕</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索项目、市场、车型、负责人或标签" /></div>
        <select value={status} onChange={event => setStatus(event.target.value)}><option value="all">全部状态</option>{PROJECT_STATUSES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
        <select value={market} onChange={event => setMarket(event.target.value)}><option value="all">全部市场</option>{markets.map(value => <option key={value}>{value}</option>)}</select>
        <div className="view-toggle"><button className={view === 'table' ? 'active' : ''} onClick={() => setView('table')}>表格</button><button className={view === 'cards' ? 'active' : ''} onClick={() => setView('cards')}>卡片</button></div>
      </div>
      <div className="catalog-summary"><span>显示 <strong>{projects.length}</strong> / {store.projects.length} 个项目</span><span>{store.projects.filter(project => project.status === 'running').length} 个执行中</span><span>{store.projects.filter(project => project.priority === 'critical').length} 个紧急项目</span></div>

      {!projects.length ? <EmptyState icon="PJ" title={store.projects.length ? '没有匹配的项目' : '还没有测试项目'} description={store.projects.length ? '请调整搜索或筛选条件。' : '从法规/市场模板创建项目，建立完整的测试工作流。'} action={!store.projects.length && <Button variant="primary" onClick={() => setParams({ create: '1' })}>创建第一个项目</Button>} /> : view === 'table' ? <ProjectTable projects={projects} routes={routes} store={store} /> : <ProjectCards projects={projects} routes={routes} />}
    </Card>
  </div>;
}

function CreateProjectPanel({ store, initialProfileId, onCancel, onCreated }) {
  const first = store.profiles.find(item => item.id === initialProfileId) || store.profiles[0];
  const [form, setForm] = useState({ profileId: first.id, name: '', market: first.market, vehicle: '', owner: '', priority: 'medium', phase: 'concept', startDate: '', endDate: '' });
  const profile = store.profiles.find(item => item.id === form.profileId) || first;
  const update = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const changeProfile = value => { const next = store.profiles.find(item => item.id === value); setForm(current => ({ ...current, profileId: value, market: next.market })); };
  const create = () => {
    const project = store.createProject(form.profileId, { ...form, name: form.name.trim() || `${profile.name} · ${new Date().toLocaleDateString('zh-CN')}`, markets: [form.market] });
    onCreated(project);
  };
  return <section className="create-project-panel">
    <header><div><span>NEW PROGRAM</span><h2>创建海外测试项目</h2><p>先冻结目标市场与项目阶段，路线和测试执行可以随后持续补充。</p></div><button onClick={onCancel}>×</button></header>
    <div className="create-project-layout">
      <div className="template-selector">
        {store.profiles.map(item => <button key={item.id} className={form.profileId === item.id ? 'active' : ''} onClick={() => changeProfile(item.id)}><span>{item.type}</span><strong>{item.name}</strong><small>{item.market} · {item.scenarios.length} 个测试场景</small></button>)}
      </div>
      <div className="form-grid project-form">
        <label className="field span-2"><span>项目名称</span><input value={form.name} onChange={event => update('name', event.target.value)} placeholder={profile.name} /></label>
        <label className="field"><span>目标市场</span><input value={form.market} onChange={event => update('market', event.target.value)} /></label>
        <label className="field"><span>车型 / 软件版本</span><input value={form.vehicle} onChange={event => update('vehicle', event.target.value)} placeholder="车型、软件、地图版本" /></label>
        <label className="field"><span>负责人</span><input value={form.owner} onChange={event => update('owner', event.target.value)} /></label>
        <label className="field"><span>优先级</span><select value={form.priority} onChange={event => update('priority', event.target.value)}>{PRIORITIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label className="field"><span>项目阶段</span><select value={form.phase} onChange={event => update('phase', event.target.value)}>{PROJECT_PHASES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label className="field"><span>开始日期</span><input type="date" value={form.startDate} onChange={event => update('startDate', event.target.value)} /></label>
        <label className="field"><span>计划结束</span><input type="date" value={form.endDate} onChange={event => update('endDate', event.target.value)} /></label>
        <div className="create-summary span-2"><strong>{profile.scenarios.length}</strong><span>个法规/工程场景</span><strong>{profile.references.length}</strong><span>项官方参考</span><em>{profile.description}</em></div>
        <div className="toolbar-row span-2"><Button variant="primary" onClick={create}>创建并进入项目</Button><Button onClick={onCancel}>取消</Button></div>
      </div>
    </div>
  </section>;
}

function ProjectTable({ projects, routes, store }) {
  return <div className="project-table">
    <div className="project-table-head"><span>项目</span><span>阶段 / 状态</span><span>准备度</span><span>路线</span><span>测试执行</span><span>待闭环问题</span><span>计划结束</span><span /></div>
    {projects.map(project => {
      const metrics = getProjectMetrics(project, routes);
      return <div className="project-table-row" key={project.id}>
        <Link className="project-identity" to={`/projects/${project.id}`}><i className={`priority-${project.priority}`}><span>{project.name.slice(0, 1).toUpperCase()}</span></i><div><strong>{project.name}</strong><small>{project.market} · {project.vehicle || '车型待定义'} · {project.owner || '未指派'}</small></div></Link>
        <div className="status-stack"><span>{PHASE_LABELS[project.phase]}</span><StatusBadge value={project.status} labels={STATUS_LABELS} /></div>
        <div className="progress-cell"><strong>{metrics.readiness}%</strong><ProgressBar value={metrics.readiness} tone={metrics.readiness >= 70 ? 'green' : 'blue'} /></div>
        <strong>{metrics.assignedRoutes.length}</strong>
        <span>{metrics.completedRuns}/{project.testRuns.length}</span>
        <strong className={metrics.criticalIssues ? 'text-danger' : ''}>{metrics.openIssues.length}</strong>
        <span>{formatDate(project.endDate)}</span>
        <select className="row-menu" defaultValue="" onChange={event => handleAction(event, project, store)}><option value="">•••</option><option value="open">打开项目</option><option value="duplicate">复制项目</option><option value="delete">删除项目</option></select>
      </div>;
    })}
  </div>;
}

function ProjectCards({ projects, routes }) {
  return <div className="project-card-grid">{projects.map(project => {
    const metrics = getProjectMetrics(project, routes);
    return <article className="project-card" key={project.id}>
      <header><span className={`project-avatar priority-${project.priority}`}>{project.name.slice(0, 2)}</span><div><StatusBadge value={project.status} labels={STATUS_LABELS} /><StatusBadge value={project.priority} labels={PRIORITY_LABELS} /></div></header>
      <Link to={`/projects/${project.id}`}><h3>{project.name}</h3><p>{project.market} · {project.vehicle || '车型待定义'} · {project.owner || '未指派'}</p></Link>
      <div className="card-progress"><span><strong>项目准备度</strong><em>{metrics.readiness}%</em></span><ProgressBar value={metrics.readiness} tone={metrics.readiness >= 70 ? 'green' : 'blue'} /></div>
      <div className="project-card-kpis"><span><strong>{metrics.assignedRoutes.length}</strong><small>路线</small></span><span><strong>{project.testRuns.length}</strong><small>测试</small></span><span><strong className={metrics.criticalIssues ? 'text-danger' : ''}>{metrics.openIssues.length}</strong><small>问题</small></span><span><strong>{metrics.completedScenarios}/{metrics.scenarioCount}</strong><small>场景</small></span></div>
      <footer><span>{PHASE_LABELS[project.phase]} · {formatDate(project.endDate)}</span><Link to={`/projects/${project.id}`}>进入项目 →</Link></footer>
    </article>;
  })}</div>;
}

function handleAction(event, project, store) {
  const action = event.target.value; event.target.value = '';
  if (action === 'open') window.location.hash = `#/projects/${project.id}`;
  if (action === 'duplicate') store.duplicateProject(project.id);
  if (action === 'delete' && window.confirm(`删除项目“${project.name}”？路线资产不会被删除。`)) store.deleteProject(project.id);
}
