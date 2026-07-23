import { Navigate, useNavigate, useParams } from 'react-router-dom';
import CoveragePlanner from '../components/CoveragePlanner.jsx';
import ManualRoute from '../components/ManualRoute.jsx';
import MapCanvas from '../components/MapCanvas.jsx';
import POIEditor from '../components/POIEditor.jsx';
import RouteLibrary from '../components/RouteLibrary.jsx';
import { PageHeader, StatCard } from '../components/ui.jsx';
import { flattenRoutes } from '../services/portfolio.js';
import { formatKm } from '../services/utils.js';
import { usePOIStore } from '../stores/usePOIStore.js';
import { useRoutePlannerStore } from '../stores/useRoutePlannerStore.js';

export function RouteAssetsPage() {
  const { tab = 'library' } = useParams();
  const navigate = useNavigate();
  const groups = useRoutePlannerStore(state => state.groups);
  const activeRouteId = useRoutePlannerStore(state => state.activeRouteId);
  const pois = usePOIStore(state => state.pois);
  const routes = flattenRoutes(groups);
  if (!['library', 'pois'].includes(tab)) return <Navigate to="/routes/library" replace />;
  const totalDistance = routes.reduce((sum, route) => sum + (route.stats?.distance || 0), 0);
  const roadTypeCount = new Set(routes.flatMap(route => Object.keys(route.stats?.roadTypeDistances || {}).filter(type => (route.stats.roadTypeDistances[type] || 0) > 0))).size;
  const taggedDistance = routes.reduce((sum, route) => sum + (route.stats?.regulatorySignals?.speedTaggedDistance || 0), 0);

  return <div className="page-stack route-assets-page">
    <PageHeader eyebrow="ROUTE ASSET MANAGEMENT" title="路线资产中心" description="把测试路线作为可搜索、可分组、可复用、可度量的工程资产，而不是一次性导航结果。" actions={<button className="button button-primary button-md" onClick={() => navigate('/planning')}>＋ 创建路线</button>} />
    <section className="stats-grid compact-stats">
      <StatCard icon="RT" label="路线资产" value={routes.length} detail={`${groups.length} 个资产分组`} />
      <StatCard icon="KM" label="累计可测里程" value={formatKm(totalDistance)} detail="基于当前已保存路线" tone="violet" />
      <StatCard icon="RD" label="道路类型" value={roadTypeCount} detail="高速、主干道、城市道路等" tone="green" />
      <StatCard icon="ISA" label="限速标注里程" value={formatKm(taggedDistance)} detail="OSM 属性摸底，不替代现场真值" tone="amber" />
    </section>
    <nav className="workspace-tabs"><button className={tab === 'library' ? 'active' : ''} onClick={() => navigate('/routes/library')}>路线资产库 <span>{routes.length}</span></button><button className={tab === 'pois' ? 'active' : ''} onClick={() => navigate('/routes/pois')}>设施与标记点 <span>{pois.length}</span></button></nav>
    <section className="map-workspace route-map-workspace">
      <div className="map-stage"><MapCanvas /><div className="map-stage-label"><span>LIVE ASSET MAP</span><strong>{activeRouteId ? '已聚焦路线，可拖动途经点调整' : '选择路线以查看道路构成和地图位置'}</strong></div></div>
      <aside className="workspace-panel">{tab === 'library' ? <RouteLibrary /> : <POIEditor />}</aside>
    </section>
  </div>;
}

export function PlanningCenterPage() {
  const { mode = 'area' } = useParams();
  const navigate = useNavigate();
  if (!['area', 'manual'].includes(mode)) return <Navigate to="/planning/area" replace />;
  return <div className="page-stack planning-page">
    <PageHeader eyebrow="ROUTE ENGINEERING" title="路线规划中心" description="从测试目标出发生成多条长路线，控制路线间重复，并允许适度越界完成道路衔接与掉头。" />
    <div className="planning-methods">
      <button className={mode === 'area' ? 'active' : ''} onClick={() => navigate('/planning/area')}><i>AI</i><span><strong>区域智能规划</strong><small>绘制任意多边形，生成 4–5 条长路线</small></span></button>
      <button className={mode === 'manual' ? 'active' : ''} onClick={() => navigate('/planning/manual')}><i>MN</i><span><strong>手工路线设计</strong><small>搜索地点或地图选点，精确编辑途经点</small></span></button>
      <div className="planning-principles"><span>设计原则</span><strong>长路线</strong><strong>低重复</strong><strong>道路差异</strong><strong>转弯平滑</strong></div>
    </div>
    <section className="map-workspace planning-map-workspace">
      <aside className="workspace-panel planning-controls">{mode === 'area' ? <CoveragePlanner /> : <ManualRoute />}</aside>
      <div className="map-stage"><MapCanvas /><div className="map-stage-label"><span>{mode === 'area' ? 'POLYGON PLANNING MODE' : 'MANUAL ROUTE MODE'}</span><strong>{mode === 'area' ? '在地图上绘制测试区域，边界外允许合理衔接' : '启用地图选点后，单击地图添加途经点'}</strong></div></div>
    </section>
  </div>;
}
