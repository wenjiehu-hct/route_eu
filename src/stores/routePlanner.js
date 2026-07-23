import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { ROUTE_COLORS } from '../constants/routes.js';
import { buildGoogleMapsUrl, fetchRoutePlan, localSuggest } from '../services/routing.js';
import { loadGroups, saveGroups } from '../services/storage.js';
import { createId, formatKm } from '../services/utils.js';

function nextRouteColor(routeCount) {
  return ROUTE_COLORS[routeCount % ROUTE_COLORS.length];
}

export const useRoutePlannerStore = defineStore('routePlanner', () => {
  const groups = ref(loadGroups());
  const draft = ref({ id: null, name: '', stops: [], groupId: groups.value[0]?.id || null });
  const draftPreview = ref({ stats: null, warning: '', loading: false });
  const status = ref('就绪。');
  const mapPickEnabled = ref(false);
  const activeRouteId = ref(null);

  const visibleRoutes = computed(() => groups.value.flatMap(group => group.routes.filter(route => route.visible)));
  const allRoutes = computed(() => groups.value.flatMap(group => group.routes));
  const activeRoute = computed(() => allRoutes.value.find(route => route.id === activeRouteId.value) || null);
  const totalRouteCount = computed(() => allRoutes.value.length);

  function persist() {
    saveGroups(groups.value);
  }

  function setStatus(message) {
    status.value = message;
  }

  function addGroup() {
    groups.value.push({ id: createId('group'), name: `新分组 ${groups.value.length + 1}`, expanded: true, routes: [] });
    persist();
  }

  function renameGroup(groupId, name) {
    const group = groups.value.find(item => item.id === groupId);
    if (!group) return;
    group.name = name.trim() || group.name;
    persist();
  }

  function removeGroup(groupId) {
    const removed = groups.value.find(group => group.id === groupId);
    if (removed?.routes.some(route => route.id === activeRouteId.value)) activeRouteId.value = null;
    groups.value = groups.value.filter(group => group.id !== groupId);
    if (!groups.value.length) addGroup();
    if (!groups.value.some(group => group.id === draft.value.groupId)) {
      draft.value.groupId = groups.value[0]?.id || null;
    }
    persist();
  }

  function toggleGroupExpanded(groupId) {
    const group = groups.value.find(item => item.id === groupId);
    if (!group) return;
    group.expanded = !group.expanded;
    persist();
  }

  function toggleGroupRoutesVisibility(groupId, visible) {
    const group = groups.value.find(item => item.id === groupId);
    if (!group) return;
    group.routes.forEach(route => { route.visible = visible; });
    if (!visible && group.routes.some(route => route.id === activeRouteId.value)) activeRouteId.value = null;
    persist();
  }

  function toggleAllRoutesVisibility(visible) {
    groups.value.forEach(group => {
      group.routes.forEach(route => { route.visible = visible; });
    });
    if (!visible) activeRouteId.value = null;
    persist();
    setStatus(visible ? '已显示全部路线。' : '已隐藏全部路线。');
  }

  function renameRoute(routeId, name) {
    for (const group of groups.value) {
      const route = group.routes.find(item => item.id === routeId);
      if (!route) continue;
      route.name = name.trim() || route.name;
      persist();
      return;
    }
  }

  function duplicateRoute(routeId) {
    for (const group of groups.value) {
      const route = group.routes.find(item => item.id === routeId);
      if (!route) continue;
      group.routes.unshift({
        ...JSON.parse(JSON.stringify(route)),
        id: createId('route'),
        name: `${route.name} - 副本`,
        visible: false,
        expanded: false,
      });
      persist();
      return;
    }
  }

  function removeRoute(routeId) {
    deleteRoutes([routeId]);
  }

  function toggleRoute(routeId) {
    for (const group of groups.value) {
      const route = group.routes.find(item => item.id === routeId);
      if (!route) continue;
      route.visible = !route.visible;
      if (!route.visible && activeRouteId.value === routeId) activeRouteId.value = null;
      persist();
      return;
    }
  }

  function locateRoute(routeId) {
    for (const group of groups.value) {
      const route = group.routes.find(item => item.id === routeId);
      if (!route) continue;
      const points = route.stats?.geometry?.length
        ? route.stats.geometry.map(([lon, lat]) => ({ lat, lon }))
        : route.stops;
      if (!points?.length) return;
      route.visible = true;
      activeRouteId.value = routeId;
      persist();
      const bounds = points.reduce((result, point) => ({
        south: Math.min(result.south, point.lat),
        west: Math.min(result.west, point.lon),
        north: Math.max(result.north, point.lat),
        east: Math.max(result.east, point.lon),
      }), {
        south: points[0].lat,
        west: points[0].lon,
        north: points[0].lat,
        east: points[0].lon,
      });
      window.dispatchEvent(new CustomEvent('locate-route-bounds', { detail: bounds }));
      setStatus(`已定位路线：${route.name}`);
      return;
    }
  }

  function showOnlyRoute(routeId) {
    groups.value.forEach(group => {
      group.routes.forEach(route => { route.visible = route.id === routeId; });
    });
    persist();
    locateRoute(routeId);
  }

  function selectRoute(routeId) {
    if (!allRoutes.value.some(route => route.id === routeId)) return;
    activeRouteId.value = routeId;
  }

  function clearActiveRoute() {
    activeRouteId.value = null;
  }

  function exportRouteGpx(routeId) {
    const route = allRoutes.value.find(item => item.id === routeId);
    if (!route) return;
    const points = route.stats?.geometry?.length
      ? route.stats.geometry.map(([lon, lat]) => ({ lat, lon }))
      : route.stops;
    if (!points?.length) {
      setStatus('该路线没有可导出的轨迹数据。');
      return;
    }
    const trackPoints = points
      .map(point => `      <trkpt lat="${Number(point.lat).toFixed(7)}" lon="${Number(point.lon).toFixed(7)}"></trkpt>`)
      .join('\n');
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Route Planner Pro" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${escapeXml(route.name)}</name></metadata>
  <trk><name>${escapeXml(route.name)}</name><trkseg>
${trackPoints}
  </trkseg></trk>
</gpx>`;
    downloadTextFile(gpx, `${safeFileName(route.name)}.gpx`, 'application/gpx+xml');
    setStatus(`已导出 GPX：${route.name}`);
  }

  async function copyRouteSummary(routeId) {
    const route = allRoutes.value.find(item => item.id === routeId);
    if (!route) return;
    const roadTypes = Object.entries(route.stats?.roadTypeDistances || {})
      .filter(([, distance]) => distance > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([type, distance]) => `${roadTypeLabel(type)} ${formatKm(distance)}`)
      .join(' / ');
    const topRoads = (route.stats?.topRoads || [])
      .slice(0, 5)
      .map(road => `${road.name} ${formatKm(road.distance)}`)
      .join(' / ');
    const lines = [
      `路线：${route.name}`,
      `总里程：${formatKm(route.stats?.distance || 0)}`,
      `途经点：${route.stops.length}`,
      roadTypes ? `道路类型：${roadTypes}` : '',
      topRoads ? `主要道路：${topRoads}` : '',
      route.googleUrl ? `Google 导航：${route.googleUrl}` : '',
    ].filter(Boolean);
    try {
      await copyText(lines.join('\n'));
      setStatus(`已复制路线摘要：${route.name}`);
    } catch (error) {
      setStatus(`复制路线摘要失败：${error.message}`);
    }
  }

  function setRoutesVisibility(routeIds, visible) {
    const ids = new Set(routeIds);
    groups.value.forEach(group => {
      group.routes.forEach(route => {
        if (ids.has(route.id)) route.visible = visible;
      });
    });
    if (!visible && ids.has(activeRouteId.value)) activeRouteId.value = null;
    persist();
    setStatus(`已${visible ? '显示' : '隐藏'} ${ids.size} 条路线。`);
  }

  function moveRoutesToGroup(routeIds, targetGroupId) {
    const ids = new Set(routeIds);
    const target = groups.value.find(group => group.id === targetGroupId);
    if (!target || !ids.size) return;
    const moving = [];
    groups.value.forEach(group => {
      group.routes.forEach(route => {
        if (ids.has(route.id)) moving.push(route);
      });
      group.routes = group.routes.filter(route => !ids.has(route.id));
    });
    if (!moving.length) return;
    target.routes.unshift(...moving);
    target.expanded = true;
    persist();
    setStatus(`已将 ${moving.length} 条路线移至「${target.name}」。`);
  }

  function deleteRoutes(routeIds) {
    const ids = new Set(routeIds);
    const deleted = [];
    groups.value.forEach(group => {
      group.routes.forEach(route => {
        if (ids.has(route.id)) deleted.push({ route, groupName: group.name });
      });
      group.routes = group.routes.filter(route => !ids.has(route.id));
    });
    if (!deleted.length) return;
    if (ids.has(activeRouteId.value)) activeRouteId.value = null;
    if (draft.value.id && ids.has(draft.value.id)) resetDraft();
    persist();
    setStatus(`已删除 ${deleted.length} 条路线。`);
  }

  function toggleRouteExpanded(routeId) {
    for (const group of groups.value) {
      const route = group.routes.find(item => item.id === routeId);
      if (!route) continue;
      route.expanded = !route.expanded;
      return;
    }
  }

  function startEditRoute(routeId) {
    for (const group of groups.value) {
      const route = group.routes.find(item => item.id === routeId);
      if (!route) continue;
      draft.value = { id: route.id, name: route.name, stops: JSON.parse(JSON.stringify(route.stops)), groupId: group.id };
      group.expanded = true;
      refreshDraftPreview();
      return;
    }
  }

  function resetDraft() {
    draft.value = { id: null, name: '', stops: [], groupId: groups.value[0]?.id || null };
    draftPreview.value = { stats: null, warning: '', loading: false };
  }

  function addStopToDraft(stop) {
    draft.value.stops.push({ name: stop.name, lat: stop.lat, lon: stop.lon });
    refreshDraftPreview();
  }

  function removeDraftStop(index) {
    draft.value.stops.splice(index, 1);
    refreshDraftPreview();
  }

  function moveDraftStopUp(index) {
    if (index <= 0) return;
    [draft.value.stops[index - 1], draft.value.stops[index]] = [draft.value.stops[index], draft.value.stops[index - 1]];
    refreshDraftPreview();
  }

  function moveDraftStopDown(index) {
    if (index >= draft.value.stops.length - 1) return;
    [draft.value.stops[index + 1], draft.value.stops[index]] = [draft.value.stops[index], draft.value.stops[index + 1]];
    refreshDraftPreview();
  }

  async function refreshDraftPreview() {
    draftPreview.value = { stats: null, warning: '', loading: false };
    if (!draft.value.stops.length) return;
    if (draft.value.stops.length < 2) return;
    draftPreview.value.loading = true;
    try {
      const stats = await fetchRoutePlan(draft.value.stops);
      draftPreview.value = { stats, warning: '', loading: false };
      setStatus('草稿路线预览已更新。');
    } catch (error) {
      draftPreview.value = { stats: null, warning: `草稿路线预览失败：${error.message}`, loading: false };
      setStatus(draftPreview.value.warning);
    }
  }

  async function saveDraftRoute() {
    const name = draft.value.name.trim();
    if (!name) {
      setStatus('请先填写路线名称。');
      return;
    }
    if (draft.value.stops.length < 2) {
      setStatus('至少需要 2 个点位才能生成路线。');
      return;
    }
    const group = groups.value.find(item => item.id === draft.value.groupId) || groups.value[0];
    if (!group) return;

    try {
      let routePayload = {
        id: draft.value.id || createId('route'),
        name,
        color: draft.value.id ? (group.routes.find(route => route.id === draft.value.id)?.color || nextRouteColor(totalRouteCount.value)) : nextRouteColor(totalRouteCount.value),
        visible: true,
        expanded: true,
        stats: draftPreview.value.stats,
        warning: draftPreview.value.warning,
        googleUrl: buildGoogleMapsUrl(draft.value.stops),
        stops: JSON.parse(JSON.stringify(draft.value.stops)),
      };

      if (!routePayload.stats && !routePayload.warning) {
        routePayload = { ...routePayload, stats: await fetchRoutePlan(draft.value.stops) };
      }

      groups.value.forEach(item => {
        item.routes = item.routes.filter(route => route.id !== routePayload.id);
      });
      group.routes.unshift(routePayload);
      persist();
      resetDraft();
      setStatus(`已保存路线：${routePayload.name}`);

    } catch (error) {
      setStatus(`保存路线失败：${error.message}`);
    }
  }

  function addRoutesToGroup(groupId, routePayloads) {
    const group = groups.value.find(item => item.id === groupId) || groups.value[0];
    if (!group || !routePayloads.length) return;
    group.expanded = true;
    group.routes.unshift(...routePayloads);
    persist();
    setStatus(`已批量保存 ${routePayloads.length} 条路线到「${group.name}」。`);

  }

  async function hydrateMissingStats() {
    const routesNeedingStats = allRoutes.value.filter(route => route.stops.length >= 2 && !route.stats);
    if (!routesNeedingStats.length) return;
    setStatus(`正在加载 ${routesNeedingStats.length} 条路线的几何数据...`);
    for (const route of routesNeedingStats) {
      try {
        const stats = await fetchRoutePlan(route.stops);
        for (const group of groups.value) {
          const target = group.routes.find(item => item.id === route.id);
          if (target) {
            target.stats = stats;
            target.warning = '';
            target.googleUrl = buildGoogleMapsUrl(target.stops);
            break;
          }
        }
      } catch (error) {
        for (const group of groups.value) {
          const target = group.routes.find(item => item.id === route.id);
          if (target) {
            target.warning = `路线几何数据加载失败：${error.message}`;
            break;
          }
        }
      }
    }
    persist();
    setStatus('路线几何数据加载完成。');
  }

  /**
   * 导出全部路线数据为 JSON 文件（包含 OSRM 几何路径等完整数据）。
   * 导出后无需再次请求 OSRM API，导入即可直接渲染。
   */
  function exportData({ pois = [] } = {}) {
    const payload = {
      version: 2,
      exportedAt: new Date().toISOString(),
      groups: JSON.parse(JSON.stringify(groups.value)),
      pois: JSON.parse(JSON.stringify(pois)),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const timestamp = new Date().toISOString().slice(0, 10);
    anchor.href = url;
    anchor.download = `route-planner-${timestamp}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus(`已备份 ${allRoutes.value.length} 条路线和 ${pois.length} 个收藏点。`);
  }

  /**
   * 从 JSON 文件导入路线数据，替换当前所有分组和路线。
   * 支持 version=1 格式（含 stats 几何数据）以及旧版纯路线数组格式（自动迁移）。
   */
  function importData(file, onImported) {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const raw = JSON.parse(event.target.result);

        // 格式一：新版导出格式 { version, exportedAt, groups }
        if ((raw.version === 1 || raw.version === 2) && Array.isArray(raw.groups)) {
          groups.value = raw.groups;
          activeRouteId.value = null;
          persist();
          onImported?.(raw);
          setStatus(`已导入 ${raw.groups.length} 个分组、${allRoutes.value.length} 条路线。`);
          return;
        }

        // 格式二：旧版纯路线数组（兼容 HTML 版 routesData_v2）
        if (Array.isArray(raw)) {
          const migrated = migrateImportedRoutes(raw);
          groups.value = migrated;
          activeRouteId.value = null;
          persist();
          setStatus(`已迁移导入 ${migrated.length} 个分组、${allRoutes.value.length} 条路线。`);
          return;
        }

        setStatus('导入失败：文件格式不匹配。');
      } catch (error) {
        setStatus(`导入失败：${error.message}`);
      }
    };
    reader.readAsText(file);
  }

  /** 将旧版路线数组（不含 groups/stats）迁移为 groups 格式 */
  function migrateImportedRoutes(rawRoutes) {
    const routes = rawRoutes.map((route, index) => ({
      id: route.id || createId(`route${index}`),
      name: route.name || `路线 ${index + 1}`,
      color: route.color || ROUTE_COLORS[index % ROUTE_COLORS.length],
      visible: route.visible !== false,
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
    return [{
      id: createId('group'),
      name: '导入路线',
      expanded: true,
      routes,
    }];
  }

  /** 草稿点位拖拽后更新坐标，并重新计算路线预览 */
  function updateDraftStopCoords(index, lat, lon) {
    if (index < 0 || index >= draft.value.stops.length) return;
    draft.value.stops[index].lat = lat;
    draft.value.stops[index].lon = lon;
    setStatus(`已更新草稿第 ${index + 1} 个点位坐标。`);
    refreshDraftPreview();
  }

  /** 已保存路线点位拖拽后更新坐标，并重新获取路线几何 */
  async function updateRouteStopCoords(routeId, stopIndex, lat, lon) {
    for (const group of groups.value) {
      const route = group.routes.find(item => item.id === routeId);
      if (!route) continue;
      if (stopIndex < 0 || stopIndex >= route.stops.length) continue;
      route.stops[stopIndex].lat = lat;
      route.stops[stopIndex].lon = lon;
      route.googleUrl = buildGoogleMapsUrl(route.stops);
      route.stats = null;
      persist();
      setStatus(`正在重新计算 ${route.name} 的路线...`);
      try {
        route.stats = await fetchRoutePlan(route.stops);
        route.warning = '';
      } catch (error) {
        route.warning = `路线几何数据更新失败：${error.message}`;
      }
      persist();
      setStatus(`已更新 ${route.name} 第 ${stopIndex + 1} 个点位坐标。`);
      return;
    }
  }

  /** 将路线移到目标分组 */
  function moveRouteToGroup(routeId, targetGroupId) {
    moveRoutesToGroup([routeId], targetGroupId);
  }

  /** 删除单条路线 */
  function deleteRoute(routeId) {
    deleteRoutes([routeId]);
  }

  return {
    groups,
    draft,
    draftPreview,
    status,
    mapPickEnabled,
    activeRouteId,
    visibleRoutes,
    allRoutes,
    activeRoute,
    localSuggest,
    addGroup,
    renameGroup,
    removeGroup,
    toggleGroupExpanded,
    toggleGroupRoutesVisibility,
    toggleAllRoutesVisibility,
    renameRoute,
    duplicateRoute,
    removeRoute,
    deleteRoute,
    toggleRoute,
    locateRoute,
    showOnlyRoute,
    selectRoute,
    clearActiveRoute,
    exportRouteGpx,
    copyRouteSummary,
    setRoutesVisibility,
    moveRoutesToGroup,
    deleteRoutes,
    toggleRouteExpanded,
    startEditRoute,
    resetDraft,
    addStopToDraft,
    removeDraftStop,
    moveDraftStopUp,
    moveDraftStopDown,
    refreshDraftPreview,
    saveDraftRoute,
    addRoutesToGroup,
    setStatus,
    hydrateMissingStats,
    exportData,
    importData,
    updateDraftStopCoords,
    updateRouteStopCoords,
    moveRouteToGroup,
  };
});

const ROAD_TYPE_LABELS = {
  motorway: '高速公路',
  motorway_link: '高速匝道',
  trunk: '快速路',
  trunk_link: '快速路匝道',
  primary: '主干道',
  primary_link: '主干道匝道',
  secondary: '次干道',
  secondary_link: '次干道匝道',
  tertiary: '支路',
  tertiary_link: '支路匝道',
  residential: '居住区道路',
  unclassified: '未分类道路',
  urban: '城市道路',
  rural: '普通道路',
  other: '其他道路',
};

function roadTypeLabel(type) {
  return ROAD_TYPE_LABELS[type] || type;
}

function escapeXml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function safeFileName(value) {
  return String(value || 'route').replace(/[\\/:*?"<>|]/g, '_').trim() || 'route';
}

function downloadTextFile(content, fileName, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function copyText(content) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(content);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = content;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}
