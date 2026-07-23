<template>
  <div ref="mapRef" class="map-canvas"></div>
  <div class="map-controls">
    <n-select
      v-model:value="selectedBaseMapKey"
      :options="baseMapOptions"
      size="small"
      class="base-map-select"
      @update:value="switchBaseMap"
    />
    <n-button-group>
      <n-button size="small" @click="toggleStopLabels" :type="showStopLabels ? 'default' : 'primary'">
        {{ showStopLabels ? '隐藏名称' : '显示名称' }}
      </n-button>
      <n-button size="small" @click="toggleLocation" :type="tracking ? 'primary' : 'default'">
        <template #icon>
          <n-icon><Location /></n-icon>
        </template>
        {{ tracking ? '关闭定位' : '我的位置' }}
      </n-button>
    </n-button-group>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import L from 'leaflet';
import { NButton, NButtonGroup, NIcon, NSelect } from 'naive-ui';
import { Location } from '@vicons/ionicons5';
import { useRoutePlannerStore } from '../stores/routePlanner.js';
import { usePOIStore } from '../stores/poi.js';
import { useCoveragePlannerStore } from '../stores/coveragePlanner.js';
import { EUROPE_BOUNDS } from '../constants/routes.js';

const store = useRoutePlannerStore();
const poiStore = usePOIStore();
const coverageStore = useCoveragePlannerStore();
const { groups, visibleRoutes, draft, draftPreview, mapPickEnabled, activeRouteId } = storeToRefs(store);
const { visiblePOIs } = storeToRefs(poiStore);
const {
  mode: coverageMode,
  polygon: coveragePolygon,
  previewSegments: coveragePreviewSegments,
} = storeToRefs(coverageStore);
const baseMaps = {
  esriStreet: {
    label: 'Esri 街道',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    options: { maxZoom: 19, attribution: 'Tiles © Esri' },
  },
  osmStandard: {
    label: 'OSM 标准',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: { maxZoom: 19, attribution: '© OpenStreetMap contributors' },
  },
  cartoLight: {
    label: 'Carto 浅色',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    options: { maxZoom: 20, subdomains: 'abcd', attribution: '© OpenStreetMap contributors © CARTO' },
  },
  cartoDark: {
    label: 'Carto 深色',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    options: { maxZoom: 20, subdomains: 'abcd', attribution: '© OpenStreetMap contributors © CARTO' },
  },
  cartoVoyager: {
    label: 'Carto Voyager',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    options: { maxZoom: 20, subdomains: 'abcd', attribution: '© OpenStreetMap contributors © CARTO' },
  },
  esriTopo: {
    label: 'Esri 地形',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    options: { maxZoom: 19, attribution: 'Tiles © Esri' },
  },
  esriImagery: {
    label: 'Esri 卫星',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: { maxZoom: 19, attribution: 'Tiles © Esri' },
  },
  opentopo: {
    label: 'OpenTopo 地形',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    options: { maxZoom: 17, subdomains: 'abc', attribution: '© OpenStreetMap contributors, SRTM | © OpenTopoMap' },
  },
};

const baseMapOptions = Object.entries(baseMaps).map(([value, item]) => ({ label: item.label, value }));
const mapRef = ref(null);
const tracking = ref(false);
const showStopLabels = ref(localStorage.getItem('routePlannerVue.showStopLabels') !== 'false');
const selectedBaseMapKey = ref(
  baseMaps[localStorage.getItem('routePlannerVue.baseMap')]
    ? localStorage.getItem('routePlannerVue.baseMap')
    : 'esriStreet'
);

let map;
let baseLayer;
let routeLayer;
let markerLayer;
let draftRouteLayer;
let draftMarkerLayer;
let poiLayer;
let locationLayer;
let locationMarker;
let locationCircle;
let coverageBoxLayer;
let coveragePreviewLayer;
let watchId = null;

let drawPoints = [];
let drawPolygonLayer = null;
let drawGuideLayer = null;
let drawVertexLayer = null;
let escHandler = null;

function drawMarkers(layer, stops, color, context) {
  stops.forEach((stop, index) => {
    const isEndpoint = index === 0 || index === stops.length - 1;
    const size = isEndpoint ? 16 : 12;
    const half = size / 2;

    const icon = L.divIcon({
      html: `<div style="width:${size}px;height:${size}px;border-radius:50%;border:2px solid ${color};background:#fff;cursor:grab;box-shadow:0 1px 3px rgba(0,0,0,.18);"></div>`,
      className: 'drag-dot',
      iconSize: [size, size],
      iconAnchor: [half, half],
    });

    const marker = L.marker([stop.lat, stop.lon], { icon, draggable: true });

    if (showStopLabels.value) {
      marker.bindTooltip(stop.name, {
        permanent: true,
        direction: 'top',
        offset: [0, -(half + 4)],
        className: 'stop-label',
      });
    }

    marker.addTo(layer);

    marker.on('dragend', () => {
      const { lat, lng: lon } = marker.getLatLng();
      if (context.isDraft) {
        store.updateDraftStopCoords(index, lat, lon);
      } else if (context.routeId) {
        store.updateRouteStopCoords(context.routeId, index, lat, lon);
      }
    });
  });
}

function drawPOIs() {
  if (!map) return;
  poiLayer.clearLayers();

  visiblePOIs.value.forEach(poi => {
    const icon = L.divIcon({
      html: `<div style="width:24px;height:24px;border-radius:50%;border:3px solid ${poi.color};background:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:bold;box-shadow:0 2px 4px rgba(0,0,0,.3);">P</div>`,
      className: 'poi-icon',
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });

    const marker = L.marker([poi.lat, poi.lon], { icon })
      .bindPopup(`
        <div style="min-width:200px">
          <h4 style="margin:0 0 8px 0">${poi.name}</h4>
          <div style="margin-bottom:4px"><strong>类型:</strong> ${getPOITypeLabel(poi.type)}</div>
          <div style="margin-bottom:4px"><strong>坐标:</strong> ${poi.lat.toFixed(5)}, ${poi.lon.toFixed(5)}</div>
          ${poi.description ? `<div style="margin-top:8px;color:#666">${poi.description}</div>` : ''}
        </div>
      `)
      .addTo(poiLayer);
  });
}

function getPOITypeLabel(type) {
  const labels = {
    parking: '停车场',
    gas: '加油站',
    rest: '休息区',
    attraction: '景点',
    hotel: '酒店',
    restaurant: '餐厅',
    other: '其他',
  };
  return labels[type] || type;
}

function createBaseLayer(key) {
  const item = baseMaps[key] || baseMaps.esriStreet;
  return L.tileLayer(item.url, {
    crossOrigin: true,
    ...item.options,
  });
}

function switchBaseMap(key) {
  selectedBaseMapKey.value = key;
  localStorage.setItem('routePlannerVue.baseMap', key);
  if (!map) return;
  if (baseLayer) baseLayer.remove();
  baseLayer = createBaseLayer(key).addTo(map);
  store.setStatus(`已切换底图：${baseMaps[key]?.label || baseMaps.esriStreet.label}`);
}

function redraw() {
  if (!map) return;
  routeLayer.clearLayers();
  markerLayer.clearLayers();
  draftRouteLayer.clearLayers();
  draftMarkerLayer.clearLayers();

  visibleRoutes.value.forEach(route => {
    const isActive = route.id === activeRouteId.value;
    if (isActive) drawMarkers(markerLayer, route.stops, route.color, { routeId: route.id });
    if (route.stats?.geometry?.length) {
      const latLngs = route.stats.geometry.map(([lon, lat]) => [lat, lon]);
      addInteractiveRouteLine(routeLayer, latLngs, {
        color: route.color,
        weight: isActive ? 7 : 4,
        opacity: activeRouteId.value ? (isActive ? 1 : 0.5) : 0.82,
      }, route.name, () => store.selectRoute(route.id));
    } else if (route.stops.length >= 2) {
      addInteractiveRouteLine(routeLayer, route.stops.map(stop => [stop.lat, stop.lon]), {
        color: route.color,
        weight: isActive ? 7 : 4,
        opacity: activeRouteId.value ? (isActive ? 1 : 0.45) : 0.7,
        dashArray: '8 8',
      }, route.name, () => store.selectRoute(route.id));
    }
  });

  if (draft.value.stops.length) {
    drawMarkers(draftMarkerLayer, draft.value.stops, '#3b82f6', { isDraft: true });
    if (draftPreview.value.stats?.geometry?.length) {
      const latLngs = draftPreview.value.stats.geometry.map(([lon, lat]) => [lat, lon]);
      L.polyline(latLngs, { color: '#3b82f6', weight: 5, opacity: 0.92 }).addTo(draftRouteLayer);
    } else if (draft.value.stops.length >= 2) {
      L.polyline(draft.value.stops.map(stop => [stop.lat, stop.lon]), { color: '#3b82f6', weight: 4, opacity: 0.82, dashArray: '8 8' }).addTo(draftRouteLayer);
    }
  }

  drawPOIs();
  drawCoverage();
}

function addInteractiveRouteLine(layer, latLngs, options, label, onClick = null) {
  const line = L.polyline(latLngs, options).addTo(layer);
  if (label) line.bindTooltip(label, { sticky: true, direction: 'top' });
  line.on('mouseover', () => line.setStyle({ weight: options.weight + 2, opacity: 1 }));
  line.on('mouseout', () => line.setStyle({ weight: options.weight, opacity: options.opacity }));
  if (onClick) {
    line.on('click', event => {
      if (event.originalEvent) L.DomEvent.stopPropagation(event.originalEvent);
      onClick(event);
    });
  }
  return line;
}

function drawCoverage() {
  if (!map) return;
  if (coverageBoxLayer) coverageBoxLayer.clearLayers();
  if (coveragePreviewLayer) coveragePreviewLayer.clearLayers();
  if (!coverageMode.value || coverageMode.value === 'idle') return;
  if (coverageMode.value === 'drawing') return;

  if (coveragePolygon.value.length >= 3) {
    L.polygon(
      coveragePolygon.value.map(point => [point.lat, point.lon]),
      {
        color: '#f59e0b',
        weight: 2,
        fillColor: '#f59e0b',
        fillOpacity: 0.08,
      }
    ).addTo(coverageBoxLayer);
  }

  coveragePreviewSegments.value.filter(segment => segment.visible !== false).forEach(segment => {
    const latLngs = segment.stats?.geometry?.length
      ? segment.stats.geometry.map(([lon, lat]) => [lat, lon])
      : segment.stops.map(stop => [stop.lat, stop.lon]);
    const isReal = !!segment.stats?.geometry?.length;
    addInteractiveRouteLine(coveragePreviewLayer, latLngs, {
      color: segment.color,
      weight: 5,
      opacity: segment.selected ? 0.9 : 0.35,
      dashArray: isReal ? undefined : '8 8',
    }, segment.name);

    if (segment.stops.length) {
      const first = segment.stops[0];
      const last = segment.stops[segment.stops.length - 1];
      addCoverageEndpoint(first, 'S', segment.color);
      addCoverageEndpoint(last, 'E', segment.color);
    }
  });
}

function addCoverageEndpoint(stop, label, color) {
  const icon = L.divIcon({
    html: `<div style="width:18px;height:18px;border-radius:50%;border:2px solid #fff;background:${color};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:bold;color:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);">${label}</div>`,
    className: 'coverage-endpoint',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
  L.marker([stop.lat, stop.lon], { icon }).addTo(coveragePreviewLayer);
}

function enableCoverageDrawing() {
  if (!map) return;
  disableCoverageDrawing();
  map.doubleClickZoom.disable();
  map.getContainer().style.cursor = 'crosshair';
  drawPoints = [];
  drawPolygonLayer = L.polygon([], {
    color: '#f59e0b',
    weight: 2,
    dashArray: '6 4',
    fillColor: '#f59e0b',
    fillOpacity: 0.10,
  }).addTo(coverageBoxLayer);
  drawGuideLayer = L.polyline([], {
    color: '#f59e0b',
    weight: 2,
    dashArray: '4 6',
    opacity: 0.8,
  }).addTo(coverageBoxLayer);
  drawVertexLayer = L.layerGroup().addTo(coverageBoxLayer);

  escHandler = (event) => {
    if (event.key === 'Escape') {
      coverageStore.cancelDrawing();
    } else if (event.key === 'Enter') {
      finishCoveragePolygon();
    } else if (event.key === 'Backspace' && drawPoints.length) {
      event.preventDefault();
      drawPoints.pop();
      renderCoverageDraft();
    }
  };
  document.addEventListener('keydown', escHandler);

  map.on('click', onCoveragePolygonClick);
  map.on('mousemove', onCoveragePolygonMove);
  map.on('dblclick', finishCoveragePolygon);
}

function disableCoverageDrawing() {
  if (!map) return;
  map.doubleClickZoom.enable();
  map.getContainer().style.cursor = '';
  map.off('click', onCoveragePolygonClick);
  map.off('mousemove', onCoveragePolygonMove);
  map.off('dblclick', finishCoveragePolygon);
  if (escHandler) {
    document.removeEventListener('keydown', escHandler);
    escHandler = null;
  }
  drawPoints = [];
  drawPolygonLayer = null;
  drawGuideLayer = null;
  drawVertexLayer = null;
}

function onCoveragePolygonClick(event) {
  if (drawPoints.length >= 3) {
    const firstPixel = map.latLngToContainerPoint(drawPoints[0]);
    const clickPixel = map.latLngToContainerPoint(event.latlng);
    if (firstPixel.distanceTo(clickPixel) <= 14) {
      finishCoveragePolygon();
      return;
    }
  }
  drawPoints.push(event.latlng);
  renderCoverageDraft();
}

function onCoveragePolygonMove(event) {
  if (!drawPoints.length || !drawPolygonLayer || !drawGuideLayer) return;
  drawPolygonLayer.setLatLngs([...drawPoints, event.latlng]);
  drawGuideLayer.setLatLngs([drawPoints.at(-1), event.latlng]);
}

function renderCoverageDraft() {
  if (!drawPolygonLayer || !drawGuideLayer || !drawVertexLayer) return;
  drawPolygonLayer.setLatLngs(drawPoints);
  drawGuideLayer.setLatLngs([]);
  drawVertexLayer.clearLayers();
  drawPoints.forEach((point, index) => {
    L.circleMarker(point, {
      interactive: false,
      radius: index === 0 ? 6 : 4,
      color: '#fff',
      weight: 2,
      fillColor: index === 0 ? '#d97706' : '#f59e0b',
      fillOpacity: 1,
    }).addTo(drawVertexLayer);
  });
}

function finishCoveragePolygon(event) {
  event?.originalEvent && L.DomEvent.stop(event.originalEvent);
  const points = dedupeDrawPoints(drawPoints);
  if (points.length < 3) {
    store.setStatus('多边形至少需要 3 个顶点。');
    return;
  }
  if (!coverageStore.setPolygon(points.map(point => ({ lat: point.lat, lon: point.lng })))) {
    store.setStatus('多边形存在自相交，请按 Backspace 撤销顶点后重试。');
  }
}

function dedupeDrawPoints(points) {
  const result = [];
  points.forEach(point => {
    const previous = result.at(-1);
    if (!previous || map.latLngToContainerPoint(previous).distanceTo(map.latLngToContainerPoint(point)) > 4) {
      result.push(point);
    }
  });
  return result;
}

function locateCoverageBounds(bounds) {
  if (map && bounds) {
    map.fitBounds(
      [
        [bounds.south, bounds.west],
        [bounds.north, bounds.east],
      ],
      { padding: [40, 40] }
    );
  }
}

function toggleStopLabels() {
  showStopLabels.value = !showStopLabels.value;
  localStorage.setItem('routePlannerVue.showStopLabels', String(showStopLabels.value));
  redraw();
}

function toggleLocation() {
  if (tracking.value) {
    stopTracking();
  } else {
    startTracking();
  }
}

function startTracking() {
  if (!navigator.geolocation) {
    alert('浏览器不支持定位');
    return;
  }

  tracking.value = true;
  store.setStatus('正在获取位置...');

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude: lat, longitude: lon, accuracy } = pos.coords;
      updateLocationMarker(lat, lon, accuracy);
      store.setStatus(`当前位置: ${lat.toFixed(5)}, ${lon.toFixed(5)} (精度: ${Math.round(accuracy)}m)`);
    },
    (err) => {
      store.setStatus(`定位失败: ${err.message}`);
      stopTracking();
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    }
  );
}

function stopTracking() {
  tracking.value = false;
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  if (locationMarker) {
    locationMarker.remove();
    locationMarker = null;
  }
  if (locationCircle) {
    locationCircle.remove();
    locationCircle = null;
  }
  store.setStatus('已关闭定位');
}

function updateLocationMarker(lat, lon, accuracy) {
  const latlng = L.latLng(lat, lon);

  if (!locationMarker) {
    const icon = L.divIcon({
      html: '<div style="width:16px;height:16px;border-radius:50%;background:#4285f4;border:3px solid #fff;box-shadow:0 0 0 2px #4285f4,0 2px 4px rgba(0,0,0,.3);"></div>',
      className: 'location-dot',
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
    locationMarker = L.marker(latlng, { icon, zIndexOffset: 1000 }).addTo(locationLayer);
  } else {
    locationMarker.setLatLng(latlng);
  }

  if (!locationCircle) {
    locationCircle = L.circle(latlng, {
      radius: accuracy,
      color: '#4285f4',
      fillColor: '#4285f4',
      fillOpacity: 0.1,
      weight: 1,
    }).addTo(locationLayer);
  } else {
    locationCircle.setLatLng(latlng);
    locationCircle.setRadius(accuracy);
  }
}

function locatePOI(poi) {
  if (map) {
    map.setView([poi.lat, poi.lon], 15);
  }
}

function handleLocatePOI(event) {
  locatePOI(event.detail);
}

function handleLocateBounds(event) {
  locateCoverageBounds(event.detail);
}

onMounted(() => {
  map = L.map(mapRef.value, { preferCanvas: false }).fitBounds(EUROPE_BOUNDS, { padding: [20, 20] });
  baseLayer = createBaseLayer(selectedBaseMapKey.value).addTo(map);
  routeLayer = L.featureGroup().addTo(map);
  markerLayer = L.featureGroup().addTo(map);
  draftRouteLayer = L.featureGroup().addTo(map);
  draftMarkerLayer = L.featureGroup().addTo(map);
  poiLayer = L.featureGroup().addTo(map);
  locationLayer = L.featureGroup().addTo(map);
  coverageBoxLayer = L.featureGroup().addTo(map);
  coveragePreviewLayer = L.featureGroup().addTo(map);

  map.on('click', event => {
    if (coverageMode.value === 'drawing') return;
    if (!mapPickEnabled.value) return;
    store.addStopToDraft({
      name: `地图点 ${draft.value.stops.length + 1} (${event.latlng.lat.toFixed(5)}, ${event.latlng.lng.toFixed(5)})`,
      lat: event.latlng.lat,
      lon: event.latlng.lng,
    });
    store.setStatus('已从地图添加途径点。');
  });

  // 监听 POI 定位事件
  window.addEventListener('locate-poi', handleLocatePOI);

  window.addEventListener('locate-coverage-bounds', handleLocateBounds);
  window.addEventListener('locate-route-bounds', handleLocateBounds);

  redraw();
});

onUnmounted(() => {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
  }
  disableCoverageDrawing();
  window.removeEventListener('locate-poi', handleLocatePOI);
  window.removeEventListener('locate-coverage-bounds', handleLocateBounds);
  window.removeEventListener('locate-route-bounds', handleLocateBounds);
});

watch([groups, draft, draftPreview, visiblePOIs, activeRouteId], redraw, { deep: true });
watch(mapPickEnabled, enabled => {
  if (map) map.getContainer().style.cursor = enabled ? 'crosshair' : '';
  if (enabled && coverageMode.value === 'drawing') coverageStore.cancelDrawing();
});
watch(coverageMode, mode => {
  drawCoverage();
  if (mode === 'drawing') {
    enableCoverageDrawing();
  } else {
    disableCoverageDrawing();
  }
});
watch([coveragePolygon, coveragePreviewSegments], drawCoverage, { deep: true });
</script>

<style scoped>
.map-canvas {
  width: 100%;
  height: 100%;
}

.map-controls {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 8px;
}

.base-map-select {
  width: 132px;
}
</style>
