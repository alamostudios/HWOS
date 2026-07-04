const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const forecastEl = $('forecast');
const alertsEl = $('alerts');
const observationsEl = $('observations');
const currentEl = $('currentConditions');
const toastStack = $('toastStack');
const adminMessageStack = $('adminMessageStack');
const appEl = $('app');
const ADMIN_ALERT_TYPES = ['Tornado Warning','Severe Thunderstorm Warning','Flash Flood Warning','Flood Warning','Winter Storm Warning','High Wind Warning','Special Weather Statement','Severe Thunderstorm Watch','Tornado Watch','Flood Watch','Wind Advisory','Winter Weather Advisory','Dense Fog Advisory','Heat Advisory','Test Message'];

const DEFAULT_LOCATION = {
  label: 'Fulton County, Indiana',
  lat: 41.0456,
  lon: -86.2622,
  zoom: 10
};


const PREFS_KEY = 'hwosPreferencesV1';
const defaultPreferences = {
  theme: 'standard',
  colorScheme: 'light',
  radarOpacity: 68,
  radarProduct: 'reflectivity',
  spotterMode: false,
  soundEnabled: true,
  autoReadAlerts: true,
  popupEnabled: true,
  ttsMode: 'short',
  ttsVoiceURI: 'david',
  layers: {
    radar: true,
    boundary: true,
    alerts: true,
    stormMotion: true,
    counties: true
  },
  hazards: ['Tornado', 'Severe Thunderstorm', 'Flash Flood', 'Special Weather'],
  alertKinds: ['Warning', 'Watch', 'Advisory', 'Statement'],
  location: null
};

function cloneDefaults() { return JSON.parse(JSON.stringify(defaultPreferences)); }

function readPreferences() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return cloneDefaults();
    const saved = JSON.parse(raw);
    return {
      ...cloneDefaults(),
      ...saved,
      layers: { ...defaultPreferences.layers, ...(saved.layers || {}) },
      hazards: Array.isArray(saved.hazards) ? saved.hazards : defaultPreferences.hazards,
      alertKinds: Array.isArray(saved.alertKinds) ? saved.alertKinds : defaultPreferences.alertKinds
    };
  } catch {
    return cloneDefaults();
  }
}

const prefs = readPreferences();

function savePreferences(patch = {}) {
  Object.assign(prefs, patch);
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

function saveLayerPreference(key, value) {
  prefs.layers = { ...prefs.layers, [key]: Boolean(value) };
  savePreferences({ layers: prefs.layers });
}

function saveCurrentLocationPreference() {
  savePreferences({ location: { lat: state.lat, lon: state.lon, label: state.label, zoom: map.getZoom() } });
}

function setCheckbox(id, value) {
  const el = $(id);
  if (el) el.checked = Boolean(value);
}

function applySavedControls() {
  setCheckbox('radarToggle', prefs.layers.radar);
  setCheckbox('boundaryToggle', prefs.layers.boundary);
  setCheckbox('alertsLayerToggle', prefs.layers.alerts);
  setCheckbox('stormMotionToggle', prefs.layers.stormMotion);
  setCheckbox('countiesToggle', prefs.layers.counties);
  setCheckbox('spotterModeToggle', prefs.spotterMode);
  setCheckbox('soundToggle', prefs.soundEnabled);
  setCheckbox('ttsToggle', prefs.autoReadAlerts);
  setCheckbox('popupToggle', prefs.popupEnabled);

  if ($('radarOpacity')) $('radarOpacity').value = String(prefs.radarOpacity);
  if ($('themeSelect')) $('themeSelect').value = prefs.theme;
  if ($('displayModeSelect')) $('displayModeSelect').value = prefs.colorScheme;
  if ($('ttsModeSelect')) $('ttsModeSelect').value = prefs.ttsMode;

  document.querySelectorAll('.hazard-toggle').forEach(cb => { cb.checked = prefs.hazards.includes(cb.value); });
  document.querySelectorAll('.alert-toggle').forEach(cb => { cb.checked = prefs.alertKinds.includes(cb.value); });
  document.querySelectorAll('.layer-btn[data-radar]').forEach(btn => btn.classList.toggle('active', btn.dataset.radar === prefs.radarProduct));
}

const basemaps = {
  standard: {
    name: 'OpenStreetMap Standard',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }
  },
  hot: {
    name: 'OpenStreetMap Humanitarian',
    url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    options: { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors, HOT' }
  },
  opentopo: {
    name: 'OpenTopoMap',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    options: { maxZoom: 17, attribution: 'Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap' }
  }
};

const state = {
  lat: DEFAULT_LOCATION.lat,
  lon: DEFAULT_LOCATION.lon,
  label: DEFAULT_LOCATION.label,
  alerts: [],
  selectedAlerts: [],
  adminMessages: [],
  spotterMode: Boolean(prefs.spotterMode),
  stations: [],
  lastGeojson: null,
  notifiedIds: new Set(),
  activeAlertIds: new Set(),
  alertMonitorInitialized: false,
  ttsPrimed: false,
  ttsMode: prefs.ttsMode,
  ttsVoiceURI: prefs.ttsVoiceURI,
  activeTts: null,
  enabledHazards: new Set(prefs.hazards),
  enabledKinds: new Set(prefs.alertKinds),
  radarOpacity: Number(prefs.radarOpacity || 68) / 100,
  radarPlaying: false,
  radarTimer: null,
  radarFrames: [],
  radarIndex: 0,
  radarFrameMs: 5 * 60 * 1000,
  colorScheme: prefs.colorScheme || 'light'
};

const initialLocation = prefs.location || DEFAULT_LOCATION;
state.lat = Number(initialLocation.lat) || DEFAULT_LOCATION.lat;
state.lon = Number(initialLocation.lon) || DEFAULT_LOCATION.lon;
state.label = initialLocation.label || DEFAULT_LOCATION.label;
const map = L.map('map', { zoomControl: false, doubleClickZoom: false }).setView([state.lat, state.lon], Number(initialLocation.zoom) || DEFAULT_LOCATION.zoom);
L.control.zoom({ position: 'bottomright' }).addTo(map);
let baseLayer = L.tileLayer((basemaps[prefs.theme] || basemaps.standard).url, (basemaps[prefs.theme] || basemaps.standard).options).addTo(map);

const RADAR_IMAGE_SERVER = 'https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity_time/ImageServer';
let radarLayer = null;
let radarRequestId = 0;

function mapBoundsToWebMercatorBbox() {
  const b = map.getBounds();
  const sw = L.CRS.EPSG3857.project(b.getSouthWest());
  const ne = L.CRS.EPSG3857.project(b.getNorthEast());
  return `${sw.x},${sw.y},${ne.x},${ne.y}`;
}

function radarExportUrl(frameMs) {
  const size = map.getSize();
  const url = new URL(`${RADAR_IMAGE_SERVER}/exportImage`);
  url.searchParams.set('f', 'image');
  url.searchParams.set('format', 'png32');
  url.searchParams.set('transparent', 'true');
  url.searchParams.set('bbox', mapBoundsToWebMercatorBbox());
  url.searchParams.set('bboxSR', '3857');
  url.searchParams.set('imageSR', '3857');
  url.searchParams.set('size', `${Math.max(256, size.x)},${Math.max(256, size.y)}`);
  url.searchParams.set('time', String(frameMs));
  return url.toString();
}

function updateRadarImage() {
  if (!$('radarToggle')?.checked || !state.radarFrames.length) return;
  const frame = state.radarFrames[state.radarIndex] || Date.now();
  const requestId = ++radarRequestId;
  const bounds = map.getBounds();
  const url = radarExportUrl(frame);
  const next = L.imageOverlay(url, bounds, { opacity: state.radarOpacity, interactive: false, crossOrigin: false });
  next.once('load', () => {
    if (requestId !== radarRequestId) { map.removeLayer(next); return; }
    if (radarLayer) map.removeLayer(radarLayer);
    radarLayer = next;
    radarLayer.addTo(map);
    radarLayer.bringToFront();
    alertLayer.bringToFront();
    boundaryLayer.bringToFront();
  });
  next.once('error', () => { if (requestId === radarRequestId) setStatus('Radar frame could not be loaded from NOAA.'); });
  next.addTo(map);
}

const alertLayer = L.geoJSON(null, {
  style(feature) {
    const event = feature.properties?.event || '';
    return {
      color: alertColor(event),
      weight: event.includes('Tornado') ? 5 : 3,
      fillColor: alertColor(event),
      fillOpacity: event.includes('Tornado') ? 0.22 : 0.14,
      dashArray: event.includes('Watch') ? '8 5' : null
    };
  },
  onEachFeature(feature, layer) {
    layer.on('click', event => {
      try { layer.bringToFront(); } catch {}
      const alerts = alertsAtLatLng(event.latlng);
      map._lastPopupAlertList = alerts.length > 1 ? alerts : [alerts[0] || feature];
      const content = alerts.length > 1 ? buildAlertListPopup(alerts) : buildAlertPopup(alerts[0] || feature);
      L.popup({
        maxWidth: 540,
        className: 'alert-detail-popup',
        autoPan: true,
        keepInView: true,
        autoPanPaddingTopLeft: [24, 96],
        autoPanPaddingBottomRight: [24, 24]
      }).setLatLng(event.latlng).setContent(content).openOn(map);
      L.DomEvent.stop(event);
    });
  }
}).addTo(map);

const boundaryLayer = L.geoJSON(null, {
  className: 'boundary-outline',
  style: () => boundaryStyle()
}).addTo(map);

const stormMotionLayer = L.layerGroup().addTo(map);
const windMarkerLayer = L.layerGroup().addTo(map);

function boundaryStyle() {
  return { color: '#CCFF00', weight: 3, opacity: 0.95, fill: false, fillOpacity: 0, lineJoin: 'round' };
}

function refreshBoundaryStyle() {
  boundaryLayer.setStyle(boundaryStyle());
}

async function api(path) {
  const res = await fetch(path);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}

function setStatus(text) { statusEl.textContent = text; }
function fmtTemp(period) { return `${period.temperature}°${period.temperatureUnit}`; }
function safe(text) { return String(text ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch])); }

function cToF(value) {
  return value == null ? null : Math.round((value * 9 / 5) + 32);
}
function mpsToMph(value) {
  return value == null ? null : Math.round(value * 2.23694);
}
function formatObservationValue(value, unitCode) {
  if (value == null) return 'Unavailable';
  if (unitCode?.includes('degC')) return `${cToF(value)}°F`;
  if (unitCode?.includes('m_s-1')) return `${mpsToMph(value)} mph`;
  if (unitCode?.includes('Pa')) return `${Math.round(value / 100)} mb`;
  return `${Math.round(value)}`;
}

function alertKind(event = '') {
  if (event.includes('Warning')) return 'Warning';
  if (event.includes('Watch')) return 'Watch';
  if (event.includes('Advisory')) return 'Advisory';
  return 'Statement';
}
function alertColor(event = '') {
  if (event.includes('Tornado')) return '#ff00ff';
  if (event.includes('Severe Thunderstorm')) return '#facc15';
  if (event.includes('Flash Flood')) return '#2563eb';
  if (event.includes('Warning')) return '#dc2626';
  if (event.includes('Watch')) return '#ca8a04';
  if (event.includes('Advisory')) return '#9333ea';
  return '#0369a1';
}
function alertClass(event = '') {
  if (event.includes('Warning')) return 'alert-warning';
  if (event.includes('Watch')) return 'alert-watch';
  if (event.includes('Advisory')) return 'alert-advisory';
  return 'alert-statement';
}

function alertImageSlug(event = '') {
  const e = String(event || '')
    .toLowerCase()
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Specific hazards first. Keep this loose so NWS wording variants still map.
  if (e.includes('tornado warning')) return 'tornado-warning';
  if (e.includes('tornado watch')) return 'tornado-watch';
  if (e.includes('severe thunderstorm warning')) return 'severe-thunderstorm-warning';
  if (e.includes('severe thunderstorm watch')) return 'severe-thunderstorm-watch';
  if (e.includes('severe weather statement')) return 'severe-weather-statement';
  if (e.includes('special weather statement')) return 'special-weather-statement';
  if (e.includes('special marine warning')) return 'special-marine-warning';
  if (e.includes('marine weather statement')) return 'marine-weather-statement';
  if (e.includes('flash flood warning')) return 'flash-flood-warning';
  if (e.includes('flash flood watch')) return 'flash-flood-watch';
  if (e.includes('flood advisory')) return 'flood-advisory';
  if (e.includes('river flood warning')) return 'river-flood-warning';
  if (e.includes('coastal flood warning')) return 'coastal-flood-warning';
  if (e.includes('coastal flood advisory')) return 'coastal-flood-advisory';
  if (e.includes('lakeshore flood warning')) return 'lakeshore-flood-warning';
  if (e.includes('flood warning')) return 'flood-warning';
  if (e.includes('flood watch')) return 'flood-watch';
  if (e.includes('snow squall warning')) return 'snow-squall-warning';
  if (e.includes('blizzard warning')) return 'blizzard-warning';
  if (e.includes('ice storm warning')) return 'ice-storm-warning';
  if (e.includes('winter storm watch')) return 'winter-storm-watch';
  if (e.includes('winter storm warning')) return 'winter-storm-warning';
  if (e.includes('winter weather advisory')) return 'winter-weather-advisory';
  if (e.includes('wind chill warning')) return 'wind-chill-warning';
  if (e.includes('extreme wind warning')) return 'extreme-wind-warning';
  if (e.includes('high wind warning')) return 'high-wind-warning';
  if (e.includes('wind advisory')) return 'wind-advisory';
  if (e.includes('derecho')) return 'derecho-warning';
  if (e.includes('dust storm')) return 'dust-storm-warning';
  if (e.includes('dense fog')) return 'dense-fog-advisory';
  if (e.includes('excessive heat warning')) return 'excessive-heat-warning';
  if (e.includes('heat advisory')) return 'heat-advisory';
  if (e.includes('freeze warning')) return 'freeze-warning';
  if (e.includes('frost advisory')) return 'frost-advisory';
  if (e.includes('red flag warning')) return 'red-flag-warning';
  if (e.includes('fire weather watch')) return 'fire-weather-watch';
  if (e.includes('fire weather')) return 'red-flag-warning';
  if (e.includes('air quality')) return 'air-quality-alert';
  if (e.includes('hurricane local statement')) return 'hurricane-local-statement';
  if (e.includes('hurricane warning')) return 'hurricane-warning';
  if (e.includes('hurricane watch')) return 'hurricane-watch';
  if (e.includes('tropical storm warning')) return 'tropical-storm-warning';
  if (e.includes('tropical storm watch')) return 'tropical-storm-watch';
  if (e.includes('storm surge warning')) return 'storm-surge-warning';
  if (e.includes('storm surge watch')) return 'storm-surge-watch';
  if (e.includes('gale warning')) return 'gale-warning';
  if (e.includes('gale watch')) return 'gale-watch';
  if (e.includes('storm warning')) return 'storm-warning';
  if (e.includes('small craft advisory')) return 'small-craft-advisory';
  if (e.includes('high surf advisory')) return 'high-surf-advisory';
  if (e.includes('beach hazards')) return 'beach-hazards-statement';
  if (e.includes('hydrologic outlook')) return 'hydrologic-outlook';
  if (e.includes('hazardous weather outlook')) return 'hazardous-weather-outlook';
  if (e.includes('local area emergency')) return 'local-area-emergency';
  if (e.includes('civil emergency')) return 'civil-emergency-message';
  if (e.includes('evacuation immediate')) return 'evacuation-immediate';
  if (e.includes('shelter in place')) return 'shelter-in-place-warning';
  if (e.includes('911') || e.includes('telephone outage')) return '911-telephone-outage';
  if (e.includes('administrative')) return 'administrative-message';

  // Category fallbacks have generated images now, so we never immediately fall to logo.png
  if (e.includes('warning')) return 'warning';
  if (e.includes('watch')) return 'watch';
  if (e.includes('advisory')) return 'advisory';
  return 'statement';
}

function alertImageUrl(event = '') {
  return `/assets/weather-alerts/${alertImageSlug(event)}.png`;
}

function fullAlertUrl(p = {}) {
  const url = String(p['@id'] || p.id || '').trim();
  return url.startsWith('http') ? url : '';
}

function alertSummaryText(p = {}) {
  const event = p.event || 'Weather Alert';
  const office = alertOffice(p);
  const areas = p.areaDesc ? `<div><strong>Areas:</strong> ${safe(p.areaDesc)}</div>` : '';
  const expires = p.expires || p.ends ? `<div><strong>Until:</strong> ${safe(formatAlertTime(p.expires || p.ends))}</div>` : '';
  const headline = p.headline ? `<p>${safe(p.headline)}</p>` : '';
  const rows = alertImpactRows(p).map(([k, v]) => `<div class="alert-row"><span>${safe(k)}</span><strong>${safe(v)}</strong></div>`).join('');
  const instruction = alertInstruction(p);
  const instructionLine = instruction ? `<p class="popup-plainline">${safe(String(instruction).split(/\n+/).find(Boolean) || instruction).slice(0, 280)}${instruction.length > 280 ? '…' : ''}</p>` : '';
  return `
    <div class="popup-kicker">${safe(office)}</div>
    <h3>${safe(event)}</h3>
    ${headline}
    <div class="popup-times"><strong>Issued:</strong> ${safe(formatAlertTime(p.sent || p.effective))}<br>${expires}</div>
    ${areas}
    ${rows ? `<div class="alert-rows">${rows}</div>` : ''}
    ${instructionLine}
  `;
}

function alertPriorityValue(alert) {
  const p = alert.properties || alert || {};
  const event = String(p.event || '');
  if (event.includes('Tornado Warning')) return 100;
  if (event.includes('Flash Flood Warning')) return 90;
  if (event.includes('Severe Thunderstorm Warning')) return 85;
  if (event.includes('Warning')) return 75;
  if (event.includes('Tornado Watch')) return 65;
  if (event.includes('Severe Thunderstorm Watch')) return 60;
  if (event.includes('Watch')) return 50;
  if (event.includes('Advisory')) return 30;
  return 10;
}

function pointInRing(latlng, ring = []) {
  const x = latlng.lng, y = latlng.lat;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersects = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInFeature(latlng, feature) {
  const g = feature?.geometry;
  if (!g?.coordinates) return false;
  const polys = g.type === 'Polygon' ? [g.coordinates] : (g.type === 'MultiPolygon' ? g.coordinates : []);
  return polys.some(poly => Array.isArray(poly?.[0]) && pointInRing(latlng, poly[0]));
}

function alertsAtLatLng(latlng) {
  const matches = [];
  alertLayer.eachLayer(layer => {
    const feature = layer.feature;
    if (!feature?.properties) return;
    if (!layer.getBounds?.().contains(latlng)) return;
    if (pointInFeature(latlng, feature)) matches.push(feature);
  });
  const seen = new Set();
  return matches
    .filter(f => {
      const id = canonicalAlertId(f.properties || {});
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .sort((a, b) => alertPriorityValue(b) - alertPriorityValue(a));
}

function alertPopupLocationTitle(alerts = []) {
  const p = alerts.find(a => a?.properties?.areaDesc)?.properties || alerts[0]?.properties || {};
  const area = String(p.areaDesc || '').split(/[;,]/).map(x => x.trim()).filter(Boolean)[0];
  return area || state.label || 'Selected location';
}

function buildAlertListPopup(alerts = []) {
  const list = alerts.map(alert => {
    const p = alert.properties || {};
    const id = canonicalAlertId(p);
    return `<button class="popup-alert-choice ${alertClass(p.event || '')}" type="button" data-popup-alert-id="${safe(id)}">
      <strong>${safe(p.event || 'Weather Alert')}</strong>
      <span>${safe(p.headline || p.areaDesc || '')}</span>
      <small>${safe(p.severity || '')} · ${safe(p.urgency || '')} · Until ${safe(formatAlertTime(p.expires || p.ends))}</small>
    </button>`;
  }).join('');
  return `<div class="alert-popup-card alert-list-popup">
    <div class="alert-popup-head">
      <div><div class="popup-kicker">${safe(alertPopupLocationTitle(alerts))}</div><h3>${alerts.length} Active Alerts</h3></div>
      <span class="popup-badge">Select</span>
    </div>
    <div class="popup-scroll-body popup-choice-list">${list}</div>
  </div>`;
}

function alertDetailInfo(p = {}) {
  const areas = p.areaDesc ? `<div class="popup-area"><strong>Areas:</strong> ${safe(p.areaDesc)}</div>` : '';
  const headline = p.headline ? `<p class="popup-plainline">${safe(p.headline)}</p>` : '';
  const rows = alertImpactRows(p).map(([k, v]) => `<div class="alert-row"><span>${safe(k)}</span><strong>${safe(v)}</strong></div>`).join('');
  const instruction = alertInstruction(p);
  const description = String(p.description || '').split(/\n+/).map(x => x.trim()).filter(Boolean).slice(0, 2).join(' ');
  const shortText = instruction || description;
  const shortLine = shortText ? `<p class="popup-plainline">${safe(shortText).slice(0, 520)}${shortText.length > 520 ? '…' : ''}</p>` : '';
  return `${headline}${areas}${rows ? `<div class="alert-rows">${rows}</div>` : ''}${shortLine}`;
}

function firstParam(params = {}, keys = []) {
  for (const key of keys) {
    const value = params?.[key];
    if (Array.isArray(value) && value.length) return value[0];
    if (typeof value === 'string' && value) return value;
  }
  return '';
}

function formatAlertTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function alertId(p = {}) {
  return String(p.id || p['@id'] || '').replace('https://api.weather.gov/alerts/', '');
}

function canonicalAlertId(alertOrProperties = {}) {
  const p = alertOrProperties.properties || alertOrProperties || {};
  const candidates = [
    p.id,
    p['@id'],
    p.identifier,
    p.parameters?.AWIPSidentifier?.[0],
    p.parameters?.WMOidentifier?.[0],
    [p.event, p.sent, p.effective, p.expires, p.areaDesc].filter(Boolean).join('|')
  ];
  const found = candidates.find(v => String(v || '').trim());
  return String(found || '')
    .replace(/^https:\/\/api\.weather\.gov\/alerts\//, '')
    .trim();
}

function alertOffice(p = {}) {
  return p.senderName || String(p.sender || '').replace(/^w-nws\.webmaster@noaa\.gov$/i, 'National Weather Service') || 'National Weather Service';
}

function alertInstruction(p = {}) {
  return p.instruction || firstParam(p.parameters, ['instruction']) || '';
}

function cleanOfficeName(name = '') {
  let out = String(name || '').trim();
  out = out.replace(/^National Weather Service\s+/i, '');
  out = out.replace(/^NWS\s+/i, '');
  out = out.replace(/\s+Weather Forecast Office$/i, '');
  out = out.replace(/\s*,?\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)$/i, '');
  return out || 'National Weather Service';
}

const STATE_NAMES = {
  AL:'Alabama', AK:'Alaska', AZ:'Arizona', AR:'Arkansas', CA:'California', CO:'Colorado', CT:'Connecticut', DE:'Delaware', FL:'Florida', GA:'Georgia', HI:'Hawaii', IA:'Iowa', ID:'Idaho', IL:'Illinois', IN:'Indiana', KS:'Kansas', KY:'Kentucky', LA:'Louisiana', MA:'Massachusetts', MD:'Maryland', ME:'Maine', MI:'Michigan', MN:'Minnesota', MO:'Missouri', MS:'Mississippi', MT:'Montana', NC:'North Carolina', ND:'North Dakota', NE:'Nebraska', NH:'New Hampshire', NJ:'New Jersey', NM:'New Mexico', NV:'Nevada', NY:'New York', OH:'Ohio', OK:'Oklahoma', OR:'Oregon', PA:'Pennsylvania', RI:'Rhode Island', SC:'South Carolina', SD:'South Dakota', TN:'Tennessee', TX:'Texas', UT:'Utah', VA:'Virginia', VT:'Vermont', WA:'Washington', WI:'Wisconsin', WV:'West Virginia', WY:'Wyoming', DC:'District of Columbia'
};

// TTS engines often mispronounce short state abbreviations in county lists.
// Keep this deliberately focused on common Mid-Atlantic / nearby NWS alert states
// rather than expanding every possible two-letter word-like abbreviation.
const TTS_STATE_NAMES = {
  DE: 'Delaware',
  PA: 'Pennsylvania',
  NJ: 'New Jersey',
  MD: 'Maryland',
  DC: 'District of Columbia',
  VA: 'Virginia',
  WV: 'West Virginia',
  NY: 'New York',
  OH: 'Ohio',
  IN: 'Indiana',
  IL: 'Illinois',
  KY: 'Kentucky',
  NC: 'North Carolina',
  SC: 'South Carolina',
  TN: 'Tennessee'
};

function spokenStateName(code = '') {
  const key = String(code || '').trim().toUpperCase();
  return TTS_STATE_NAMES[key] || STATE_NAMES[key] || '';
}

function normalizeAreaForSpeech(area = '') {
  let out = String(area || '').replace(/\s+/g, ' ').trim();
  // Convert strings like "New Castle DE" or "Kent, DE" into readable speech.
  Object.entries(TTS_STATE_NAMES).forEach(([abbr, name]) => {
    const trailing = new RegExp(`(?:,?\\s+)${abbr}$`, 'i');
    if (trailing.test(out)) out = out.replace(trailing, `, ${name}`);
  });
  return out;
}

function normalizeTtsText(text = '') {
  let out = String(text || '');
  Object.entries(TTS_STATE_NAMES).forEach(([abbr, name]) => {
    // Replace standalone state abbreviations that occur after common separators.
    const re = new RegExp(`(^|[\\s,;:()])${abbr}(?=$|[\\s,;:.)])`, 'g');
    out = out.replace(re, `$1${name}`);
  });
  return out.replace(/\s+/g, ' ').trim();
}

function alertAreaGroups(p = {}) {
  const areas = String(p.areaDesc || '').split(';').map(x => x.trim()).filter(Boolean);
  const ugc = Array.isArray(p.geocode?.UGC) ? p.geocode.UGC : [];
  const byState = new Map();
  areas.forEach((area, i) => {
    const code = String(ugc[i] || ugc.find(c => String(c || '').match(/^[A-Z]{2}/)) || '').slice(0, 2).toUpperCase();
    const stateName = spokenStateName(code) || '';
    const key = stateName || 'the affected area';
    if (!byState.has(key)) byState.set(key, []);
    byState.get(key).push(normalizeAreaForSpeech(area.replace(/\s+County$/i, ' County')));
  });
  if (!byState.size && areas.length) byState.set('the affected area', areas);
  return [...byState.entries()].map(([stateName, counties]) => ({ stateName, counties }));
}

function isAdminMessage(alertOrProperties = {}) {
  const p = alertOrProperties.properties || alertOrProperties || {};
  return p.adminMessage === true || String(p.event || '').toLowerCase().includes('administrative message');
}

function shortAlertSpeechText(alertOrProperties = {}) {
  const p = alertOrProperties.properties || alertOrProperties || {};
  if (isAdminMessage(p)) {
    const parts = ['Fulton County Disaster Response in Rochester, Indiana has issued an Administrative Message.'];
    if (p.headline) parts.push(String(p.headline));
    if (p.description) parts.push(String(p.description));
    return normalizeTtsText(parts.join(' '));
  }
  const office = cleanOfficeName(alertOffice(p));
  const event = String(p.event || 'weather alert').replace(/\s+/g, ' ').trim();
  const groups = alertAreaGroups(p);
  const statePhrase = groups.length
    ? groups.map((g, idx) => {
        const label = g.counties.length === 1 ? 'county' : 'counties';
        const place = g.stateName === 'the affected area'
          ? `the following ${label}; ${g.counties.join(', ')}`
          : `the following ${label} in ${g.stateName}; ${g.counties.join(', ')}`;
        if (idx === 0) return place;
        return `and ${place}`;
      }).join(', ')
    : 'the selected area';
  const expires = (p.expires || p.ends) ? ` This alert expires ${formatAlertTime(p.expires || p.ends)}.` : '';
  const motion = alertMotionText(p);
  const motionLine = motion ? ` Storm motion is ${motion}.` : '';
  return normalizeTtsText(`The National Weather Service in ${office} has issued a ${event} for ${statePhrase}.${expires}${motionLine}`);
}

function normalizeDirection(raw = '') {
  const input = String(raw || '').trim().toUpperCase();
  const map = {
    NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W',
    NORTHEAST: 'NE', NORTHWEST: 'NW', SOUTHEAST: 'SE', SOUTHWEST: 'SW',
    'NORTH EAST': 'NE', 'NORTH WEST': 'NW', 'SOUTH EAST': 'SE', 'SOUTH WEST': 'SW'
  };
  return map[input] || input;
}

function alertMotionText(p = {}) {
  const text = `${p.description || ''}\n${p.instruction || ''}`;
  const patterns = [
    /(?:moving|movement\s+was)\s+(northwest|northeast|southwest|southeast|north|south|east|west|nw|ne|sw|se|n|s|e|w)\s+(?:at\s+)?(\d{1,3})\s*mph/i,
    /motion\s*[:.]{1,3}\s*(northwest|northeast|southwest|southeast|north|south|east|west|nw|ne|sw|se|n|s|e|w)\s+(\d{1,3})\s*mph/i,
    /storm\s+motion\s*[:.]{1,3}\s*(northwest|northeast|southwest|southeast|north|south|east|west|nw|ne|sw|se|n|s|e|w)\s+(\d{1,3})\s*mph/i
  ];
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m) return `${normalizeDirection(m[1])} at ${m[2]} mph`;
  }
  const direct = firstParam(p.parameters, ['eventMotionDescription', 'stormMotion', 'stormMotionDescription']);
  const directMatch = String(direct || '').match(/(?:moving|movement\s+was)?\s*(northwest|northeast|southwest|southeast|north|south|east|west|nw|ne|sw|se|n|s|e|w)\s+(?:at\s+)?(\d{1,3})\s*mph/i);
  if (directMatch) return `${normalizeDirection(directMatch[1])} at ${directMatch[2]} mph`;
  return '';
}

function parseStormMotion(text = '') {
  const normalized = String(text).toUpperCase();
  const m = normalized.match(/\b(N|S|E|W|NE|NW|SE|SW)\b(?:\s+AT)?\s+(\d{1,3})?\s*MPH?/);
  const dirMatch = m || normalized.match(/\b(N|S|E|W|NE|NW|SE|SW)\b/);
  if (!dirMatch) return null;
  const dir = dirMatch[1];
  const speed = m && m[2] ? Number(m[2]) : null;
  const bearings = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };
  return { direction: dir, bearing: bearings[dir], speed, text: String(text) };
}

function extractCapsField(text = '', label = '') {
  const pattern = new RegExp(`(?:^|\\n)\\s*${label}\\s*\\.\\.\\.\\s*([^\\n]+(?:\\n(?![A-Z][A-Z ]+\\.\\.\\.).+)*)`, 'i');
  const m = String(text || '').match(pattern);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

function nwsSections(text = '') {
  const raw = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!raw) return '';
  const lines = raw.split('\n');
  let html = '';
  let buffer = [];
  const flush = () => {
    const body = buffer.join('\n').trim();
    if (body) html += `<p>${safe(body)}</p>`;
    buffer = [];
  };
  for (const line of lines) {
    const trimmed = line.trim();
    const m = trimmed.match(/^([A-Z][A-Z0-9 /()-]{2,}?)(?:\.\.\.|:)\s*(.*)$/);
    if (m && m[1].length <= 48) {
      flush();
      html += `<h4>${safe(m[1].replace(/\s+/g, ' '))}</h4>`;
      if (m[2]) buffer.push(m[2]);
    } else {
      buffer.push(line);
    }
  }
  flush();
  return html;
}

function extractTornadoInfo(p = {}) {
  const params = p.parameters || {};
  const fromParam = firstParam(params, ['tornadoDetection', 'tornadoDamageThreat', 'tornadoDetectionStatus']);
  if (fromParam) return fromParam;
  const text = `${p.description || ''}\n${p.instruction || ''}`;
  return extractCapsField(text, 'TORNADO') || '';
}

function alertImpactRows(p = {}) {
  const params = p.parameters || {};
  const rows = [];
  const text = `${p.description || ''}\n${p.instruction || ''}`;
  const tornado = extractTornadoInfo(p);
  const thunder = firstParam(params, ['thunderstormDamageThreat']);
  const wind = firstParam(params, ['maxWindGust', 'windThreat']) || extractCapsField(text, 'WIND');
  const hail = firstParam(params, ['maxHailSize', 'hailThreat']) || extractCapsField(text, 'HAIL');
  const source = extractCapsField(text, 'SOURCE');
  const impact = extractCapsField(text, 'IMPACT');
  const flash = firstParam(params, ['flashFloodDamageThreat']) || extractCapsField(text, 'FLASH FLOOD');
  const motion = alertMotionText(p);
  if (tornado) rows.push(['Tornado', tornado]);
  if (thunder) rows.push(['Storm threat', thunder]);
  if (wind) rows.push(['Wind', wind]);
  if (hail) rows.push(['Hail', hail]);
  if (source) rows.push(['Source', source]);
  if (impact) rows.push(['Impact', impact]);
  if (flash) rows.push(['Flood threat', flash]);
  if (motion) rows.push(['Storm motion', motion]);
  return rows;
}

function summarizeText(text = '', max = 560) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trim()}…`;
}

function fullAlertSpeechText(alertOrProperties = {}) {
  const p = alertOrProperties.properties || alertOrProperties || {};
  if (isAdminMessage(p)) {
    const chunks = ['Fulton County Disaster Response in Rochester, Indiana has issued an Administrative Message.'];
    if (p.headline) chunks.push(p.headline);
    if (p.description) chunks.push(p.description);
    return normalizeTtsText(chunks.join(' '));
  }
  const chunks = [];
  if (p.event) chunks.push(p.event);
  if (p.headline && !String(p.headline).includes(String(p.event || ''))) chunks.push(p.headline);
  if (p.areaDesc) chunks.push(`Areas affected: ${p.areaDesc}.`);
  if (p.sent || p.effective) chunks.push(`Issued ${formatAlertTime(p.sent || p.effective)}.`);
  if (p.expires || p.ends) chunks.push(`Expires ${formatAlertTime(p.expires || p.ends)}.`);
  const impactRows = alertImpactRows(p).map(([label, value]) => `${label}: ${value}.`).join(' ');
  if (impactRows) chunks.push(impactRows);
  if (p.description) chunks.push(p.description);
  const instruction = alertInstruction(p);
  if (instruction) chunks.push(`Precautionary preparedness actions. ${instruction}`);
  return normalizeTtsText(chunks.join('\n\n').replace(/\*+/g, '').replace(/\n{3,}/g, '\n\n').trim());
}

function alertSpeechText(alertOrProperties = {}, mode = state.ttsMode || 'short') {
  return mode === 'full' ? fullAlertSpeechText(alertOrProperties) : shortAlertSpeechText(alertOrProperties);
}

function setTtsButtonState(id = '', playing = false) {
  const wanted = String(id || '');
  document.querySelectorAll('.tts-alert-btn').forEach(btn => {
    if (wanted && String(btn.dataset.speakAlertId || '') !== wanted) return;
    btn.classList.toggle('is-playing', playing);
    btn.textContent = playing ? '■ Stop' : '▶ Listen';
    btn.setAttribute('aria-pressed', playing ? 'true' : 'false');
  });
}

function stopTts() {
  const current = state.activeTts;
  if (current?.audio) {
    current.audio.pause();
    current.audio.currentTime = 0;
  }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  if (current?.url) URL.revokeObjectURL(current.url);
  if (current?.id) setTtsButtonState(current.id, false);
  state.activeTts = null;
}

function getBrowserTtsVoices() {
  if (!('speechSynthesis' in window)) return [];
  return window.speechSynthesis.getVoices?.() || [];
}

function davidVoiceCandidate(voices = getBrowserTtsVoices()) {
  return voices.find(v => /microsoft\s+david/i.test(v.name || ''))
      || voices.find(v => /\bdavid\b/i.test(v.name || ''))
      || voices.find(v => /^en[-_]US/i.test(v.lang || ''))
      || voices.find(v => /^en[-_]/i.test(v.lang || ''))
      || voices[0]
      || null;
}

function selectedBrowserTtsVoice() {
  const voices = getBrowserTtsVoices();
  const uri = state.ttsVoiceURI || 'david';
  if (uri === 'david') return davidVoiceCandidate(voices);
  if (!uri) return null;
  return voices.find(v => v.voiceURI === uri || v.name === uri) || null;
}

function populateBrowserVoiceSelect() {
  const select = $('ttsVoiceSelect');
  if (!select || !('speechSynthesis' in window)) return;
  const voices = getBrowserTtsVoices();
  const current = state.ttsVoiceURI || 'david';
  select.innerHTML = '<option value="david">Microsoft David / default US male voice</option><option value="">System default browser voice</option>' + voices.map(v => {
    const label = `${v.name}${v.lang ? ` (${v.lang})` : ''}`;
    return `<option value="${safe(v.voiceURI || v.name)}">${safe(label)}</option>`;
  }).join('');
  select.value = current;
}


function findAlertById(id = '') {
  const wanted = String(id || '');
  return [...(state.alerts || []), ...(state.adminMessages || [])].find(a => canonicalAlertId(a) === wanted || canonicalAlertId(a.properties || {}) === wanted);
}

async function speakAlert(alertOrProperties = {}, options = {}) {
  const p = alertOrProperties.properties || alertOrProperties || {};
  const id = options.id || canonicalAlertId(p);
  const mode = options.mode || state.ttsMode || 'short';
  const text = alertSpeechText(p, mode);
  if (!text) return;
  if (options.requireToggle !== false && !$('ttsToggle')?.checked) return;

  if (state.activeTts?.id === id) {
    stopTts();
    return;
  }
  stopTts();
  state.activeTts = { id };
  setTtsButtonState(id, true);

  if (!('speechSynthesis' in window) || !window.SpeechSynthesisUtterance) {
    stopTts();
    setStatus('Text-to-speech is not supported by this browser.');
    return;
  }

  const utterance = new SpeechSynthesisUtterance(text);
  const voice = selectedBrowserTtsVoice();
  if (voice) utterance.voice = voice;
  utterance.rate = 0.96;
  utterance.pitch = 1;
  utterance.volume = 1;
  utterance.onend = () => { if (state.activeTts?.id === id) stopTts(); };
  utterance.onerror = () => { if (state.activeTts?.id === id) stopTts(); };
  state.activeTts.utterance = utterance;
  window.speechSynthesis.speak(utterance);
}

function speakAlertById(id = '') {
  const alert = findAlertById(id);
  if (alert) speakAlert(alert, { requireToggle: false, id });
}

function buildAlertPopup(feature, options = {}) {
  const p = feature.properties || {};
  const event = p.event || 'Weather Alert';
  const alertKey = canonicalAlertId(p);
  const listenButton = `<button class="popup-action tts-alert-btn" type="button" data-speak-alert-id="${safe(alertKey)}">▶ Listen</button>`;
  const fullUrl = fullAlertUrl(p);
  const fullLink = fullUrl ? `<a class="popup-action popup-link-action" target="_blank" rel="noopener" href="${safe(fullUrl)}">Open API</a>` : '';
  const backButton = options.back ? `<button class="popup-back-btn popup-back-link" type="button">Back to Alerts</button>` : '';
  return `
    <div class="alert-popup-card ${alertClass(event)}" data-popup-alert-id="${safe(alertKey)}">
      <img class="alert-popup-image" src="${safe(alertImageUrl(event))}" alt="${safe(event)} image" onerror="this.onerror=null;this.src='/assets/weather-alerts/statement.png';">
      <div class="popup-scroll-body alert-detail-scroll">
        <div class="alert-detail-title">
          <div class="popup-kicker">${safe(alertOffice(p))}</div>
          <h3>${safe(event)}</h3>
          <div class="popup-times"><strong>Issued:</strong> ${safe(formatAlertTime(p.sent || p.effective))}${p.expires || p.ends ? ` · <strong>Until:</strong> ${safe(formatAlertTime(p.expires || p.ends))}` : ''}</div>
        </div>
        <div class="alert-detail-info">${alertDetailInfo(p)}</div>
        ${backButton}
        <div class="popup-footer">${fullLink}${listenButton}</div>
      </div>
    </div>
  `;
}

function alertPopupLatLng(alert) {
  const center = featureCenter(alert);
  if (center) return L.latLng(center[0], center[1]);
  return L.latLng(state.lat, state.lon);
}

function openAlertPopupForAlert(alert, options = {}) {
  if (!alert?.properties) return;
  const latlng = options.latlng || alertPopupLatLng(alert);
  const nearby = options.forceSingle ? [] : alertsAtLatLng(latlng);
  map._lastPopupAlertList = nearby.length > 1 ? nearby : [alert];
  const content = options.forceSingle || nearby.length <= 1 ? buildAlertPopup(alert, { back: false }) : buildAlertListPopup(nearby);
  const zoom = Math.max(map.getZoom(), options.zoom || 10);
  if (options.pan !== false) map.setView(latlng, zoom, { animate: true });
  L.popup({
    maxWidth: 460,
    className: 'alert-detail-popup',
    autoPan: true,
    keepInView: true,
    autoPanPaddingTopLeft: [24, 96],
    autoPanPaddingBottomRight: [24, 24]
  }).setLatLng(latlng).setContent(content).openOn(map);
}

function flattenCoords(coords, out = []) {
  if (!Array.isArray(coords)) return out;
  if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
    out.push([coords[1], coords[0]]);
    return out;
  }
  coords.forEach(c => flattenCoords(c, out));
  return out;
}

function featureCenter(feature) {
  const pts = flattenCoords(feature.geometry?.coordinates || []);
  if (!pts.length) return null;
  const lat = pts.reduce((sum, p) => sum + p[0], 0) / pts.length;
  const lon = pts.reduce((sum, p) => sum + p[1], 0) / pts.length;
  return [lat, lon];
}

function destinationPoint(lat, lon, bearingDeg, distanceMiles) {
  const R = 3958.7613;
  const brng = bearingDeg * Math.PI / 180;
  const phi1 = lat * Math.PI / 180;
  const lambda1 = lon * Math.PI / 180;
  const d = distanceMiles / R;
  const phi2 = Math.asin(Math.sin(phi1) * Math.cos(d) + Math.cos(phi1) * Math.sin(d) * Math.cos(brng));
  const lambda2 = lambda1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(phi1), Math.cos(d) - Math.sin(phi1) * Math.sin(phi2));
  return [phi2 * 180 / Math.PI, lambda2 * 180 / Math.PI];
}

function addStormMotionOverlay(feature) {
  const p = feature.properties || {};
  const motion = parseStormMotion(alertMotionText(p));
  const center = featureCenter(feature);
  if (!motion || !center) return;
  const length = Math.max(8, Math.min(45, motion.speed || 20));
  const start = destinationPoint(center[0], center[1], (motion.bearing + 180) % 360, length * 0.45);
  const end = destinationPoint(center[0], center[1], motion.bearing, length * 0.75);
  const color = alertColor(p.event || '');
  const line = L.polyline([start, end], { color, weight: 4, opacity: 0.95, dashArray: '8 6', interactive: false });
  const arrow = L.marker(end, {
    interactive: false,
    icon: L.divIcon({
      className: 'storm-motion-arrow',
      html: `<span style="transform: rotate(${motion.bearing}deg)">➤</span>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    })
  });
  const label = L.marker(center, {
    interactive: false,
    icon: L.divIcon({
      className: 'storm-motion-label',
      html: `${safe(motion.direction)}${motion.speed ? ` ${motion.speed} mph` : ''}`,
      iconSize: [86, 24],
      iconAnchor: [43, 12]
    })
  });
  stormMotionLayer.addLayer(line);
  stormMotionLayer.addLayer(arrow);
  stormMotionLayer.addLayer(label);
}
function hazardAllowed(event = '') {
  const stormHazards = ['Tornado', 'Severe Thunderstorm', 'Flash Flood', 'Special Weather'];
  const hazardMatch = [...state.enabledHazards].some(h => event.includes(h));
  const isStormHazard = stormHazards.some(h => event.includes(h));
  const kindAllowed = state.enabledKinds.has(alertKind(event));
  return kindAllowed && (!isStormHazard || hazardMatch);
}

function soundEventForKey(event = '', soundKey = 'auto') {
  if (soundKey === 'tornado') return 'Tornado Warning';
  if (soundKey === 'warning') return 'Severe Thunderstorm Warning';
  if (soundKey === 'watch') return 'Tornado Watch';
  if (soundKey === 'advisory') return 'Wind Advisory';
  if (soundKey === 'statement') return 'Special Weather Statement';
  if (soundKey === 'silent') return 'Silent';
  return event || 'Special Weather Statement';
}

function playToneSequence(sequence = []) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx || !sequence.length) return;
  const ctx = new AudioCtx();
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.001, ctx.currentTime);
  master.gain.exponentialRampToValueAtTime(0.52, ctx.currentTime + 0.02);
  master.connect(ctx.destination);
  let offset = 0;
  sequence.forEach(step => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const duration = Math.max(30, Number(step.duration || 120)) / 1000;
    osc.type = step.wave || 'sine';
    osc.frequency.setValueAtTime(Number(step.frequency || 440), ctx.currentTime + offset);
    gain.gain.setValueAtTime(0.001, ctx.currentTime + offset);
    gain.gain.exponentialRampToValueAtTime(0.95, ctx.currentTime + offset + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + Math.max(0.025, duration - 0.015));
    osc.connect(gain);
    gain.connect(master);
    osc.start(ctx.currentTime + offset);
    osc.stop(ctx.currentTime + offset + duration);
    offset += duration + 0.025;
  });
  master.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.12);
  setTimeout(() => ctx.close(), Math.ceil((offset + 0.4) * 1000));
}

function alertToneSequence(event = '', soundKey = 'auto', severity = '') {
  const normalized = soundEventForKey(event, soundKey);
  const sev = String(severity || '').toLowerCase();
  if (soundKey === 'admin-green') return [
    { wave: 'sine', frequency: 659, duration: 110 },
    { wave: 'sine', frequency: 784, duration: 110 },
    { wave: 'sine', frequency: 988, duration: 180 }
  ];
  if (soundKey === 'admin-red') return [
    { wave: 'square', frequency: 622, duration: 120 },
    { wave: 'square', frequency: 466, duration: 120 },
    { wave: 'square', frequency: 622, duration: 120 },
    { wave: 'sine', frequency: 740, duration: 220 }
  ];
  if (normalized.includes('Tornado') || sev === 'extreme') return [
    { wave: 'square', frequency: 1563, duration: 90 },
    { wave: 'square', frequency: 2083, duration: 90 },
    { wave: 'square', frequency: 1563, duration: 90 },
    { wave: 'square', frequency: 2083, duration: 90 },
    { wave: 'sine', frequency: 960, duration: 180 },
    { wave: 'sine', frequency: 853, duration: 180 },
    { wave: 'square', frequency: 1563, duration: 120 },
    { wave: 'square', frequency: 2083, duration: 110 }
  ];
  if (normalized.includes('Flash Flood')) return [
    { wave: 'sawtooth', frequency: 880, duration: 110 },
    { wave: 'sawtooth', frequency: 587, duration: 110 },
    { wave: 'square', frequency: 880, duration: 110 },
    { wave: 'square', frequency: 587, duration: 220 }
  ];
  if (normalized.includes('Severe Thunderstorm')) return [
    { wave: 'square', frequency: 988, duration: 100 },
    { wave: 'square', frequency: 740, duration: 100 },
    { wave: 'square', frequency: 988, duration: 100 },
    { wave: 'triangle', frequency: 622, duration: 210 }
  ];
  if (normalized.includes('Warning')) return [
    { wave: 'square', frequency: 932, duration: 110 },
    { wave: 'square', frequency: 698, duration: 110 },
    { wave: 'square', frequency: 932, duration: 110 },
    { wave: 'sine', frequency: 784, duration: 200 }
  ];
  if (normalized.includes('Watch')) return [
    { wave: 'triangle', frequency: 659, duration: 130 },
    { wave: 'triangle', frequency: 523, duration: 130 },
    { wave: 'sine', frequency: 659, duration: 240 }
  ];
  if (normalized.includes('Advisory')) return [
    { wave: 'sine', frequency: 587, duration: 120 },
    { wave: 'sine', frequency: 494, duration: 160 },
    { wave: 'sine', frequency: 440, duration: 220 }
  ];
  return [
    { wave: 'sine', frequency: 523, duration: 150 },
    { wave: 'sine', frequency: 659, duration: 200 }
  ];
}

function soundAssetKeys(event = '', soundKey = 'auto', severity = '') {
  const normalized = soundEventForKey(event, soundKey);
  const sev = String(severity || '').toLowerCase();
  if (soundKey === 'admin-green') return ['admin-green', 'administrative-green'];
  if (soundKey === 'admin-red') return ['admin-red', 'administrative-red'];
  if (normalized.includes('Tornado') || sev === 'extreme') return ['tornado', 'high', 'warning'];
  if (normalized.includes('Flash Flood')) return ['flash-flood', 'warning'];
  if (normalized.includes('Severe Thunderstorm')) return ['severe-thunderstorm', 'warning'];
  if (normalized.includes('Warning')) return ['warning'];
  if (normalized.includes('Watch')) return ['watch'];
  if (normalized.includes('Advisory')) return ['advisory'];
  return ['statement', 'alert'];
}

function tryPlaySoundFile(keys = [], onFail = () => {}) {
  const formats = ['mp3', 'wav', 'ogg'];
  const sources = [];
  keys.forEach(key => formats.forEach(ext => sources.push(`/sounds/${key}.${ext}`)));
  let i = 0;
  const tryNext = () => {
    if (i >= sources.length) return onFail();
    const audio = new Audio(sources[i++]);
    audio.volume = 1;
    audio.preload = 'auto';
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      tryNext();
    };
    audio.addEventListener('canplaythrough', () => {
      if (settled) return;
      settled = true;
      audio.play().catch(fail);
    }, { once: true });
    audio.addEventListener('error', fail, { once: true });
    setTimeout(fail, 900);
    audio.load();
  };
  tryNext();
}

function playAlertSound(event = '', soundKey = 'auto', severity = '') {
  if (soundKey === 'silent') return;
  if (!$('soundToggle')?.checked) return;
  const audio = new Audio('/sounds/alert.wav');
  audio.volume = 1;
  audio.preload = 'auto';
  audio.play().catch(() => {});
}

function toastAlert(alert, force = false) {
  if (!$('popupToggle').checked && !force) return;
  const p = alert.properties || alert;
  const id = canonicalAlertId(p);
  if (state.notifiedIds.has(id) && !force) return;
  state.notifiedIds.add(id);
  const el = document.createElement('div');
  const kind = alertKind(p.event);
  el.className = `toast ${kind === 'Warning' ? 'danger' : kind.toLowerCase()}`;
  el.innerHTML = `<strong>${safe(p.event || 'Weather Alert')}</strong><div>${safe(p.headline || 'Active weather hazard')}</div><div class="small">${safe(p.severity || '')} · ${safe(p.urgency || '')}</div>`;
  toastStack.prepend(el);
  playAlertSound(p.event || '', p.soundKey || 'auto', p.severity || '');
  speakAlert(p, { requireToggle: true });
  setTimeout(() => el.remove(), 13000);
}


function isExpiredMessage(alert) {
  const p = alert.properties || alert || {};
  const expires = Date.parse(p.expires || p.ends || '');
  return Number.isFinite(expires) && expires <= Date.now();
}

function renderAdminMessages() {
  if (!adminMessageStack) return;
  state.adminMessages = (state.adminMessages || []).filter(a => !isExpiredMessage(a)).slice(0, 1);
  adminMessageStack.innerHTML = state.adminMessages.map(alert => {
    const p = alert.properties || {};
    const id = canonicalAlertId(p);
    const sev = String(p.adminSeverity || p.severity || 'green').toLowerCase() === 'red' ? 'red' : 'green';
    const expires = p.expires ? `<div class="admin-message-expire">Expires ${safe(formatAlertTime(p.expires))}</div>` : '';
    const issuedTime = formatAlertTime(p.sent || p.effective || Date.now());
    const issued = `<div class="admin-message-issued">- Issued by Fulton County Disaster Response in Rochester, Indiana at ${safe(issuedTime)}</div>`;
    return `<article class="admin-message-banner ${sev}" data-alert-id="${safe(id)}">
      <div class="admin-message-main">
        <div class="admin-message-label">Administrative Message</div>
        <h2>${safe(p.headline || 'Administrative Message')}</h2>
        <p>${safe(p.description || '')}</p>
      </div>
      <div class="admin-message-meta">${expires}${issued}</div>
      <button class="listen-btn tts-alert-btn" type="button" data-speak-alert-id="${safe(id)}">▶ Listen</button>
    </article>`;
  }).join('');
}

async function loadAdminMessages() {
  try {
    const data = await api('/api/admin-messages');
    state.adminMessages = (data.messages || []).filter(a => !isExpiredMessage(a));
    renderAdminMessages();
  } catch {}
}

function receiveAdminAlert(alert) {
  if (!alert?.properties) return;
  const id = canonicalAlertId(alert);
  if (isAdminMessage(alert)) {
    const wasAlreadyDisplayed = (state.adminMessages || []).some(a => canonicalAlertId(a) === id || canonicalAlertId(a.properties || {}) === id);
    state.adminMessages = [alert].filter(a => !isExpiredMessage(a)).slice(0, 1);
    renderAdminMessages();
    // Existing/persisted admin messages are shown silently. Only a genuinely new real-time admin message sounds/reads.
    if (!wasAlreadyDisplayed) {
      playAlertSound(alert.properties.event || 'Administrative Message', alert.properties.soundKey || 'admin-green', alert.properties.severity || '');
      speakAlert(alert, { requireToggle: true, id });
    }
    return;
  }
  state.alerts = [alert, ...state.alerts.filter(a => canonicalAlertId(a) !== id)].slice(0, 60);
  state.activeAlertIds.add(id);
  renderAlerts();
  toastAlert(alert, true);
}

function applyAlertFeed(alerts = [], options = {}) {
  const { notify = true, resetBaseline = false } = options;
  const nextAlerts = Array.isArray(alerts) ? alerts : [];
  const nextIds = new Set(nextAlerts.map(canonicalAlertId).filter(Boolean));

  if (resetBaseline) {
    state.alertMonitorInitialized = false;
    state.notifiedIds.clear();
  }

  const isFirstFeed = !state.alertMonitorInitialized;
  const newAlerts = nextAlerts.filter(a => {
    const id = canonicalAlertId(a);
    return id && !state.activeAlertIds.has(id);
  });

  state.alerts = nextAlerts;
  state.activeAlertIds = nextIds;
  renderAlerts();

  if (isFirstFeed) {
    nextIds.forEach(id => state.notifiedIds.add(id));
    state.alertMonitorInitialized = true;
    return;
  }

  if (notify) newAlerts.forEach(a => toastAlert(a));
}

function connectAdminAlertStream() {
  if (!window.EventSource) return;
  const events = new EventSource('/api/events');
  events.addEventListener('fake-alert', (message) => {
    try { receiveAdminAlert(JSON.parse(message.data)); } catch {}
  });
  events.onerror = () => {
    // Browser will automatically retry the SSE connection.
  };
}

function renderAlerts() {
  const filtered = state.alerts.filter(a => hazardAllowed(a.properties?.event || ''));
  $('alertMetric').textContent = String(filtered.length);
  const scope = state.spotterMode ? 'Spotter Mode — all severe/tornado alerts' : `Selected Area — ${state.label}`;
  const grouped = filtered.reduce((acc, alert) => {
    const kind = alertKind(alert.properties?.event || 'Statement');
    (acc[kind] ||= []).push(alert);
    return acc;
  }, {});
  const order = ['Warning', 'Watch', 'Advisory', 'Statement'];
  const body = order.filter(kind => grouped[kind]?.length).map(kind => `
    <div class="alert-category">
      <div class="alert-category-title"><span>${safe(kind)}s</span><span>${grouped[kind].length}</span></div>
      ${grouped[kind].map(a => {
        const p = a.properties || {};
        const id = canonicalAlertId(p);
        return `<div class="card alert-card ${alertClass(p.event)}" data-open-alert-id="${safe(id)}" role="button" tabindex="0"><div class="alert-card-head"><strong>${safe(p.event)}</strong><button class="listen-btn tts-alert-btn" type="button" data-speak-alert-id="${safe(id)}">▶ Listen</button></div><div>${safe(p.headline || '')}</div><div class="small">${safe(p.severity || '')} · ${safe(p.urgency || '')}</div></div>`;
      }).join('')}
    </div>
  `).join('');
  alertsEl.innerHTML = `<div class="alert-scope">${safe(scope)}</div>` + (body || '<div class="card">No enabled active alerts for this location.</div>');
  alertLayer.clearLayers();
  stormMotionLayer.clearLayers();
  if ($('alertsLayerToggle').checked) {
    const mapped = filtered.filter(a => a.geometry);
    alertLayer.addData({ type: 'FeatureCollection', features: mapped });
    if ($('stormMotionToggle')?.checked) mapped.forEach(addStormMotionOverlay);
  }
}

function renderForecast(hourly = []) {
  forecastEl.innerHTML = hourly.slice(0, 14).map(p => `
    <div class="card"><strong>${safe(p.name)}: ${safe(fmtTemp(p))} · ${safe(p.shortForecast)}</strong><div class="small">Wind ${safe(p.windSpeed)} ${safe(p.windDirection)}</div></div>
  `).join('') || '<div class="card">Forecast unavailable.</div>';
}

function stationLabel(station) {
  if (!station) return '—';
  const stripStationUrl = value => String(value || '')
    .replace(/https:\/\/api\.weather\.gov\/stations\//g, '')
    .replace(/\/observations\/latest/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (typeof station === 'string') return stripStationUrl(station) || '—';

  const display = stripStationUrl(station.displayName);
  if (display) return display;

  const id = stripStationUrl(station.id);
  const name = stripStationUrl(station.name);
  const label = [id, name].filter(Boolean).join(' ');
  return label || '—';
}

function renderStations(stations = []) {
  observationsEl.innerHTML = stations.slice(0, 8).map((s, index) => `
    <div class="card"><strong>${safe(stationLabel(s))}</strong><div class="small">${index === 0 ? 'Selected nearest station' : 'Nearby station'}${Number.isFinite(s.distanceMiles) ? ` · ${s.distanceMiles.toFixed(1)} mi away` : ''}</div></div>
  `).join('') || '<div class="card">Observation stations unavailable.</div>';
}

async function renderCurrentConditions(stationOrStations) {
  const candidates = Array.isArray(stationOrStations) ? stationOrStations : [stationOrStations].filter(Boolean);
  if (!candidates.length) {
    currentEl.innerHTML = 'No nearby station was returned for this location.';
    return;
  }
  let lastError = null;
  for (const station of candidates.slice(0, 6)) {
    try {
      const qs = station.stationUrl ? `stationUrl=${encodeURIComponent(station.stationUrl)}` : `station=${encodeURIComponent(station.id)}`;
      const obs = await api(`/api/observations/latest?${qs}`);
      const temp = formatObservationValue(obs.temperature?.value, obs.temperature?.unitCode);
      const wind = formatObservationValue(obs.windSpeed?.value, obs.windSpeed?.unitCode);
      const dew = formatObservationValue(obs.dewpoint?.value, obs.dewpoint?.unitCode);
      const windDir = formatWindDirection(obs.windDirection?.value);
      const desc = obs.textDescription || 'Latest NWS observation';
      $('stationMetric').textContent = stationLabel(station);
      windMarkerLayer.clearLayers();
      const coords = Array.isArray(station.geometry?.coordinates) ? station.geometry.coordinates : [];
      if (windDir && Number.isFinite(Number(coords[1])) && Number.isFinite(Number(coords[0]))) {
        windMarkerLayer.addLayer(L.marker([Number(coords[1]), Number(coords[0])], {
          interactive: false,
          icon: L.divIcon({ className: 'wind-direction-marker', html: `<span title="Wind ${safe(windDir)}" style="transform: rotate(${Number(obs.windDirection?.value || 0) + 180}deg)">➤</span>`, iconSize: [28,28], iconAnchor: [14,14] })
        }));
      }
      currentEl.innerHTML = `
        <div class="current-main">${safe(temp)}</div>
        <div class="current-sub">${safe(desc)}</div>
        <div class="small"><strong>Station:</strong> ${safe(stationLabel(station))}</div>
        <div class="small"><strong>Distance:</strong> ${Number.isFinite(station.distanceMiles) ? `${station.distanceMiles.toFixed(1)} mi` : 'Unavailable'}</div>
        <div class="small"><strong>Wind:</strong> ${safe([wind, windDir].filter(Boolean).join(' from '))}</div>
        <div class="small"><strong>Dew Point:</strong> ${safe(dew)}</div>
        <div class="small"><strong>Updated:</strong> ${safe(obs.timestamp ? new Date(obs.timestamp).toLocaleString() : 'Unavailable')}</div>
      `;
      return;
    } catch (err) {
      lastError = err;
    }
  }
  currentEl.innerHTML = `<div class="small">Current observation error: ${safe(lastError?.message || 'No nearby station had current observations.')}</div>`;
}

async function resolveLocation(query) {
  const pair = query.split(',').map(s => Number(s.trim()));
  if (pair.length === 2 && Number.isFinite(pair[0]) && Number.isFinite(pair[1])) {
    return { label: `${pair[0].toFixed(4)}, ${pair[1].toFixed(4)}`, lat: pair[0], lon: pair[1], geojson: null };
  }
  return api(`/api/geocode?q=${encodeURIComponent(query)}`);
}

async function drawBoundary(geojson, options = {}) {
  const { fit = false } = options;
  boundaryLayer.clearLayers();
  state.lastGeojson = geojson;
  if (!$('boundaryToggle').checked || !$('countiesToggle').checked || !geojson) return;
  boundaryLayer.addData(geojson);
  if (fit) {
    try { map.fitBounds(boundaryLayer.getBounds(), { padding: [90, 90] }); } catch {}
  }
}


async function loadSpotterAlerts(options = {}) {
  if (options.setStatus !== false) setStatus('Spotter Mode: loading all active Tornado Warnings, Tornado Watches, and Severe Thunderstorm Warnings...');
  const data = await api('/api/alerts/spotter');
  applyAlertFeed(data.alerts || [], { notify: options.notify !== false, resetBaseline: options.resetBaseline === true });
  if (options.setStatus !== false) setStatus(`Spotter Mode active: monitoring ${state.alerts.length} national severe/tornado alerts, independent of the selected location.`);
  return state.alerts;
}

function formatWindDirection(deg) {
  const n = Number(deg);
  if (!Number.isFinite(n)) return '';
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return `${dirs[Math.round(n / 22.5) % 16]} ${Math.round(n)}°`;
}

async function reverseSelectLocation(lat, lon) {
  setStatus('Finding nearest named location...');
  const loc = await api(`/api/reverse-geocode?lat=${lat}&lon=${lon}`);
  $('locationSearch').value = loc.label;
  await loadWeather(loc.lat, loc.lon, loc.label, loc.geojson, { fitBoundary: false, center: false, resetAlertBaseline: true });
}

async function loadWeather(lat, lon, label = `${lat}, ${lon}`, geojson = null, options = {}) {
  state.lat = lat;
  state.lon = lon;
  state.label = label;
  if (!options.skipLocationSave) {
    try { saveCurrentLocationPreference(); } catch {}
  }
  $('placeName').textContent = label;
  setStatus('Loading forecast, alerts, observation stations, and selected-area outline...');
  await drawBoundary(geojson ?? state.lastGeojson, { fit: options.fitBoundary === true });
  if (options.center === true && !geojson && !state.lastGeojson) map.setView([lat, lon], Math.max(map.getZoom(), 9));

  const [forecast, alerts, stations] = await Promise.all([
    api(`/api/forecast?lat=${lat}&lon=${lon}`),
    api(`/api/alerts?lat=${lat}&lon=${lon}`),
    api(`/api/stations?lat=${lat}&lon=${lon}`)
  ]);

  const place = forecast.location ? `${forecast.location.city || label}, ${forecast.location.state || ''}` : label;
  $('officeMetric').textContent = forecast.office || '—';
  $('stationMetric').textContent = stationLabel(stations[0]);
  setStatus(`Loaded ${place}. Radar, warnings, watches, advisories, and selected-area outline are active.`);

  state.stations = stations || [];
  renderForecast(forecast.hourly || []);
  renderStations(state.stations);
  await renderCurrentConditions(state.stations);

  state.selectedAlerts = alerts.alerts || [];
  if (state.spotterMode) {
    await loadSpotterAlerts({ setStatus: false });
  } else {
    applyAlertFeed(state.selectedAlerts, { notify: options.notify !== false, resetBaseline: options.resetAlertBaseline === true });
  }
}

function applyColorScheme(mode = 'auto') {
  state.colorScheme = mode;
  savePreferences({ colorScheme: mode });
  const dark = mode === 'dark' || (mode === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  appEl.dataset.colorScheme = dark ? 'dark' : 'light';
  refreshBoundaryStyle();
}

function setBasemap(key, options = {}) {
  const nextKey = basemaps[key] ? key : 'standard';
  const next = basemaps[nextKey] || basemaps.standard;
  if (!options.skipSave) savePreferences({ theme: nextKey });
  if (baseLayer) map.removeLayer(baseLayer);
  baseLayer = L.tileLayer(next.url, { updateWhenIdle: false, keepBuffer: 4, ...next.options }).addTo(map);
  baseLayer.bringToBack();
}


async function buildRadarFrames() {
  try {
    const data = await api('/api/radar/frames');
    state.radarFrames = (data.frames || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    state.radarFrameMs = Number(data.intervalMs) || (5 * 60 * 1000);
    state.radarIndex = Math.max(0, state.radarFrames.length - 1);
  } catch (err) {
    const now = Date.now();
    const rounded = Math.floor(now / state.radarFrameMs) * state.radarFrameMs;
    const frames = [];
    for (let i = 48; i >= 0; i -= 1) frames.push(rounded - (i * state.radarFrameMs));
    state.radarFrames = frames;
    state.radarIndex = frames.length - 1;
  }
}

function radarFrameLabel(frameMs, live = false) {
  const time = new Date(frameMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return live ? `Live · ${time}` : time;
}

function applyRadarFrame(index = state.radarIndex, options = {}) {
  if (!state.radarFrames.length) return;
  const max = state.radarFrames.length - 1;
  state.radarIndex = Math.max(0, Math.min(max, index));
  const frame = state.radarFrames[state.radarIndex];
  updateRadarImage();
  $('radarTimeLabel').textContent = radarFrameLabel(frame, options.live === true && state.radarIndex === max);
}

async function refreshRadar(label = null) {
  const wasLatest = state.radarIndex >= state.radarFrames.length - 1;
  await buildRadarFrames();
  if (!wasLatest) state.radarIndex = Math.min(state.radarIndex, state.radarFrames.length - 1);
  applyRadarFrame(state.radarIndex, { live: wasLatest });
  if (label) $('radarTimeLabel').textContent = label;
}

function setRadarPlaying(playing) {
  state.radarPlaying = playing;
  $('radarPlayPause').textContent = playing ? '⏸' : '▶';
  if (state.radarTimer) clearInterval(state.radarTimer);
  state.radarTimer = null;
  if (playing) {
    state.radarTimer = setInterval(() => {
      const next = state.radarIndex >= state.radarFrames.length - 1 ? 0 : state.radarIndex + 1;
      applyRadarFrame(next, { live: next === state.radarFrames.length - 1 });
    }, 900);
  }
}

let radarMoveTimer = null;
let preferenceMapMoveTimer = null;
map.on('moveend zoomend resize', () => {
  refreshBoundaryStyle();
  clearTimeout(radarMoveTimer);
  radarMoveTimer = setTimeout(updateRadarImage, 60);
  clearTimeout(preferenceMapMoveTimer);
  preferenceMapMoveTimer = setTimeout(() => { try { saveCurrentLocationPreference(); } catch {} }, 250);
});

map.on('dblclick', async (e) => {
  try {
    await reverseSelectLocation(Number(e.latlng.lat.toFixed(5)), Number(e.latlng.lng.toFixed(5)));
  } catch (err) {
    setStatus(`Location lookup error: ${err.message}`);
  }
});

$('locationForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const loc = await resolveLocation($('locationSearch').value.trim() || DEFAULT_LOCATION.label);
    await loadWeather(loc.lat, loc.lon, loc.label, loc.geojson, { fitBoundary: true, center: true, resetAlertBaseline: true });
  } catch (err) { setStatus(`Location error: ${err.message}`); }
});

$('locateBtn').addEventListener('click', () => {
  navigator.geolocation.getCurrentPosition(async pos => {
    const lat = Number(pos.coords.latitude.toFixed(5));
    const lon = Number(pos.coords.longitude.toFixed(5));
    await reverseSelectLocation(lat, lon);
    map.setView([lat, lon], Math.max(map.getZoom(), 11));
  }, err => setStatus(`Location error: ${err.message}`));
});

document.addEventListener('click', event => {
  const choice = event.target.closest?.('.popup-alert-choice');
  if (choice) {
    event.preventDefault();
    event.stopPropagation();
    const id = choice.dataset.popupAlertId || '';
    const alert = findAlertById(id);
    if (alert) {
      const latlng = map._popup?.getLatLng?.() || map.getCenter();
      const alerts = alertsAtLatLng(latlng);
      map._lastPopupAlertList = alerts;
      map._popup.setContent(buildAlertPopup(alert, { back: alerts.length > 1 }));
    }
    return;
  }
  const back = event.target.closest?.('.popup-back-btn');
  if (back) {
    event.preventDefault();
    event.stopPropagation();
    const alerts = map._lastPopupAlertList || [];
    if (alerts.length && map._popup) map._popup.setContent(buildAlertListPopup(alerts));
    return;
  }
  const openCard = event.target.closest?.('[data-open-alert-id]');
  if (openCard && !event.target.closest?.('.tts-alert-btn')) {
    event.preventDefault();
    event.stopPropagation();
    const alert = findAlertById(openCard.dataset.openAlertId || '');
    if (alert) openAlertPopupForAlert(alert, { forceSingle: true, zoom: 11 });
    return;
  }
  const btn = event.target.closest?.('.tts-alert-btn');
  if (!btn) return;
  event.preventDefault();
  event.stopPropagation();
  speakAlertById(btn.dataset.speakAlertId || '');
});

document.addEventListener('keydown', event => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const card = event.target.closest?.('[data-open-alert-id]');
  if (!card) return;
  event.preventDefault();
  const alert = findAlertById(card.dataset.openAlertId || '');
  if (alert) openAlertPopupForAlert(alert, { forceSingle: true, zoom: 11 });
});

$('ttsToggle')?.addEventListener('change', e => {
  savePreferences({ autoReadAlerts: e.target.checked });
  if (!e.target.checked) stopTts();
});
$('soundToggle')?.addEventListener('change', e => savePreferences({ soundEnabled: e.target.checked }));
$('popupToggle')?.addEventListener('change', e => savePreferences({ popupEnabled: e.target.checked }));
$('ttsModeSelect')?.addEventListener('change', e => { state.ttsMode = e.target.value; savePreferences({ ttsMode: state.ttsMode }); });
$('ttsVoiceSelect')?.addEventListener('change', e => { state.ttsVoiceURI = e.target.value; savePreferences({ ttsVoiceURI: state.ttsVoiceURI }); });

$('settingsBtn').addEventListener('click', () => $('settingsDrawer').classList.add('open'));
$('closeSettings').addEventListener('click', () => $('settingsDrawer').classList.remove('open'));
$('resetPreferencesBtn')?.addEventListener('click', () => { localStorage.removeItem(PREFS_KEY); location.reload(); });
$('themeSelect').addEventListener('change', e => setBasemap(e.target.value));
if ($('ttsModeSelect')) $('ttsModeSelect').value = state.ttsMode;
populateBrowserVoiceSelect();
if ('speechSynthesis' in window) window.speechSynthesis.onvoiceschanged = populateBrowserVoiceSelect;
$('displayModeSelect')?.addEventListener('change', e => applyColorScheme(e.target.value));
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (state.colorScheme === 'auto') applyColorScheme('auto'); });
$('radarToggle').addEventListener('change', e => { saveLayerPreference('radar', e.target.checked); if (e.target.checked) updateRadarImage(); else if (radarLayer) map.removeLayer(radarLayer); });
$('radarOpacity').addEventListener('input', e => { state.radarOpacity = Number(e.target.value) / 100; savePreferences({ radarOpacity: Number(e.target.value) }); if (radarLayer) radarLayer.setOpacity(state.radarOpacity); });
$('alertsLayerToggle').addEventListener('change', e => { saveLayerPreference('alerts', e.target.checked); renderAlerts(); });
$('stormMotionToggle')?.addEventListener('change', e => { saveLayerPreference('stormMotion', e.target.checked); renderAlerts(); });
$('spotterModeToggle')?.addEventListener('change', async e => {
  state.spotterMode = e.target.checked;
  savePreferences({ spotterMode: state.spotterMode });
  if (state.spotterMode) {
    await loadSpotterAlerts({ resetBaseline: true });
  } else {
    applyAlertFeed(state.selectedAlerts || [], { resetBaseline: true, notify: false });
    setStatus(`Spotter Mode off. Showing alerts for ${state.label}.`);
  }
});
$('boundaryToggle').addEventListener('change', e => { saveLayerPreference('boundary', e.target.checked); drawBoundary(state.lastGeojson, { fit: false }); });
$('countiesToggle').addEventListener('change', e => { saveLayerPreference('counties', e.target.checked); drawBoundary(state.lastGeojson, { fit: false }); });

document.querySelectorAll('.hazard-toggle').forEach(cb => cb.addEventListener('change', () => {
  state.enabledHazards = new Set([...document.querySelectorAll('.hazard-toggle:checked')].map(x => x.value));
  savePreferences({ hazards: [...state.enabledHazards] });
  renderAlerts();
}));
document.querySelectorAll('.alert-toggle').forEach(cb => cb.addEventListener('change', () => {
  state.enabledKinds = new Set([...document.querySelectorAll('.alert-toggle:checked')].map(x => x.value));
  savePreferences({ alertKinds: [...state.enabledKinds] });
  renderAlerts();
}));
document.querySelectorAll('.layer-btn[data-radar]').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.layer-btn[data-radar]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  savePreferences({ radarProduct: btn.dataset.radar || 'reflectivity' });
  if (btn.dataset.radar === 'alerts') {
    if (!$('alertsLayerToggle').checked) $('alertsLayerToggle').checked = true;
    renderAlerts();
  }
}));

$('radarRefresh').addEventListener('click', () => refreshRadar());
$('radarPlayPause').addEventListener('click', () => setRadarPlaying(!state.radarPlaying));
$('radarStepBack').addEventListener('click', () => { setRadarPlaying(false); applyRadarFrame(state.radarIndex - 1); });
$('radarStepForward').addEventListener('click', () => { setRadarPlaying(false); applyRadarFrame(state.radarIndex + 1, { live: state.radarIndex + 1 >= state.radarFrames.length - 1 }); });

document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
  btn.classList.add('active');
  $(`tab-${btn.dataset.tab}`).classList.add('active');

  // On mobile, keep the tab buttons as the anchor and reveal the selected content below them.
  if (window.matchMedia?.('(max-width: 980px)').matches) {
    requestAnimationFrame(() => {
      document.querySelector('.panel-tabs')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  }
}));

async function init() {
  applySavedControls();
  setBasemap(prefs.theme || 'standard', { skipSave: true });
  if ($('themeSelect')) $('themeSelect').value = prefs.theme || 'standard';
  if ($('displayModeSelect')) $('displayModeSelect').value = state.colorScheme;
  applyColorScheme(state.colorScheme);
  await buildRadarFrames();
  applyRadarFrame(state.radarIndex, { live: true });
  setRadarPlaying(true);
  connectAdminAlertStream();
  loadAdminMessages();
  setInterval(loadAdminMessages, 60000);

  const startupLocation = prefs.location || DEFAULT_LOCATION;
  const startupLabel = startupLocation.label || DEFAULT_LOCATION.label;
  resolveLocation(startupLabel)
    .then(loc => loadWeather(loc.lat, loc.lon, loc.label, loc.geojson, { fitBoundary: false, center: false, skipLocationSave: true, notify: false, resetAlertBaseline: true }))
    .catch(() => loadWeather(Number(startupLocation.lat) || DEFAULT_LOCATION.lat, Number(startupLocation.lon) || DEFAULT_LOCATION.lon, startupLabel, null, { skipLocationSave: true, notify: false, resetAlertBaseline: true }));

  setInterval(() => { refreshRadar().catch(() => {}); }, 300000);
  setInterval(() => loadWeather(state.lat, state.lon, state.label, state.lastGeojson, { fitBoundary: false, center: false }).catch(err => setStatus(`Refresh error: ${err.message}`)), 180000);
  setInterval(() => { if (state.spotterMode) loadSpotterAlerts({ setStatus: false }).catch(() => {}); }, 90000);
}

init();


function updateHeaderLogoForViewport() {
  const img = document.getElementById('headerLogo') || document.querySelector('.logo-slot img');
  if (!img) return;
  const narrow = window.innerWidth <= 900;
  const desired = narrow ? '/tablogo.png' : '/logo.png';
  if (!img.getAttribute('src')?.endsWith(desired.replace('/', ''))) img.src = desired;
}
window.addEventListener('resize', updateHeaderLogoForViewport);
updateHeaderLogoForViewport();
