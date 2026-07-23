const MIN_COMPONENT_METERS = 500;
const PROGRESS_BATCH_SIZE = 300;

export function haversineMeters(a, b) {
  const radius = 6371000;
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function getCoverageBufferMeters(bbox) {
  if (!bbox) return 0;
  const midLat = (bbox.south + bbox.north) / 2;
  const midLon = (bbox.west + bbox.east) / 2;
  const height = haversineMeters(
    { lat: bbox.south, lon: midLon },
    { lat: bbox.north, lon: midLon }
  );
  const width = haversineMeters(
    { lat: midLat, lon: bbox.west },
    { lat: midLat, lon: bbox.east }
  );
  const shorterSide = Math.max(1, Math.min(width, height));
  return Math.round(Math.min(1500, Math.max(300, shorterSide * 0.12)));
}

export function getCoveragePlanningBbox(bbox) {
  return bbox ? expandBboxByMeters(bbox, getCoverageBufferMeters(bbox)) : null;
}

export function polygonBounds(points) {
  if (!points?.length) return null;
  return points.reduce((bounds, point) => ({
    south: Math.min(bounds.south, point.lat),
    west: Math.min(bounds.west, point.lon),
    north: Math.max(bounds.north, point.lat),
    east: Math.max(bounds.east, point.lon),
  }), {
    south: points[0].lat,
    west: points[0].lon,
    north: points[0].lat,
    east: points[0].lon,
  });
}

export function estimatePolygonAreaKm2(points) {
  if (!points || points.length < 3) return 0;
  const centerLat = toRad(points.reduce((sum, point) => sum + point.lat, 0) / points.length);
  const metersPerLon = 111_320 * Math.cos(centerLat);
  const metersPerLat = 110_570;
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    twiceArea += (current.lon * metersPerLon) * (next.lat * metersPerLat)
      - (next.lon * metersPerLon) * (current.lat * metersPerLat);
  }
  return Math.abs(twiceArea) / 2 / 1_000_000;
}

export function isSimplePolygon(points) {
  if (!points || points.length < 3) return false;
  for (let first = 0; first < points.length; first += 1) {
    const firstNext = (first + 1) % points.length;
    for (let second = first + 1; second < points.length; second += 1) {
      const secondNext = (second + 1) % points.length;
      if (first === second || firstNext === second || secondNext === first) continue;
      if (first === 0 && secondNext === 0) continue;
      if (segmentsIntersect(points[first], points[firstNext], points[second], points[secondNext])) {
        return false;
      }
    }
  }
  return estimatePolygonAreaKm2(points) > 0.001;
}

export function buildGraph(ways, bbox = null, options = {}) {
  // Overpass 会返回与 bbox 相交的完整 way。先按边界裁剪，否则一条穿城公路
  // 可能把几十公里外的几何也带入覆盖规划。这里使用有限软边界：允许道路
  // 在框外延伸一小段完成掉头和顺滑转弯，但不会无限保留整条框外道路。
  const planningBbox = getCoveragePlanningBbox(bbox);
  const clippedWays = bbox
    ? ways.flatMap(way => clipWayToBbox(way, planningBbox))
    : ways;
  const polygon = options.polygon?.length >= 3 ? options.polygon : null;
  const boundedWays = polygon
    ? clippedWays.flatMap(way => filterWayToPolygonBuffer(
        way,
        polygon,
        getCoverageBufferMeters(bbox)
      ))
    : clippedWays;
  const useCounts = new Map();
  boundedWays.forEach(way => {
    way.nodes.forEach(nodeId => useCounts.set(nodeId, (useCounts.get(nodeId) || 0) + 1));
  });

  const vertexIds = new Set();
  boundedWays.forEach(way => {
    vertexIds.add(way.nodes[0]);
    vertexIds.add(way.nodes[way.nodes.length - 1]);
    way.nodes.forEach(nodeId => {
      if ((useCounts.get(nodeId) || 0) >= 2) vertexIds.add(nodeId);
    });
  });

  const vertices = new Map();
  const edges = [];

  boundedWays.forEach(way => {
    let startIndex = 0;
    for (let index = 1; index < way.nodes.length; index += 1) {
      const nodeId = way.nodes[index];
      const shouldCut = vertexIds.has(nodeId) || index === way.nodes.length - 1;
      if (!shouldCut) continue;

      const nodeSlice = way.nodes.slice(startIndex, index + 1);
      const geometry = way.geometry.slice(startIndex, index + 1);
      startIndex = index;
      if (nodeSlice.length < 2 || geometry.length < 2) continue;

      let from = nodeSlice[0];
      let to = nodeSlice[nodeSlice.length - 1];
      let edgeGeometry = geometry;
      let oneway = isOneWay(way.tags);

      if (way.tags?.oneway === '-1') {
        [from, to] = [to, from];
        edgeGeometry = [...geometry].reverse();
        oneway = true;
      }

      upsertVertex(vertices, from, edgeGeometry[0]);
      upsertVertex(vertices, to, edgeGeometry[edgeGeometry.length - 1]);

      const length = polylineLength(edgeGeometry);
      if (length <= 0) continue;

      edges.push({
        id: `edge-${way.id}-${startIndex}-${edges.length}`,
        wayId: way.id,
        from,
        to,
        geometry: edgeGeometry,
        length,
        insideLength: polygon ? polylineLengthInsidePolygon(edgeGeometry, polygon) : length,
        highway: way.tags?.highway || '',
        name: way.tags?.name || way.tags?.ref || '',
        tags: way.tags || {},
        oneway,
      });
    }
  });

  const adjOut = createAdjacency(edges, true);
  const adjAll = createAdjacency(edges, false);
  for (const [id, vertex] of vertices.entries()) {
    vertex.degree = (adjAll.get(id) || []).length;
  }

  return { vertices, edges, adjOut, adjAll };
}

export function splitComponents(graph) {
  const visited = new Set();
  const components = [];

  for (const vertexId of graph.vertices.keys()) {
    if (visited.has(vertexId)) continue;
    const queue = [vertexId];
    const vertexIds = new Set([vertexId]);
    const edgeIds = new Set();
    visited.add(vertexId);

    while (queue.length) {
      const current = queue.shift();
      for (const item of graph.adjAll.get(current) || []) {
        edgeIds.add(item.edge.id);
        const next = item.to;
        if (visited.has(next)) continue;
        visited.add(next);
        vertexIds.add(next);
        queue.push(next);
      }
    }

    const edges = graph.edges.filter(edge => edgeIds.has(edge.id));
    const totalMeters = edges.reduce((sum, edge) => sum + edge.length, 0);
    if (edges.length) {
      components.push({ id: `component-${components.length + 1}`, vertexIds, edgeIds, edges, totalMeters });
    }
  }

  return components.sort((a, b) => b.totalMeters - a.totalMeters);
}

export async function planCoverage(graph, { onProgress, signal } = {}) {
  const components = splitComponents(graph);
  const activeComponents = components.filter(component => component.totalMeters >= MIN_COMPONENT_METERS);
  const ignoredComponents = components.filter(component => component.totalMeters < MIN_COMPONENT_METERS);
  const walks = [];
  const unreachable = [];
  const totalEdges = activeComponents.reduce((sum, component) => sum + component.edges.length, 0);
  let processedEdges = 0;

  for (const component of activeComponents) {
    throwIfAborted(signal);
    const walk = await planComponent(graph, component, {
      signal,
      onProgress: async count => {
        processedEdges += count;
        onProgress?.({
          phase: 'plan',
          current: Math.min(processedEdges, totalEdges),
          total: totalEdges,
          message: `正在规划覆盖路径：${Math.min(processedEdges, totalEdges)} / ${totalEdges} 条道路段`,
        });
      },
    });
    walks.push(walk);
    unreachable.push(...walk.unreachableEdges);
  }

  const coveredMeters = walks.reduce((sum, walk) => sum + walk.coveredMeters, 0);
  const deadheadMeters = walks.reduce((sum, walk) => sum + walk.deadheadMeters, 0);
  const ignoredMeters = ignoredComponents.reduce((sum, component) => sum + component.totalMeters, 0);

  return {
    walks,
    ignoredComponents,
    unreachable,
    coveredMeters,
    deadheadMeters,
    ignoredMeters,
    duplicationRatio: coveredMeters ? deadheadMeters / coveredMeters : 0,
    componentCount: activeComponents.length,
  };
}

export function traversalToSegments(walk, options = {}) {
  const sampleSpacingMeters = options.sampleSpacingMeters || 300;
  const maxWaypoints = options.maxWaypoints || 90;
  const steps = walk.walk.map(step => ({
    ...step,
    geometry: step.reversed ? [...step.edge.geometry].reverse() : step.edge.geometry,
  }));
  const totalMeters = steps.reduce((sum, step) => sum + step.edge.length, 0);
  if (!steps.length || totalMeters <= 0) return [];

  const targetMeters = options.targetSegmentMeters || options.maxSegmentMeters || 50_000;
  const segmentCount = options.targetSegmentCount > 0
    ? Math.min(steps.length, Math.round(options.targetSegmentCount))
    : chooseSegmentCount(totalMeters, targetMeters, steps.length);
  const cutIndexes = findBalancedCutIndexes(steps, segmentCount, totalMeters);
  const segments = [];
  let startIndex = 0;

  [...cutIndexes, steps.length].forEach(endIndex => {
    const segment = createEmptySegment();
    segment.steps = steps.slice(startIndex, endIndex);
    segment.estimatedMeters = segment.steps.reduce((sum, step) => sum + step.edge.length, 0);
    segment.deadheadMeters = segment.steps
      .filter(step => step.deadhead)
      .reduce((sum, step) => sum + step.edge.length, 0);
    finalizeSegment(segment, sampleSpacingMeters, maxWaypoints, segments);
    startIndex = endIndex;
  });

  return segments;
}

export function selectCoverageSegments(segments, options = {}) {
  const maxSegments = Math.max(1, Math.min(segments.length, Math.round(options.maxSegments || 5)));
  const targetMeters = options.targetMeters || 50_000;
  const remaining = segments
    .map((segment, sourceIndex) => ({ ...segment, sourceIndex }))
    .filter(segment => segment.geometry?.length >= 2 && segment.distance > 0);
  const selected = [];
  const usedEdges = new Set();

  while (selected.length < maxSegments && remaining.length) {
    let bestIndex = 0;
    let bestMetrics = null;

    remaining.forEach((segment, index) => {
      const metrics = scoreSegmentCandidate(segment, selected, usedEdges, targetMeters);
      if (!bestMetrics || metrics.score > bestMetrics.score) {
        bestIndex = index;
        bestMetrics = metrics;
      }
    });

    const [picked] = remaining.splice(bestIndex, 1);
    picked.crossOverlapMeters = bestMetrics.crossOverlapMeters;
    picked.uniqueCoveredMeters = bestMetrics.uniqueCoveredMeters;
    picked.uniqueInsideMeters = bestMetrics.uniqueInsideMeters;
    picked.edgeUsages?.forEach(usage => usedEdges.add(usage.id));
    selected.push(picked);
  }

  return selected.sort((a, b) => a.sourceIndex - b.sourceIndex);
}

function scoreSegmentCandidate(segment, selected, usedEdges, targetMeters) {
  const usages = segment.edgeUsages || [];
  let crossOverlapMeters = 0;
  let uniqueCoveredMeters = 0;
  let uniqueInsideMeters = 0;

  usages.forEach(usage => {
    if (usedEdges.has(usage.id)) crossOverlapMeters += usage.length;
    if (!usage.deadhead && !usedEdges.has(usage.id)) {
      uniqueCoveredMeters += usage.length;
      uniqueInsideMeters += usage.insideLength ?? usage.length;
    }
  });
  if (!usages.length) {
    uniqueCoveredMeters = segment.coveredMeters || segment.distance || 0;
    uniqueInsideMeters = segment.insideCoveredMeters ?? uniqueCoveredMeters;
  }

  const distance = segment.distance || 0;
  const deadhead = segment.deadheadMeters || 0;
  const shortfall = Math.max(0, targetMeters - distance);
  const spread = selected.length
    ? Math.min(
        targetMeters,
        Math.min(...selected.map(item => haversineMeters(segment.center, item.center)))
      )
    : targetMeters;

  return {
    crossOverlapMeters,
    uniqueCoveredMeters,
    uniqueInsideMeters,
    score:
      uniqueInsideMeters * 1.4
      + uniqueCoveredMeters * 0.35
      + distance * 0.35
      + spread * 0.10
      - shortfall * 0.30
      - deadhead * 3
      - crossOverlapMeters * 5,
  };
}

export function segmentBounds(segment) {
  const points = segment.geometry || segment.stops || [];
  if (!points.length) return null;
  const seed = 'lat' in points[0] ? points[0] : { lat: points[0][0], lon: points[0][1] };
  return points.reduce((bounds, point) => {
    const lat = Array.isArray(point) ? point[0] : point.lat;
    const lon = Array.isArray(point) ? point[1] : point.lon;
    return {
      south: Math.min(bounds.south, lat),
      west: Math.min(bounds.west, lon),
      north: Math.max(bounds.north, lat),
      east: Math.max(bounds.east, lon),
    };
  }, { south: seed.lat, west: seed.lon, north: seed.lat, east: seed.lon });
}

function chooseSegmentCount(totalMeters, targetMeters, maxSegments) {
  if (targetMeters <= 0 || totalMeters <= targetMeters * 0.65) return 1;
  const exact = totalMeters / targetMeters;
  const candidates = new Set([
    Math.max(1, Math.floor(exact)),
    Math.max(1, Math.ceil(exact)),
  ]);

  return [...candidates]
    .filter(count => count <= maxSegments)
    .sort((a, b) => {
      const errorA = Math.abs(totalMeters / a - targetMeters);
      const errorB = Math.abs(totalMeters / b - targetMeters);
      if (errorA !== errorB) return errorA - errorB;
      return a - b;
    })[0] || 1;
}

function findBalancedCutIndexes(steps, segmentCount, totalMeters) {
  if (segmentCount <= 1) return [];
  const cumulative = [0];
  steps.forEach(step => cumulative.push(cumulative.at(-1) + step.edge.length));
  const cuts = [];
  let minIndex = 1;

  for (let segmentIndex = 1; segmentIndex < segmentCount; segmentIndex += 1) {
    const target = totalMeters * segmentIndex / segmentCount;
    const maxIndex = steps.length - (segmentCount - segmentIndex);
    let bestIndex = minIndex;
    let bestScore = Infinity;

    for (let index = minIndex; index <= maxIndex; index += 1) {
      const distanceError = Math.abs(cumulative[index] - target);
      const turn = boundaryTurnAngle(steps[index - 1], steps[index]);
      // 在距离相近时，优先把急转弯或掉头放到两条路线的交界处，
      // 避免单条路线出现不必要的尖锐折返。
      const smoothBoundaryBonus = (turn / Math.PI) * (totalMeters / segmentCount) * 0.08;
      const score = distanceError - smoothBoundaryBonus;
      if (score < bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    cuts.push(bestIndex);
    minIndex = bestIndex + 1;
  }

  return cuts;
}

function boundaryTurnAngle(previousStep, nextStep) {
  if (!previousStep || !nextStep) return 0;
  const previous = previousStep.geometry;
  const next = nextStep.geometry;
  if (previous.length < 2 || next.length < 2) return 0;
  const a = previous[previous.length - 2];
  const b = previous[previous.length - 1];
  const c = next[1];
  const latitudeScale = Math.cos(toRad(b.lat));
  const incoming = Math.atan2(b.lat - a.lat, (b.lon - a.lon) * latitudeScale);
  const outgoing = Math.atan2(c.lat - b.lat, (c.lon - b.lon) * latitudeScale);
  return Math.abs(normalizeAngle(outgoing - incoming));
}

async function planComponent(graph, component, { signal, onProgress }) {
  const startCandidates = pickStartCandidates(graph, component, component.edges.length <= 2000 ? 3 : 1);
  let best = null;

  for (let attempt = 0; attempt < startCandidates.length; attempt += 1) {
    throwIfAborted(signal);
    const result = await runTraversal(graph, component, startCandidates[attempt], { signal, onProgress });
    if (!best || result.deadheadMeters < best.deadheadMeters) {
      best = result;
    }
  }

  return best;
}

async function runTraversal(graph, component, startVertex, { signal, onProgress }) {
  const covered = new Set();
  const componentEdgeIds = component.edgeIds;
  let current = startVertex;
  const walk = [];
  let deadheadMeters = 0;
  let coveredMeters = 0;
  let batchCount = 0;

  while (covered.size < component.edges.length) {
    throwIfAborted(signal);
    const next = pickNextUncoveredEdge(graph, current, covered, componentEdgeIds, walk.at(-1));
    if (next) {
      covered.add(next.edge.id);
      coveredMeters += next.edge.length;
      walk.push({ edge: next.edge, reversed: next.reversed, deadhead: false });
      current = next.to;
      batchCount += 1;
    } else {
      const path = dijkstraToUncovered(graph, current, covered, componentEdgeIds);
      if (!path) break;
      path.steps.forEach(step => walk.push({ ...step, deadhead: true }));
      deadheadMeters += path.distance;
      current = path.target;
    }

    if (batchCount >= PROGRESS_BATCH_SIZE) {
      await onProgress?.(batchCount);
      batchCount = 0;
      await yieldToMainThread();
    }
  }

  if (batchCount) await onProgress?.(batchCount);

  const unreachableEdges = component.edges.filter(edge => !covered.has(edge.id));
  return {
    componentId: component.id,
    walk,
    coveredMeters,
    deadheadMeters,
    unreachableEdges,
  };
}

function pickNextUncoveredEdge(graph, vertexId, covered, componentEdgeIds, prevStep) {
  const candidates = (graph.adjAll.get(vertexId) || [])
    .filter(item => componentEdgeIds.has(item.edge.id) && !covered.has(item.edge.id));
  if (!candidates.length) return null;

  return candidates
    .map(item => ({
      ...item,
      pocketScore: deadEndPocketScore(graph, item.to, item.edge.id, covered, componentEdgeIds),
      remainingDegree: remainingUncoveredDegree(graph, item.to, covered, componentEdgeIds),
      turn: turnPenalty(prevStep, item),
    }))
    .map(item => ({
      ...item,
      routeScore:
        (item.turn / Math.PI) * 1.4
        + (item.turn > Math.PI * 0.82 ? 0.7 : 0)
        + item.remainingDegree * 0.05
        - item.pocketScore * 0.35,
    }))
    .sort((a, b) => {
      if (a.routeScore !== b.routeScore) return a.routeScore - b.routeScore;
      return a.edge.length - b.edge.length;
    })[0];
}

function dijkstraToUncovered(graph, start, covered, componentEdgeIds) {
  const distances = new Map([[start, 0]]);
  const previous = new Map();
  const visited = new Set();
  const queue = [{ id: start, distance: 0 }];

  while (queue.length) {
    queue.sort((a, b) => a.distance - b.distance);
    const current = queue.shift();
    if (visited.has(current.id)) continue;
    visited.add(current.id);

    if (current.id !== start && hasUncoveredIncident(graph, current.id, covered, componentEdgeIds)) {
      return buildPath(previous, current.id, distances.get(current.id));
    }

    for (const item of graph.adjAll.get(current.id) || []) {
      if (!componentEdgeIds.has(item.edge.id)) continue;
      const nextDistance = current.distance + item.edge.length;
      if (nextDistance >= (distances.get(item.to) ?? Infinity)) continue;
      distances.set(item.to, nextDistance);
      previous.set(item.to, { from: current.id, step: item });
      queue.push({ id: item.to, distance: nextDistance });
    }
  }

  return null;
}

function buildPath(previous, target, distance) {
  const steps = [];
  let cursor = target;
  while (previous.has(cursor)) {
    const entry = previous.get(cursor);
    steps.push({ edge: entry.step.edge, reversed: entry.step.reversed });
    cursor = entry.from;
  }
  steps.reverse();
  return { target, distance, steps };
}

function hasUncoveredIncident(graph, vertexId, covered, componentEdgeIds) {
  return (graph.adjAll.get(vertexId) || []).some(item => componentEdgeIds.has(item.edge.id) && !covered.has(item.edge.id));
}

function pickStartCandidates(graph, component, count = 1) {
  const vertices = [...component.vertexIds].map(id => graph.vertices.get(id)).filter(Boolean);
  const endpoints = vertices.filter(vertex => vertex.degree === 1);
  const odd = vertices.filter(vertex => vertex.degree % 2 === 1);
  const pool = endpoints.length ? endpoints : (odd.length ? odd : vertices);
  if (pool.length <= 1) return [pool[0]?.id || [...component.vertexIds][0]].filter(Boolean);

  // 取地理上尽量分散的若干起点：按经纬度排序后等距抽取
  const sorted = [...pool].sort((a, b) => a.lat - b.lat || a.lon - b.lon);
  const result = new Set();
  const steps = Math.max(1, Math.floor(sorted.length / count));
  for (let i = 0; i < count && i * steps < sorted.length; i += 1) {
    result.add(sorted[i * steps].id);
    result.add(sorted[Math.min(sorted.length - 1, sorted.length - 1 - i * steps)].id);
  }
  const picked = [...result].filter(Boolean);
  return picked.length ? picked : [sorted[0].id];
}

function remainingUncoveredDegree(graph, vertexId, covered, componentEdgeIds) {
  return (graph.adjAll.get(vertexId) || [])
    .filter(item => componentEdgeIds.has(item.edge.id) && !covered.has(item.edge.id))
    .length;
}

function deadEndPocketScore(graph, vertexId, incomingEdgeId, covered, componentEdgeIds) {
  const degree = (graph.adjAll.get(vertexId) || []).filter(item => componentEdgeIds.has(item.edge.id)).length;
  if (degree <= 1) return 3;

  const queue = [{ id: vertexId, depth: 0 }];
  const visited = new Set([vertexId]);
  let uncovered = 0;
  while (queue.length) {
    const current = queue.shift();
    for (const item of graph.adjAll.get(current.id) || []) {
      if (!componentEdgeIds.has(item.edge.id) || item.edge.id === incomingEdgeId) continue;
      if (!covered.has(item.edge.id)) uncovered += 1;
      if (current.depth >= 3 || visited.has(item.to)) continue;
      visited.add(item.to);
      queue.push({ id: item.to, depth: current.depth + 1 });
    }
  }
  return uncovered <= 3 ? 2 : 0;
}

function turnPenalty(prevStep, item) {
  if (!prevStep) return 0;
  const prevGeom = prevStep.reversed ? [...prevStep.edge.geometry].reverse() : prevStep.edge.geometry;
  const nextGeom = item.reversed ? [...item.edge.geometry].reverse() : item.edge.geometry;
  if (prevGeom.length < 2 || nextGeom.length < 2) return 0;
  const a = prevGeom[prevGeom.length - 2];
  const b = prevGeom[prevGeom.length - 1];
  const c = nextGeom[1];
  const latitudeScale = Math.cos(toRad(b.lat));
  const angle1 = Math.atan2(b.lat - a.lat, (b.lon - a.lon) * latitudeScale);
  const angle2 = Math.atan2(c.lat - b.lat, (c.lon - b.lon) * latitudeScale);
  return Math.abs(normalizeAngle(angle2 - angle1));
}

function createEmptySegment() {
  return { steps: [], estimatedMeters: 0, deadheadMeters: 0, stops: [] };
}

function finalizeSegment(segment, sampleSpacingMeters, maxWaypoints, segments) {
  if (!segment.steps.length) return;
  const stops = sampleSegmentStops(segment.steps, sampleSpacingMeters, maxWaypoints);
  const geometry = collectSegmentGeometry(segment.steps);
  if (geometry.length < 2) return;
  const bounds = pointsBounds(geometry.map(([lat, lon]) => ({ lat, lon })));
  const roadTypeDistances = aggregateStepDistances(
    segment.steps,
    step => step.edge.highway || 'other'
  );
  const roadNameDistances = aggregateStepDistances(
    segment.steps,
    step => step.edge.name || '未命名道路'
  );
  const topRoads = Object.entries(roadNameDistances)
    .map(([name, distance]) => ({ name, distance }))
    .sort((a, b) => b.distance - a.distance)
    .slice(0, 5);
  const regulatorySignals = buildRegulatorySignals(segment.steps);
  segments.push({
    stops: stops.map((point, index) => ({
      name: `覆盖点 ${index + 1}`,
      lat: point.lat,
      lon: point.lon,
    })),
    geometry,
    distance: segment.estimatedMeters,
    estimatedMeters: segment.estimatedMeters,
    deadheadMeters: segment.deadheadMeters,
    coveredMeters: Math.max(0, segment.estimatedMeters - segment.deadheadMeters),
    duplicationRatio: segment.estimatedMeters
      ? segment.deadheadMeters / segment.estimatedMeters
      : 0,
    edgeUsages: segment.steps.map(step => ({
      id: step.edge.id,
      length: step.edge.length,
      insideLength: step.edge.insideLength ?? step.edge.length,
      highway: step.edge.highway || 'other',
      name: step.edge.name || '',
      deadhead: !!step.deadhead,
    })),
    roadTypeDistances,
    regulatorySignals,
    topRoads,
    insideCoveredMeters: segment.steps
      .filter(step => !step.deadhead)
      .reduce((sum, step) => sum + (step.edge.insideLength ?? step.edge.length), 0),
    insideTravelMeters: segment.steps
      .reduce((sum, step) => sum + (step.edge.insideLength ?? step.edge.length), 0),
    outsideMeters: Math.max(0, segment.estimatedMeters - segment.steps
      .reduce((sum, step) => sum + (step.edge.insideLength ?? step.edge.length), 0)),
    bounds,
    center: {
      lat: (bounds.south + bounds.north) / 2,
      lon: (bounds.west + bounds.east) / 2,
    },
  });
}

function buildRegulatorySignals(steps) {
  const maxspeedDistances = aggregateStepDistances(steps, step => normalizeTag(step.edge.tags?.maxspeed) || 'unknown');
  const surfaceDistances = aggregateStepDistances(steps, step => normalizeTag(step.edge.tags?.surface) || 'unknown');
  const laneDistances = aggregateStepDistances(steps, step => normalizeTag(step.edge.tags?.lanes) || 'unknown');
  const uniqueSpeedLimits = Object.keys(maxspeedDistances).filter(value => value !== 'unknown');
  const roundaboutWays = new Set();
  const trafficCalmingWays = new Set();
  let speedTaggedDistance = 0;
  let conditionalSpeedDistance = 0;
  let variableSpeedDistance = 0;
  let schoolZoneDistance = 0;
  let tunnelDistance = 0;
  let bridgeDistance = 0;
  let litDistance = 0;
  let onewayDistance = 0;
  let unpavedDistance = 0;
  let speedChangeCount = 0;
  let previousSpeed = '';

  steps.forEach(step => {
    const edge = step.edge;
    const tags = edge.tags || {};
    const maxspeed = normalizeTag(tags.maxspeed);
    const tagText = Object.entries(tags).map(([key, value]) => `${key}=${value}`).join(' ');
    if (maxspeed) {
      speedTaggedDistance += edge.length;
      if (previousSpeed && previousSpeed !== maxspeed) speedChangeCount += 1;
      previousSpeed = maxspeed;
    }
    if (tags['maxspeed:conditional']) conditionalSpeedDistance += edge.length;
    if (/signals|variable/i.test(`${tags.maxspeed || ''} ${tags['maxspeed:variable'] || ''}`)) variableSpeedDistance += edge.length;
    if (/school/i.test(tagText)) schoolZoneDistance += edge.length;
    if (isTruthyTag(tags.tunnel)) tunnelDistance += edge.length;
    if (isTruthyTag(tags.bridge)) bridgeDistance += edge.length;
    if (tags.lit === 'yes') litDistance += edge.length;
    if (edge.oneway) onewayDistance += edge.length;
    if (/^(unpaved|gravel|dirt|ground|sand|mud|compacted|fine_gravel)$/i.test(tags.surface || '')) unpavedDistance += edge.length;
    if (tags.junction === 'roundabout') roundaboutWays.add(edge.wayId);
    if (tags.traffic_calming) trafficCalmingWays.add(edge.wayId);
  });

  delete maxspeedDistances.unknown;
  return {
    speedTaggedDistance,
    speedChangeCount,
    uniqueSpeedLimitCount: uniqueSpeedLimits.length,
    conditionalSpeedDistance,
    variableSpeedDistance,
    schoolZoneDistance,
    tunnelDistance,
    bridgeDistance,
    litDistance,
    onewayDistance,
    unpavedDistance,
    roundaboutCount: roundaboutWays.size,
    trafficCalmingCount: trafficCalmingWays.size,
    maxspeedDistances,
    surfaceDistances,
    laneDistances,
  };
}

function normalizeTag(value) {
  return String(value || '').trim().toLowerCase();
}

function isTruthyTag(value) {
  return value === 'yes' || value === 'true' || value === '1';
}

function aggregateStepDistances(steps, keySelector) {
  return steps.reduce((result, step) => {
    const key = keySelector(step);
    result[key] = (result[key] || 0) + step.edge.length;
    return result;
  }, {});
}

function collectSegmentGeometry(steps) {
  const points = [];
  steps.forEach(step => {
    step.geometry.forEach((point, index) => {
      if (index === 0 && points.length) return;
      points.push([point.lat, point.lon]);
    });
  });
  return points;
}

function sampleSegmentStops(steps, sampleSpacingMeters, maxWaypoints) {
  // 导航途经点数量有限时，均匀取点经常会漏掉关键转弯并触发大幅抄近路。
  // 这里优先保留对整体形状贡献最大的点，再用最小间距去除挤在一起的点。
  const geometry = collectSegmentGeometry(steps);
  if (geometry.length < 2) return [];
  const points = geometry.map(([lat, lon]) => ({ lat, lon }));
  const totalLength = polylineLength(points);
  if (totalLength <= 0) return [{ lat: geometry[0][0], lon: geometry[0][1] }];

  const desiredCount = Math.max(
    2,
    Math.min(maxWaypoints, Math.ceil(totalLength / Math.max(sampleSpacingMeters, 200)) + 1)
  );
  return selectShapePoints(points, desiredCount, sampleSpacingMeters);
}

function selectShapePoints(points, maxPoints, minSpacingMeters) {
  if (points.length <= maxPoints) return points;
  const selected = new Set([0, points.length - 1]);

  while (selected.size < maxPoints) {
    const indexes = [...selected].sort((a, b) => a - b);
    let best = null;

    for (let part = 1; part < indexes.length; part += 1) {
      const start = indexes[part - 1];
      const end = indexes[part];
      if (end - start <= 1) continue;

      for (let index = start + 1; index < end; index += 1) {
        const spacing = Math.min(
          haversineMeters(points[index], points[start]),
          haversineMeters(points[index], points[end])
        );
        if (spacing < minSpacingMeters * 0.5 && end - start > 2) continue;
        const deviation = pointToSegmentMeters(points[index], points[start], points[end]);
        const progress = (index - start) / (end - start);
        const distributionWeight = Math.sin(Math.PI * progress) * 0.12 + 0.88;
        const score = deviation * distributionWeight;
        if (!best || score > best.score) best = { index, score };
      }
    }

    if (!best || best.score < 0.5) break;
    selected.add(best.index);
  }

  // 极直的长路上几何偏差可能都接近 0，补充均匀点，防止导航中间无约束。
  if (selected.size < maxPoints) {
    for (let slot = 1; slot < maxPoints - 1 && selected.size < maxPoints; slot += 1) {
      selected.add(Math.round(slot * (points.length - 1) / (maxPoints - 1)));
    }
  }

  return [...selected]
    .sort((a, b) => a - b)
    .map(index => points[index]);
}

function pointToSegmentMeters(point, start, end) {
  const midLat = toRad((start.lat + end.lat + point.lat) / 3);
  const metersPerLon = 111_320 * Math.cos(midLat);
  const metersPerLat = 110_570;
  const ax = start.lon * metersPerLon;
  const ay = start.lat * metersPerLat;
  const bx = end.lon * metersPerLon;
  const by = end.lat * metersPerLat;
  const px = point.lon * metersPerLon;
  const py = point.lat * metersPerLat;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(px - ax, py - ay);
  const ratio = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + dx * ratio), py - (ay + dy * ratio));
}

function polylineLength(geometry) {
  let total = 0;
  for (let index = 1; index < geometry.length; index += 1) {
    total += haversineMeters(geometry[index - 1], geometry[index]);
  }
  return total;
}

function pointsBounds(points) {
  return points.reduce((bounds, point) => ({
    south: Math.min(bounds.south, point.lat),
    west: Math.min(bounds.west, point.lon),
    north: Math.max(bounds.north, point.lat),
    east: Math.max(bounds.east, point.lon),
  }), { south: points[0].lat, west: points[0].lon, north: points[0].lat, east: points[0].lon });
}

function createAdjacency(edges, directed) {
  const adjacency = new Map();
  const add = (from, to, edge, reversed) => {
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from).push({ edge, from, to, reversed });
  };
  edges.forEach(edge => {
    add(edge.from, edge.to, edge, false);
    if (!directed || !edge.oneway) add(edge.to, edge.from, edge, true);
  });
  return adjacency;
}

function upsertVertex(vertices, id, point) {
  if (vertices.has(id)) return;
  vertices.set(id, { id, lat: point.lat, lon: point.lon, degree: 0 });
}

function isOneWay(tags = {}) {
  return tags.oneway === 'yes' || tags.junction === 'roundabout' || tags.highway === 'motorway';
}

function expandBboxByMeters(bbox, meters) {
  const midLat = toRad((bbox.south + bbox.north) / 2);
  const latPadding = meters / 110_570;
  const lonScale = Math.max(0.01, Math.cos(midLat));
  const lonPadding = meters / (111_320 * lonScale);
  return {
    south: bbox.south - latPadding,
    west: bbox.west - lonPadding,
    north: bbox.north + latPadding,
    east: bbox.east + lonPadding,
  };
}

function filterWayToPolygonBuffer(way, polygon, bufferMeters) {
  const pieces = [];
  let current = null;

  const finishCurrent = () => {
    if (current?.nodes.length >= 2) {
      pieces.push({
        ...way,
        id: `${way.id}:region:${pieces.length}`,
        nodes: current.nodes,
        geometry: current.geometry,
      });
    }
    current = null;
  };

  for (let index = 0; index < way.geometry.length - 1; index += 1) {
    const start = way.geometry[index];
    const end = way.geometry[index + 1];
    if (!segmentNearPolygon(start, end, polygon, bufferMeters)) {
      finishCurrent();
      continue;
    }

    if (!current || !samePoint(current.geometry.at(-1), start)) {
      finishCurrent();
      current = { nodes: [way.nodes[index]], geometry: [start] };
    }
    current.nodes.push(way.nodes[index + 1]);
    current.geometry.push(end);
  }

  finishCurrent();
  return pieces;
}

function segmentNearPolygon(start, end, polygon, bufferMeters) {
  if (pointInPolygon(start, polygon) || pointInPolygon(end, polygon)) return true;

  for (let index = 0; index < polygon.length; index += 1) {
    const edgeStart = polygon[index];
    const edgeEnd = polygon[(index + 1) % polygon.length];
    if (segmentsIntersect(start, end, edgeStart, edgeEnd)) return true;
    const distance = Math.min(
      pointToSegmentMeters(start, edgeStart, edgeEnd),
      pointToSegmentMeters(end, edgeStart, edgeEnd),
      pointToSegmentMeters(edgeStart, start, end),
      pointToSegmentMeters(edgeEnd, start, end)
    );
    if (distance <= bufferMeters) return true;
  }

  return false;
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const a = polygon[current];
    const b = polygon[previous];
    const crosses = ((a.lat > point.lat) !== (b.lat > point.lat))
      && point.lon < (b.lon - a.lon) * (point.lat - a.lat) / ((b.lat - a.lat) || 1e-14) + a.lon;
    if (crosses) inside = !inside;
  }
  return inside;
}

function polylineLengthInsidePolygon(geometry, polygon) {
  let insideMeters = 0;
  for (let index = 1; index < geometry.length; index += 1) {
    const start = geometry[index - 1];
    const end = geometry[index];
    const length = haversineMeters(start, end);
    const sampleCount = Math.max(1, Math.ceil(length / 200));
    for (let sample = 0; sample < sampleCount; sample += 1) {
      const ratio = (sample + 0.5) / sampleCount;
      if (pointInPolygon(interpolatePoint(start, end, ratio), polygon)) {
        insideMeters += length / sampleCount;
      }
    }
  }
  return insideMeters;
}

function segmentsIntersect(a, b, c, d) {
  const orientation = (p, q, r) => {
    const value = (q.lon - p.lon) * (r.lat - p.lat) - (q.lat - p.lat) * (r.lon - p.lon);
    if (Math.abs(value) < 1e-12) return 0;
    return value > 0 ? 1 : -1;
  };
  const onSegment = (p, q, r) =>
    q.lon >= Math.min(p.lon, r.lon) - 1e-12
    && q.lon <= Math.max(p.lon, r.lon) + 1e-12
    && q.lat >= Math.min(p.lat, r.lat) - 1e-12
    && q.lat <= Math.max(p.lat, r.lat) + 1e-12;

  const first = orientation(a, b, c);
  const second = orientation(a, b, d);
  const third = orientation(c, d, a);
  const fourth = orientation(c, d, b);
  if (first !== second && third !== fourth) return true;
  if (first === 0 && onSegment(a, c, b)) return true;
  if (second === 0 && onSegment(a, d, b)) return true;
  if (third === 0 && onSegment(c, a, d)) return true;
  if (fourth === 0 && onSegment(c, b, d)) return true;
  return false;
}

function clipWayToBbox(way, bbox) {
  const pieces = [];
  let current = null;

  const finishCurrent = () => {
    if (current?.nodes.length >= 2 && current.geometry.length >= 2) {
      pieces.push({
        ...way,
        id: `${way.id}:clip:${pieces.length}`,
        sourceWayId: way.id,
        nodes: current.nodes,
        geometry: current.geometry,
      });
    }
    current = null;
  };

  for (let index = 0; index < way.geometry.length - 1; index += 1) {
    const originalStart = way.geometry[index];
    const originalEnd = way.geometry[index + 1];
    const clipped = clipSegmentToBbox(originalStart, originalEnd, bbox);
    if (!clipped) {
      finishCurrent();
      continue;
    }

    const startId = samePoint(clipped.start, originalStart)
      ? way.nodes[index]
      : boundaryNodeId(way.id, index, clipped.start);
    const endId = samePoint(clipped.end, originalEnd)
      ? way.nodes[index + 1]
      : boundaryNodeId(way.id, index, clipped.end);

    if (!current || !samePoint(current.geometry.at(-1), clipped.start)) {
      finishCurrent();
      current = { nodes: [startId], geometry: [clipped.start] };
    }

    if (!samePoint(current.geometry.at(-1), clipped.end)) {
      current.nodes.push(endId);
      current.geometry.push(clipped.end);
    }
  }

  finishCurrent();
  return pieces;
}

function clipSegmentToBbox(start, end, bbox) {
  const dx = end.lon - start.lon;
  const dy = end.lat - start.lat;
  let from = 0;
  let to = 1;
  const constraints = [
    [-dx, start.lon - bbox.west],
    [dx, bbox.east - start.lon],
    [-dy, start.lat - bbox.south],
    [dy, bbox.north - start.lat],
  ];

  for (const [direction, distance] of constraints) {
    if (Math.abs(direction) < 1e-14) {
      if (distance < 0) return null;
      continue;
    }
    const ratio = distance / direction;
    if (direction < 0) {
      if (ratio > to) return null;
      from = Math.max(from, ratio);
    } else {
      if (ratio < from) return null;
      to = Math.min(to, ratio);
    }
  }

  if (from > to) return null;
  return {
    start: interpolatePoint(start, end, from),
    end: interpolatePoint(start, end, to),
  };
}

function interpolatePoint(start, end, ratio) {
  return {
    lat: start.lat + (end.lat - start.lat) * ratio,
    lon: start.lon + (end.lon - start.lon) * ratio,
  };
}

function samePoint(a, b) {
  return !!a && !!b && Math.abs(a.lat - b.lat) < 1e-10 && Math.abs(a.lon - b.lon) < 1e-10;
}

function boundaryNodeId(wayId, segmentIndex, point) {
  return `boundary-${wayId}-${segmentIndex}-${point.lat.toFixed(8)}-${point.lon.toFixed(8)}`;
}

function normalizeAngle(angle) {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function toRad(value) {
  return value * Math.PI / 180;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new Error('已取消覆盖路线生成。');
}

function yieldToMainThread() {
  return new Promise(resolve => setTimeout(resolve, 0));
}
