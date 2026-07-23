<template>
  <n-card title="道路区域规划" size="small">
    <n-space vertical :size="10">
      <div v-if="store.complianceProjectId" class="compliance-link-banner">
        法规项目模式：生成并保存的路线会自动加入当前法规测试项目。
      </div>
      <div class="coverage-section">
        <div class="coverage-label">道路类型</div>
        <n-checkbox-group v-model:value="store.roadTypes">
          <n-space :size="6" wrap>
            <n-checkbox
              v-for="item in store.highwayTypeOptions"
              :key="item.value"
              :value="item.value"
              :label="item.label"
            />
          </n-space>
        </n-checkbox-group>
        <n-space align="center" :size="8" style="margin-top: 6px;">
          <span class="coverage-label">包含匝道</span>
          <n-switch v-model:value="store.includeLinks" size="small" />
        </n-space>
      </div>

      <div class="coverage-section">
        <div class="coverage-row">
          <span class="coverage-label">生成路线数量</span>
          <n-input-number
            v-model:value="store.routeCount"
            :min="4"
            :max="5"
            :step="1"
            size="small"
            style="width: 120px;"
          />
          <span class="coverage-unit">条</span>
        </div>
        <div class="coverage-row">
          <span class="coverage-label">每条路线目标里程</span>
          <n-input-number
            v-model:value="store.maxSegmentKm"
            :min="10"
            :max="150"
            :step="5"
            size="small"
            style="width: 120px;"
          />
          <span class="coverage-unit">km</span>
        </div>
        <div class="coverage-row">
          <span class="coverage-label">关键点最小间距</span>
          <n-input-number
            v-model:value="store.sampleSpacingMeters"
            :min="100"
            :max="1000"
            :step="50"
            size="small"
            style="width: 120px;"
          />
          <span class="coverage-unit">m</span>
        </div>
        <div class="coverage-hint">只保留指定数量的优质候选路线，优先路线长度、低重复和道路差异；未被选中的道路不再强求覆盖。</div>
      </div>

      <n-space>
        <n-button
          v-if="store.mode === 'idle' || store.mode === 'preview'"
          type="primary"
          @click="store.startDrawing"
        >绘制区域</n-button>
        <n-button
          v-else-if="store.mode === 'drawn'"
          @click="store.startDrawing"
        >重新绘制</n-button>
        <n-button
          v-if="store.mode === 'drawing'"
          @click="store.cancelDrawing"
        >取消绘制</n-button>
        <n-button
          v-if="store.mode !== 'idle'"
          quaternary
          @click="store.clearAll"
        >清空</n-button>
      </n-space>

      <div v-if="store.mode === 'drawing'" class="coverage-hint">
        单击添加顶点；双击、按 Enter 或点击首个顶点完成。Backspace 撤销，Esc 取消。绘制过程中仍可拖动和缩放地图。
        <div v-if="store.progress.phase === 'error'" class="coverage-warn">
          {{ store.progress.message }}
        </div>
      </div>
      <div v-else-if="store.polygon.length >= 3" class="coverage-hint">
        多边形 <strong>{{ store.polygon.length }}</strong> 个顶点
        · 实际面积约 <strong>{{ store.areaKm2.toFixed(1) }}</strong> km²
        · 软边界约 <strong>{{ store.edgeBufferMeters }}</strong> m
        <span v-if="store.queryAreaKm2 > store.areaLimitKm2" class="coverage-warn">
          （外接范围 {{ store.queryAreaKm2.toFixed(1) }} km²，超过查询上限 {{ store.areaLimitKm2 }} km²）</span>
      </div>

      <n-button
        v-if="store.mode === 'drawn'"
        type="primary"
        :disabled="!store.canGenerate"
        @click="store.generate"
      >生成精选路线</n-button>

      <div v-if="store.mode === 'generating'">
        <n-progress
          type="line"
          :percentage="store.progress.percent"
          :status="store.progress.phase === 'error' ? 'error' : 'default'"
        />
        <div class="coverage-hint">{{ store.progress.message }}</div>
        <n-button size="small" style="margin-top: 6px;" @click="store.abort">中断生成</n-button>
      </div>

      <div v-if="store.mode === 'preview'">
        <div class="coverage-preview-toolbar">
          <span class="coverage-label">候选路线：勾选决定是否保存，显示状态只影响地图</span>
          <n-space :size="4">
            <n-button size="tiny" @click="store.setAllSegmentsVisible(true)">全部显示</n-button>
            <n-button size="tiny" @click="store.setAllSegmentsVisible(false)">全部隐藏</n-button>
          </n-space>
        </div>
        <div class="coverage-stats">
          区域内道路 {{ formatKm(store.stats.insideCoveredMeters) }}
          · 框外衔接 {{ formatKm(store.stats.outsideMeters) }}
          · 综合重复率 {{ formatPercent(store.stats.duplicationRatio) }}
          · {{ store.stats.componentCount }} 个路网 · {{ store.previewSegments.length }} 条路线
          <span v-if="store.stats.omittedMeters > 0">
            · 未纳入 {{ formatKm(store.stats.omittedMeters) }}</span>
          <span v-if="store.stats.ignoredMeters > 0" class="coverage-warn">
            · 忽略碎片 {{ formatKm(store.stats.ignoredMeters) }}</span>
        </div>

        <n-list bordered size="small" style="margin-top: 8px;">
          <n-list-item v-for="segment in store.previewSegments" :key="segment.id">
            <div class="coverage-segment-row">
              <n-checkbox
                :checked="segment.selected"
                title="是否保存该路线"
                @update:checked="store.toggleSegmentSelected(segment.id)"
              />
              <span class="coverage-color-dot" :style="{ background: segment.color }"></span>
              <span class="coverage-segment-name">{{ segment.name }}</span>
              <span class="coverage-segment-meta">
                {{ formatKm(segment.stats?.distance || segment.estimatedMeters) }}
                <span v-if="segment.deadheadMeters + (segment.crossOverlapMeters || 0) > 0">
                  · 重复 {{ formatKm(segment.deadheadMeters + (segment.crossOverlapMeters || 0)) }}
                </span>
                <span v-if="segment.outsideMeters > 0">
                  · 区域外 {{ formatKm(segment.outsideMeters) }}
                </span>
                <span v-for="item in segmentRoadTypes(segment)" :key="item.type">
                  · {{ item.label }} {{ formatKm(item.distance) }}
                </span>
                <span v-if="segment.warning" class="coverage-warn"> · {{ segment.warning }}</span>
              </span>
              <n-button size="tiny" quaternary @click="store.toggleSegmentVisible(segment.id)">
                {{ segment.visible === false ? '显示' : '隐藏' }}
              </n-button>
              <n-button size="tiny" quaternary @click="store.showOnlySegment(segment.id)">仅看</n-button>
              <n-button size="tiny" quaternary @click="store.locateSegment(segment.id)">定位</n-button>
            </div>
          </n-list-item>
        </n-list>

        <div class="coverage-row" style="margin-top: 10px;">
          <span class="coverage-label">保存到分组</span>
          <n-select
            v-model:value="saveGroupId"
            :options="groupOptions"
            size="small"
            style="flex: 1;"
          />
        </div>
        <n-space style="margin-top: 8px;">
          <n-button type="primary" :disabled="selectedCount === 0" @click="handleSave">保存选中 {{ selectedCount }} 条</n-button>
          <n-button @click="store.clearAll">放弃</n-button>
        </n-space>
      </div>
    </n-space>
  </n-card>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useCoveragePlannerStore } from '../stores/coveragePlanner.js';
import { useRoutePlannerStore } from '../stores/routePlanner.js';
import { formatKm, formatPercent } from '../services/utils.js';

const store = useCoveragePlannerStore();
const routeStore = useRoutePlannerStore();
const { groups } = storeToRefs(routeStore);
const saveGroupId = ref(groups.value[0]?.id || null);

const groupOptions = computed(() =>
  groups.value.map(group => ({ label: group.name, value: group.id }))
);

const selectedCount = computed(() =>
  store.previewSegments.filter(segment => segment.selected).length
);

watch(groups, next => {
  if (!next.some(group => group.id === saveGroupId.value)) {
    saveGroupId.value = next[0]?.id || null;
  }
});

function handleSave() {
  if (!saveGroupId.value) return;
  store.saveSelected(saveGroupId.value);
}

function segmentRoadTypes(segment) {
  const labels = {
    motorway: '高速', trunk: '快速路', primary: '主干道', secondary: '次干道',
    tertiary: '支路', residential: '居住区道路', unclassified: '未分类', other: '其他',
  };
  return Object.entries(segment.roadTypeDistances || {})
    .filter(([, distance]) => distance > 0)
    .map(([type, distance]) => ({
      type,
      label: labels[type.replace(/_link$/, '')] || type,
      distance,
    }))
    .sort((a, b) => b.distance - a.distance)
    .slice(0, 2);
}
</script>

<style scoped>
.coverage-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.compliance-link-banner {
  padding: 8px 10px;
  border: 1px solid #9bc2f3;
  border-radius: 8px;
  background: #eff6ff;
  color: #174c8f;
  font-size: 11px;
  line-height: 1.5;
}

.coverage-label {
  font-size: 12px;
  color: #666;
}

.coverage-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.coverage-unit {
  font-size: 12px;
  color: #999;
}

.coverage-hint {
  font-size: 12px;
  color: #888;
  line-height: 1.5;
}

.coverage-warn {
  color: #d03050;
}

.coverage-stats {
  font-size: 12px;
  color: #555;
  line-height: 1.6;
}

.coverage-preview-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.coverage-segment-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
  font-size: 12px;
}

.coverage-color-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
}

.coverage-segment-name {
  flex: 1;
}

.coverage-segment-meta {
  color: #888;
  font-size: 11px;
}
</style>
