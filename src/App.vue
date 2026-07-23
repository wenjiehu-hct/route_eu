<template>
  <n-config-provider>
    <div class="app-shell">
      <!-- 地图始终全屏 -->
      <MapCanvas />

      <!-- 浮动面板 -->
      <div
        class="floating-panel"
        :style="panelStyle"
      >
        <!-- 拖拽手柄 + 折叠按钮 -->
        <div class="panel-drag-bar" @mousedown="startDragPanel">
          <span class="drag-bar-grip">⋮⋮</span>
          <span class="panel-title">全球道路测试工作台</span>
          <n-space size="small" align="center">
            <n-button size="tiny" quaternary @click="toggleCollapse">
              {{ collapsed ? '展开' : '折叠' }}
            </n-button>
          </n-space>
        </div>

        <!-- 宽度拖拽分隔线 -->
        <div class="width-resizer" @mousedown="startDragWidth"></div>

        <!-- 高度拖拽分隔线 -->
        <div v-show="!collapsed" class="height-resizer" @mousedown="startDragHeight"></div>

        <!-- 面板内容 -->
        <div v-show="!collapsed" class="panel-body">
          <n-scrollbar class="panel-scroll">
            <div class="workspace-tabs">
              <button
                v-for="item in workspaceTabs"
                :key="item.value"
                type="button"
                :class="{ active: activeWorkspace === item.value }"
                @click="activeWorkspace = item.value"
              >{{ item.label }}</button>
            </div>
            <div v-show="activeWorkspace === 'compliance'"><ComplianceWorkbench /></div>
            <div v-show="activeWorkspace === 'coverage'"><CoveragePlanner /></div>
            <div v-show="activeWorkspace === 'routes'"><RouteGroupTree /></div>
            <div v-show="activeWorkspace === 'manual'" class="workspace-stack">
              <DraftEditor />
              <DraftPreviewCard />
            </div>
            <div v-show="activeWorkspace === 'poi'"><POIEditor /></div>
          </n-scrollbar>
        </div>

        <!-- 底部固定状态 + 数据管理 -->
        <div v-show="!collapsed" class="panel-footer">
          <n-space justify="space-between" align="center">
            <span class="status-text">{{ status }}</span>
            <n-space size="small">
              <n-button size="tiny" @click="exportBackup">导出备份</n-button>
              <n-button size="tiny" @click="triggerImport">导入备份</n-button>
            </n-space>
          </n-space>
          <input ref="importFileRef" type="file" accept=".json" style="display:none" @change="handleImportFile" />
        </div>
      </div>
    </div>
  </n-config-provider>
</template>

<script setup>
import { onMounted, onUnmounted, ref, computed, watch } from 'vue';
import { storeToRefs } from 'pinia';
import DraftEditor from './components/DraftEditor.vue';
import DraftPreviewCard from './components/DraftPreviewCard.vue';
import MapCanvas from './components/MapCanvas.vue';
import RouteGroupTree from './components/RouteGroupTree.vue';
import POIEditor from './components/POIEditor.vue';
import CoveragePlanner from './components/CoveragePlanner.vue';
import ComplianceWorkbench from './components/ComplianceWorkbench.vue';
import { useComplianceStore } from './stores/compliance.js';
import { useRoutePlannerStore } from './stores/routePlanner.js';
import { usePOIStore } from './stores/poi.js';

const store = useRoutePlannerStore();
const poiStore = usePOIStore();
const complianceStore = useComplianceStore();
const { status } = storeToRefs(store);
const importFileRef = ref(null);

const PANEL_LAYOUT_KEY = 'routePlannerVue.panelLayout.v1';
const savedLayout = loadPanelLayout();
const workspaceTabs = [
  { value: 'compliance', label: '法规测试' },
  { value: 'coverage', label: '区域规划' },
  { value: 'routes', label: '路线库' },
  { value: 'manual', label: '手工路线' },
  { value: 'poi', label: '标记点' },
];
const activeWorkspace = ref(savedLayout.workspace || 'compliance');
const panelX = ref(savedLayout.x ?? 16);
const panelY = ref(savedLayout.y ?? 16);
const panelWidth = ref(savedLayout.width ?? 520);
const panelHeight = ref(savedLayout.height ?? window.innerHeight - 32);
const collapsed = ref(savedLayout.collapsed ?? false);

const panelStyle = computed(() => ({
  left: `${panelX.value}px`,
  top: `${panelY.value}px`,
  width: `${panelWidth.value}px`,
  height: collapsed.value ? 'auto' : `${panelHeight.value}px`,
}));

// 拖拽移动面板
let draggingPanel = false;
let dragOffsetX = 0;
let dragOffsetY = 0;

function startDragPanel(event) {
  // 避免拖拽按钮时误触
  if (event.target.closest('button')) return;
  draggingPanel = true;
  dragOffsetX = event.clientX - panelX.value;
  dragOffsetY = event.clientY - panelY.value;
  document.addEventListener('mousemove', onDragPanel);
  document.addEventListener('mouseup', stopDragPanel);
  event.preventDefault();
}

function onDragPanel(event) {
  if (!draggingPanel) return;
  panelX.value = Math.max(0, Math.min(event.clientX - dragOffsetX, window.innerWidth - panelWidth.value));
  panelY.value = Math.max(0, Math.min(event.clientY - dragOffsetY, window.innerHeight - 100));
}

function stopDragPanel() {
  draggingPanel = false;
  document.removeEventListener('mousemove', onDragPanel);
  document.removeEventListener('mouseup', stopDragPanel);
}

// 拖拽调整宽度
let draggingWidth = false;
let dragStartX = 0;
let dragStartWidth = 0;

function startDragWidth(event) {
  draggingWidth = true;
  dragStartX = event.clientX;
  dragStartWidth = panelWidth.value;
  document.addEventListener('mousemove', onDragWidth);
  document.addEventListener('mouseup', stopDragWidth);
  event.preventDefault();
}

function onDragWidth(event) {
  if (!draggingWidth) return;
  const delta = event.clientX - dragStartX;
  panelWidth.value = Math.max(360, Math.min(760, dragStartWidth + delta));
}

function stopDragWidth() {
  draggingWidth = false;
  document.removeEventListener('mousemove', onDragWidth);
  document.removeEventListener('mouseup', stopDragWidth);
}

// 拖拽调整高度
let draggingHeight = false;
let dragStartY = 0;
let dragStartHeight = 0;

function startDragHeight(event) {
  draggingHeight = true;
  dragStartY = event.clientY;
  dragStartHeight = panelHeight.value;
  document.addEventListener('mousemove', onDragHeight);
  document.addEventListener('mouseup', stopDragHeight);
  event.preventDefault();
}

function onDragHeight(event) {
  if (!draggingHeight) return;
  const delta = event.clientY - dragStartY;
  panelHeight.value = Math.max(200, Math.min(window.innerHeight - panelY.value, dragStartHeight + delta));
}

function stopDragHeight() {
  draggingHeight = false;
  document.removeEventListener('mousemove', onDragHeight);
  document.removeEventListener('mouseup', stopDragHeight);
}

function toggleCollapse() {
  collapsed.value = !collapsed.value;
}

function triggerImport() {
  if ((store.allRoutes.length || poiStore.pois.length || complianceStore.projects.length)
    && !window.confirm('导入备份会替换当前全部路线和收藏点，建议先导出当前数据。确定继续吗？')) return;
  importFileRef.value?.click();
}

function exportBackup() {
  store.exportData({
    pois: JSON.parse(JSON.stringify(poiStore.pois)),
    compliance: {
      version: 1,
      activeProjectId: complianceStore.activeProjectId,
      projects: JSON.parse(JSON.stringify(complianceStore.projects)),
    },
  });
}

function handleImportFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  store.importData(file, (backup) => {
    if (Array.isArray(backup.pois)) poiStore.replacePOIs(backup.pois);
    if (backup.compliance?.projects) complianceStore.replaceState(backup.compliance);
  });
  event.target.value = '';
}

function loadPanelLayout() {
  try {
    return JSON.parse(localStorage.getItem(PANEL_LAYOUT_KEY) || '{}');
  } catch {
    return {};
  }
}

function constrainPanelToViewport() {
  panelWidth.value = Math.min(window.innerWidth, Math.max(360, Math.min(760, panelWidth.value)));
  panelHeight.value = Math.max(240, Math.min(panelHeight.value, window.innerHeight - 16));
  panelX.value = Math.max(0, Math.min(panelX.value, window.innerWidth - panelWidth.value));
  panelY.value = Math.max(0, Math.min(panelY.value, window.innerHeight - 80));
}

function handleOpenWorkspace(event) {
  if (workspaceTabs.some(item => item.value === event.detail)) activeWorkspace.value = event.detail;
}

watch([panelX, panelY, panelWidth, panelHeight, collapsed, activeWorkspace], () => {
  localStorage.setItem(PANEL_LAYOUT_KEY, JSON.stringify({
    x: panelX.value,
    y: panelY.value,
    width: panelWidth.value,
    height: panelHeight.value,
    collapsed: collapsed.value,
    workspace: activeWorkspace.value,
  }));
});

onMounted(() => {
  constrainPanelToViewport();
  window.addEventListener('resize', constrainPanelToViewport);
  window.addEventListener('open-workspace', handleOpenWorkspace);
  store.hydrateMissingStats();
});

onUnmounted(() => {
  window.removeEventListener('resize', constrainPanelToViewport);
  window.removeEventListener('open-workspace', handleOpenWorkspace);
});
</script>
