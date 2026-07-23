export function htmlEscape(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[character]));
}

export function normalizeName(name) {
  return String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function parseLatLon(text) {
  const match = String(text ?? '').trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { name: String(text).trim(), lat, lon };
}

export function titleCase(text) {
  return String(text ?? '').replace(/\b\w/g, character => character.toUpperCase());
}

export function formatKm(meters) {
  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatHours(seconds) {
  return `${(seconds / 3600).toFixed(1)} h`;
}

let idSeed = 1;

export function createId(prefix = 'id') {
  idSeed += 1;
  return `${prefix}_${idSeed}`;
}
