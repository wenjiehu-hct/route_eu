import { ref, computed } from 'vue';
import { defineStore } from 'pinia';
import { createId } from '../services/utils.js';

export const usePOIStore = defineStore('poi', () => {
  const pois = ref(loadPOIs());

  const visiblePOIs = computed(() => pois.value.filter(poi => poi.visible));

  function persist() {
    localStorage.setItem('routePlannerPOIs', JSON.stringify(pois.value));
  }

  function loadPOIs() {
    try {
      const data = localStorage.getItem('routePlannerPOIs');
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  function addPOI(poi) {
    pois.value.push({
      id: createId('poi'),
      visible: true,
      color: '#FF9800',
      ...poi,
    });
    persist();
  }

  function updatePOI(id, updates) {
    const index = pois.value.findIndex(p => p.id === id);
    if (index !== -1) {
      pois.value[index] = { ...pois.value[index], ...updates };
      persist();
    }
  }

  function removePOI(id) {
    pois.value = pois.value.filter(p => p.id !== id);
    persist();
  }

  function togglePOI(id) {
    const poi = pois.value.find(p => p.id === id);
    if (poi) {
      poi.visible = !poi.visible;
      persist();
    }
  }

  function replacePOIs(nextPOIs) {
    pois.value = Array.isArray(nextPOIs) ? nextPOIs : [];
    persist();
  }

  return {
    pois,
    visiblePOIs,
    addPOI,
    updatePOI,
    removePOI,
    togglePOI,
    replacePOIs,
  };
});
