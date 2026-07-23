import { DEFAULT_GROUP_NAME, LEGACY_STORAGE_KEYS, ROUTE_COLORS, STORAGE_KEY } from '../constants/routes.js';
import { createId } from './utils.js';

const LEGACY_SAMPLE_ROUTE_NAMES = new Set([
  '德国环线',
  '意大利环线',
  '西班牙线',
  '法国线',
  '英国线',
]);

export function createDefaultGroup(routes = []) {
  return [{
    id: createId('group'),
    name: DEFAULT_GROUP_NAME,
    expanded: true,
    routes,
  }];
}

function migrateLegacyRoutes(rawRoutes) {
  const routes = rawRoutes
    .filter(route => !LEGACY_SAMPLE_ROUTE_NAMES.has(route?.name))
    .map((route, index) => ({
    id: route.id || createId(`route${index}`),
    name: route.name || `路线 ${index + 1}`,
    color: route.color || ROUTE_COLORS[index % ROUTE_COLORS.length],
    visible: Boolean(route.visible),
    expanded: false,
    stats: route.stats || null,
    warning: route.warning || '',
    googleUrl: route.googleUrl || '',
    stops: Array.isArray(route.stops) ? route.stops.map(stop => ({
      name: stop.name,
      lat: Number(stop.lat),
      lon: Number(stop.lon),
    })) : [],
  }));
  return createDefaultGroup(routes);
}

export function loadGroups() {
  const current = localStorage.getItem(STORAGE_KEY);
  if (current) {
    try {
      const parsed = JSON.parse(current);
      if (Array.isArray(parsed)) {
        const cleaned = removeLegacySampleRoutes(parsed);
        if (cleaned.changed) saveGroups(cleaned.groups);
        if (cleaned.groups.length) return cleaned.groups;
        const empty = createDefaultGroup();
        saveGroups(empty);
        return empty;
      }
    } catch {
      // ignore parse error and continue fallback
    }
  }

  for (const key of LEGACY_STORAGE_KEYS) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const migrated = migrateLegacyRoutes(parsed);
        saveGroups(migrated);
        return migrated;
      }
    } catch {
      // continue
    }
  }

  const empty = createDefaultGroup();
  saveGroups(empty);
  return empty;
}

export function saveGroups(groups) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
}

function removeLegacySampleRoutes(groups) {
  let changed = false;
  const cleaned = groups.map(group => {
    const routes = (group.routes || []).filter(route => {
      const isSample = LEGACY_SAMPLE_ROUTE_NAMES.has(route.name);
      if (isSample) changed = true;
      return !isSample;
    });
    return { ...group, routes };
  });
  return { groups: cleaned, changed };
}
