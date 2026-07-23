import { create } from 'zustand';
import { ROUTE_COLORS } from '../constants/routes.js';
import { buildGoogleMapsUrl, fetchRoutePlan, localSuggest } from '../services/routing.js';
import { loadGroups, saveGroups } from '../services/storage.js';
import { createId, formatKm } from '../services/utils.js';

const initialGroups = loadGroups();
const emptyDraft = groups => ({ id: null, name: '', stops: [], groupId: groups[0]?.id || null });
const clone = value => JSON.parse(JSON.stringify(value));
const flattenRoutes = groups => groups.flatMap(group => group.routes || []);

export const useRoutePlannerStore = create((set, get) => ({
  groups: initialGroups,
  draft: emptyDraft(initialGroups),
  draftPreview: { stats: null, warning: '', loading: false },
  status: '就绪',
  mapPickEnabled: false,
  activeRouteId: null,

  localSuggest,
  setStatus: status => set({ status }),
  setMapPickEnabled: mapPickEnabled => set({ mapPickEnabled }),
  setDraftField: (field, value) => set(state => ({ draft: { ...state.draft, [field]: value } })),

  addGroup: () => {
    const groups = clone(get().groups);
    groups.push({ id: createId('group'), name: `新分组 ${groups.length + 1}`, expanded: true, routes: [] });
    commitGroups(set, groups);
  },
  renameGroup: (groupId, name) => mutateGroups(get, set, groups => {
    const group = groups.find(item => item.id === groupId);
    if (group) group.name = String(name || '').trim() || group.name;
  }),
  removeGroup: groupId => {
    let groups = clone(get().groups).filter(group => group.id !== groupId);
    if (!groups.length) groups = [{ id: createId('group'), name: '默认分组', expanded: true, routes: [] }];
    const activeStillExists = flattenRoutes(groups).some(route => route.id === get().activeRouteId);
    const draft = groups.some(group => group.id === get().draft.groupId)
      ? get().draft
      : { ...get().draft, groupId: groups[0]?.id || null };
    saveGroups(groups);
    set({ groups, draft, activeRouteId: activeStillExists ? get().activeRouteId : null });
  },
  toggleGroupExpanded: groupId => mutateGroups(get, set, groups => {
    const group = groups.find(item => item.id === groupId);
    if (group) group.expanded = !group.expanded;
  }),
  toggleGroupRoutesVisibility: (groupId, visible) => {
    const groups = clone(get().groups);
    const group = groups.find(item => item.id === groupId);
    if (!group) return;
    group.routes.forEach(route => { route.visible = visible; });
    const hideActive = !visible && group.routes.some(route => route.id === get().activeRouteId);
    saveGroups(groups);
    set({ groups, activeRouteId: hideActive ? null : get().activeRouteId });
  },
  toggleAllRoutesVisibility: visible => {
    const groups = clone(get().groups);
    groups.forEach(group => group.routes.forEach(route => { route.visible = visible; }));
    saveGroups(groups);
    set({ groups, activeRouteId: visible ? get().activeRouteId : null, status: visible ? '已显示全部路线。' : '已隐藏全部路线。' });
  },
  renameRoute: (routeId, name) => mutateGroups(get, set, groups => {
    const route = flattenRoutes(groups).find(item => item.id === routeId);
    if (route) route.name = String(name || '').trim() || route.name;
  }),
  duplicateRoute: routeId => mutateGroups(get, set, groups => {
    for (const group of groups) {
      const route = group.routes.find(item => item.id === routeId);
      if (!route) continue;
      group.routes.unshift({ ...clone(route), id: createId('route'), name: `${route.name} - 副本`, visible: false, expanded: false });
      break;
    }
  }),
  toggleRoute: routeId => {
    const groups = clone(get().groups);
    const route = flattenRoutes(groups).find(item => item.id === routeId);
    if (!route) return;
    route.visible = !route.visible;
    saveGroups(groups);
    set({ groups, activeRouteId: !route.visible && get().activeRouteId === routeId ? null : get().activeRouteId });
  },
  locateRoute: routeId => {
    const groups = clone(get().groups);
    const route = flattenRoutes(groups).find(item => item.id === routeId);
    if (!route) return;
    const points = route.stats?.geometry?.length
      ? route.stats.geometry.map(([lon, lat]) => ({ lat, lon }))
      : route.stops;
    if (!points?.length) return;
    route.visible = true;
    saveGroups(groups);
    set({ groups, activeRouteId: routeId, status: `已定位路线：${route.name}` });
    window.dispatchEvent(new CustomEvent('locate-route-bounds', { detail: pointsBounds(points) }));
  },
  showOnlyRoute: routeId => {
    const groups = clone(get().groups);
    groups.forEach(group => group.routes.forEach(route => { route.visible = route.id === routeId; }));
    saveGroups(groups);
    set({ groups, activeRouteId: routeId });
    get().locateRoute(routeId);
  },
  selectRoute: routeId => {
    if (flattenRoutes(get().groups).some(route => route.id === routeId)) set({ activeRouteId: routeId });
  },
  clearActiveRoute: () => set({ activeRouteId: null }),
  setRoutesVisibility: (routeIds, visible) => {
    const ids = new Set(routeIds);
    const groups = clone(get().groups);
    groups.forEach(group => group.routes.forEach(route => { if (ids.has(route.id)) route.visible = visible; }));
    saveGroups(groups);
    set({ groups, activeRouteId: !visible && ids.has(get().activeRouteId) ? null : get().activeRouteId, status: `已${visible ? '显示' : '隐藏'} ${ids.size} 条路线。` });
  },
  moveRoutesToGroup: (routeIds, targetGroupId) => {
    const ids = new Set(routeIds);
    const groups = clone(get().groups);
    const target = groups.find(group => group.id === targetGroupId);
    if (!target || !ids.size) return;
    const moving = [];
    groups.forEach(group => {
      group.routes.forEach(route => { if (ids.has(route.id)) moving.push(route); });
      group.routes = group.routes.filter(route => !ids.has(route.id));
    });
    if (!moving.length) return;
    target.routes.unshift(...moving);
    target.expanded = true;
    saveGroups(groups);
    set({ groups, status: `已将 ${moving.length} 条路线移至「${target.name}」。` });
  },
  moveRouteToGroup: (routeId, targetGroupId) => get().moveRoutesToGroup([routeId], targetGroupId),
  deleteRoutes: routeIds => {
    const ids = new Set(routeIds);
    const groups = clone(get().groups);
    let count = 0;
    groups.forEach(group => {
      count += group.routes.filter(route => ids.has(route.id)).length;
      group.routes = group.routes.filter(route => !ids.has(route.id));
    });
    if (!count) return;
    saveGroups(groups);
    const draft = ids.has(get().draft.id) ? emptyDraft(groups) : get().draft;
    set({ groups, draft, draftPreview: ids.has(get().draft.id) ? { stats: null, warning: '', loading: false } : get().draftPreview, activeRouteId: ids.has(get().activeRouteId) ? null : get().activeRouteId, status: `已删除 ${count} 条路线。` });
  },
  deleteRoute: routeId => get().deleteRoutes([routeId]),
  removeRoute: routeId => get().deleteRoutes([routeId]),
  toggleRouteExpanded: routeId => mutateGroups(get, set, groups => {
    const route = flattenRoutes(groups).find(item => item.id === routeId);
    if (route) route.expanded = !route.expanded;
  }),
  startEditRoute: routeId => {
    for (const group of get().groups) {
      const route = group.routes.find(item => item.id === routeId);
      if (!route) continue;
      set({ draft: { id: route.id, name: route.name, stops: clone(route.stops), groupId: group.id } });
      get().refreshDraftPreview();
      window.dispatchEvent(new CustomEvent('open-workspace', { detail: 'manual' }));
      return;
    }
  },
  resetDraft: () => set(state => ({ draft: emptyDraft(state.groups), draftPreview: { stats: null, warning: '', loading: false }, mapPickEnabled: false })),
  addStopToDraft: stop => {
    set(state => ({ draft: { ...state.draft, stops: [...state.draft.stops, { name: stop.name, lat: Number(stop.lat), lon: Number(stop.lon) }] } }));
    get().refreshDraftPreview();
  },
  removeDraftStop: index => {
    set(state => ({ draft: { ...state.draft, stops: state.draft.stops.filter((_, itemIndex) => itemIndex !== index) } }));
    get().refreshDraftPreview();
  },
  moveDraftStop: (index, direction) => {
    const stops = clone(get().draft.stops);
    const next = index + direction;
    if (next < 0 || next >= stops.length) return;
    [stops[index], stops[next]] = [stops[next], stops[index]];
    set(state => ({ draft: { ...state.draft, stops } }));
    get().refreshDraftPreview();
  },
  updateDraftStopCoords: (index, lat, lon) => {
    const stops = clone(get().draft.stops);
    if (!stops[index]) return;
    stops[index] = { ...stops[index], lat, lon };
    set(state => ({ draft: { ...state.draft, stops }, status: `已更新草稿第 ${index + 1} 个点位。` }));
    get().refreshDraftPreview();
  },
  refreshDraftPreview: async () => {
    const stops = clone(get().draft.stops);
    if (stops.length < 2) {
      set({ draftPreview: { stats: null, warning: '', loading: false } });
      return;
    }
    set({ draftPreview: { stats: null, warning: '', loading: true } });
    try {
      const stats = await fetchRoutePlan(stops);
      set({ draftPreview: { stats, warning: '', loading: false }, status: '草稿路线预览已更新。' });
    } catch (error) {
      const warning = `草稿路线预览失败：${error.message}`;
      set({ draftPreview: { stats: null, warning, loading: false }, status: warning });
    }
  },
  saveDraftRoute: async () => {
    const state = get();
    const name = state.draft.name.trim();
    if (!name) return set({ status: '请先填写路线名称。' });
    if (state.draft.stops.length < 2) return set({ status: '至少需要 2 个点位才能生成路线。' });
    const groups = clone(state.groups);
    const group = groups.find(item => item.id === state.draft.groupId) || groups[0];
    if (!group) return;
    try {
      const existing = flattenRoutes(groups).find(route => route.id === state.draft.id);
      const stats = state.draftPreview.stats || await fetchRoutePlan(state.draft.stops);
      const route = {
        id: state.draft.id || createId('route'), name,
        color: existing?.color || ROUTE_COLORS[flattenRoutes(groups).length % ROUTE_COLORS.length],
        visible: true, expanded: true, stats, warning: '',
        googleUrl: buildGoogleMapsUrl(state.draft.stops), stops: clone(state.draft.stops),
      };
      groups.forEach(item => { item.routes = item.routes.filter(candidate => candidate.id !== route.id); });
      group.routes.unshift(route);
      saveGroups(groups);
      set({ groups, draft: emptyDraft(groups), draftPreview: { stats: null, warning: '', loading: false }, status: `已保存路线：${name}` });
      return route;
    } catch (error) {
      set({ status: `保存路线失败：${error.message}` });
      return null;
    }
  },
  addRoutesToGroup: (groupId, routes) => {
    const groups = clone(get().groups);
    const group = groups.find(item => item.id === groupId) || groups[0];
    if (!group || !routes.length) return;
    group.expanded = true;
    group.routes.unshift(...clone(routes));
    saveGroups(groups);
    set({ groups, status: `已批量保存 ${routes.length} 条路线到「${group.name}」。` });
  },
  replaceGroups: rawGroups => {
    const groups = Array.isArray(rawGroups) && rawGroups.length ? clone(rawGroups) : [{ id: createId('group'), name: '默认分组', expanded: true, routes: [] }];
    saveGroups(groups);
    set({ groups, activeRouteId: null, draft: emptyDraft(groups), draftPreview: { stats: null, warning: '', loading: false }, status: `已恢复 ${groups.length} 个分组、${flattenRoutes(groups).length} 条路线。` });
  },
  updateRouteStopCoords: async (routeId, stopIndex, lat, lon) => {
    let groups = clone(get().groups);
    const route = flattenRoutes(groups).find(item => item.id === routeId);
    if (!route?.stops?.[stopIndex]) return;
    route.stops[stopIndex] = { ...route.stops[stopIndex], lat, lon };
    route.googleUrl = buildGoogleMapsUrl(route.stops);
    route.stats = null;
    saveGroups(groups);
    set({ groups, status: `正在重新计算 ${route.name}...` });
    try {
      const stats = await fetchRoutePlan(route.stops);
      groups = clone(get().groups);
      const target = flattenRoutes(groups).find(item => item.id === routeId);
      if (target) { target.stats = stats; target.warning = ''; }
      saveGroups(groups);
      set({ groups, status: `已更新 ${route.name} 第 ${stopIndex + 1} 个点位。` });
    } catch (error) {
      groups = clone(get().groups);
      const target = flattenRoutes(groups).find(item => item.id === routeId);
      if (target) target.warning = `路线几何更新失败：${error.message}`;
      saveGroups(groups);
      set({ groups, status: target?.warning || '路线更新失败。' });
    }
  },
  hydrateMissingStats: async () => {
    const pending = flattenRoutes(get().groups).filter(route => route.stops?.length >= 2 && !route.stats);
    if (!pending.length) return;
    set({ status: `正在加载 ${pending.length} 条路线的几何数据...` });
    for (const route of pending) {
      try {
        const stats = await fetchRoutePlan(route.stops);
        mutateGroups(get, set, groups => {
          const target = flattenRoutes(groups).find(item => item.id === route.id);
          if (target) { target.stats = stats; target.warning = ''; target.googleUrl = buildGoogleMapsUrl(target.stops); }
        });
      } catch (error) {
        mutateGroups(get, set, groups => {
          const target = flattenRoutes(groups).find(item => item.id === route.id);
          if (target) target.warning = `路线几何数据加载失败：${error.message}`;
        });
      }
    }
    set({ status: '路线几何数据加载完成。' });
  },
  exportRouteGpx: routeId => {
    const route = flattenRoutes(get().groups).find(item => item.id === routeId);
    if (!route) return;
    const points = route.stats?.geometry?.length ? route.stats.geometry.map(([lon, lat]) => ({ lat, lon })) : route.stops;
    if (!points?.length) return set({ status: '该路线没有可导出的轨迹数据。' });
    const trackPoints = points.map(point => `      <trkpt lat="${Number(point.lat).toFixed(7)}" lon="${Number(point.lon).toFixed(7)}"></trkpt>`).join('\n');
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Global Road Test Studio" xmlns="http://www.topografix.com/GPX/1/1">\n  <metadata><name>${escapeXml(route.name)}</name></metadata>\n  <trk><name>${escapeXml(route.name)}</name><trkseg>\n${trackPoints}\n  </trkseg></trk>\n</gpx>`;
    downloadTextFile(gpx, `${safeFileName(route.name)}.gpx`, 'application/gpx+xml');
    set({ status: `已导出 GPX：${route.name}` });
  },
  copyRouteSummary: async routeId => {
    const route = flattenRoutes(get().groups).find(item => item.id === routeId);
    if (!route) return;
    const roadTypes = Object.entries(route.stats?.roadTypeDistances || {}).filter(([, distance]) => distance > 0).sort((a, b) => b[1] - a[1]).map(([type, distance]) => `${roadTypeLabel(type)} ${formatKm(distance)}`).join(' / ');
    const topRoads = (route.stats?.topRoads || []).slice(0, 5).map(road => `${road.name} ${formatKm(road.distance)}`).join(' / ');
    const text = [`路线：${route.name}`, `总里程：${formatKm(route.stats?.distance || 0)}`, `途经点：${route.stops.length}`, roadTypes && `道路类型：${roadTypes}`, topRoads && `主要道路：${topRoads}`, route.googleUrl && `Google 导航：${route.googleUrl}`].filter(Boolean).join('\n');
    try { await copyText(text); set({ status: `已复制路线摘要：${route.name}` }); }
    catch (error) { set({ status: `复制失败：${error.message}` }); }
  },
  exportData: ({ pois = [], compliance = null } = {}) => {
    const routes = flattenRoutes(get().groups);
    const payload = { version: 3, exportedAt: new Date().toISOString(), groups: clone(get().groups), pois: clone(pois), compliance: compliance ? clone(compliance) : null };
    downloadTextFile(JSON.stringify(payload, null, 2), `route-planner-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
    set({ status: `已备份 ${routes.length} 条路线、${pois.length} 个收藏点和 ${compliance?.projects?.length || 0} 个法规项目。` });
  },
  importData: (file, onImported) => {
    const reader = new FileReader();
    reader.onload = event => {
      try {
        const raw = JSON.parse(event.target.result);
        let groups;
        if ([1, 2, 3].includes(raw.version) && Array.isArray(raw.groups)) groups = raw.groups;
        else if (Array.isArray(raw)) groups = migrateImportedRoutes(raw);
        else throw new Error('文件格式不匹配');
        saveGroups(groups);
        set({ groups, activeRouteId: null, draft: emptyDraft(groups), draftPreview: { stats: null, warning: '', loading: false }, status: `已导入 ${groups.length} 个分组、${flattenRoutes(groups).length} 条路线。` });
        onImported?.(raw);
      } catch (error) { set({ status: `导入失败：${error.message}` }); }
    };
    reader.readAsText(file);
  },
}));

function mutateGroups(get, set, mutation) {
  const groups = clone(get().groups);
  mutation(groups);
  commitGroups(set, groups);
}

function commitGroups(set, groups) {
  saveGroups(groups);
  set({ groups });
}

function pointsBounds(points) {
  return points.reduce((bounds, point) => ({ south: Math.min(bounds.south, point.lat), west: Math.min(bounds.west, point.lon), north: Math.max(bounds.north, point.lat), east: Math.max(bounds.east, point.lon) }), { south: points[0].lat, west: points[0].lon, north: points[0].lat, east: points[0].lon });
}

function migrateImportedRoutes(routes) {
  return [{ id: createId('group'), name: '导入路线', expanded: true, routes: routes.map((route, index) => ({ id: route.id || createId('route'), name: route.name || `路线 ${index + 1}`, color: route.color || ROUTE_COLORS[index % ROUTE_COLORS.length], visible: route.visible !== false, expanded: false, stats: route.stats || null, warning: route.warning || '', googleUrl: route.googleUrl || '', stops: Array.isArray(route.stops) ? route.stops.map(stop => ({ name: stop.name, lat: Number(stop.lat), lon: Number(stop.lon) })) : [] })) }];
}

const ROAD_TYPE_LABELS = { motorway: '高速公路', motorway_link: '高速匝道', trunk: '快速路', trunk_link: '快速路匝道', primary: '主干道', primary_link: '主干道匝道', secondary: '次干道', secondary_link: '次干道匝道', tertiary: '支路', tertiary_link: '支路匝道', residential: '居住区道路', unclassified: '未分类道路', urban: '城市道路', rural: '普通道路', other: '其他道路' };
const roadTypeLabel = type => ROAD_TYPE_LABELS[type] || type;
const safeFileName = value => String(value || 'route').replace(/[\\/:*?"<>|]/g, '_').trim() || 'route';
const escapeXml = value => String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');

function downloadTextFile(content, fileName, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = fileName; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function copyText(content) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(content);
  const textarea = document.createElement('textarea');
  textarea.value = content; textarea.style.position = 'fixed'; textarea.style.opacity = '0';
  document.body.appendChild(textarea); textarea.select(); document.execCommand('copy'); textarea.remove();
}
