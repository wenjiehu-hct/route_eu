import { useMemo, useState } from 'react';
import { COMPLIANCE_SCENARIOS, TEST_STATUSES, getComplianceProfile } from '../constants/compliance.js';
import { analyzeRouteForProfile, bestRouteForScenario } from '../services/compliance.js';
import { formatKm } from '../services/utils.js';
import { useComplianceStore } from '../stores/useComplianceStore.js';
import { useCoveragePlannerStore } from '../stores/useCoveragePlannerStore.js';
import { useRoutePlannerStore } from '../stores/useRoutePlannerStore.js';
import { Button, Card, Chip, EmptyState, ProgressBar } from './ui.jsx';

const SECTIONS = [{ value: 'overview', label: '项目总览' }, { value: 'routes', label: '路线池' }, { value: 'scenarios', label: '场景矩阵' }, { value: 'references', label: '法规依据' }];
const PROJECT_STATUSES = [{ value: 'planning', label: '规划中' }, { value: 'running', label: '执行中' }, { value: 'paused', label: '暂停' }, { value: 'completed', label: '已完成' }];

export default function ComplianceWorkbench() {
  const store = useComplianceStore();
  const groups = useRoutePlannerStore(state => state.groups);
  const allRoutes = useMemo(() => groups.flatMap(group => group.routes), [groups]);
  const [section, setSection] = useState('overview');
  const [newProfile, setNewProfile] = useState(store.profiles[0].id);
  const project = store.projects.find(item => item.id === store.activeProjectId) || null;
  const profile = getComplianceProfile(project?.profileId);
  const scenarios = profile.scenarios.map(id => COMPLIANCE_SCENARIOS[id]).filter(Boolean);
  const assignedRoutes = project ? allRoutes.filter(route => (project.routeIds || []).includes(route.id)) : [];
  const groupedScenarios = scenarios.reduce((result, scenario) => {
    const group = result.find(item => item.category === scenario.category);
    group ? group.items.push(scenario) : result.push({ category: scenario.category, items: [scenario] });
    return result;
  }, []);
  const completed = project ? scenarios.filter(scenario => ['passed', 'failed', 'blocked', 'not_applicable'].includes(project.results?.[scenario.id]?.status)).length : 0;
  const routeReadiness = (() => {
    const automatic = scenarios.filter(scenario => scenario.autoMetric && !scenario.manualOnly);
    if (!automatic.length || !assignedRoutes.length) return 0;
    return Math.round(automatic.reduce((sum, scenario) => sum + (bestRouteForScenario(assignedRoutes, scenario.id)?.analysis.score || 0), 0) / automatic.length);
  })();

  if (!project) return <Card title="海外法规测试工作台" subtitle="法规路线规划 · 执行记录 · 工程报告" actions={<Chip tone="amber">工程摸底</Chip>}>
    <EmptyState icon="GSR" title="建立第一个法规测试项目" description="选择模板后，把路线加入项目，系统会自动分析道路类型、限速数据与复杂场景覆盖。" action={<div className="create-project"><select value={newProfile} onChange={event => setNewProfile(event.target.value)}>{store.profiles.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><Button variant="primary" onClick={() => store.createProject(newProfile)}>创建测试项目</Button></div>} />
    <div className="template-grid">{store.profiles.map(item => <button key={item.id} onClick={() => store.createProject(item.id)}><span>{item.type}</span><strong>{item.name}</strong><p>{item.description}</p><small>{item.market} · {item.scenarios.length} 个场景</small></button>)}</div>
  </Card>;

  const update = (field, value) => store.updateProject({ [field]: value });
  const openPlanner = () => { useCoveragePlannerStore.getState().configureForCompliance(project.profileId, project.id); window.dispatchEvent(new CustomEvent('open-workspace', { detail: 'coverage' })); };

  return <Card title="海外法规测试工作台" subtitle="法规路线规划 · 执行记录 · 工程报告" actions={<Chip tone="amber">工程摸底</Chip>}>
    <div className="project-switcher"><select value={project.id} onChange={event => store.selectProject(event.target.value)}>{store.projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><Button size="sm" onClick={() => store.createProject(project.profileId)}>新建</Button><Button size="sm" variant="ghost" onClick={() => store.duplicateProject(project.id)}>复制</Button></div>
    <nav className="subnav">{SECTIONS.map(item => <button key={item.value} className={section === item.value ? 'active' : ''} onClick={() => setSection(item.value)}>{item.label}{item.value === 'routes' && <span>{assignedRoutes.length}</span>}{item.value === 'scenarios' && <span>{completed}/{scenarios.length}</span>}</button>)}</nav>

    {section === 'overview' && <div className="stack-lg">
      <div className="readiness-card"><div><strong>{routeReadiness}</strong><span>/100</span><small>路线准备度</small></div><section><strong>{profile.name}</strong><span>{profile.type} · {project.market}</span><ProgressBar value={scenarios.length ? completed / scenarios.length * 100 : 0} tone="green" /><small>执行完成 {completed}/{scenarios.length} · 已分配 {assignedRoutes.length} 条路线</small></section></div>
      <div className="notice notice-amber">本模块用于工程摸底与内部预验证，不构成法规认证结论。OSM 数据必须用现场标志和适用法规原文复核；危险动作只能在受控条件下执行。</div>
      <div className="form-grid"><label className="field span-2"><span>项目名称</span><input value={project.name} onChange={event => update('name', event.target.value)} /></label><label className="field"><span>模板</span><select value={project.profileId} onChange={event => store.setProfile(event.target.value)}>{store.profiles.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="field"><span>项目状态</span><select value={project.status} onChange={event => update('status', event.target.value)}>{PROJECT_STATUSES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label className="field"><span>目标市场</span><input value={project.market} onChange={event => update('market', event.target.value)} /></label><label className="field"><span>车型/版本</span><input value={project.vehicle} onChange={event => update('vehicle', event.target.value)} placeholder="车型、软件、地图版本" /></label><label className="field"><span>负责人</span><input value={project.owner} onChange={event => update('owner', event.target.value)} /></label><label className="field span-2"><span>项目备注</span><textarea rows="3" value={project.notes} onChange={event => update('notes', event.target.value)} /></label></div>
      <div className="toolbar-row"><Button variant="primary" onClick={openPlanner}>按模板生成路线</Button><Button disabled={!assignedRoutes.length} onClick={() => setSection('scenarios')}>进入场景矩阵</Button><Button onClick={() => store.exportProject(project.id, allRoutes)}>导出 Markdown 报告</Button><Button variant="danger" onClick={() => { if (window.confirm(`删除测试项目“${project.name}”？路线不会被删除。`)) store.deleteProject(project.id); }}>删除项目</Button></div>
    </div>}

    {section === 'routes' && <RoutePool store={store} project={project} profile={profile} allRoutes={allRoutes} assignedRoutes={assignedRoutes} />}
    {section === 'scenarios' && <ScenarioMatrix store={store} project={project} groups={groupedScenarios} assignedRoutes={assignedRoutes} allRoutes={allRoutes} />}
    {section === 'references' && <div className="stack-lg"><div className="reference-intro"><strong>{profile.name}</strong><p>{profile.description}</p></div>{profile.references.length ? <div className="reference-list">{profile.references.map(reference => <a key={reference.url} href={reference.url} target="_blank" rel="noreferrer"><span>{reference.label}</span><strong>打开官方来源 ↗</strong></a>)}</div> : <EmptyState title="跨市场工程模板" description="请按目标国家补充并冻结适用法规版本。" />}<div className="notice notice-amber">法规和消费者测试协议会更新。项目立项时应冻结市场、车型类别、实施日期及法规/协议版本，并由法规工程师复核。</div></div>}
  </Card>;
}

function RoutePool({ store, project, profile, allRoutes, assignedRoutes }) {
  const ranked = useMemo(() => allRoutes.map(route => ({ route, analysis: analyzeRouteForProfile(route, profile.id) })).sort((a, b) => b.analysis.score - a.analysis.score), [allRoutes, profile.id]);
  return <div className="stack-lg"><div className="section-heading"><div><strong>测试路线池</strong><span>评分越高表示自动场景匹配越充分，不代表法规通过。</span></div><div><Button size="sm" onClick={() => store.assignAllRoutes(allRoutes.map(route => route.id))}>全选</Button><Button size="sm" onClick={() => store.assignAllRoutes([])}>清空</Button></div></div>{!allRoutes.length ? <EmptyState title="路线库为空" description="先通过区域规划或手工路线创建测试路线。" /> : <div className="compliance-route-list">{ranked.map(({ route, analysis }) => <article key={route.id} className={(project.routeIds || []).includes(route.id) ? 'selected' : ''}><input type="checkbox" checked={(project.routeIds || []).includes(route.id)} onChange={event => store.toggleRoute(route.id, event.target.checked)} /><i style={{ background: route.color }} /><button onClick={() => useRoutePlannerStore.getState().locateRoute(route.id)}><strong>{route.name}</strong><span>{formatKm(route.stats?.distance || 0)} · 自动覆盖 {analysis.matched}/{analysis.automaticCount}</span><small>{regulatorySummary(route)}</small></button><em className={analysis.score >= 75 ? 'good' : analysis.score >= 45 ? 'medium' : 'low'}>{analysis.score}</em></article>)}</div>}<div className="notice">已分配 {assignedRoutes.length} 条。手工路线若缺少 OSM 限速属性，自动评分会偏低，但仍可用于人工测试记录。</div></div>;
}

function ScenarioMatrix({ store, project, groups, assignedRoutes, allRoutes }) {
  const routeOptions = assignedRoutes;
  const result = id => project.results?.[id] || {};
  const update = (id, field, value) => store.setScenarioResult(id, { [field]: value });
  return <div className="stack-lg"><div className="section-heading"><div><strong>测试场景覆盖矩阵</strong><span>自动指标用于筛路；执行状态、真值和证据由测试人员确认。</span></div><Button size="sm" onClick={() => store.exportProject(project.id, allRoutes)}>导出报告</Button></div>{!assignedRoutes.length && <div className="notice notice-amber">请先在“路线池”中分配至少一条路线。</div>}<div className="scenario-groups">{groups.map((group, groupIndex) => <details key={group.category} open={groupIndex === 0}><summary><strong>{group.category}</strong><span>{group.items.filter(item => ['passed', 'failed', 'blocked', 'not_applicable'].includes(result(item.id).status)).length}/{group.items.length}</span></summary><div className="scenario-list">{group.items.map(scenario => {
    const record = result(scenario.id); const best = bestRouteForScenario(assignedRoutes, scenario.id); const status = TEST_STATUSES.find(item => item.value === (record.status || 'not_started')) || TEST_STATUSES[0];
    return <article key={scenario.id} className="scenario-card"><header><div><strong>{scenario.name}</strong><span>目标 {scenario.targetLabel}</span></div><Chip tone={statusTone(status.value)}>{status.label}</Chip></header><p>{scenario.objective}</p><div className="auto-match"><span>路线摸底</span><strong>{best?.analysis.label || '需人工验证'}</strong><small>{best?.route?.name || ''}</small></div>{best?.analysis.auto && <ProgressBar value={best.analysis.score} tone={best.analysis.meetsTarget ? 'green' : 'blue'} />}<div className="form-grid compact"><label className="field"><span>执行状态</span><select value={record.status || 'not_started'} onChange={event => update(scenario.id, 'status', event.target.value)}>{TEST_STATUSES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label className="field"><span>执行路线</span><select value={record.routeId || ''} onChange={event => update(scenario.id, 'routeId', event.target.value)}><option value="">未指定</option>{routeOptions.map(route => <option key={route.id} value={route.id}>{route.name}</option>)}</select></label><label className="field"><span>实测次数</span><input type="number" min="0" value={record.actualCount ?? ''} onChange={event => update(scenario.id, 'actualCount', event.target.value === '' ? null : Number(event.target.value))} /></label><label className="field span-2"><span>结果记录</span><textarea rows="2" value={record.notes || ''} placeholder={scenario.evidenceHint} onChange={event => update(scenario.id, 'notes', event.target.value)} /></label><label className="field span-2"><span>证据索引</span><input value={record.evidence || ''} placeholder="视频、日志ID、问题单或云盘链接" onChange={event => update(scenario.id, 'evidence', event.target.value)} /></label></div><details className="scenario-help"><summary>路线与证据建议</summary><p>{scenario.routeHint}</p><p>{scenario.evidenceHint}</p></details></article>;
  })}</div></details>)}</div></div>;
}

function regulatorySummary(route) {
  const signals = route.stats?.regulatorySignals;
  if (!signals) return '暂无 OSM 限速属性，可人工执行或用区域规划重新生成';
  return `限速覆盖 ${formatKm(signals.speedTaggedDistance || 0)} · 变化 ${signals.speedChangeCount || 0} 次 · ${signals.uniqueSpeedLimitCount || 0} 种限速`;
}

function statusTone(status) { return ({ planned: 'blue', passed: 'green', failed: 'red', blocked: 'amber' })[status] || 'neutral'; }
