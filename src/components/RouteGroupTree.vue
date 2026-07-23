<template>
  <n-card title="路线库" size="small">
    <template #header-extra>
      <n-space :size="6" align="center">
        <n-tag size="small">{{ formatKm(totalDistance) }}</n-tag>
        <n-tag size="small" type="info">{{ visibleRouteCount }}/{{ allRoutes.length }} 显示</n-tag>
        <n-button size="tiny" type="primary" @click="store.addGroup">新建分组</n-button>
      </n-space>
    </template>

    <div class="library-filters">
      <n-input v-model:value="searchText" clearable size="small" placeholder="搜索路线名称" />
      <n-select v-model:value="visibilityFilter" :options="visibilityOptions" size="small" />
      <n-select v-model:value="sortMode" :options="sortOptions" size="small" />
    </div>

    <div class="library-toolbar">
      <n-space :size="6">
        <n-button size="tiny" @click="store.toggleAllRoutesVisibility(true)">全部显示</n-button>
        <n-button size="tiny" @click="store.toggleAllRoutesVisibility(false)">全部隐藏</n-button>
        <n-button v-if="activeRoute" size="tiny" @click="store.clearActiveRoute">取消聚焦</n-button>
      </n-space>
    </div>

    <div v-if="activeRoute" class="active-route-banner">
      <span class="active-route-dot" :style="{ background: activeRoute.color }"></span>
      <div class="active-route-copy">
        <span class="active-route-label">当前路线</span>
        <strong>{{ activeRoute.name }}</strong>
      </div>
      <n-button size="tiny" type="primary" @click="store.locateRoute(activeRoute.id)">定位</n-button>
    </div>

    <div v-if="activeRoute" class="active-route-details">
      <div class="route-stat-grid">
        <div><span>总里程</span><strong>{{ formatKm(activeRoute.stats?.distance || 0) }}</strong></div>
        <div><span>预计时间</span><strong>{{ formatHours(activeRoute.stats?.duration || 0) }}</strong></div>
        <div v-if="activeRoute.stats?.coverage"><span>重复连接</span><strong>{{ formatKm(activeRepeatMeters) }}</strong></div>
        <div v-if="activeRoute.stats?.coverage"><span>区域外衔接</span><strong>{{ formatKm(activeRoute.stats.coverage.outsideMeters || 0) }}</strong></div>
      </div>

      <div v-if="activeRoadTypes.length" class="road-type-breakdown">
        <div class="detail-section-title">道路类型长度</div>
        <div v-for="item in activeRoadTypes" :key="item.type" class="road-type-row">
          <span>{{ item.label }}</span>
          <div class="road-type-track"><i :style="{ width: `${item.share * 100}%` }"></i></div>
          <strong>{{ formatKm(item.distance) }}</strong>
        </div>
      </div>

      <div v-if="activeRoute.stats?.topRoads?.length" class="top-road-list">
        <span class="detail-section-title">主要道路</span>
        <span v-for="road in activeRoute.stats.topRoads.slice(0, 3)" :key="`${road.name}-${road.distance}`">
          {{ road.name }} {{ formatKm(road.distance) }}
        </span>
      </div>

      <n-space :size="5" wrap>
        <n-button size="tiny" @click="store.exportRouteGpx(activeRoute.id)">导出 GPX</n-button>
        <n-button size="tiny" @click="store.copyRouteSummary(activeRoute.id)">复制摘要</n-button>
        <n-button v-if="activeRoute.googleUrl" size="tiny" tag="a" :href="activeRoute.googleUrl" target="_blank">
          Google 导航 ↗
        </n-button>
      </n-space>
    </div>

    <div v-if="selectedIds.length" class="bulk-toolbar">
      <strong>已选 {{ selectedIds.length }} 条</strong>
      <n-space :size="4" wrap>
        <n-button size="tiny" @click="store.setRoutesVisibility(selectedIds, true)">显示</n-button>
        <n-button size="tiny" @click="store.setRoutesVisibility(selectedIds, false)">隐藏</n-button>
        <n-dropdown :options="bulkMoveOptions" @select="handleBulkMove">
          <n-button size="tiny" :disabled="!bulkMoveOptions.length">移动到…</n-button>
        </n-dropdown>
        <n-button size="tiny" type="error" @click="deleteSelected">删除</n-button>
        <n-button size="tiny" quaternary @click="clearSelection">取消选择</n-button>
      </n-space>
    </div>

    <n-empty v-if="!displayGroups.length" size="small" description="没有符合条件的路线" />

    <div v-else class="route-groups">
      <section v-for="item in displayGroups" :key="item.group.id" class="route-group-card">
        <div class="route-group-header" @click="store.toggleGroupExpanded(item.group.id)">
          <n-checkbox
            :checked="isGroupFullySelected(item.routes)"
            :indeterminate="isGroupPartlySelected(item.routes)"
            @click.stop
            @update:checked="toggleGroupSelection(item.routes, $event)"
          />
          <span class="group-chevron">{{ isGroupOpen(item.group) || hasActiveFilters ? '⌄' : '›' }}</span>
          <div class="group-title-wrap">
            <strong>{{ item.group.name }}</strong>
            <span>{{ visibleCount(item.routes) }}/{{ item.routes.length }} 显示</span>
          </div>
          <n-space :size="3" @click.stop>
            <n-button size="tiny" quaternary @click="store.toggleGroupRoutesVisibility(item.group.id, true)">全显</n-button>
            <n-button size="tiny" quaternary @click="store.toggleGroupRoutesVisibility(item.group.id, false)">全隐</n-button>
            <n-dropdown :options="groupOptions(item.group)" @select="handleGroupAction">
              <n-button size="tiny" quaternary>•••</n-button>
            </n-dropdown>
          </n-space>
        </div>

        <div v-show="isGroupOpen(item.group) || hasActiveFilters" class="route-list">
          <div v-if="!item.routes.length" class="empty-group">暂无路线，可将路线移动到此分组</div>
          <div
            v-for="route in item.routes"
            :key="route.id"
            class="route-library-item"
            :class="{
              'is-active': route.id === store.activeRouteId,
              'is-hidden': !route.visible,
            }"
          >
            <n-checkbox
              :checked="selectedIds.includes(route.id)"
              @update:checked="toggleRouteSelection(route.id, $event)"
            />
            <span class="route-color-bar" :style="{ background: route.color }"></span>
            <button class="route-main" type="button" @click="store.locateRoute(route.id)">
              <span class="route-name-line">
                <strong>{{ route.name }}</strong>
                <span v-if="route.id === store.activeRouteId" class="active-chip">当前</span>
              </span>
              <span class="route-meta-line">
                <span>{{ routeDistance(route) }}</span>
                <span>{{ route.stops.length }} 点</span>
                <span v-for="roadType in routeRoadTypes(route, 2)" :key="roadType.type" class="road-type-chip">
                  {{ roadType.label }} {{ formatKm(roadType.distance) }}
                </span>
                <span :class="route.visible ? 'state-visible' : 'state-hidden'">
                  {{ route.visible ? '地图显示' : '已隐藏' }}
                </span>
                <span v-if="route.warning" class="state-warning">数据异常</span>
              </span>
            </button>
            <div class="route-quick-actions">
              <n-button size="tiny" @click="store.toggleRoute(route.id)">
                {{ route.visible ? '隐藏' : '显示' }}
              </n-button>
              <n-dropdown :options="routeOptions(route, item.group.id)" @select="handleRouteAction">
                <n-button size="tiny" quaternary>更多</n-button>
              </n-dropdown>
            </div>
          </div>
        </div>
      </section>
    </div>
  </n-card>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoutePlannerStore } from '../stores/routePlanner.js';
import { formatHours, formatKm } from '../services/utils.js';

const store = useRoutePlannerStore();
const { groups, allRoutes, activeRoute } = storeToRefs(store);
const searchText = ref('');
const visibilityFilter = ref('all');
const sortMode = ref('recent');
const selectedIds = ref([]);
const ROAD_TYPE_LABELS = {
  motorway: '高速',
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

const visibilityOptions = [
  { label: '全部状态', value: 'all' },
  { label: '仅显示中', value: 'visible' },
  { label: '仅已隐藏', value: 'hidden' },
];
const sortOptions = [
  { label: '最近添加', value: 'recent' },
  { label: '名称排序', value: 'name' },
  { label: '里程从长到短', value: 'distance' },
];

const visibleRouteCount = computed(() => allRoutes.value.filter(route => route.visible).length);
const totalDistance = computed(() => allRoutes.value.reduce((sum, route) => sum + (route.stats?.distance || 0), 0));
const hasActiveFilters = computed(() => !!searchText.value.trim() || visibilityFilter.value !== 'all');
const activeRoadTypes = computed(() => routeRoadTypes(activeRoute.value));
const activeRepeatMeters = computed(() => {
  const coverage = activeRoute.value?.stats?.coverage;
  return (coverage?.deadheadMeters || 0) + (coverage?.crossOverlapMeters || 0);
});

const displayGroups = computed(() => {
  const keyword = searchText.value.trim().toLocaleLowerCase();
  return groups.value
    .map(group => {
      let routes = group.routes.filter(route => {
        if (keyword && !route.name.toLocaleLowerCase().includes(keyword)) return false;
        if (visibilityFilter.value === 'visible' && !route.visible) return false;
        if (visibilityFilter.value === 'hidden' && route.visible) return false;
        return true;
      });
      if (sortMode.value === 'name') {
        routes = [...routes].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
      } else if (sortMode.value === 'distance') {
        routes = [...routes].sort((a, b) => (b.stats?.distance || 0) - (a.stats?.distance || 0));
      }
      return { group, routes };
    })
    .filter(item => item.routes.length || (!hasActiveFilters.value && !item.group.routes.length));
});

const bulkMoveOptions = computed(() => groups.value.map(group => ({
  label: group.name,
  key: group.id,
})));

watch(allRoutes, routes => {
  const existing = new Set(routes.map(route => route.id));
  selectedIds.value = selectedIds.value.filter(id => existing.has(id));
}, { deep: true });

function routeDistance(route) {
  return route.stats?.distance ? formatKm(route.stats.distance) : '里程待计算';
}

function routeRoadTypes(route, limit = Infinity) {
  if (!route?.stats) return [];
  let distances = route.stats.roadTypeDistances;
  if (!distances || !Object.values(distances).some(distance => distance > 0)) {
    distances = {
      motorway: route.stats.motorwayDistance || 0,
      urban: route.stats.urbanDistance || 0,
      rural: route.stats.ruralDistance || 0,
    };
  }
  const total = Object.values(distances).reduce((sum, distance) => sum + (Number(distance) || 0), 0);
  return Object.entries(distances)
    .filter(([, distance]) => Number(distance) > 0)
    .map(([type, distance]) => ({
      type,
      label: ROAD_TYPE_LABELS[type] || type,
      distance: Number(distance),
      share: total ? Number(distance) / total : 0,
    }))
    .sort((a, b) => b.distance - a.distance)
    .slice(0, limit);
}

function isGroupOpen(group) {
  return group.expanded !== false;
}

function visibleCount(routes) {
  return routes.filter(route => route.visible).length;
}

function toggleRouteSelection(routeId, checked) {
  const next = new Set(selectedIds.value);
  checked ? next.add(routeId) : next.delete(routeId);
  selectedIds.value = [...next];
}

function toggleGroupSelection(routes, checked) {
  const next = new Set(selectedIds.value);
  routes.forEach(route => checked ? next.add(route.id) : next.delete(route.id));
  selectedIds.value = [...next];
}

function isGroupFullySelected(routes) {
  return !!routes.length && routes.every(route => selectedIds.value.includes(route.id));
}

function isGroupPartlySelected(routes) {
  const count = routes.filter(route => selectedIds.value.includes(route.id)).length;
  return count > 0 && count < routes.length;
}

function clearSelection() {
  selectedIds.value = [];
}

function deleteSelected() {
  if (!window.confirm(`确定删除选中的 ${selectedIds.value.length} 条路线吗？`)) return;
  store.deleteRoutes(selectedIds.value);
  clearSelection();
}

function handleBulkMove(groupId) {
  store.moveRoutesToGroup(selectedIds.value, groupId);
  clearSelection();
}

function groupOptions(group) {
  return [
    { label: '重命名分组', key: `rename-group|${group.id}` },
    { label: '删除分组', key: `delete-group|${group.id}` },
  ];
}

function handleGroupAction(key) {
  const [action, groupId] = String(key).split('|');
  const group = groups.value.find(item => item.id === groupId);
  if (!group) return;
  if (action === 'rename-group') {
    const name = window.prompt('请输入新的分组名称', group.name);
    if (name) store.renameGroup(group.id, name);
  } else if (action === 'delete-group') {
    if (window.confirm(`确定删除分组「${group.name}」及其中 ${group.routes.length} 条路线吗？`)) {
      store.removeGroup(group.id);
    }
  }
}

function routeOptions(route, currentGroupId) {
  const options = [
    { label: '查看并定位', key: `locate|${route.id}` },
    { label: '仅显示此路线', key: `solo|${route.id}` },
    { label: '编辑途经点', key: `edit|${route.id}` },
    { label: '重命名', key: `rename|${route.id}` },
    { label: '创建副本', key: `duplicate|${route.id}` },
    { label: '复制路线摘要', key: `copy-summary|${route.id}` },
    { label: '导出 GPX', key: `export-gpx|${route.id}` },
  ];
  if (route.googleUrl) options.push({ label: '打开 Google 导航', key: `navigate|${route.id}` });
  const targets = groups.value.filter(group => group.id !== currentGroupId);
  if (targets.length) {
    options.push({
      label: '移动到分组',
      key: `move-menu|${route.id}`,
      children: targets.map(group => ({
        label: group.name,
        key: `move|${route.id}|${group.id}`,
      })),
    });
  }
  options.push({ type: 'divider', key: `divider|${route.id}` });
  options.push({ label: '删除路线', key: `delete|${route.id}` });
  return options;
}

function handleRouteAction(key) {
  const [action, routeId, targetGroupId] = String(key).split('|');
  const route = allRoutes.value.find(item => item.id === routeId);
  if (!route) return;
  if (action === 'locate') store.locateRoute(routeId);
  if (action === 'solo') store.showOnlyRoute(routeId);
  if (action === 'edit') store.startEditRoute(routeId);
  if (action === 'duplicate') store.duplicateRoute(routeId);
  if (action === 'copy-summary') store.copyRouteSummary(routeId);
  if (action === 'export-gpx') store.exportRouteGpx(routeId);
  if (action === 'move' && targetGroupId) store.moveRouteToGroup(routeId, targetGroupId);
  if (action === 'navigate' && route.googleUrl) window.open(route.googleUrl, '_blank', 'noopener');
  if (action === 'rename') {
    const name = window.prompt('请输入新的路线名称', route.name);
    if (name) store.renameRoute(routeId, name);
  }
  if (action === 'delete' && window.confirm(`确定删除路线「${route.name}」吗？`)) {
    store.deleteRoute(routeId);
  }
}

</script>

<style scoped>
.library-filters {
  display: grid;
  grid-template-columns: minmax(140px, 1fr) 104px 118px;
  gap: 6px;
}

.library-toolbar,
.bulk-toolbar,
.active-route-banner,
.route-group-header,
.route-library-item {
  display: flex;
  align-items: center;
}

.library-toolbar {
  justify-content: space-between;
  margin-top: 8px;
}

.active-route-banner {
  gap: 8px;
  margin-top: 8px;
  padding: 8px 10px;
  border: 1px solid #93c5fd;
  border-radius: 8px;
  background: #eff6ff;
}

.active-route-dot {
  width: 10px;
  height: 28px;
  border-radius: 5px;
}

.active-route-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}

.active-route-copy strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.active-route-label {
  color: #64748b;
  font-size: 10px;
}

.active-route-details {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 9px 10px;
  border: 1px solid #bfdbfe;
  border-top: 0;
  border-radius: 0 0 8px 8px;
  background: #f8fbff;
}

.active-route-banner + .active-route-details {
  margin-top: -1px;
}

.route-stat-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}

.route-stat-grid > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  padding: 5px 6px;
  border-radius: 6px;
  background: #fff;
}

.route-stat-grid span {
  color: #64748b;
  font-size: 9px;
}

.route-stat-grid strong {
  overflow: hidden;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-section-title {
  color: #475569;
  font-size: 10px;
  font-weight: 700;
}

.road-type-breakdown {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.road-type-row {
  display: grid;
  grid-template-columns: 74px minmax(50px, 1fr) 58px;
  align-items: center;
  gap: 6px;
  font-size: 10px;
}

.road-type-row > span {
  overflow: hidden;
  color: #475569;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.road-type-row > strong {
  color: #1e293b;
  text-align: right;
}

.road-type-track {
  height: 5px;
  overflow: hidden;
  border-radius: 999px;
  background: #dbeafe;
}

.road-type-track i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #2563eb, #38bdf8);
}

.top-road-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  color: #64748b;
  font-size: 10px;
}

.bulk-toolbar {
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
  padding: 8px;
  border-radius: 8px;
  background: #fff7ed;
  color: #9a3412;
  font-size: 12px;
}

.route-groups {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}

.route-group-card {
  overflow: hidden;
  border: 1px solid #dbe4f0;
  border-radius: 9px;
  background: #fff;
}

.route-group-header {
  gap: 6px;
  padding: 7px 8px;
  background: #f6f8fb;
  cursor: pointer;
}

.group-chevron {
  width: 12px;
  color: #64748b;
  font-size: 18px;
  line-height: 1;
}

.group-title-wrap {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}

.group-title-wrap strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-title-wrap span {
  color: #64748b;
  font-size: 10px;
}

.route-list {
  border-top: 1px solid #e7edf5;
}

.empty-group {
  padding: 14px 10px;
  color: #94a3b8;
  font-size: 11px;
  text-align: center;
}

.route-library-item {
  gap: 7px;
  min-height: 50px;
  padding: 7px 8px;
  border-bottom: 1px solid #edf1f6;
  transition: background 0.15s ease, opacity 0.15s ease;
}

.route-library-item:last-child {
  border-bottom: 0;
}

.route-library-item:hover {
  background: #f8fbff;
}

.route-library-item.is-active {
  background: #eff6ff;
  box-shadow: inset 3px 0 #2563eb;
}

.route-library-item.is-hidden {
  opacity: 0.62;
}

.route-color-bar {
  width: 4px;
  height: 32px;
  flex: 0 0 4px;
  border-radius: 3px;
}

.route-main {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 3px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.route-name-line,
.route-meta-line {
  display: flex;
  align-items: center;
  gap: 6px;
}

.road-type-chip {
  padding: 1px 4px;
  border-radius: 4px;
  background: #eef2ff;
  color: #4338ca;
}

.route-name-line strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.route-meta-line {
  flex-wrap: wrap;
  color: #64748b;
  font-size: 10px;
}

.active-chip {
  padding: 1px 5px;
  border-radius: 999px;
  background: #2563eb;
  color: #fff;
  font-size: 9px;
}

.state-visible { color: #15803d; }
.state-hidden { color: #64748b; }
.state-warning { color: #c2410c; }

.route-quick-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 3px;
}

@media (max-width: 430px) {
  .library-filters {
    grid-template-columns: 1fr 1fr;
  }

  .library-filters :first-child {
    grid-column: 1 / -1;
  }

  .route-quick-actions {
    flex-direction: column;
  }

  .route-stat-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
