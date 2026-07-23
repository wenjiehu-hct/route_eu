import { create } from 'zustand';
import { createId } from '../services/utils.js';

const STORAGE_KEY = 'routePlannerPOIs';

export const usePOIStore = create((set, get) => ({
  pois: loadPOIs(),
  addPOI: poi => commit(set, [...get().pois, { id: createId('poi'), visible: true, color: '#f59e0b', ...poi }]),
  updatePOI: (id, updates) => commit(set, get().pois.map(poi => poi.id === id ? { ...poi, ...updates } : poi)),
  removePOI: id => commit(set, get().pois.filter(poi => poi.id !== id)),
  togglePOI: id => commit(set, get().pois.map(poi => poi.id === id ? { ...poi, visible: !poi.visible } : poi)),
  replacePOIs: pois => commit(set, Array.isArray(pois) ? pois : []),
}));

function loadPOIs() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

function commit(set, pois) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pois));
  set({ pois });
}

