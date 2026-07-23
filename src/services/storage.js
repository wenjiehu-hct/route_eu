import { DEFAULT_GROUP_NAME, DEFAULT_ROUTES, LEGACY_STORAGE_KEYS, ROUTE_COLORS, STORAGE_KEY } from '../constants/routes.js';
import { createId, normalizeName, parseLatLon } from './utils.js';
import { CITY_COORDS } from '../constants/routes.js';

function localGeocode(name) {
  const direct = parseLatLon(name);
  if (direct) return direct;
  const key = normalizeName(name);
  const coords = CITY_COORDS[key];
  if (coords) return { name, lat: coords[0], lon: coords[1] };
  return null;
}

export function seedRoutes() {
  return DEFAULT_ROUTES.map((route, index) => ({
    id: createId('route'),
    name: route.name,
    color: ROUTE_COLORS[index % ROUTE_COLORS.length],
    visible: true,
    expanded: true,
    stats: null,
    warning: '',
    googleUrl: '',
    stops: route.stops.map(stopName => {
      const point = localGeocode(stopName) || { name: stopName, lat: 0, lon: 0 };
      return { name: stopName, lat: point.lat, lon: point.lon };
    }),
  }));
}

export function createDefaultGroup(routes) {
  return [{
    id: createId('group'),
    name: DEFAULT_GROUP_NAME,
    expanded: true,
    routes,
  }];
}

function migrateLegacyRoutes(rawRoutes) {
  const routes = rawRoutes.map((route, index) => ({
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
      if (Array.isArray(parsed)) return parsed;
    } catch (error) {
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
    } catch (error) {
      // continue
    }
  }

  const seeded = createDefaultGroup(seedRoutes());
  saveGroups(seeded);
  return seeded;
}

export function saveGroups(groups) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
}
