import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import {
  COVERAGE_DEFAULTS,
  COVERAGE_MAX_WAYPOINTS_PER_SEGMENT,
  HIGHWAY_TYPE_OPTIONS,
  ROUTE_COLORS,
} from '../constants/routes.js';
import { buildGoogleMapsUrl } from '../services/routing.js';
import { estimateBboxAreaKm2, fetchRoadsInBbox, getCoverageAreaLimitKm2 } from '../services/overpass.js';
import {
  buildGraph,
  estimatePolygonAreaKm2,
  getCoverageBufferMeters,
  getCoveragePlanningBbox,
  isSimplePolygon,
  planCoverage,
  polygonBounds,
  selectCoverageSegments,
  traversalToSegments,
} from '../services/coveragePlanner.js';
import { createId, formatKm } from '../services/utils.js';
import { useRoutePlannerStore } from './routePlanner.js';
import { useComplianceStore } from './compliance.js';

export const useCoveragePlannerStore = defineStore('coveragePlanner', () => {
  const mode = ref('idle');
  const bbox = ref(null);
  const polygon = ref([]);
  const roadTypes = ref([...COVERAGE_DEFAULTS.roadTypes]);
  const includeLinks = ref(COVERAGE_DEFAULTS.includeLinks);
  const maxSegmentKm = ref(COVERAGE_DEFAULTS.maxSegmentKm);
  const routeCount = ref(COVERAGE_DEFAULTS.routeCount);
  const sampleSpacingMeters = ref(COVERAGE_DEFAULTS.sampleSpacingMeters);
  const progress = ref({ phase: '', message: '', percent: 0 });
  const previewSegments = ref([]);
  const stats = ref(createEmptyStats());
  const complianceProjectId = ref(null);
  const areaKm2 = computed(() => estimatePolygonAreaKm2(polygon.value));
  const planningBbox = computed(() => getCoveragePlanningBbox(bbox.value));
  const queryAreaKm2 = computed(() => estimateBboxAreaKm2(planningBbox.value));
  const areaLimitKm2 = computed(() => getCoverageAreaLimitKm2(roadTypes.value));
  const edgeBufferMeters = computed(() => getCoverageBufferMeters(bbox.value));
  const canGenerate = computed(() =>
    mode.value === 'drawn'
    && polygon.value.length >= 3
    && bbox.value
    && roadTypes.value.length > 0
    && queryAreaKm2.value <= areaLimitKm2.value
  );

  let abortController = null;

  function startDrawing() {
    const routeStore = useRoutePlannerStore();
    routeStore.mapPickEnabled = false;
    mode.value = 'drawing';
    progress.value = { phase: 'draw', message: '请在地图上逐点绘制多边形区域。', percent: 0 };
  }

  function cancelDrawing() {
    if (mode.value === 'drawing') {
      mode.value = previewSegments.value.length
        ? 'preview'
        : (polygon.value.length >= 3 ? 'drawn' : 'idle');
    }
    progress.value = { phase: '', message: '', percent: 0 };
  }

  function setPolygon(nextPolygon) {
    const normalized = normalizePolygon(nextPolygon);
    if (!isSimplePolygon(normalized)) {
      progress.value = { phase: 'error', message: '多边形不能自相交，且至少需要 3 个有效顶点。', percent: 0 };
      return false;
    }
    polygon.value = normalized;
    bbox.value = polygonBounds(normalized);
    mode.value = 'drawn';
    previewSegments.value = [];
    resetStats();
    progress.value = { phase: 'polygon', message: `已绘制 ${areaKm2.value.toFixed(1)} km² 区域。`, percent: 0 };
    return true;
  }

  function clearAll() {
    abort();
    mode.value = 'idle';
    bbox.value = null;
    polygon.value = [];
    previewSegments.value = [];
    resetStats();
    complianceProjectId.value = null;
    progress.value = { phase: '', message: '', percent: 0 };
  }

  function abort() {
    abortController?.abort();
    abortController = null;
    if (mode.value === 'generating') {
      mode.value = polygon.value.length >= 3 ? 'drawn' : 'idle';
      progress.value = { phase: 'abort', message: '已取消覆盖路线生成。', percent: 0 };
    }
  }

  async function generate() {
    if (!canGenerate.value) return;
    const routeStore = useRoutePlannerStore();
    abortController = new AbortController();
    mode.value = 'generating';
    previewSegments.value = [];
    resetStats();

    try {
      updateProgress('query', '正在获取多边形区域附近的道路...', 5);
      const roads = await fetchRoadsInBbox(planningBbox.value, roadTypes.value, {
        includeLinks: includeLinks.value,
        signal: abortController.signal,
      });

      updateProgress('graph', `正在构建路网：${roads.wayCount} 条 OSM way...`, 15);
      const graph = buildGraph(roads.ways, bbox.value, { polygon: polygon.value });
      if (!graph.edges.length) throw new Error('所绘区域及软边界内没有可用于规划的道路段。');

      updateProgress('plan', `正在规划覆盖路径：${graph.edges.length} 条道路段...`, 25);
      const plan = await planCoverage(graph, {
        signal: abortController.signal,
        onProgress: item => {
          const ratio = item.total ? item.current / item.total : 0;
          updateProgress('plan', item.message, 25 + ratio * 35);
        },
      });

      // 先完成全局道路覆盖，再按目标里程均衡切分；这样不会因为逐条独立规划
      // 而反复走相同的主干连接道路。
      const segmentOptions = {
        sampleSpacingMeters: sampleSpacingMeters.value,
        maxWaypoints: COVERAGE_MAX_WAYPOINTS_PER_SEGMENT,
        targetSegmentMeters: maxSegmentKm.value * 1000,
      };
      const candidateSegments = plan.walks.flatMap(walk =>
        traversalToSegments(walk, segmentOptions)
          .map(segment => ({ ...segment, componentId: walk.componentId }))
      );
      const rawSegments = selectCoverageSegments(candidateSegments, {
        maxSegments: routeCount.value,
        targetMeters: maxSegmentKm.value * 1000,
      });

      if (!rawSegments.length) throw new Error('未能生成有效路线分段。请缩小范围或调整道路类型。');

      const selectedCoveredMeters = rawSegments.reduce((sum, segment) => sum + segment.coveredMeters, 0);
      const selectedInsideMeters = rawSegments.reduce((sum, segment) => sum + (segment.insideCoveredMeters || 0), 0);
      const outsideMeters = rawSegments.reduce((sum, segment) => sum + (segment.outsideMeters || 0), 0);
      const selectedDeadheadMeters = rawSegments.reduce((sum, segment) => sum + segment.deadheadMeters, 0);
      const crossOverlapMeters = rawSegments.reduce((sum, segment) => sum + (segment.crossOverlapMeters || 0), 0);
      stats.value = {
        coveredMeters: selectedCoveredMeters,
        insideCoveredMeters: selectedInsideMeters,
        outsideMeters,
        deadheadMeters: selectedDeadheadMeters,
        crossOverlapMeters,
        duplicationRatio: selectedCoveredMeters
          ? (selectedDeadheadMeters + crossOverlapMeters) / selectedCoveredMeters
          : 0,
        componentCount: new Set(rawSegments.map(segment => segment.componentId)).size,
        ignoredMeters: plan.ignoredMeters,
        omittedMeters: Math.max(0, plan.coveredMeters - selectedCoveredMeters),
        unreachableMeters: plan.unreachable.reduce((sum, edge) => sum + edge.length, 0),
      };

      previewSegments.value = rawSegments.map((segment, index) => ({
        ...segment,
        id: createId('coverage'),
        name: `精选路线 ${index + 1}`,
        color: ROUTE_COLORS[index % ROUTE_COLORS.length],
        selected: true,
        visible: true,
        stats: buildCoverageStats(segment),
        warning: '',
      }));

      mode.value = 'preview';
      updateProgress('done', `已选出 ${previewSegments.value.length} 条低重复路线。`, 100);
      routeStore.setStatus(`已选出 ${previewSegments.value.length} 条路线，纳入道路 ${formatKm(selectedCoveredMeters)}。`);
    } catch (error) {
      if (abortController?.signal.aborted) {
        routeStore.setStatus('已取消覆盖路线生成。');
      } else {
        routeStore.setStatus(`覆盖路线生成失败：${error.message}`);
        progress.value = { phase: 'error', message: error.message, percent: 0 };
      }
      mode.value = polygon.value.length >= 3 ? 'drawn' : 'idle';
    } finally {
      abortController = null;
    }
  }

  function saveSelected(groupId) {
    const selected = previewSegments.value.filter(segment => segment.selected);
    if (!selected.length) return;
    const routeStore = useRoutePlannerStore();
    const routes = selected.map((segment, index) => ({
      id: createId('route'),
      name: segment.name || `精选路线 ${index + 1}`,
      color: segment.color,
      visible: segment.visible !== false,
      expanded: false,
      stats: segment.stats,
      warning: segment.warning,
      googleUrl: buildGoogleMapsUrl(segment.stops),
      stops: segment.stops.map(stop => ({ name: stop.name, lat: stop.lat, lon: stop.lon })),
    }));
    routeStore.addRoutesToGroup(groupId, routes);
    if (complianceProjectId.value) {
      const complianceStore = useComplianceStore();
      complianceStore.assignRoutesToProject(complianceProjectId.value, routes.map(route => route.id));
      routeStore.setStatus(`已保存 ${routes.length} 条路线并加入法规测试项目。`);
    } else {
      routeStore.setStatus(`已保存 ${routes.length} 条覆盖路线。`);
    }
    clearAll();
  }

  function configureForCompliance(profileId, projectId) {
    const laneProfile = profileId === 'unece_lane_support';
    const aebProfile = profileId === 'unece_aeb_data';
    roadTypes.value = laneProfile
      ? ['motorway', 'trunk', 'primary', 'secondary']
      : ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified'];
    includeLinks.value = true;
    routeCount.value = 5;
    maxSegmentKm.value = aebProfile ? 100 : (laneProfile ? 80 : 60);
    sampleSpacingMeters.value = 250;
    complianceProjectId.value = projectId || null;
    const routeStore = useRoutePlannerStore();
    routeStore.setStatus('已按法规模板配置区域规划；保存后将自动加入当前测试项目。');
  }

  function toggleSegmentSelected(segmentId) {
    const segment = previewSegments.value.find(item => item.id === segmentId);
    if (segment) segment.selected = !segment.selected;
  }

  function toggleSegmentVisible(segmentId) {
    const segment = previewSegments.value.find(item => item.id === segmentId);
    if (segment) segment.visible = segment.visible === false;
  }

  function setAllSegmentsVisible(visible) {
    previewSegments.value.forEach(segment => { segment.visible = visible; });
  }

  function showOnlySegment(segmentId) {
    previewSegments.value.forEach(segment => { segment.visible = segment.id === segmentId; });
    locateSegment(segmentId);
  }

  function locateSegment(segmentId) {
    const segment = previewSegments.value.find(item => item.id === segmentId);
    if (!segment?.bounds) return;
    window.dispatchEvent(new CustomEvent('locate-coverage-bounds', { detail: segment.bounds }));
  }

  function updateProgress(phase, message, percent) {
    progress.value = { phase, message, percent: Math.max(0, Math.min(100, Math.round(percent))) };
  }

  function resetStats() {
    stats.value = createEmptyStats();
  }

  return {
    mode,
    bbox,
    polygon,
    roadTypes,
    includeLinks,
    maxSegmentKm,
    routeCount,
    sampleSpacingMeters,
    progress,
    previewSegments,
    stats,
    complianceProjectId,
    areaKm2,
    queryAreaKm2,
    areaLimitKm2,
    edgeBufferMeters,
    canGenerate,
    highwayTypeOptions: HIGHWAY_TYPE_OPTIONS,
    startDrawing,
    cancelDrawing,
    setPolygon,
    clearAll,
    abort,
    generate,
    saveSelected,
    configureForCompliance,
    toggleSegmentSelected,
    toggleSegmentVisible,
    setAllSegmentsVisible,
    showOnlySegment,
    locateSegment,
  };
});

function createEmptyStats() {
  return {
    coveredMeters: 0,
    insideCoveredMeters: 0,
    outsideMeters: 0,
    deadheadMeters: 0,
    crossOverlapMeters: 0,
    duplicationRatio: 0,
    componentCount: 0,
    ignoredMeters: 0,
    omittedMeters: 0,
    unreachableMeters: 0,
  };
}

function normalizePolygon(points) {
  const result = [];
  (points || []).forEach(point => {
    const normalized = { lat: Number(point.lat), lon: Number(point.lon) };
    if (!Number.isFinite(normalized.lat) || !Number.isFinite(normalized.lon)) return;
    const previous = result.at(-1);
    if (previous && Math.abs(previous.lat - normalized.lat) < 1e-9 && Math.abs(previous.lon - normalized.lon) < 1e-9) return;
    result.push(normalized);
  });
  if (result.length > 2) {
    const first = result[0];
    const last = result.at(-1);
    if (Math.abs(first.lat - last.lat) < 1e-9 && Math.abs(first.lon - last.lon) < 1e-9) result.pop();
  }
  return result;
}

function buildCoverageStats(segment) {
  const distance = segment.distance || segment.estimatedMeters || 0;
  const geometry = (segment.geometry || []).map(([lat, lon]) => [lon, lat]);
  const roadTypeDistances = { ...(segment.roadTypeDistances || {}) };
  const motorwayDistance = Object.entries(roadTypeDistances)
    .filter(([type]) => /^(motorway|trunk)(?:_link)?$/.test(type))
    .reduce((sum, [, meters]) => sum + meters, 0);
  const urbanDistance = Math.min(
    Math.max(0, distance - motorwayDistance),
    Object.entries(roadTypeDistances).reduce((sum, [type, meters]) => {
      const normalized = type.replace(/_link$/, '');
      if (normalized === 'residential' || normalized === 'unclassified') return sum + meters;
      if (normalized === 'tertiary') return sum + meters * 0.6;
      if (normalized === 'secondary') return sum + meters * 0.35;
      if (normalized === 'primary') return sum + meters * 0.2;
      return sum;
    }, 0)
  );
  const ruralDistance = Math.max(0, distance - motorwayDistance - urbanDistance);
  return {
    geometry,
    distance,
    duration: Math.round(distance / 11.1),
    motorwayDistance,
    urbanDistance,
    ruralDistance,
    share: {
      motorway: distance ? motorwayDistance / distance : 0,
      urban: distance ? urbanDistance / distance : 0,
      rural: distance ? ruralDistance / distance : 0,
    },
    roadTypeDistances,
    regulatorySignals: segment.regulatorySignals || {},
    topRoads: segment.topRoads || [],
    coverage: {
      deadheadMeters: segment.deadheadMeters || 0,
      crossOverlapMeters: segment.crossOverlapMeters || 0,
      insideCoveredMeters: segment.insideCoveredMeters || 0,
      outsideMeters: segment.outsideMeters || 0,
      duplicationRatio: segment.duplicationRatio || 0,
    },
  };
}
