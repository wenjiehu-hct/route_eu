import { CITY_COORDS, MAX_GOOGLE_WAYPOINTS } from '../constants/routes.js';
import { formatHours, formatKm, formatPercent, normalizeName, parseLatLon, titleCase } from './utils.js';

function osrmUrl(stops) {
  const coordinates = stops.map(stop => `${stop.lon},${stop.lat}`).join(';');
  return `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=true&annotations=false`;
}

function isMotorway(step) {
  const haystack = [step.ref, step.name, step.destinations, step.pronunciation, step.mode]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return /\b(motorway|autobahn|autoroute|freeway|expressway|autostrada|autosnelweg|autovia|autov[ií]a|motorvei)\b/.test(haystack)
    || /\b(a\d+|a-\d+|m\d+|m-\d+|e\d+|ap-\d+|ax|a\s?\d+)\b/.test(haystack);
}

function isUrban(step) {
  const haystack = [step.name, step.ref, step.destinations]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (/\b(street|st\.|road|rd\.|avenue|ave\.|boulevard|blvd|ring|city|center|centre|platz|strasse|straße|via|viale|calle|gran via|paseo|carrer|laan|straat|inner ring|urban)\b/.test(haystack)) {
    return true;
  }
  const maneuverType = step.maneuver?.type || '';
  return ['depart', 'arrive', 'roundabout', 'turn'].includes(maneuverType) && step.distance < 5000;
}

function classifyDistance(step) {
  const distance = Number(step.distance) || 0;
  if (distance <= 0) return { motorway: 0, urban: 0, rural: 0 };
  if (isMotorway(step)) return { motorway: distance, urban: 0, rural: 0 };
  if (isUrban(step)) return { motorway: 0, urban: distance, rural: 0 };
  return { motorway: 0, urban: 0, rural: distance };
}

function aggregateLegs(route) {
  const totals = { motorway: 0, urban: 0, rural: 0 };
  const steps = [];
  for (const leg of route.legs || []) {
    for (const step of leg.steps || []) {
      const partial = classifyDistance(step);
      totals.motorway += partial.motorway;
      totals.urban += partial.urban;
      totals.rural += partial.rural;
      steps.push({
        name: step.name || step.ref || '未命名道路',
        distance: step.distance || 0,
      });
    }
  }
  return { totals, steps };
}

function topRoadsByDistance(steps) {
  const totals = new Map();
  steps.forEach(step => totals.set(step.name, (totals.get(step.name) || 0) + step.distance));
  return [...totals.entries()]
    .map(([name, distance]) => ({ name, distance }))
    .sort((left, right) => right.distance - left.distance)
    .slice(0, 5);
}

export async function fetchRoutePlan(stops) {
  const response = await fetch(osrmUrl(stops));
  if (!response.ok) throw new Error(`OSRM HTTP ${response.status}`);
  const data = await response.json();
  if (data.code !== 'Ok' || !data.routes?.[0]?.geometry?.coordinates) {
    throw new Error(data.message || data.code || 'OSRM 未返回有效路线');
  }
  const route = data.routes[0];
  const { totals, steps } = aggregateLegs(route);
  const distance = route.distance || 0;
  const duration = route.duration || 0;
  const gap = Math.max(0, distance - (totals.motorway + totals.urban + totals.rural));
  totals.rural += gap;
  return {
    geometry: route.geometry.coordinates,
    distance,
    duration,
    motorwayDistance: totals.motorway,
    urbanDistance: totals.urban,
    ruralDistance: totals.rural,
    share: {
      motorway: distance ? totals.motorway / distance : 0,
      urban: distance ? totals.urban / distance : 0,
      rural: distance ? totals.rural / distance : 0,
    },
    roadTypeDistances: {
      motorway: totals.motorway,
      urban: totals.urban,
      rural: totals.rural,
    },
    topRoads: topRoadsByDistance(steps),
  };
}

export function buildGoogleMapsUrl(stops) {
  if (stops.length < 2) return '';
  const origin = `${stops[0].lat},${stops[0].lon}`;
  const destination = `${stops[stops.length - 1].lat},${stops[stops.length - 1].lon}`;
  const waypoints = stops.slice(1, -1);
  if (waypoints.length > MAX_GOOGLE_WAYPOINTS) return '';
  const params = new URLSearchParams({ api: '1', origin, destination, travelmode: 'driving' });
  if (waypoints.length) {
    params.set('waypoints', waypoints.map(stop => `${stop.lat},${stop.lon}`).join('|'));
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function describeStats(stats) {
  return [
    `总里程 ${formatKm(stats.distance)}`,
    `预计 ${formatHours(stats.duration)}`,
    `高速 ${formatKm(stats.motorwayDistance)} (${formatPercent(stats.share.motorway)})`,
    `城市 ${formatKm(stats.urbanDistance)} (${formatPercent(stats.share.urban)})`,
    `普通道路 ${formatKm(stats.ruralDistance)} (${formatPercent(stats.share.rural)})`,
  ].join(' · ');
}

export function buildTopRoadsText(stats) {
  if (!stats.topRoads?.length) return '未提取到主要道路段。';
  return stats.topRoads.map(road => `${titleCase(road.name)} ${formatKm(road.distance)}`).join(' / ');
}

function normalizeCityEntry(name, entry) {
  if (Array.isArray(entry)) {
    return { displayName: titleCase(name), coords: entry, aliases: [] };
  }
  return {
    displayName: entry.displayName || titleCase(name),
    coords: entry.coords,
    aliases: entry.aliases || [],
  };
}

export function localSuggest(query) {
  const key = normalizeName(query);
  const direct = parseLatLon(query);
  const results = [];
  if (direct) {
    results.push({ name: direct.name, full: `坐标 ${direct.lat}, ${direct.lon}`, lat: direct.lat, lon: direct.lon, source: '坐标' });
  }
  const seen = new Set();
  for (const [name, entry] of Object.entries(CITY_COORDS)) {
    const city = normalizeCityEntry(name, entry);
    const searchNames = [name, city.displayName, ...city.aliases].map(normalizeName);
    const matched = searchNames.some(searchName => searchName.includes(key));
    const uniqueKey = `${city.displayName}-${city.coords[0]}-${city.coords[1]}`;
    if (!matched || seen.has(uniqueKey)) continue;
    seen.add(uniqueKey);
    results.push({ name: city.displayName, full: '本地离线城市库', lat: city.coords[0], lon: city.coords[1], source: '本地' });
    if (results.length >= 8) break;
  }
  return results;
}

export async function remoteSuggest(query, { signal } = {}) {
  const value = String(query || '').trim();
  if (value.length < 3 || parseLatLon(value)) return [];
  const cacheKey = `roadTestGeocode:${normalizeName(value)}`;
  try {
    const cached = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
    if (Array.isArray(cached)) return cached;
  } catch { /* ignore cache failures */ }
  const params = new URLSearchParams({ q: value, format: 'jsonv2', addressdetails: '1', limit: '6' });
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { signal, headers: { Accept: 'application/json', 'Accept-Language': navigator.language || 'zh-CN' } });
  if (!response.ok) throw new Error(`地名搜索服务 HTTP ${response.status}`);
  const data = await response.json();
  const results = data.map(item => ({ name: item.name || item.display_name.split(',')[0], full: item.display_name, lat: Number(item.lat), lon: Number(item.lon), source: 'OpenStreetMap' })).filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lon));
  try { sessionStorage.setItem(cacheKey, JSON.stringify(results)); } catch { /* ignore cache failures */ }
  return results;
}
