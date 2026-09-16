const $ = id => document.getElementById(id);
const region = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || 'spotter');
const isSpotter = region.toLowerCase() === 'spotter';
const ALERT_REFRESH_MS = 60_000;
const POPUP_MS = 60_000;
const DEFAULT_CENTER = [41.0648, -86.2158];

let alerts = [];
let globalAlerts = [];
let baselineReady = false;
let knownIds = new Set();
let popupTimer = null;
let regionTarget = null;
let focusFetchTimer = null;

const map = L.map('tvMap', { zoomControl: false, attributionControl: false }).setView(DEFAULT_CENTER, isSpotter ? 5 : 9);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
L.control.attribution({ position: 'bottomleft', prefix: false }).addTo(map);
L.control.zoom({ position: 'bottomright' }).addTo(map);
const alertLayer = L.layerGroup().addTo(map);
const zoneCache = new Map();

function safe(value = '') {
  return String(value ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
}
function alertId(feature = {}) {
  const p = feature.properties || feature || {};
  return String(p.id || p['@id'] || feature.id || `${p.event}:${p.sent}:${p.areaDesc}`).replace(/^https:\/\/api\.weather\.gov\/alerts\//, '');
}
function alertKind(event = '') {
  if (String(event).includes('Warning')) return 'warning';
  if (String(event).includes('Watch')) return 'watch';
  if (String(event).includes('Advisory')) return 'advisory';
  return 'statement';
}
function alertColor(event = '') {
  const e = String(event || '').toLowerCase();
  if (e.includes('tornado')) return '#d90429';
  if (e.includes('severe thunderstorm')) return '#f59e0b';
  if (e.includes('flash flood') || e.includes('flood')) return '#16a34a';
  if (e.includes('winter') || e.includes('snow') || e.includes('ice')) return '#38bdf8';
  if (e.includes('hurricane') || e.includes('tropical')) return '#7c3aed';
  if (e.includes('warning')) return '#ef4444';
  if (e.includes('watch')) return '#eab308';
  if (e.includes('advisory')) return '#3b82f6';
  return '#64748b';
}
function slug(event = '') {
  const e = String(event || '').toLowerCase().replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (e.includes('tornado warning')) return 'tornado-warning';
  if (e.includes('tornado watch')) return 'tornado-watch';
  if (e.includes('severe thunderstorm warning')) return 'severe-thunderstorm-warning';
  if (e.includes('severe thunderstorm watch')) return 'severe-thunderstorm-watch';
  if (e.includes('flash flood warning')) return 'flash-flood-warning';
  if (e.includes('flood warning')) return 'flood-warning';
  if (e.includes('flood watch')) return 'flood-watch';
  if (e.includes('winter storm warning')) return 'winter-storm-warning';
  if (e.includes('winter weather advisory')) return 'winter-weather-advisory';
  if (e.includes('hurricane warning')) return 'hurricane-warning';
  if (e.includes('hurricane watch')) return 'hurricane-watch';
  if (e.includes('tropical storm warning')) return 'tropical-storm-warning';
  if (e.includes('storm surge warning')) return 'storm-surge-warning';
  if (e.includes('wind advisory')) return 'wind-advisory';
  if (e.includes('red flag warning')) return 'red-flag-warning';
  if (e.includes('special weather statement')) return 'special-weather-statement';
  if (e.includes('warning')) return 'warning';
  if (e.includes('watch')) return 'watch';
  if (e.includes('advisory')) return 'advisory';
  return 'statement';
}
function imageUrl(event = '') { return `/assets/weather-alerts/${slug(event)}.png`; }
function fmtTime(value) {
  if (!value) return 'Unavailable';
  const d = new Date(value);
  if (Number.isNaN(d.valueOf())) return 'Unavailable';
  return d.toLocaleString('en-US', { timeZone: 'America/Indiana/Indianapolis', hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' });
}
function featureCenter(feature) {
  const pts = [];
  function walk(c) {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === 'number' && typeof c[1] === 'number') pts.push([c[1], c[0]]);
    else c.forEach(walk);
  }
  walk(feature.geometry?.coordinates || []);
  if (!pts.length) return null;
  return [pts.reduce((s,p)=>s+p[0],0)/pts.length, pts.reduce((s,p)=>s+p[1],0)/pts.length];
}
function summary(p = {}) {
  const lines = [];
  if (p.headline) lines.push(p.headline);
  if (p.areaDesc) lines.push(`Areas: ${p.areaDesc}`);
  if (p.severity || p.urgency) lines.push(`Severity: ${[p.severity, p.urgency].filter(Boolean).join(' / ')}`);
  if (p.expires) lines.push(`Expires: ${fmtTime(p.expires)}`);
  const desc = String(p.description || '').replace(/\s+/g, ' ').trim();
  if (desc) lines.push(desc.slice(0, 360) + (desc.length > 360 ? '…' : ''));
  return lines.join('\n\n');
}
function card(alert) {
  const p = alert.properties || alert || {};
  return `<article class="tv-alert-card ${alertKind(p.event)}"><h3>${safe(p.event || 'Weather Alert')}</h3><p>${safe((p.areaDesc || p.headline || '').slice(0, 150))}</p><p>Issued ${safe(fmtTime(p.sent || p.effective))}</p></article>`;
}
function renderLists() {
  if (isSpotter) {
    $('tvGlobalPanel').classList.remove('hidden');
    $('tvGlobalAlerts').innerHTML = globalAlerts.length ? globalAlerts.slice(0, 10).map(card).join('') : '<div class="small">No high-impact global storm alerts.</div>';
  }
  $('tvLocalAlerts').innerHTML = alerts.length ? alerts.slice(0, 12).map(card).join('') : '<div class="small">No active alerts for this location.</div>';
}
async function fetchJson(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok || data.ok === false) throw new Error(data.error || res.statusText);
  return data;
}
async function zoneGeometry(url) {
  if (!url) return null;
  if (zoneCache.has(url)) return zoneCache.get(url);
  try {
    const data = await fetchJson(`/api/nws-zone?url=${encodeURIComponent(url)}`);
    zoneCache.set(url, data.geometry || null);
    return data.geometry || null;
  } catch { return null; }
}
function addGeoJson(feature, alert) {
  const p = alert.properties || {};
  const color = alertColor(p.event);
  L.geoJSON(feature, {
    style: { color, weight: 1.5, opacity: 0.85, fillColor: color, fillOpacity: 0.38, className: 'tv-zone-fill' },
    onEachFeature: (_, layer) => layer.on('click', () => showPopup(alert, { pan: false }))
  }).addTo(alertLayer);
}
async function drawAlerts(list) {
  alertLayer.clearLayers();
  for (const alert of list) {
    if (alert.geometry) addGeoJson(alert, alert);
    else {
      const zones = (alert.properties?.affectedZones || []).filter(z => /\/zones\/(county|forecast|fire)\//.test(z));
      for (const z of zones.slice(0, 12)) {
        const geom = await zoneGeometry(z);
        if (geom) addGeoJson({ type: 'Feature', geometry: geom, properties: alert.properties || {} }, alert);
      }
    }
  }
}
function showPopup(alert, opts = {}) {
  const p = alert.properties || alert || {};
  clearTimeout(popupTimer);
  const color = alertColor(p.event);
  $('tvPopup').innerHTML = `
    <div class="tv-popup-inner" style="border-bottom-color:${color}">
      <img class="tv-popup-image" src="${safe(imageUrl(p.event))}" onerror="this.src='/logo.png'" alt="" />
      <div>
        <div class="tv-popup-kicker">${safe(p.areaDesc || 'Active Weather Alert')}</div>
        <h2 class="tv-popup-title">${safe(p.event || 'Weather Alert')}</h2>
        <div class="tv-popup-meta"><span>Issued ${safe(fmtTime(p.sent || p.effective))}</span><span>Expires ${safe(fmtTime(p.expires || p.ends))}</span></div>
        <p class="tv-popup-summary">${safe(summary(p))}</p>
      </div>
    </div>`;
  $('tvPopup').classList.remove('hidden');
  const center = featureCenter(alert);
  if (center && opts.pan !== false) map.setView(center, Math.max(map.getZoom(), 8), { animate: true });
  popupTimer = setTimeout(() => $('tvPopup').classList.add('hidden'), POPUP_MS);
}
function closePopup() {
  clearTimeout(popupTimer);
  $('tvPopup').classList.add('hidden');
}
function highestPriorityNew(list) {
  const fresh = list.filter(a => !knownIds.has(alertId(a)));
  if (!fresh.length) return null;
  fresh.sort((a,b) => {
    const pa = priority(a), pb = priority(b);
    if (pb !== pa) return pb - pa;
    return new Date(b.properties?.sent || 0) - new Date(a.properties?.sent || 0);
  });
  return fresh[0];
}
function priority(a) {
  const e = String(a.properties?.event || '');
  const s = String(a.properties?.severity || '').toLowerCase();
  if (e.includes('Tornado Warning') || s === 'extreme') return 100;
  if (e.includes('Warning')) return 80;
  if (e.includes('Watch')) return 50;
  if (e.includes('Advisory')) return 30;
  return 10;
}
async function refreshRegion() {
  try {
    const data = await fetchJson(`/api/tv/region/${encodeURIComponent(region)}`);
    regionTarget = data.target;
    $('tvRegionLabel').textContent = data.target?.label || region;
    const nextAlerts = data.alerts || [];
    globalAlerts = data.globalAlerts || [];
    const newAlert = baselineReady ? highestPriorityNew(nextAlerts) : null;
    alerts = nextAlerts;
    renderLists();
    await drawAlerts(isSpotter ? nextAlerts : alerts);
    if (!baselineReady) {
      knownIds = new Set(nextAlerts.map(alertId));
      baselineReady = true;
      if (data.center) map.setView([data.center.lat, data.center.lon], 9);
      else if (nextAlerts[0]) {
        const c = featureCenter(nextAlerts[0]);
        if (c) map.setView(c, isSpotter ? 5 : 8);
      }
    } else {
      nextAlerts.forEach(a => knownIds.add(alertId(a)));
      if (newAlert) {
        closePopup();
        showPopup(newAlert);
        if (isSpotter) setTimeout(refreshFocusAlerts, 1200);
      }
    }
    $('tvStatus').textContent = `Updated ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    $('tvStatus').textContent = `TV overlay error: ${err.message}`;
  }
}
async function refreshFocusAlerts() {
  if (!isSpotter) return;
  const c = map.getCenter();
  try {
    const data = await fetchJson(`/api/tv/focus-alerts?lat=${c.lat.toFixed(4)}&lon=${c.lng.toFixed(4)}`);
    $('tvLocalTitle').textContent = `Alerts for ${data.label || 'this location'}`;
    alerts = data.alerts || [];
    renderLists();
  } catch {}
}
function updateClock() {
  $('tvClock').textContent = new Date().toLocaleTimeString('en-US', { timeZone: 'America/Indiana/Indianapolis', hour: 'numeric', minute: '2-digit' });
}
map.on('moveend', () => {
  if (!isSpotter) return;
  clearTimeout(focusFetchTimer);
  focusFetchTimer = setTimeout(refreshFocusAlerts, 700);
});
updateClock();
setInterval(updateClock, 10_000);
refreshRegion();
setInterval(refreshRegion, ALERT_REFRESH_MS);
