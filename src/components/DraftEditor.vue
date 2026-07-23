<template>
  <n-card title="路线编辑" size="small">
    <n-space vertical>
      <n-input v-model:value="draft.name" placeholder="例如：德国南北干线" />
      <div class="draft-group-select">
        <span class="draft-group-label">保存到分组</span>
        <n-select v-model:value="draft.groupId" :options="groupOptions" placeholder="选择分组" size="small" />
      </div>
      <n-input v-model:value="searchText" placeholder="输入城市名，或输入 纬度,经度" @input="handleSearch" />
      <div class="suggestion-list" v-if="suggestions.length">
        <button v-for="item in suggestions" :key="`${item.name}-${item.lat}-${item.lon}`" class="suggestion-button" @click="pickSuggestion(item)">
          <span>{{ item.name }}</span>
          <small>{{ item.source }}</small>
        </button>
      </div>
      <n-space>
        <n-button type="primary" @click="toggleMapPick">{{ mapPickEnabled ? '退出点选' : '地图点选' }}</n-button>
        <n-button :loading="saving" @click="handleSave">保存路线</n-button>
        <n-button @click="store.resetDraft">清空草稿</n-button>
      </n-space>
      <div class="helper-text">{{ mapPickEnabled ? '点选模式已开启：点击地图任意位置即可加入途径点。' : '开启地图点选后，可直接在地图上点击加入途径点。' }}</div>
      <n-list bordered>
        <n-list-item v-for="(stop, index) in draft.stops" :key="`${stop.name}-${index}`">
          <div class="stop-row">
            <div>{{ index + 1 }}. {{ stop.name }}</div>
            <n-space>
              <n-button size="tiny" @click="store.moveDraftStopUp(index)">↑</n-button>
              <n-button size="tiny" @click="store.moveDraftStopDown(index)">↓</n-button>
              <n-button size="tiny" type="error" @click="store.removeDraftStop(index)">删除</n-button>
            </n-space>
          </div>
        </n-list-item>
      </n-list>
    </n-space>
  </n-card>
</template>

<script setup>
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoutePlannerStore } from '../stores/routePlanner.js';

const store = useRoutePlannerStore();
const { draft, mapPickEnabled, groups } = storeToRefs(store);
const searchText = ref('');
const suggestions = ref([]);
const saving = ref(false);

const groupOptions = computed(() =>
  groups.value.map(group => ({ label: group.name, value: group.id }))
);

function handleSearch() {
  suggestions.value = searchText.value.trim() ? store.localSuggest(searchText.value) : [];
}

function pickSuggestion(item) {
  store.addStopToDraft(item);
  searchText.value = '';
  suggestions.value = [];
}

function toggleMapPick() {
  mapPickEnabled.value = !mapPickEnabled.value;
}

async function handleSave() {
  saving.value = true;
  try {
    await store.saveDraftRoute();
  } catch (error) {
    store.setStatus(`保存异常：${error.message}`);
  } finally {
    saving.value = false;
  }
}
</script>
