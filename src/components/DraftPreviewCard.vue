<template>
  <n-card size="small" title="草稿预览" class="draft-preview-card">
    <template v-if="!draft.stops.length">
      <n-empty description="还没有预览内容，请先添加点位。" size="small" />
    </template>
    <template v-else-if="draft.stops.length === 1">
      <div class="draft-preview-line"><strong>当前点位：</strong>1 个</div>
      <div class="draft-preview-line">地图已显示预览点，再加 1 个点即可自动生成路线。</div>
    </template>
    <template v-else-if="draftPreview.loading">
      <div class="draft-preview-line"><strong>当前点位：</strong>{{ draft.stops.length }} 个</div>
      <div class="draft-preview-line">正在计算草稿路线预览...</div>
      <a v-if="draftGoogleUrl" :href="draftGoogleUrl" target="_blank" rel="noopener" class="nav-link">
        Google 导航 ↗
      </a>
    </template>
    <template v-else-if="draftPreview.warning">
      <div class="draft-preview-line"><strong>当前点位：</strong>{{ draft.stops.length }} 个</div>
      <div class="draft-preview-error">{{ draftPreview.warning }}</div>
      <a v-if="draftGoogleUrl" :href="draftGoogleUrl" target="_blank" rel="noopener" class="nav-link">
        Google 导航 ↗
      </a>
    </template>
    <template v-else-if="draftPreview.stats">
      <div class="draft-preview-line"><strong>当前点位：</strong>{{ draft.stops.length }} 个</div>
      <div class="draft-preview-line"><strong>总里程：</strong>{{ formatKm(draftPreview.stats.distance) }}</div>
      <div class="draft-preview-line"><strong>预计时间：</strong>{{ formatHours(draftPreview.stats.duration) }}</div>
      <div class="draft-preview-grid">
        <div class="metric-chip"><strong>高速</strong>{{ formatKm(draftPreview.stats.motorwayDistance) }} · {{ formatPercent(draftPreview.stats.share.motorway) }}</div>
        <div class="metric-chip"><strong>城市</strong>{{ formatKm(draftPreview.stats.urbanDistance) }} · {{ formatPercent(draftPreview.stats.share.urban) }}</div>
        <div class="metric-chip"><strong>普通道路</strong>{{ formatKm(draftPreview.stats.ruralDistance) }} · {{ formatPercent(draftPreview.stats.share.rural) }}</div>
        <div class="metric-chip"><strong>主要道路段</strong>{{ buildTopRoadsText(draftPreview.stats) }}</div>
      </div>
      <a v-if="draftGoogleUrl" :href="draftGoogleUrl" target="_blank" rel="noopener" class="nav-link">
        Google 导航 ↗
      </a>
    </template>
  </n-card>
</template>

<script setup>
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoutePlannerStore } from '../stores/routePlanner.js';
import { buildGoogleMapsUrl, buildTopRoadsText } from '../services/routing.js';
import { formatHours, formatKm, formatPercent } from '../services/utils.js';

const store = useRoutePlannerStore();
const { draft, draftPreview } = storeToRefs(store);

const draftGoogleUrl = computed(() => draft.value.stops.length >= 2 ? buildGoogleMapsUrl(draft.value.stops) : '');
</script>
