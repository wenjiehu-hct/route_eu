import {
  COVERAGE_AREA_LIMIT_KM2,
  COVERAGE_MAX_WAYS,
  OVERPASS_ENDPOINTS,
} from '../constants/routes.js';

const LINK_SUFFIX = '_link';

export function estimateBboxAreaKm2(bbox) {
  if (!bbox) return 0;
  const south = Number(bbox.south);
  const west = Number(bbox.west);
  const north = Number(bbox.north);
  const east = Number(bbox.east);
  const height = Math.abs(north - south) * 110.57;
  const midLat = ((north + south) / 2) * Math.PI / 180;
  const width = Math.abs(east - west) * 111.32 * Math.cos(midLat);
  return Math.max(0, height * width);
}

export function getCoverageAreaLimitKm2(highwayTypes) {
  return highwayTypes.includes('residential') || highwayTypes.includes('unclassified')
    ? COVERAGE_AREA_LIMIT_KM2.dense
    : COVERAGE_AREA_LIMIT_KM2.major;
}

export function buildHighwayPattern(highwayTypes, includeLinks = false) {
  const types = [...new Set(highwayTypes)].filter(Boolean);
  const expanded = includeLinks ? types.flatMap(type => [type, `${type}${LINK_SUFFIX}`]) : types;
  return expanded.map(escapeRegex).join('|');
}

export function buildOverpassQuery(bbox, highwayTypes, { includeLinks = false, timeoutSec = 60 } = {}) {
  const pattern = buildHighwayPattern(highwayTypes, includeLinks);
  if (!pattern) throw new Error('请至少选择一种道路类型。');
  const south = Number(bbox.south).toFixed(7);
  const west = Number(bbox.west).toFixed(7);
  const north = Number(bbox.north).toFixed(7);
  const east = Number(bbox.east).toFixed(7);

  return `[out:json][timeout:${timeoutSec}];
(
  way["highway"~"^(${pattern})$"]["area"!="yes"]["access"!~"^(private|no)$"](${south},${west},${north},${east});
);
out geom;`;
}

export async function fetchRoadsInBbox(bbox, highwayTypes, options = {}) {
  const areaKm2 = estimateBboxAreaKm2(bbox);
  const areaLimit = getCoverageAreaLimitKm2(highwayTypes);
  if (areaKm2 > areaLimit) {
    throw new Error(`道路查询范围约 ${areaKm2.toFixed(1)} km²，超过当前道路类型的上限 ${areaLimit} km²。请缩小多边形或减少道路类型。`);
  }

  const query = buildOverpassQuery(bbox, highwayTypes, options);
  const endpoints = options.endpoints || OVERPASS_ENDPOINTS;
  let lastError;

  for (let attempt = 0; attempt < Math.min(endpoints.length, 2); attempt += 1) {
    const endpoint = endpoints[attempt];
    try {
      const data = await postOverpass(endpoint, query, options.signal);
      const ways = normalizeWays(data.elements || []);
      if (!ways.length) {
        throw new Error('所绘区域附近没有找到符合条件的道路。');
      }
      if (ways.length > COVERAGE_MAX_WAYS) {
        throw new Error(`道路数量 ${ways.length} 条，超过上限 ${COVERAGE_MAX_WAYS} 条。请缩小范围或减少道路类型。`);
      }
      return {
        ways,
        wayCount: ways.length,
        nodeCount: new Set(ways.flatMap(way => way.nodes)).size,
        areaKm2,
      };
    } catch (error) {
      lastError = error;
      if (options.signal?.aborted) throw new Error('已取消道路查询。', { cause: error });
      if (!shouldRetry(error)) break;
      await delay(1200 * (attempt + 1), options.signal);
    }
  }

  throw lastError || new Error('道路查询失败。');
}

async function postOverpass(endpoint, query, externalSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 70_000);
  const abortExternal = () => controller.abort();
  externalSignal?.addEventListener('abort', abortExternal, { once: true });

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: new URLSearchParams({ data: query }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const error = new Error(formatHttpError(response.status));
      error.status = response.status;
      throw error;
    }

    return await response.json();
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(externalSignal?.aborted ? '已取消道路查询。' : 'Overpass 查询超时，请缩小范围后重试。', { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', abortExternal);
  }
}

function normalizeWays(elements) {
  return elements
    .filter(item => item.type === 'way' && Array.isArray(item.nodes) && Array.isArray(item.geometry))
    .map(item => ({
      id: item.id,
      tags: item.tags || {},
      nodes: item.nodes,
      geometry: item.geometry.map(point => ({ lat: Number(point.lat), lon: Number(point.lon) })),
    }))
    .filter(way => way.nodes.length >= 2 && way.geometry.length >= 2);
}

function shouldRetry(error) {
  return error.status === 429 || error.status === 504 || /超时|Too Many Requests|Gateway Timeout/i.test(error.message);
}

function formatHttpError(status) {
  if (status === 429) return 'Overpass 请求过于频繁，请稍后重试。';
  if (status === 504) return 'Overpass 查询超时，请缩小范围后重试。';
  return `Overpass 查询失败（HTTP ${status}）。`;
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('已取消道路查询。'));
    }, { once: true });
  });
}
