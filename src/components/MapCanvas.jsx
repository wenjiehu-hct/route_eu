import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { EUROPE_BOUNDS } from '../constants/routes.js';
import { useCoveragePlannerStore } from '../stores/useCoveragePlannerStore.js';
import { usePOIStore } from '../stores/usePOIStore.js';
import { useRoutePlannerStore } from '../stores/useRoutePlannerStore.js';

const BASE_MAPS = {
  esriStreet: { label: 'Esri 街道', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', options: { maxZoom: 19, attribution: 'Tiles © Esri' } },
  osmStandard: { label: 'OSM 标准', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', options: { maxZoom: 19, attribution: '© OpenStreetMap contributors' } },
  cartoLight: { label: 'Carto 浅色', url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', options: { maxZoom: 20, subdomains: 'abcd', attribution: '© OpenStreetMap © CARTO' } },
  cartoDark: { label: 'Carto 深色', url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', options: { maxZoom: 20, subdomains: 'abcd', attribution: '© OpenStreetMap © CARTO' } },
  cartoVoyager: { label: 'Carto Voyager', url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', options: { maxZoom: 20, subdomains: 'abcd', attribution: '© OpenStreetMap © CARTO' } },
  esriTopo: { label: 'Esri 地形', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', options: { maxZoom: 19, attribution: 'Tiles © Esri' } },
  esriImagery: { label: 'Esri 卫星', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', options: { maxZoom: 19, attribution: 'Tiles © Esri' } },
};

export default function MapCanvas() {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef({});
  const baseLayerRef = useRef(null);
  const locationRef = useRef({ watchId: null, marker: null, circle: null });
  const fittedRouteRef = useRef(null);
  const groups = useRoutePlannerStore(state => state.groups);
  const draft = useRoutePlannerStore(state => state.draft);
  const draftPreview = useRoutePlannerStore(state => state.draftPreview);
  const activeRouteId = useRoutePlannerStore(state => state.activeRouteId);
  const mapPickEnabled = useRoutePlannerStore(state => state.mapPickEnabled);
  const pois = usePOIStore(state => state.pois);
  const coverageMode = useCoveragePlannerStore(state => state.mode);
  const coveragePolygon = useCoveragePlannerStore(state => state.polygon);
  const previewSegments = useCoveragePlannerStore(state => state.previewSegments);
  const [baseMap, setBaseMap] = useState(() => BASE_MAPS[localStorage.getItem('routePlannerVue.baseMap')] ? localStorage.getItem('routePlannerVue.baseMap') : 'esriStreet');
  const initialBaseMapRef = useRef(baseMap);
  const [showLabels, setShowLabels] = useState(() => localStorage.getItem('routePlannerVue.showStopLabels') !== 'false');
  const [tracking, setTracking] = useState(false);

  useEffect(() => {
    const map = L.map(containerRef.current, { preferCanvas: false }).fitBounds(EUROPE_BOUNDS, { padding: [20, 20] });
    mapRef.current = map;
    baseLayerRef.current = createBaseLayer(initialBaseMapRef.current).addTo(map);
    layersRef.current = {
      routes: L.featureGroup().addTo(map), markers: L.featureGroup().addTo(map),
      draftRoutes: L.featureGroup().addTo(map), draftMarkers: L.featureGroup().addTo(map),
      pois: L.featureGroup().addTo(map), location: L.featureGroup().addTo(map),
      coverage: L.featureGroup().addTo(map), coveragePreview: L.featureGroup().addTo(map),
    };
    const onMapClick = event => {
      const coverage = useCoveragePlannerStore.getState();
      const routes = useRoutePlannerStore.getState();
      if (coverage.mode === 'drawing' || !routes.mapPickEnabled) return;
      routes.addStopToDraft({ name: `地图点 ${routes.draft.stops.length + 1} (${event.latlng.lat.toFixed(5)}, ${event.latlng.lng.toFixed(5)})`, lat: event.latlng.lat, lon: event.latlng.lng });
      routes.setStatus('已从地图添加途径点。');
    };
    const fitEvent = event => fitBounds(map, event.detail);
    const poiEvent = event => map.setView([event.detail.lat, event.detail.lon], 15);
    map.on('click', onMapClick);
    window.addEventListener('locate-route-bounds', fitEvent);
    window.addEventListener('locate-coverage-bounds', fitEvent);
    window.addEventListener('locate-poi', poiEvent);
    return () => {
      stopTracking(locationRef, setTracking);
      window.removeEventListener('locate-route-bounds', fitEvent);
      window.removeEventListener('locate-coverage-bounds', fitEvent);
      window.removeEventListener('locate-poi', poiEvent);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const timer = setTimeout(() => map.invalidateSize(), 80);
    if (activeRouteId && fittedRouteRef.current !== activeRouteId) {
      const route = groups.flatMap(group => group.routes).find(item => item.id === activeRouteId);
      const points = route?.stats?.geometry?.length ? route.stats.geometry.map(([lon, lat]) => ({ lat, lon })) : route?.stops;
      if (points?.length) {
        fitBounds(map, points.reduce((bounds, point) => ({ south: Math.min(bounds.south, point.lat), west: Math.min(bounds.west, point.lon), north: Math.max(bounds.north, point.lat), east: Math.max(bounds.east, point.lon) }), { south: points[0].lat, west: points[0].lon, north: points[0].lat, east: points[0].lon }));
        fittedRouteRef.current = activeRouteId;
      }
    }
    if (!activeRouteId) fittedRouteRef.current = null;
    return () => clearTimeout(timer);
  }, [activeRouteId, groups]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    baseLayerRef.current?.remove();
    baseLayerRef.current = createBaseLayer(baseMap).addTo(map);
    localStorage.setItem('routePlannerVue.baseMap', baseMap);
  }, [baseMap]);

  useEffect(() => {
    const map = mapRef.current;
    if (map) map.getContainer().style.cursor = mapPickEnabled ? 'crosshair' : '';
    if (mapPickEnabled && coverageMode === 'drawing') useCoveragePlannerStore.getState().cancelDrawing();
  }, [mapPickEnabled, coverageMode]);

  useEffect(() => {
    redraw({ map: mapRef.current, layers: layersRef.current, groups, draft, draftPreview, activeRouteId, pois, coverageMode, coveragePolygon, previewSegments, showLabels });
  }, [groups, draft, draftPreview, activeRouteId, pois, coverageMode, coveragePolygon, previewSegments, showLabels]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layersRef.current.coverage;
    if (!map || !layer || coverageMode !== 'drawing') return undefined;
    layer.clearLayers();
    let points = [];
    const polygon = L.polygon([], { color: '#f59e0b', weight: 2, dashArray: '6 4', fillColor: '#f59e0b', fillOpacity: .1 }).addTo(layer);
    const guide = L.polyline([], { color: '#f59e0b', weight: 2, dashArray: '4 6', opacity: .8 }).addTo(layer);
    const vertices = L.layerGroup().addTo(layer);
    const render = () => {
      polygon.setLatLngs(points); guide.setLatLngs([]); vertices.clearLayers();
      points.forEach((point, index) => L.circleMarker(point, { interactive: false, radius: index === 0 ? 6 : 4, color: '#fff', weight: 2, fillColor: index === 0 ? '#d97706' : '#f59e0b', fillOpacity: 1 }).addTo(vertices));
    };
    const finish = event => {
      if (event?.originalEvent) L.DomEvent.stop(event.originalEvent);
      const deduped = points.filter((point, index) => !index || map.latLngToContainerPoint(points[index - 1]).distanceTo(map.latLngToContainerPoint(point)) > 4);
      if (deduped.length < 3) return useRoutePlannerStore.getState().setStatus('多边形至少需要 3 个顶点。');
      if (!useCoveragePlannerStore.getState().setPolygon(deduped.map(point => ({ lat: point.lat, lon: point.lng })))) useRoutePlannerStore.getState().setStatus('多边形存在自相交，请撤销顶点后重试。');
    };
    const click = event => {
      if (points.length >= 3 && map.latLngToContainerPoint(points[0]).distanceTo(map.latLngToContainerPoint(event.latlng)) <= 14) return finish();
      points.push(event.latlng); render();
    };
    const move = event => { if (points.length) { polygon.setLatLngs([...points, event.latlng]); guide.setLatLngs([points.at(-1), event.latlng]); } };
    const key = event => {
      if (event.key === 'Escape') useCoveragePlannerStore.getState().cancelDrawing();
      if (event.key === 'Enter') finish();
      if (event.key === 'Backspace' && points.length) { event.preventDefault(); points.pop(); render(); }
    };
    map.doubleClickZoom.disable(); map.getContainer().style.cursor = 'crosshair';
    map.on('click', click); map.on('mousemove', move); map.on('dblclick', finish); document.addEventListener('keydown', key);
    return () => {
      map.doubleClickZoom.enable(); map.getContainer().style.cursor = '';
      map.off('click', click); map.off('mousemove', move); map.off('dblclick', finish); document.removeEventListener('keydown', key);
      layer.clearLayers();
    };
  }, [coverageMode]);

  const toggleLabels = () => {
    const next = !showLabels; setShowLabels(next); localStorage.setItem('routePlannerVue.showStopLabels', String(next));
  };
  const toggleLocation = () => tracking ? stopTracking(locationRef, setTracking) : startTracking(mapRef, layersRef, locationRef, setTracking);

  return <>
    <div ref={containerRef} className="map-canvas" />
    <div className="map-controls glass-panel">
      <select value={baseMap} onChange={event => setBaseMap(event.target.value)} aria-label="底图">
        {Object.entries(BASE_MAPS).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}
      </select>
      <button className="icon-button" onClick={toggleLabels}>{showLabels ? '隐藏点名' : '显示点名'}</button>
      <button className={`icon-button ${tracking ? 'active' : ''}`} onClick={toggleLocation}>⌖ {tracking ? '关闭定位' : '我的位置'}</button>
    </div>
  </>;
}

function createBaseLayer(key) {
  const item = BASE_MAPS[key] || BASE_MAPS.esriStreet;
  return L.tileLayer(item.url, { crossOrigin: true, ...item.options });
}

function redraw(context) {
  const { map, layers, groups, draft, draftPreview, activeRouteId, pois, coverageMode, coveragePolygon, previewSegments, showLabels } = context;
  if (!map || !layers.routes) return;
  [layers.routes, layers.markers, layers.draftRoutes, layers.draftMarkers, layers.pois, layers.coveragePreview].forEach(layer => layer?.clearLayers());
  if (coverageMode !== 'drawing') layers.coverage?.clearLayers();
  const routes = groups.flatMap(group => group.routes).filter(route => route.visible);
  routes.forEach(route => {
    const active = route.id === activeRouteId;
    if (active) drawMarkers(layers.markers, route.stops, route.color, showLabels, (index, lat, lon) => useRoutePlannerStore.getState().updateRouteStopCoords(route.id, index, lat, lon));
    const latLngs = route.stats?.geometry?.length ? route.stats.geometry.map(([lon, lat]) => [lat, lon]) : route.stops.map(stop => [stop.lat, stop.lon]);
    if (latLngs.length >= 2) addRouteLine(layers.routes, latLngs, { color: route.color, weight: active ? 7 : 4, opacity: activeRouteId ? (active ? 1 : .48) : .82, dashArray: route.stats?.geometry?.length ? undefined : '8 8' }, route.name, () => useRoutePlannerStore.getState().selectRoute(route.id));
  });
  if (draft.stops.length) {
    drawMarkers(layers.draftMarkers, draft.stops, '#3b82f6', showLabels, (index, lat, lon) => useRoutePlannerStore.getState().updateDraftStopCoords(index, lat, lon));
    const latLngs = draftPreview.stats?.geometry?.length ? draftPreview.stats.geometry.map(([lon, lat]) => [lat, lon]) : draft.stops.map(stop => [stop.lat, stop.lon]);
    if (latLngs.length >= 2) L.polyline(latLngs, { color: '#3b82f6', weight: 5, opacity: .92, dashArray: draftPreview.stats?.geometry?.length ? undefined : '8 8' }).addTo(layers.draftRoutes);
  }
  pois.filter(poi => poi.visible).forEach(poi => {
    const icon = L.divIcon({ html: `<div class="poi-pin" style="--poi-color:${poi.color || '#f59e0b'}">P</div>`, className: '', iconSize: [26, 26], iconAnchor: [13, 13] });
    L.marker([poi.lat, poi.lon], { icon }).bindPopup(createPOIPopup(poi)).addTo(layers.pois);
  });
  if (coverageMode !== 'idle' && coverageMode !== 'drawing' && coveragePolygon.length >= 3) L.polygon(coveragePolygon.map(point => [point.lat, point.lon]), { color: '#f59e0b', weight: 2, fillColor: '#f59e0b', fillOpacity: .08 }).addTo(layers.coverage);
  if (coverageMode !== 'drawing') previewSegments.filter(segment => segment.visible !== false).forEach(segment => {
    const latLngs = segment.stats?.geometry?.length ? segment.stats.geometry.map(([lon, lat]) => [lat, lon]) : segment.stops.map(stop => [stop.lat, stop.lon]);
    addRouteLine(layers.coveragePreview, latLngs, { color: segment.color, weight: 5, opacity: segment.selected ? .9 : .35, dashArray: segment.stats?.geometry?.length ? undefined : '8 8' }, segment.name);
    if (segment.stops.length) { addEndpoint(layers.coveragePreview, segment.stops[0], 'S', segment.color); addEndpoint(layers.coveragePreview, segment.stops.at(-1), 'E', segment.color); }
  });
}

function drawMarkers(layer, stops, color, showLabels, onDrag) {
  stops.forEach((stop, index) => {
    const endpoint = index === 0 || index === stops.length - 1;
    const size = endpoint ? 16 : 12;
    const icon = L.divIcon({ html: `<div class="route-handle" style="--route-color:${color};width:${size}px;height:${size}px"></div>`, className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
    const marker = L.marker([stop.lat, stop.lon], { icon, draggable: true }).addTo(layer);
    if (showLabels) marker.bindTooltip(stop.name, { permanent: true, direction: 'top', offset: [0, -(size / 2 + 4)], className: 'stop-label' });
    marker.on('dragend', () => { const point = marker.getLatLng(); onDrag(index, point.lat, point.lng); });
  });
}

function addRouteLine(layer, points, options, label, onClick) {
  const line = L.polyline(points, options).addTo(layer);
  if (label) line.bindTooltip(label, { sticky: true, direction: 'top' });
  line.on('mouseover', () => line.setStyle({ weight: options.weight + 2, opacity: 1 }));
  line.on('mouseout', () => line.setStyle({ weight: options.weight, opacity: options.opacity }));
  if (onClick) line.on('click', event => { if (event.originalEvent) L.DomEvent.stopPropagation(event.originalEvent); onClick(); });
}

function addEndpoint(layer, stop, label, color) {
  const icon = L.divIcon({ html: `<div class="coverage-endpoint" style="--route-color:${color}">${label}</div>`, className: '', iconSize: [20, 20], iconAnchor: [10, 10] });
  L.marker([stop.lat, stop.lon], { icon }).addTo(layer);
}

function createPOIPopup(poi) {
  const container = document.createElement('div');
  const title = document.createElement('strong'); title.textContent = poi.name; container.appendChild(title);
  const coords = document.createElement('div'); coords.textContent = `${Number(poi.lat).toFixed(5)}, ${Number(poi.lon).toFixed(5)}`; container.appendChild(coords);
  if (poi.description) { const description = document.createElement('p'); description.textContent = poi.description; container.appendChild(description); }
  return container;
}

function fitBounds(map, bounds) {
  if (bounds) map.fitBounds([[bounds.south, bounds.west], [bounds.north, bounds.east]], { padding: [40, 40] });
}

function startTracking(mapRef, layersRef, locationRef, setTracking) {
  if (!navigator.geolocation) return alert('浏览器不支持定位');
  setTracking(true); useRoutePlannerStore.getState().setStatus('正在获取位置...');
  locationRef.current.watchId = navigator.geolocation.watchPosition(position => {
    const { latitude: lat, longitude: lon, accuracy } = position.coords;
    const point = L.latLng(lat, lon); const layer = layersRef.current.location;
    if (!locationRef.current.marker) locationRef.current.marker = L.circleMarker(point, { radius: 7, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }).addTo(layer);
    else locationRef.current.marker.setLatLng(point);
    if (!locationRef.current.circle) locationRef.current.circle = L.circle(point, { radius: accuracy, color: '#2563eb', fillColor: '#2563eb', fillOpacity: .08, weight: 1 }).addTo(layer);
    else { locationRef.current.circle.setLatLng(point); locationRef.current.circle.setRadius(accuracy); }
    useRoutePlannerStore.getState().setStatus(`当前位置：${lat.toFixed(5)}, ${lon.toFixed(5)}（精度 ${Math.round(accuracy)}m）`);
  }, error => { useRoutePlannerStore.getState().setStatus(`定位失败：${error.message}`); stopTracking(locationRef, setTracking); }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
}

function stopTracking(locationRef, setTracking) {
  if (locationRef.current.watchId !== null) navigator.geolocation.clearWatch(locationRef.current.watchId);
  locationRef.current.marker?.remove(); locationRef.current.circle?.remove();
  locationRef.current = { watchId: null, marker: null, circle: null };
  setTracking(false);
}
