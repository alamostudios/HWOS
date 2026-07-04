import express from 'express';
import cors from 'cors';
import NodeCache from 'node-cache';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 5000;
const CONTACT = process.env.CONTACT_EMAIL || 'octokid13@gmail.com';
const APP_URL = process.env.APP_URL || 'weather.alamostudios.net';

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const COOKIE_NAME = 'hwos_admin_session';
const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;
const DATA_DIR = path.join(__dirname, '..', 'data');
const ADMIN_MESSAGES_FILE = path.join(DATA_DIR, 'admin_messages.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

const cache = new NodeCache({ stdTTL: 300, checkperiod: 120 });
const NWS_HEADERS = {
  'User-Agent': `(${APP_URL}, ${CONTACT})`,
  'Accept': 'application/geo+json'
};

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(part => {
    const index = part.indexOf('=');
    if (index === -1) return null;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    return key ? [key, decodeURIComponent(value)] : null;
  }).filter(Boolean));
}

function timingSafeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifySession(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  if (!timingSafeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() < payload.exp && payload.user === ADMIN_USER) return payload;
  } catch {}
  return null;
}

function isAdmin(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  return Boolean(verifySession(cookies[COOKIE_NAME]));
}

function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
  return res.redirect('/admin/login');
}

function scryptHash(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

function passwordMatches(password) {
  if (ADMIN_PASSWORD_HASH) {
    if (ADMIN_PASSWORD_HASH.startsWith('scrypt:')) {
      const [, salt, expected] = ADMIN_PASSWORD_HASH.split(':');
      if (!salt || !expected) return false;
      return timingSafeEqual(scryptHash(password, salt), expected);
    }
    const hash = crypto.createHash('sha256').update(String(password)).digest('hex');
    return timingSafeEqual(hash, ADMIN_PASSWORD_HASH);
  }
  return Boolean(ADMIN_PASSWORD) && timingSafeEqual(password, ADMIN_PASSWORD);
}

function sendAdminCookie(res) {
  const token = signSession({ user: ADMIN_USER, exp: Date.now() + SESSION_MAX_AGE_MS });
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_MAX_AGE_MS / 1000)}${secure}`);
}

app.get('/admin/login', (req, res) => {
  if (isAdmin(req)) return res.redirect('/admin');
  res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});

app.post('/admin/login', (req, res) => {
  const username = String(req.body.username || '');
  const password = String(req.body.password || '');
  if (!ADMIN_PASSWORD && !ADMIN_PASSWORD_HASH) {
    return res.status(503).send('Admin login is not configured. Set ADMIN_PASSWORD or ADMIN_PASSWORD_HASH on the server.');
  }
  if (!timingSafeEqual(username, ADMIN_USER) || !passwordMatches(password)) {
    return res.status(401).send('Invalid username or password.');
  }
  sendAdminCookie(res);
  res.redirect('/admin');
});

app.post('/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  res.redirect('/admin/login');
});

app.use(['/admin.html', '/admin.js'], requireAdmin);
app.get(['/tv/:region', '/tv.html/:region'], (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'tv.html'));
});
app.use(express.static('public'));

const sseClients = new Set();


function normalizeRegionTarget(value = '') {
  return String(value || 'all').trim().toLowerCase().replace(/%20/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'all';
}

function broadcastEvent(eventName, payload) {
  const body = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try { client.write(body); } catch { sseClients.delete(client); }
  }
}

app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});


app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, time: new Date().toISOString() })}\n\n`);
  sseClients.add(res);
  const keepAlive = setInterval(() => res.write(': keepalive\n\n'), 25000);
  req.on('close', () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
  });
});

app.get('/api/admin-messages', (req, res) => {
  const messages = writeAdminMessages(readAdminMessages());
  res.json({ ok: true, messages });
});

app.get('/api/admin/current-message', requireAdmin, (req, res) => {
  const messages = writeAdminMessages(readAdminMessages());
  res.json({ ok: true, message: messages[0] || null });
});

app.post('/api/admin/admin-message/expire', requireAdmin, (req, res) => {
  writeAdminMessages([]);
  broadcastEvent('admin-message-expired', { type: 'admin-message-expired' });
  res.json({ ok: true, message: null });
});

app.post('/api/admin/admin-message/expiration', requireAdmin, (req, res) => {
  const expireInput = req.body.expires || req.body.expiration || req.body.expiresAt;
  const expireMs = Date.parse(expireInput || '');
  if (!Number.isFinite(expireMs)) return res.status(400).json({ ok: false, error: 'Valid expiration date/time required.' });
  const messages = readAdminMessages();
  const current = messages[0];
  if (!current?.properties) return res.status(404).json({ ok: false, error: 'No active administrative message.' });
  current.properties.expires = new Date(expireMs).toISOString();
  const active = writeAdminMessages([current]);
  broadcastEvent('admin-message-updated', active[0] || null);
  res.json({ ok: true, message: active[0] || null });
});

app.post('/api/admin/fake-alert', requireAdmin, (req, res) => {
  const now = new Date().toISOString();
  const event = String(req.body.event || 'Special Weather Statement').slice(0, 120);
  const headline = String(req.body.headline || req.body.message || 'Administrative test alert').slice(0, 240);
  const description = String(req.body.description || req.body.message || headline).slice(0, 3000);
  const severity = String(req.body.severity || (event.includes('Warning') ? 'Severe' : event.includes('Watch') ? 'Moderate' : 'Minor')).slice(0, 80);
  const urgency = String(req.body.urgency || 'Expected').slice(0, 80);
  const adminSeverity = String(req.body.adminSeverity || '').toLowerCase() === 'red' ? 'red' : 'green';
  const isAdminMessage = event.toLowerCase().includes('administrative message') || req.body.adminMessage === true;
  const soundKey = String(req.body.soundKey || (isAdminMessage ? `admin-${adminSeverity}` : 'auto')).slice(0, 50);
  const rawTargetRegion = String(req.body.targetRegion || req.body.region || req.body.area || 'all').trim() || 'all';
  const targetRegion = rawTargetRegion.slice(0, 120);
  const targetRegionKey = normalizeRegionTarget(targetRegion);
  const expireInput = req.body.expires || req.body.expiration || req.body.expiresAt;
  const expireMs = Date.parse(expireInput || '');
  const expires = Number.isFinite(expireMs)
    ? new Date(expireMs).toISOString()
    : new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const fake = {
    type: 'Feature',
    geometry: null,
    properties: {
      id: `${isAdminMessage ? 'admin-message' : 'admin'}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      event, headline, description, severity, urgency, soundKey,
      targetRegion, targetRegionKey,
      sent: now, effective: now, expires,
      source: 'FCDR HWOS Admin Console',
      test: true,
      adminMessage: isAdminMessage,
      adminSeverity: isAdminMessage ? adminSeverity : undefined
    }
  };
  if (isAdminMessage) {
    // Administrative messages are single-active only. A new one replaces the current one.
    const active = writeAdminMessages([fake]);
    broadcastEvent('fake-alert', fake);
    broadcastEvent('tv-alert', fake);
    return res.json({ ok: true, clients: sseClients.size, alert: fake, activeMessages: active.length });
  }
  broadcastEvent('fake-alert', fake);
  broadcastEvent('tv-alert', fake);
  res.json({ ok: true, clients: sseClients.size, alert: fake });
});


function readAdminMessages() {
  try {
    const raw = fs.readFileSync(ADMIN_MESSAGES_FILE, 'utf8');
    const messages = JSON.parse(raw);
    return Array.isArray(messages) ? messages.filter(m => !isExpiredAdminMessage(m)) : [];
  } catch { return []; }
}

function writeAdminMessages(messages = []) {
  // Keep only one active administrative message at a time.
  const active = messages.filter(m => !isExpiredAdminMessage(m)).slice(0, 1);
  fs.writeFileSync(ADMIN_MESSAGES_FILE, JSON.stringify(active, null, 2));
  return active;
}

function isExpiredAdminMessage(message) {
  const expires = Date.parse(message?.properties?.expires || message?.expires || '');
  return Number.isFinite(expires) && expires <= Date.now();
}

function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

function validCoord(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

async function cachedJson(key, ttlSeconds, fetcher) {
  const hit = cache.get(key);
  if (hit) return hit;
  const value = await fetcher();
  cache.set(key, value, ttlSeconds);
  return value;
}

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text);
}

async function nws(url, ttl = 300) {
  return cachedJson(`nws:${url}`, ttl, () => getJson(url, NWS_HEADERS));
}

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'hazardous-weather-observation-system', time: new Date().toISOString() });
});

app.get('/api/point', async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!validCoord(lat, lon)) return badRequest(res, 'lat/lon are required and must be valid coordinates.');
    const point = await nws(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, 3600);
    res.json(point);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/forecast', async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!validCoord(lat, lon)) return badRequest(res, 'lat/lon are required and must be valid coordinates.');

    const point = await nws(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, 3600);
    const [hourly, daily] = await Promise.all([
      nws(point.properties.forecastHourly, 300),
      nws(point.properties.forecast, 300)
    ]);

    res.json({
      location: point.properties.relativeLocation?.properties || null,
      office: point.properties.cwa,
      grid: {
        office: point.properties.gridId,
        x: point.properties.gridX,
        y: point.properties.gridY
      },
      hourly: hourly.properties.periods,
      daily: daily.properties.periods
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/alerts', async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!validCoord(lat, lon)) return badRequest(res, 'lat/lon are required and must be valid coordinates.');

    const point = await nws(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, 3600);
    const zone = point.properties.forecastZone?.split('/').pop();
    const county = point.properties.county?.split('/').pop();
    const zones = [zone, county].filter(Boolean).join(',');
    const alerts = await nws(`https://api.weather.gov/alerts/active?zone=${zones}`, 120);

    res.json({ zones: { forecastZone: zone, county }, alerts: alerts.features });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});


app.get('/api/alerts/spotter', async (req, res) => {
  try {
    const wantedEvents = ['Tornado Warning', 'Tornado Watch', 'Severe Thunderstorm Warning'];
    const results = await Promise.all(wantedEvents.map(eventName => {
      const url = new URL('https://api.weather.gov/alerts/active');
      url.searchParams.set('event', eventName);
      return nws(url.toString(), 90).catch(err => ({ features: [], error: err.message, eventName }));
    }));
    const seen = new Set();
    const alerts = [];
    for (const result of results) {
      for (const feature of result.features || []) {
        const id = feature.id || feature.properties?.id || feature.properties?.['@id'] || JSON.stringify(feature.geometry || {}).slice(0, 80);
        if (seen.has(id)) continue;
        seen.add(id);
        alerts.push(feature);
      }
    }
    alerts.sort((a, b) => new Date(b.properties?.sent || b.properties?.effective || 0) - new Date(a.properties?.sent || a.properties?.effective || 0));
    res.json({ mode: 'spotter', events: wantedEvents, alerts });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/reverse-geocode', async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!validCoord(lat, lon)) return badRequest(res, 'lat/lon are required and must be valid coordinates.');
    const url = new URL('https://nominatim.openstreetmap.org/reverse');
    url.searchParams.set('lat', lat.toFixed(5));
    url.searchParams.set('lon', lon.toFixed(5));
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('zoom', '12');
    url.searchParams.set('polygon_geojson', '1');
    const r = await cachedJson(`revgeo:${lat.toFixed(4)},${lon.toFixed(4)}`, 86400, () => getJson(url.toString(), {
      'User-Agent': `(${APP_URL}, ${CONTACT})`,
      'Accept': 'application/json'
    }));
    const a = r.address || {};
    const locality = a.city || a.town || a.village || a.hamlet || a.municipality || a.suburb || a.neighbourhood;
    const county = a.county;
    const state = a.state;
    const label = [locality || county || r.name, locality && county && locality !== county ? county : null, state].filter(Boolean).join(', ') || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    res.json({ label, lat, lon, address: a, geojson: r.geojson || null, display_name: r.display_name || null });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});


app.get('/api/location/resolve', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return badRequest(res, 'q is required.');
    const compact = q.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const stationCandidates = [];
    if (/^[A-Z0-9]{3,4}$/.test(compact)) {
      stationCandidates.push(compact);
      if (compact.length === 3) stationCandidates.push(`K${compact}`);
    }
    for (const code of stationCandidates) {
      try {
        const st = await nws(`https://api.weather.gov/stations/${code}`, 3600);
        const coords = st.geometry?.coordinates || [];
        const lon = Number(coords[0]);
        const lat = Number(coords[1]);
        if (validCoord(lat, lon)) {
          return res.json({ label: stationDisplayName(st), lat, lon, source: 'station', station: code });
        }
      } catch {}
    }
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', q);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '1');
    url.searchParams.set('addressdetails', '1');
    const results = await cachedJson(`resolve:${q.toLowerCase()}`, 86400, () => getJson(url.toString(), {
      'User-Agent': `(${APP_URL}, ${CONTACT})`,
      'Accept': 'application/json'
    }));
    if (!Array.isArray(results) || !results.length) return res.status(404).json({ error: 'Location not found.' });
    const r = results[0];
    const a = r.address || {};
    const label = [a.city || a.town || a.village || a.county || r.name, a.state].filter(Boolean).join(', ') || q;
    res.json({ label, lat: Number(r.lat), lon: Number(r.lon), source: 'geocode' });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/geocode', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return badRequest(res, 'q is required.');
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', q);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '1');
    url.searchParams.set('polygon_geojson', '1');
    url.searchParams.set('addressdetails', '1');
    const results = await cachedJson(`geo:${q.toLowerCase()}`, 86400, () => getJson(url.toString(), {
      'User-Agent': `(${APP_URL}, ${CONTACT})`,
      'Accept': 'application/json'
    }));
    if (!Array.isArray(results) || !results.length) return res.status(404).json({ error: 'Location not found.' });
    const r = results[0];
    const label = r.display_name?.split(',').slice(0, 3).join(',') || q;
    const lat = Number(r.lat);
    const lon = Number(r.lon);
    res.json({
      label, lat, lon,
      type: r.type,
      class: r.class,
      geojson: r.geojson || null,
      boundingbox: r.boundingbox || null
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});


function distanceMiles(aLat, aLon, bLat, bLon) {
  const toRad = degrees => degrees * Math.PI / 180;
  const R = 3958.7613;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function stationDisplayName(station) {
  const rawId = station.properties?.stationIdentifier || station.id || station.name || '';
  const id = String(rawId).replace(/^https:\/\/api\.weather\.gov\/stations\//, '').replace(/\/observations\/latest$/, '');
  const name = station.properties?.name || station.name || '';
  return `${id}${name ? ` ${name}` : ''}`.trim();
}

app.get('/api/stations', async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!validCoord(lat, lon)) return badRequest(res, 'lat/lon are required and must be valid coordinates.');

    const point = await nws(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, 3600);
    const stations = await nws(point.properties.observationStations, 3600);
    const ranked = stations.features.map(s => {
      const coords = Array.isArray(s.geometry?.coordinates) ? s.geometry.coordinates : [];
      const stationLon = Number(coords[0]);
      const stationLat = Number(coords[1]);
      const distance = validCoord(stationLat, stationLon) ? distanceMiles(lat, lon, stationLat, stationLon) : null;
      const station = {
        id: s.properties.stationIdentifier,
        name: s.properties.name,
        displayName: stationDisplayName(s),
        stationUrl: s.properties['@id'] || s.id || null,
        latestObservationUrl: s.properties['@id'] ? `${s.properties['@id']}/observations/latest` : null,
        elevation: s.properties.elevation,
        distanceMiles: distance,
        geometry: s.geometry
      };
      return station;
    }).sort((a, b) => (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity));
    res.json(ranked);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/observations/latest', async (req, res) => {
  try {
    const station = String(req.query.station || '').toUpperCase().trim();
    const stationUrl = String(req.query.stationUrl || '').trim();
    let url = '';
    if (stationUrl) {
      if (!stationUrl.startsWith('https://api.weather.gov/stations/')) return badRequest(res, 'stationUrl must be a weather.gov station URL.');
      url = stationUrl.endsWith('/observations/latest') ? stationUrl : `${stationUrl.replace(/\/$/, '')}/observations/latest`;
    } else if (station) {
      url = `https://api.weather.gov/stations/${station}/observations/latest`;
    } else {
      return badRequest(res, 'station or stationUrl is required, e.g. KIND.');
    }
    const obs = await nws(url, 120);
    res.json(obs.properties);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});


app.get('/api/nws-zone', async (req, res) => {
  try {
    const zoneUrl = String(req.query.url || '');
    if (!/^https:\/\/api\.weather\.gov\/zones\/(county|forecast|fire)\/[A-Z0-9]+$/i.test(zoneUrl)) {
      return badRequest(res, 'A valid api.weather.gov zone URL is required.');
    }
    const zone = await nws(zoneUrl, 86400);
    res.json({
      id: zone.id || zone.properties?.id || zone.properties?.['@id'] || zoneUrl,
      name: zone.properties?.name || zone.properties?.id || '',
      type: zone.properties?.type || '',
      geometry: zone.geometry || null
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

const RADAR_IMAGE_SERVER = 'https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity_time/ImageServer';

app.get('/api/radar/config', (req, res) => {
  res.json({
    type: 'esri-image-server',
    url: RADAR_IMAGE_SERVER,
    opacity: 0.65,
    note: 'Time-enabled NOAA/NWS base reflectivity service. The frontend requests exportImage with explicit time frames.'
  });
});

app.get('/api/radar/frames', async (req, res) => {
  try {
    const metadata = await cachedJson('radar:metadata', 90, () => getJson(`${RADAR_IMAGE_SERVER}?f=pjson`, {
      'User-Agent': `(${APP_URL}, ${CONTACT})`,
      'Accept': 'application/json'
    }));

    const extent = metadata?.timeInfo?.timeExtent || metadata?.timeExtent || null;
    const end = Array.isArray(extent) && Number.isFinite(Number(extent[1])) ? Number(extent[1]) : Date.now();
    const startFromService = Array.isArray(extent) && Number.isFinite(Number(extent[0])) ? Number(extent[0]) : end - (4 * 60 * 60 * 1000);
    const intervalMinutes = Number(metadata?.timeInfo?.timeInterval) || 5;
    const intervalMs = Math.max(60_000, intervalMinutes * 60_000);
    const start = Math.max(startFromService, end - (4 * 60 * 60 * 1000));
    const frames = [];

    for (let t = Math.floor(start / intervalMs) * intervalMs; t <= end; t += intervalMs) {
      if (t >= startFromService) frames.push(t);
    }

    const uniqueFrames = [...new Set(frames)].slice(-64);
    res.json({
      service: RADAR_IMAGE_SERVER,
      intervalMs,
      start,
      end,
      frames: uniqueFrames.length ? uniqueFrames : [end],
      metadata: {
        name: metadata?.name || metadata?.serviceDescription || 'NOAA/NWS radar base reflectivity',
        timeInfo: metadata?.timeInfo || null
      }
    });
  } catch (err) {
    const end = Date.now();
    const intervalMs = 5 * 60 * 1000;
    const frames = [];
    for (let i = 48; i >= 0; i -= 1) frames.push(Math.floor((end - i * intervalMs) / intervalMs) * intervalMs);
    res.json({ service: RADAR_IMAGE_SERVER, intervalMs, start: frames[0], end, frames, warning: err.message });
  }
});

app.get('/api/satellite/config', (req, res) => {
  res.json({
    status: 'stub',
    recommendation: 'Use GOES-16 East and GOES-18 West ABI imagery from NOAA Open Data. Convert NetCDF scenes to Web Mercator tiles for Leaflet.',
    layers: ['GOES-16 ABI CONUS/East', 'GOES-18 ABI CONUS/West', 'GOES GLM lightning']
  });
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, () => {
  console.log(`Hazardous Weather Observation System running on http://localhost:${PORT}`);
  console.log(`Set CONTACT_EMAIL and APP_URL env vars before real use.`);
});
