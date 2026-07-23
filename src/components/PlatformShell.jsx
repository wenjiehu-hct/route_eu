import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useComplianceStore } from '../stores/useComplianceStore.js';
import { useRoutePlannerStore } from '../stores/useRoutePlannerStore.js';

const NAV_GROUPS = [
  {
    label: '运营总览',
    items: [
      { to: '/', end: true, icon: 'DB', label: '工作台总览', hint: 'Portfolio' },
      { to: '/projects', icon: 'PJ', label: '测试项目', hint: 'Programs' },
    ],
  },
  {
    label: '路线与执行',
    items: [
      { to: '/routes', icon: 'RT', label: '路线资产中心', hint: 'Routes' },
      { to: '/planning', icon: 'PL', label: '路线规划中心', hint: 'Planning' },
      { to: '/execution', icon: 'EX', label: '测试执行中心', hint: 'Operations' },
    ],
  },
  {
    label: '知识与治理',
    items: [
      { to: '/regulations', icon: 'RG', label: '法规与市场库', hint: 'Compliance' },
      { to: '/data', icon: 'DT', label: '数据与备份', hint: 'Governance' },
    ],
  },
];

const TITLES = {
  '/': ['全局工作台', '海外道路测试项目组合与运营态势'],
  '/projects': ['测试项目', '从立项、路线准备到问题关闭的完整项目组合'],
  '/routes': ['路线资产中心', '管理可复用的海外测试道路资产'],
  '/planning': ['路线规划中心', '面向测试目标生成和编辑专业路线'],
  '/execution': ['测试执行中心', '统一编排测试任务、进度与问题闭环'],
  '/regulations': ['法规与市场库', '管理目标市场、测试模板和法规依据'],
  '/data': ['数据与备份', '本地数据治理、迁移与长期保存'],
};

export default function PlatformShell() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('roadTestStudio.sidebarCollapsed') === 'true');
  const location = useLocation();
  const navigate = useNavigate();
  const status = useRoutePlannerStore(state => state.status);
  const groups = useRoutePlannerStore(state => state.groups);
  const projects = useComplianceStore(state => state.projects);
  const activeProjectId = useComplianceStore(state => state.activeProjectId);
  const routeCount = useMemo(() => groups.reduce((sum, group) => sum + group.routes.length, 0), [groups]);
  const openIssues = useMemo(() => projects.reduce((sum, project) => sum + project.issues.filter(issue => !['closed', 'verified'].includes(issue.status)).length, 0), [projects]);
  const current = getPageMeta(location.pathname, projects);

  useEffect(() => { useRoutePlannerStore.getState().hydrateMissingStats(); }, []);
  useEffect(() => { localStorage.setItem('roadTestStudio.sidebarCollapsed', String(collapsed)); }, [collapsed]);
  useEffect(() => {
    const mapping = { coverage: '/planning/area', manual: '/planning/manual', routes: '/routes', compliance: activeProjectId ? `/projects/${activeProjectId}/compliance` : '/projects', poi: '/routes/pois' };
    const open = event => mapping[event.detail] && navigate(mapping[event.detail]);
    window.addEventListener('open-workspace', open);
    return () => window.removeEventListener('open-workspace', open);
  }, [navigate, activeProjectId]);

  return <div className={`platform-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
    <aside className="platform-sidebar">
      <div className="platform-brand">
        <div className="brand-emblem"><span>GR</span><i /></div>
        {!collapsed && <div><strong>Global Road Test</strong><small>Overseas Validation OS</small></div>}
      </div>
      <nav className="platform-nav">
        {NAV_GROUPS.map(group => <section key={group.label}>
          {!collapsed && <h3>{group.label}</h3>}
          {group.items.map(item => <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => isActive ? 'active' : ''} title={collapsed ? item.label : undefined}>
            <i>{item.icon}</i>{!collapsed && <span><strong>{item.label}</strong><small>{item.hint}</small></span>}
          </NavLink>)}
        </section>)}
      </nav>
      <div className="sidebar-summary">
        {!collapsed && <><span><strong>{projects.length}</strong> 个项目</span><span><strong>{routeCount}</strong> 条路线</span><span className={openIssues ? 'alert' : ''}><strong>{openIssues}</strong> 个待闭环问题</span></>}
        <button onClick={() => setCollapsed(value => !value)} aria-label="切换侧栏">{collapsed ? '»' : '« 收起导航'}</button>
      </div>
    </aside>

    <div className="platform-main">
      <header className="platform-topbar">
        <div className="topbar-title"><span>GLOBAL ROAD TEST STUDIO</span><strong>{current[0]}</strong><small>{current[1]}</small></div>
        <div className="topbar-actions">
          <button className="command-button" onClick={() => navigate('/planning')}><span>＋</span> 创建路线</button>
          <button className="command-button primary" onClick={() => navigate('/projects?create=1')}><span>＋</span> 新建项目</button>
          <div className="user-avatar" title="本地工作区">LOCAL</div>
        </div>
      </header>
      <main className="platform-content"><Outlet /></main>
      <footer className="platform-status"><span className="status-dot" /> <span>{status || '就绪'}</span><em>数据保存在当前设备 · 建议定期导出备份</em></footer>
    </div>
  </div>;
}

function getPageMeta(pathname, projects) {
  if (pathname.startsWith('/projects/')) {
    const id = pathname.split('/')[2];
    const project = projects.find(item => item.id === id);
    return [project?.name || '项目详情', project ? `${project.market} · ${project.vehicle || '车型待定义'}` : '项目不存在或已删除'];
  }
  if (pathname.startsWith('/planning')) return TITLES['/planning'];
  if (pathname.startsWith('/routes')) return TITLES['/routes'];
  return TITLES[pathname] || ['Global Road Test Studio', '海外道路测试运营平台'];
}
