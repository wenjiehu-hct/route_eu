import { create } from 'zustand';
import { COVERAGE_DEFAULTS, COVERAGE_MAX_WAYPOINTS_PER_SEGMENT, HIGHWAY_TYPE_OPTIONS, ROUTE_COLORS } from '../constants/routes.js';
import { buildGoogleMapsUrl } from '../services/routing.js';
import { estimateBboxAreaKm2, fetchRoadsInBbox, getCoverageAreaLimitKm2 } from '../services/overpass.js';
import { buildGraph, estimatePolygonAreaKm2, getCoverageBufferMeters, getCoveragePlanningBbox, isSimplePolygon, planCoverage, polygonBounds, selectCoverageSegments, traversalToSegments } from '../services/coveragePlanner.js';
import { createId, formatKm } from '../services/utils.js';
import { useComplianceStore } from './useComplianceStore.js';
import { useRoutePlannerStore } from './useRoutePlannerStore.js';

let abortController = null;
const emptyStats = () => ({ coveredMeters: 0, insideCoveredMeters: 0, outsideMeters: 0, deadheadMeters: 0, crossOverlapMeters: 0, duplicationRatio: 0, componentCount: 0, ignoredMeters: 0, omittedMeters: 0, unreachableMeters: 0 });

export const useCoveragePlannerStore = create((set, get) => ({
  mode: 'idle',
  bbox: null,
  polygon: [],
  roadTypes: [...COVERAGE_DEFAULTS.roadTypes],
  includeLinks: COVERAGE_DEFAULTS.includeLinks,
  maxSegmentKm: COVERAGE_DEFAULTS.maxSegmentKm,
  routeCount: COVERAGE_DEFAULTS.routeCount,
  sampleSpacingMeters: COVERAGE_DEFAULTS.sampleSpacingMeters,
  progress: { phase: '', message: '', percent: 0 },
  previewSegments: [],
  stats: emptyStats(),
  complianceProjectId: null,
  highwayTypeOptions: HIGHWAY_TYPE_OPTIONS,

  setOption: (key, value) => set({ [key]: value }),
  startDrawing: () => {
    useRoutePlannerStore.getState().setMapPickEnabled(false);
    set({ mode: 'drawing', progress: { phase: 'draw', message: '请在地图上逐点绘制多边形区域。', percent: 0 } });
  },
  cancelDrawing: () => {
    const state = get();
    if (state.mode !== 'drawing') return;
    set({ mode: state.previewSegments.length ? 'preview' : (state.polygon.length >= 3 ? 'drawn' : 'idle'), progress: { phase: '', message: '', percent: 0 } });
  },
  setPolygon: points => {
    const polygon = normalizePolygon(points);
    if (!isSimplePolygon(polygon)) {
      set({ progress: { phase: 'error', message: '多边形不能自相交，且至少需要 3 个有效顶点。', percent: 0 } });
      return false;
    }
    const bbox = polygonBounds(polygon);
    set({ polygon, bbox, mode: 'drawn', previewSegments: [], stats: emptyStats(), progress: { phase: 'polygon', message: `已绘制 ${estimatePolygonAreaKm2(polygon).toFixed(1)} km² 区域。`, percent: 0 } });
    return true;
  },
  clearAll: () => {
    get().abort();
    set({ mode: 'idle', bbox: null, polygon: [], previewSegments: [], stats: emptyStats(), complianceProjectId: null, progress: { phase: '', message: '', percent: 0 } });
  },
  abort: () => {
    abortController?.abort();
    abortController = null;
    if (get().mode === 'generating') set({ mode: get().polygon.length >= 3 ? 'drawn' : 'idle', progress: { phase: 'abort', message: '已取消路线生成。', percent: 0 } });
  },
  generate: async () => {
    const state = get();
    const derived = getCoverageDerived(state);
    if (!derived.canGenerate) return;
    abortController = new AbortController();
    set({ mode: 'generating', previewSegments: [], stats: emptyStats() });
    const update = (phase, message, percent) => set({ progress: { phase, message, percent: Math.max(0, Math.min(100, Math.round(percent))) } });
    try {
      update('query', '正在获取多边形区域附近的道路...', 5);
      const roads = await fetchRoadsInBbox(derived.planningBbox, state.roadTypes, { includeLinks: state.includeLinks, signal: abortController.signal });
      update('graph', `正在构建路网：${roads.wayCount} 条 OSM 道路...`, 15);
      const graph = buildGraph(roads.ways, state.bbox, { polygon: state.polygon });
      if (!graph.edges.length) throw new Error('所绘区域及软边界内没有可用于规划的道路段。');
      update('plan', `正在规划 ${graph.edges.length} 个道路段...`, 25);
      const plan = await planCoverage(graph, { signal: abortController.signal, onProgress: item => update('plan', item.message, 25 + (item.total ? item.current / item.total : 0) * 35) });
      const candidateSegments = plan.walks.flatMap(walk => traversalToSegments(walk, { sampleSpacingMeters: state.sampleSpacingMeters, maxWaypoints: COVERAGE_MAX_WAYPOINTS_PER_SEGMENT, targetSegmentMeters: state.maxSegmentKm * 1000 }).map(segment => ({ ...segment, componentId: walk.componentId })));
      const selected = selectCoverageSegments(candidateSegments, { maxSegments: state.routeCount, targetMeters: state.maxSegmentKm * 1000 });
      if (!selected.length) throw new Error('未能生成有效路线，请缩小范围或调整道路类型。');
      const coveredMeters = selected.reduce((sum, item) => sum + item.coveredMeters, 0);
      const insideCoveredMeters = selected.reduce((sum, item) => sum + (item.insideCoveredMeters || 0), 0);
      const outsideMeters = selected.reduce((sum, item) => sum + (item.outsideMeters || 0), 0);
      const deadheadMeters = selected.reduce((sum, item) => sum + item.deadheadMeters, 0);
      const crossOverlapMeters = selected.reduce((sum, item) => sum + (item.crossOverlapMeters || 0), 0);
      const previewSegments = selected.map((segment, index) => ({ ...segment, id: createId('coverage'), name: `精选路线 ${index + 1}`, color: ROUTE_COLORS[index % ROUTE_COLORS.length], selected: true, visible: true, stats: buildCoverageStats(segment), warning: '' }));
      set({ mode: 'preview', previewSegments, stats: { coveredMeters, insideCoveredMeters, outsideMeters, deadheadMeters, crossOverlapMeters, duplicationRatio: coveredMeters ? (deadheadMeters + crossOverlapMeters) / coveredMeters : 0, componentCount: new Set(selected.map(item => item.componentId)).size, ignoredMeters: plan.ignoredMeters, omittedMeters: Math.max(0, plan.coveredMeters - coveredMeters), unreachableMeters: plan.unreachable.reduce((sum, edge) => sum + edge.length, 0) }, progress: { phase: 'done', message: `已选出 ${previewSegments.length} 条低重复路线。`, percent: 100 } });
      useRoutePlannerStore.getState().setStatus(`已选出 ${previewSegments.length} 条路线，纳入道路 ${formatKm(coveredMeters)}。`);
    } catch (error) {
      if (abortController?.signal.aborted) useRoutePlannerStore.getState().setStatus('已取消路线生成。');
      else {
        useRoutePlannerStore.getState().setStatus(`路线生成失败：${error.message}`);
        set({ progress: { phase: 'error', message: error.message, percent: 0 } });
      }
      set({ mode: get().polygon.length >= 3 ? 'drawn' : 'idle' });
    } finally { abortController = null; }
  },
  toggleSegmentSelected: id => set(state => ({ previewSegments: state.previewSegments.map(item => item.id === id ? { ...item, selected: !item.selected } : item) })),
  toggleSegmentVisible: id => set(state => ({ previewSegments: state.previewSegments.map(item => item.id === id ? { ...item, visible: item.visible === false } : item) })),
  setAllSegmentsVisible: visible => set(state => ({ previewSegments: state.previewSegments.map(item => ({ ...item, visible })) })),
  showOnlySegment: id => {
    set(state => ({ previewSegments: state.previewSegments.map(item => ({ ...item, visible: item.id === id })) }));
    get().locateSegment(id);
  },
  locateSegment: id => {
    const segment = get().previewSegments.find(item => item.id === id);
    if (segment?.bounds) window.dispatchEvent(new CustomEvent('locate-coverage-bounds', { detail: segment.bounds }));
  },
  saveSelected: groupId => {
    const selected = get().previewSegments.filter(segment => segment.selected);
    if (!selected.length) return;
    const routes = selected.map(segment => ({ id: createId('route'), name: segment.name, color: segment.color, visible: segment.visible !== false, expanded: false, stats: segment.stats, warning: segment.warning, googleUrl: buildGoogleMapsUrl(segment.stops), stops: segment.stops.map(stop => ({ name: stop.name, lat: stop.lat, lon: stop.lon })) }));
    useRoutePlannerStore.getState().addRoutesToGroup(groupId, routes);
    if (get().complianceProjectId) {
      useComplianceStore.getState().assignRoutesToProject(get().complianceProjectId, routes.map(route => route.id));
      useRoutePlannerStore.getState().setStatus(`已保存 ${routes.length} 条路线并加入法规测试项目。`);
    }
    get().clearAll();
  },
  configureForCompliance: (profileId, projectId) => {
    const lane = profileId === 'unece_lane_support';
    const aeb = profileId === 'unece_aeb_data';
    set({ roadTypes: lane ? ['motorway', 'trunk', 'primary', 'secondary'] : ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified'], includeLinks: true, routeCount: 5, maxSegmentKm: aeb ? 100 : (lane ? 80 : 60), sampleSpacingMeters: 250, complianceProjectId: projectId || null });
    useRoutePlannerStore.getState().setStatus('已按法规模板配置区域规划；保存后将自动加入当前测试项目。');
  },
}));

export function getCoverageDerived(state) {
  const areaKm2 = estimatePolygonAreaKm2(state.polygon);
  const planningBbox = getCoveragePlanningBbox(state.bbox);
  const queryAreaKm2 = estimateBboxAreaKm2(planningBbox);
  const areaLimitKm2 = getCoverageAreaLimitKm2(state.roadTypes);
  return { areaKm2, planningBbox, queryAreaKm2, areaLimitKm2, edgeBufferMeters: getCoverageBufferMeters(state.bbox), canGenerate: state.mode === 'drawn' && state.polygon.length >= 3 && !!state.bbox && state.roadTypes.length > 0 && queryAreaKm2 <= areaLimitKm2 };
}

function normalizePolygon(points) {
  const result = [];
  (points || []).forEach(point => {
    const value = { lat: Number(point.lat), lon: Number(point.lon) };
    if (!Number.isFinite(value.lat) || !Number.isFinite(value.lon)) return;
    const previous = result.at(-1);
    if (!previous || Math.abs(previous.lat - value.lat) >= 1e-9 || Math.abs(previous.lon - value.lon) >= 1e-9) result.push(value);
  });
  if (result.length > 2 && Math.abs(result[0].lat - result.at(-1).lat) < 1e-9 && Math.abs(result[0].lon - result.at(-1).lon) < 1e-9) result.pop();
  return result;
}

function buildCoverageStats(segment) {
  const distance = segment.distance || segment.estimatedMeters || 0;
  const roadTypeDistances = { ...(segment.roadTypeDistances || {}) };
  const motorwayDistance = Object.entries(roadTypeDistances).filter(([type]) => /^(motorway|trunk)(?:_link)?$/.test(type)).reduce((sum, [, meters]) => sum + meters, 0);
  const urbanDistance = Math.min(Math.max(0, distance - motorwayDistance), Object.entries(roadTypeDistances).reduce((sum, [type, meters]) => {
    const key = type.replace(/_link$/, '');
    if (key === 'residential' || key === 'unclassified') return sum + meters;
    if (key === 'tertiary') return sum + meters * 0.6;
    if (key === 'secondary') return sum + meters * 0.35;
    if (key === 'primary') return sum + meters * 0.2;
    return sum;
  }, 0));
  const ruralDistance = Math.max(0, distance - motorwayDistance - urbanDistance);
  return { geometry: (segment.geometry || []).map(([lat, lon]) => [lon, lat]), distance, duration: Math.round(distance / 11.1), motorwayDistance, urbanDistance, ruralDistance, share: { motorway: distance ? motorwayDistance / distance : 0, urban: distance ? urbanDistance / distance : 0, rural: distance ? ruralDistance / distance : 0 }, roadTypeDistances, regulatorySignals: segment.regulatorySignals || {}, topRoads: segment.topRoads || [], coverage: { deadheadMeters: segment.deadheadMeters || 0, crossOverlapMeters: segment.crossOverlapMeters || 0, insideCoveredMeters: segment.insideCoveredMeters || 0, outsideMeters: segment.outsideMeters || 0, duplicationRatio: segment.duplicationRatio || 0 } };
}

