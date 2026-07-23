import { useMemo, useState } from 'react';
import { formatHours, formatKm } from '../services/utils.js';
import { useRoutePlannerStore } from '../stores/useRoutePlannerStore.js';
import { Button, Card, Chip, EmptyState } from './ui.jsx';

const ROAD_LABELS = { motorway: '高速', motorway_link: '高速匝道', trunk: '快速路', trunk_link: '快速路匝道', primary: '主干道', primary_link: '主干道匝道', secondary: '次干道', secondary_link: '次干道匝道', tertiary: '支路', tertiary_link: '支路匝道', residential: '居住区', unclassified: '未分类', urban: '城市', rural: '普通道路', other: '其他' };

export default function RouteLibrary() {
  const store = useRoutePlannerStore();
  const [search, setSearch] = useState('');
  const [visibility, setVisibility] = useState('all');
  const [sort, setSort] = useState('recent');
  const [selected, setSelected] = useState([]);
  const [moveTarget, setMoveTarget] = useState('');
  const allRoutes = useMemo(() => store.groups.flatMap(group => group.routes), [store.groups]);
  const activeRoute = allRoutes.find(route => route.id === store.activeRouteId) || null;
  const totalDistance = allRoutes.reduce((sum, route) => sum + (route.stats?.distance || 0), 0);
  const displayed = useMemo(() => store.groups.map(group => {
    let routes = group.routes.filter(route => route.name.toLowerCase().includes(search.trim().toLowerCase()));
    if (visibility === 'visible') routes = routes.filter(route => route.visible);
    if (visibility === 'hidden') routes = routes.filter(route => !route.visible);
    if (sort === 'name') routes = [...routes].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    if (sort === 'distance') routes = [...routes].sort((a, b) => (b.stats?.distance || 0) - (a.stats?.distance || 0));
    return { group, routes };
  }).filter(item => item.routes.length || (!search && visibility === 'all')), [store.groups, search, visibility, sort]);
  const toggleSelected = id => setSelected(ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]);

  return <Card title="路线资产库" subtitle={`${allRoutes.length} 条路线 · ${formatKm(totalDistance)}`} actions={<Button size="sm" variant="primary" onClick={store.addGroup}>新建分组</Button>}>
    <div className="filter-grid"><input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索路线名称" /><select value={visibility} onChange={event => setVisibility(event.target.value)}><option value="all">全部状态</option><option value="visible">地图显示</option><option value="hidden">已隐藏</option></select><select value={sort} onChange={event => setSort(event.target.value)}><option value="recent">原始顺序</option><option value="distance">里程从长到短</option><option value="name">名称排序</option></select></div>
    <div className="toolbar-row"><Button size="sm" onClick={() => store.toggleAllRoutesVisibility(true)}>全部显示</Button><Button size="sm" onClick={() => store.toggleAllRoutesVisibility(false)}>全部隐藏</Button>{activeRoute && <Button size="sm" variant="ghost" onClick={store.clearActiveRoute}>取消聚焦</Button>}</div>

    {activeRoute && <section className="active-route-panel">
      <div className="active-route-title"><i style={{ background: activeRoute.color }} /><div><small>当前路线</small><strong>{activeRoute.name}</strong></div><Button size="sm" variant="primary" onClick={() => store.locateRoute(activeRoute.id)}>定位</Button></div>
      <div className="kpi-grid"><span><small>总里程</small><strong>{formatKm(activeRoute.stats?.distance || 0)}</strong></span><span><small>预计时间</small><strong>{formatHours(activeRoute.stats?.duration || 0)}</strong></span><span><small>途经点</small><strong>{activeRoute.stops.length}</strong></span><span><small>地图状态</small><strong>{activeRoute.visible ? '显示' : '隐藏'}</strong></span></div>
      <RoadBreakdown route={activeRoute} />
      <RegulatoryFeatures route={activeRoute} />
      <div className="toolbar-row"><Button size="sm" onClick={() => store.exportRouteGpx(activeRoute.id)}>导出 GPX</Button><Button size="sm" onClick={() => store.copyRouteSummary(activeRoute.id)}>复制摘要</Button>{activeRoute.googleUrl && <a className="button button-secondary button-sm" href={activeRoute.googleUrl} target="_blank" rel="noreferrer">Google 导航 ↗</a>}</div>
    </section>}

    {!!selected.length && <div className="bulk-bar"><strong>已选 {selected.length} 条</strong><Button size="sm" onClick={() => store.setRoutesVisibility(selected, true)}>显示</Button><Button size="sm" onClick={() => store.setRoutesVisibility(selected, false)}>隐藏</Button><select value={moveTarget} onChange={event => setMoveTarget(event.target.value)}><option value="">移动到...</option>{store.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select><Button size="sm" disabled={!moveTarget} onClick={() => { store.moveRoutesToGroup(selected, moveTarget); setSelected([]); }}>移动</Button><Button size="sm" variant="danger" onClick={() => { if (window.confirm(`删除选中的 ${selected.length} 条路线？`)) { store.deleteRoutes(selected); setSelected([]); } }}>删除</Button></div>}

    {!displayed.length ? <EmptyState title="没有符合条件的路线" description="调整筛选条件，或从区域规划创建路线。" /> : <div className="route-groups">
      {displayed.map(({ group, routes }) => <section key={group.id} className="route-group">
        <header onClick={() => store.toggleGroupExpanded(group.id)}><button>{group.expanded ? '⌄' : '›'}</button><div><strong>{group.name}</strong><span>{routes.filter(route => route.visible).length}/{routes.length} 显示</span></div><div onClick={event => event.stopPropagation()}><Button size="sm" variant="ghost" onClick={() => store.toggleGroupRoutesVisibility(group.id, true)}>全显</Button><Button size="sm" variant="ghost" onClick={() => store.toggleGroupRoutesVisibility(group.id, false)}>全隐</Button><Button size="sm" variant="ghost" onClick={() => renameGroup(store, group)}>重命名</Button><Button size="sm" variant="ghost" onClick={() => removeGroup(store, group)}>删除</Button></div></header>
        {group.expanded && <div className="route-list">{!routes.length && <p className="empty-inline">该分组暂无路线</p>}{routes.map(route => <article key={route.id} className={`route-row ${route.id === store.activeRouteId ? 'active' : ''} ${route.visible ? '' : 'muted'}`}>
          <input type="checkbox" checked={selected.includes(route.id)} onChange={() => toggleSelected(route.id)} />
          <i style={{ background: route.color }} />
          <button className="route-row-main" onClick={() => store.locateRoute(route.id)}><strong>{route.name}{route.id === store.activeRouteId && <Chip tone="blue">当前</Chip>}</strong><span>{formatKm(route.stats?.distance || 0)} · {route.stops.length} 点 · {topRoadTypes(route)}</span></button>
          <Button size="sm" onClick={() => store.toggleRoute(route.id)}>{route.visible ? '隐藏' : '显示'}</Button>
          <select className="compact-select" defaultValue="" onChange={event => { handleRouteAction(store, route, event.target.value); event.target.value = ''; }}><option value="">更多</option><option value="solo">仅看</option><option value="edit">编辑</option><option value="rename">重命名</option><option value="duplicate">复制</option><option value="summary">复制摘要</option><option value="gpx">导出 GPX</option>{store.groups.map(group => <option key={group.id} value={`move:${group.id}`}>移至：{group.name}</option>)}<option value="delete">删除</option></select>
        </article>)}</div>}
      </section>)}
    </div>}
  </Card>;
}

function RoadBreakdown({ route }) {
  const values = Object.entries(route.stats?.roadTypeDistances || {}).filter(([, distance]) => distance > 0).sort((a, b) => b[1] - a[1]);
  const total = values.reduce((sum, [, distance]) => sum + distance, 0);
  if (!values.length) return null;
  return <div className="breakdown"><h3>道路类型长度</h3>{values.map(([type, distance]) => <div key={type}><span>{ROAD_LABELS[type] || type}</span><em><i style={{ width: `${total ? distance / total * 100 : 0}%` }} /></em><strong>{formatKm(distance)}</strong></div>)}</div>;
}

function RegulatoryFeatures({ route }) {
  const signals = route.stats?.regulatorySignals;
  if (!signals) return null;
  const features = [`限速覆盖 ${formatKm(signals.speedTaggedDistance || 0)}`, `变化 ${signals.speedChangeCount || 0} 次`, `${signals.uniqueSpeedLimitCount || 0} 种限速`];
  if (signals.conditionalSpeedDistance) features.push('条件限速');
  if (signals.variableSpeedDistance) features.push('可变限速');
  if (signals.tunnelDistance) features.push(`隧道 ${formatKm(signals.tunnelDistance)}`);
  if (signals.roundaboutCount) features.push(`环岛 ${signals.roundaboutCount}`);
  return <div className="feature-chips"><h3>法规路线特征（OSM 摸底）</h3>{features.map(value => <Chip key={value} tone="blue">{value}</Chip>)}</div>;
}

function topRoadTypes(route) {
  return Object.entries(route.stats?.roadTypeDistances || {}).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([type, value]) => `${ROAD_LABELS[type] || type} ${formatKm(value)}`).join(' · ') || '道路类型待分析';
}

function renameGroup(store, group) { const name = window.prompt('分组名称', group.name); if (name) store.renameGroup(group.id, name); }
function removeGroup(store, group) { if (window.confirm(`删除分组“${group.name}”及其中全部路线？`)) store.removeGroup(group.id); }
function handleRouteAction(store, route, action) {
  if (action === 'solo') store.showOnlyRoute(route.id);
  if (action === 'edit') store.startEditRoute(route.id);
  if (action === 'rename') { const name = window.prompt('路线名称', route.name); if (name) store.renameRoute(route.id, name); }
  if (action === 'duplicate') store.duplicateRoute(route.id);
  if (action === 'summary') store.copyRouteSummary(route.id);
  if (action === 'gpx') store.exportRouteGpx(route.id);
  if (action.startsWith('move:')) store.moveRouteToGroup(route.id, action.slice(5));
  if (action === 'delete' && window.confirm(`删除路线“${route.name}”？`)) store.deleteRoute(route.id);
}
