<template>
  <div class="poi-editor">
    <n-card title="特殊场景管理" size="small">
      <template #header-extra>
        <n-button size="tiny" @click="showAddDialog = true">+ 添加</n-button>
      </template>

      <n-scrollbar style="max-height: 400px">
        <div class="poi-list">
          <div v-for="poi in pois" :key="poi.id" class="poi-item">
            <div class="poi-info">
              <n-checkbox :checked="poi.visible" @update:checked="poiStore.togglePOI(poi.id)" />
              <div class="poi-details">
                <div class="poi-name">{{ poi.name }}</div>
                <div class="poi-meta">
                  <n-tag :color="poi.color" size="tiny">{{ poi.type }}</n-tag>
                  <span class="poi-coords">{{ poi.lat.toFixed(4) }}, {{ poi.lon.toFixed(4) }}</span>
                </div>
                <div v-if="poi.description" class="poi-description">{{ poi.description }}</div>
              </div>
            </div>
            <div class="poi-actions">
              <n-button size="tiny" quaternary @click="locatePOI(poi)">
                <template #icon><n-icon><Location /></n-icon></template>
              </n-button>
              <n-button size="tiny" quaternary @click="editPOI(poi)">
                <template #icon><n-icon><CreateOutline /></n-icon></template>
              </n-button>
              <n-button size="tiny" quaternary type="error" @click="poiStore.removePOI(poi.id)">
                <template #icon><n-icon><TrashOutline /></n-icon></template>
              </n-button>
            </div>
          </div>
          <div v-if="!pois.length" class="poi-empty">
            还没有添加特殊场景，点击右上角"添加"按钮开始添加停车场、加油站等位置。
          </div>
        </div>
      </n-scrollbar>
    </n-card>

    <!-- 添加/编辑对话框 -->
    <n-modal v-model:show="showAddDialog" preset="dialog" :title="editingPOI ? '编辑位置' : '添加位置'">
      <n-form>
        <n-form-item label="名称">
          <n-input v-model:value="formData.name" placeholder="例如：慕尼黑机场停车场" />
        </n-form-item>
        <n-form-item label="类型">
          <n-select v-model:value="formData.type" :options="poiTypes" />
        </n-form-item>
        <n-form-item label="坐标">
          <n-space>
            <n-input v-model:value="formData.lat" placeholder="纬度" type="number" style="width: 120px" />
            <n-input v-model:value="formData.lon" placeholder="经度" type="number" style="width: 120px" />
            <n-button @click="useCurrentLocation">使用当前位置</n-button>
          </n-space>
        </n-form-item>
        <n-form-item label="描述（可选）">
          <n-input v-model:value="formData.description" type="textarea" placeholder="例如：可容纳500辆车，24小时开放" />
        </n-form-item>
        <n-form-item label="颜色">
          <n-color-picker v-model:value="formData.color" :show-alpha="false" />
        </n-form-item>
      </n-form>
      <template #action>
        <n-button @click="cancelEdit">取消</n-button>
        <n-button type="primary" @click="savePOI">保存</n-button>
      </template>
    </n-modal>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { usePOIStore } from '../stores/poi.js';
import { Location, CreateOutline, TrashOutline } from '@vicons/ionicons5';
import { NIcon } from 'naive-ui';

const poiStore = usePOIStore();
const pois = computed(() => poiStore.pois);

const showAddDialog = ref(false);
const editingPOI = ref(null);
const formData = ref({
  name: '',
  type: 'parking',
  lat: '',
  lon: '',
  description: '',
  color: '#FF9800',
});

const poiTypes = [
  { label: '停车场', value: 'parking' },
  { label: '加油站', value: 'gas' },
  { label: '休息区', value: 'rest' },
  { label: '景点', value: 'attraction' },
  { label: '酒店', value: 'hotel' },
  { label: '餐厅', value: 'restaurant' },
  { label: '其他', value: 'other' },
];

function editPOI(poi) {
  editingPOI.value = poi;
  formData.value = { ...poi };
  showAddDialog.value = true;
}

function cancelEdit() {
  editingPOI.value = null;
  formData.value = { name: '', type: 'parking', lat: '', lon: '', description: '', color: '#FF9800' };
  showAddDialog.value = false;
}

function savePOI() {
  if (!formData.value.name || !formData.value.lat || !formData.value.lon) {
    alert('请填写名称和坐标');
    return;
  }

  const poi = {
    name: formData.value.name,
    type: formData.value.type,
    lat: parseFloat(formData.value.lat),
    lon: parseFloat(formData.value.lon),
    description: formData.value.description,
    color: formData.value.color,
  };

  if (editingPOI.value) {
    poiStore.updatePOI(editingPOI.value.id, poi);
  } else {
    poiStore.addPOI(poi);
  }

  cancelEdit();
}

function locatePOI(poi) {
  // 发射事件，让 MapCanvas 定位到这个 POI
  window.dispatchEvent(new CustomEvent('locate-poi', { detail: poi }));
}

function useCurrentLocation() {
  if (!navigator.geolocation) {
    alert('浏览器不支持定位');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      formData.value.lat = pos.coords.latitude.toFixed(6);
      formData.value.lon = pos.coords.longitude.toFixed(6);
    },
    (err) => {
      alert('定位失败: ' + err.message);
    }
  );
}
</script>

<style scoped>
.poi-editor {
  margin-top: 12px;
}

.poi-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.poi-item {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 8px;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
}

.poi-info {
  display: flex;
  gap: 8px;
  flex: 1;
}

.poi-details {
  flex: 1;
}

.poi-name {
  font-weight: 500;
  margin-bottom: 4px;
}

.poi-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.poi-coords {
  color: #666;
}

.poi-description {
  font-size: 12px;
  color: #666;
  margin-top: 4px;
}

.poi-actions {
  display: flex;
  gap: 4px;
}

.poi-empty {
  text-align: center;
  color: #999;
  padding: 20px;
}
</style>
