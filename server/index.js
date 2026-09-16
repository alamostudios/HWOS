try { await import('dotenv/config'); } catch {}
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
const APP_URL = process.env.APP_URL || 'alamostudios.net';

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const COOKIE_NAME = 'hwos_admin_session';
const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;
const DATA_DIR = path.join(__dirname, '..', 'data');
const ADMIN_MESSAGES_FILE = path.join(DATA_DIR, 'admin_messages.json');
const DISCORD_WEBHOOK_FILE = path.join(DATA_DIR, 'discord_webhook.json');
const DISCORD_HISTORY_FILE = path.join(DATA_DIR, 'discord_webhook_history.json');
const NTFY_HISTORY_FILE = path.join(DATA_DIR, 'ntfy_history.json');
const NTFY_TOPIC = process.env.NTFY_TOPIC || 'weather-north-central-indiana';
const NTFY_URL = process.env.NTFY_URL || `https://ntfy.sh/${NTFY_TOPIC}`;
const NTFY_COUNTY_ZONES = (process.env.NTFY_COUNTY_ZONES || 'INC049,INC103,INC017,INC085,INC099').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
const NTFY_COUNTY_NAMES = (process.env.NTFY_COUNTIES || 'Fulton,Miami,Cass,Kosciusko,Marshall').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const NTFY_STATE = process.env.NTFY_STATE || 'Indiana';

const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || process.env.APP_PUBLIC_URL || '').replace(/\/+$/, '');
let observedPublicBaseUrl = '';

function publicUrl(pathname = '/') {
  const cleanPath = String(pathname).startsWith('/') ? pathname : '/' + pathname;
  const configured = PUBLIC_BASE_URL || observedPublicBaseUrl || APP_URL || '';
  const base = configured.startsWith('http') ? configured : `https://${configured || 'localhost:' + PORT}`;
  return `${base.replace(/\/+$/, '')}${cleanPath}`;
}

function localPublicPath(pathname = '/') {
  return path.join(__dirname, '..', 'public', String(pathname).replace(/^\/+/, ''));
}

function alertImagePathForFeature(feature = {}) {
  const p = feature.properties || feature || {};
  const slug = p.adminMessage ? 'administrative-message' : alertImageSlug(p.event || '');
  const png = localPublicPath(`/assets/weather-alerts/${slug}.png`);
  if (fs.existsSync(png)) return png;
  const svg = localPublicPath(`/assets/weather-alerts/${slug}.svg`);
  if (fs.existsSync(svg)) return svg;
  const fallback = localPublicPath('/logo.png');
  return fs.existsSync(fallback) ? fallback : png;
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

function alertImageUrlForFeature(feature = {}) {
  const p = feature.properties || feature || {};
  const slug = p.adminMessage ? 'administrative-message' : alertImageSlug(p.event || '');
  const png = localPublicPath(`/assets/weather-alerts/${slug}.png`);
  if (fs.existsSync(png)) return publicUrl(`/assets/weather-alerts/${slug}.png`);
  const svg = localPublicPath(`/assets/weather-alerts/${slug}.svg`);
  if (fs.existsSync(svg)) return publicUrl(`/assets/weather-alerts/${slug}.svg`);
  return publicUrl('/logo.png');
}

function fullAlertUrlForFeature(feature = {}) {
  const p = feature.properties || feature || {};
  const url = String(p['@id'] || p.id || '').trim();
  return url.startsWith('http') ? url : '';
}

function compactAlertSummary(feature = {}) {
  const p = feature.properties || feature || {};
  if (p.adminMessage) {
    return [
      'Fulton County Disaster Response in Rochester, Indiana has issued an Administrative Message.',
      p.headline || '',
      p.description || ''
    ].filter(Boolean).join('\n\n').slice(0, 1800);
  }
  const parts = [];
  if (p.headline) parts.push(p.headline);
  if (p.areaDesc) parts.push(`Areas: ${p.areaDesc}`);
  if (p.severity || p.urgency || p.certainty) parts.push(`Severity: ${[p.severity, p.urgency, p.certainty].filter(Boolean).join(' / ')}`);
  if (p.expires || p.ends) parts.push(`Expires: ${new Date(p.expires || p.ends).toLocaleString('en-US', { timeZone: 'America/Indiana/Indianapolis' })}`);
  const instruction = String(p.instruction || '').split(/\n+/).find(Boolean);
  if (instruction) parts.push(`Action: ${instruction}`);
  return parts.filter(Boolean).join('\n\n').slice(0, 1800);
}

fs.mkdirSync(DATA_DIR, { recursive: true });

const cache = new NodeCache({ stdTTL: 300, checkperiod: 120 });
const NWS_HEADERS = {
  'User-Agent': `(${APP_URL}, ${CONTACT})`,
  'Accept': 'application/geo+json'
};

app.set('trust proxy', true);
app.use((req, res, next) => {
  if (!PUBLIC_BASE_URL && req.headers.host) {
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    observedPublicBaseUrl = `${proto}://${req.headers.host}`;
  }
  next();
});
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
app.use(express.static('public'));

const sseClients = new Set();

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

app.post('/api/admin/fake-alert', requireAdmin, async (req, res) => {
  const now = new Date().toISOString();
  const event = String(req.body.event || 'Special Weather Statement').slice(0, 120);
  const headline = String(req.body.headline || req.body.message || 'Administrative test alert').slice(0, 240);
  const description = String(req.body.description || req.body.message || headline).slice(0, 3000);
  const severity = String(req.body.severity || (event.includes('Warning') ? 'Severe' : event.includes('Watch') ? 'Moderate' : 'Minor')).slice(0, 80);
  const urgency = String(req.body.urgency || 'Expected').slice(0, 80);
  const adminSeverity = String(req.body.adminSeverity || '').toLowerCase() === 'red' ? 'red' : 'green';
  const isAdminMessage = event.toLowerCase().includes('administrative message') || req.body.adminMessage === true;
  const soundKey = String(req.body.soundKey || (isAdminMessage ? `admin-${adminSeverity}` : 'auto')).slice(0, 50);
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
    notifyDiscordForAlert(fake, { force: true, source: 'admin' }).catch(err => console.warn('Discord webhook admin-message failed:', err.message));
    notifyNtfyForAlert(fake, { force: true, source: 'admin' }).catch(err => console.warn('ntfy admin-message failed:', err.message));
    return res.json({ ok: true, clients: sseClients.size, alert: fake, activeMessages: active.length });
  }
  broadcastEvent('fake-alert', fake);
  notifyDiscordForAlert(fake, { source: 'admin-test' }).catch(err => console.warn('Discord webhook admin alert failed:', err.message));
  notifyNtfyForAlert(fake, { source: 'admin-test' }).catch(err => console.warn('ntfy admin alert failed:', err.message));
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
    const data = await nws('https://api.weather.gov/alerts/active', 90);
    const seen = new Set();
    const alerts = [];
    for (const feature of data.features || []) {
      const id = feature.id || feature.properties?.id || feature.properties?.['@id'] || JSON.stringify(feature.geometry || {}).slice(0, 80);
      if (seen.has(id)) continue;
      seen.add(id);
      alerts.push(feature);
    }
    alerts.sort((a, b) => new Date(b.properties?.sent || b.properties?.effective || 0) - new Date(a.properties?.sent || a.properties?.effective || 0));
    res.json({ mode: 'spotter', events: ['All active alerts'], alerts });
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
      id: zone.id || zone.properties?.id || zoneUrl,
      name: zone.properties?.name || zone.properties?.id || '',
      type: zone.properties?.type || '',
      geometry: zone.geometry || null
    });
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



// -----------------------------------------------------------------------------

// Backend-only ntfy alerts for north-central Indiana.
// This is intentionally not exposed in the public Settings UI.
function readNtfyHistory() {
  try {
    const raw = fs.readFileSync(NTFY_HISTORY_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return { sentIds: Array.isArray(parsed.sentIds) ? parsed.sentIds.slice(-1000) : [] };
  } catch {
    return { sentIds: [] };
  }
}

function writeNtfyHistory(history) {
  const sentIds = Array.from(new Set(history.sentIds || [])).slice(-1000);
  fs.writeFileSync(NTFY_HISTORY_FILE, JSON.stringify({ sentIds }, null, 2));
  return { sentIds };
}

function ntfyAlertId(feature = {}) {
  const p = feature.properties || feature || {};
  return String(p.id || p['@id'] || feature.id || `${p.event || 'alert'}:${p.sent || p.effective || ''}:${p.headline || ''}`).trim();
}

function ntfyAlertMatchesNorthCentralIndiana(feature = {}) {
  const p = feature.properties || feature || {};
  if (p.adminMessage) return true;
  const geocode = p.geocode || {};
  const ugc = [
    ...(Array.isArray(geocode.UGC) ? geocode.UGC : []),
    ...(Array.isArray(geocode.SAME) ? geocode.SAME : [])
  ].map(v => String(v).toUpperCase());
  if (NTFY_COUNTY_ZONES.some(z => ugc.includes(z))) return true;
  const area = String(p.areaDesc || '').toLowerCase();
  return NTFY_COUNTY_NAMES.some(name => area.includes(name));
}

function ntfyTitle(feature = {}) {
  const p = feature.properties || feature || {};
  if (p.adminMessage) return `Administrative Message: ${p.headline || 'FCDR Message'}`;
  return p.event || p.headline || 'Weather Alert';
}

function ntfyBody(feature = {}) {
  const body = compactAlertSummary(feature);
  const url = fullAlertUrlForFeature(feature);
  return [body, url ? `Full NWS text: ${url}` : ''].filter(Boolean).join('\n\n').slice(0, 3800);
}

function ntfyTags(feature = {}) {
  const p = feature.properties || feature || {};
  const event = String(p.event || '').toLowerCase();
  if (p.adminMessage) return 'rotating_light';
  if (event.includes('tornado')) return 'tornado,warning';
  if (event.includes('thunderstorm')) return 'cloud_with_lightning,warning';
  if (event.includes('flood')) return 'ocean,warning';
  if (event.includes('watch')) return 'eyes,warning';
  if (event.includes('advisory')) return 'warning';
  return 'warning';
}

function ntfySafeHeader(value = '', max = 900) {
  return String(value || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function ntfyContentTypeForPath(filePath = '') {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.webp') return 'image/webp';
  return 'image/png';
}

async function sendNtfy(feature) {
  const fullUrl = fullAlertUrlForFeature(feature);
  const imagePath = alertImagePathForFeature(feature);
  const hasImage = imagePath && fs.existsSync(imagePath);
  const headers = {
    Title: ntfyTitle(feature),
    Priority: '5',
    Tags: ntfyTags(feature),
    ...(fullUrl ? { Click: fullUrl } : {})
  };

  let body = ntfyBody(feature);
  if (hasImage) {
    // ntfy cannot fetch localhost/private Attach URLs. Upload the image itself
    // as the notification attachment and place the alert summary in Message.
    headers.Filename = path.basename(imagePath);
    headers.Message = ntfySafeHeader(body, 900);
    headers['Content-Type'] = ntfyContentTypeForPath(imagePath);
    body = fs.readFileSync(imagePath);
  } else {
    headers.Icon = alertImageUrlForFeature(feature);
  }

  const res = await fetch(NTFY_URL, {
    method: 'POST',
    headers,
    body
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ntfy failed: ${res.status} ${res.statusText} ${text.slice(0, 200)}`);
  return { ok: true };
}

async function notifyNtfyForAlert(feature, options = {}) {
  if (!options.force && !ntfyAlertMatchesNorthCentralIndiana(feature)) return;
  const id = ntfyAlertId(feature);
  const history = readNtfyHistory();
  if (!options.force && id && history.sentIds.includes(id)) return;
  await sendNtfy(feature);
  if (id) {
    history.sentIds.push(id);
    writeNtfyHistory(history);
  }
}

let ntfyPollInFlight = false;
let ntfyPollStarted = false;
async function pollNtfyAlerts() {
  if (ntfyPollInFlight) return;
  ntfyPollInFlight = true;
  try {
    const zones = NTFY_COUNTY_ZONES.join(',');
    if (!zones) return;
    const data = await nws(`https://api.weather.gov/alerts/active?zone=${zones}`, 90);
    const alerts = (data.features || []).filter(ntfyAlertMatchesNorthCentralIndiana);
    const history = readNtfyHistory();
    const known = new Set(history.sentIds || []);
    if (!ntfyPollStarted) {
      // Baseline currently active alerts on startup. Only newly issued alerts after startup push to ntfy.
      for (const alert of alerts) {
        const id = ntfyAlertId(alert);
        if (id) known.add(id);
      }
      writeNtfyHistory({ sentIds: [...known] });
      ntfyPollStarted = true;
      return;
    }
    for (const alert of alerts) {
      const id = ntfyAlertId(alert);
      if (!id || known.has(id)) continue;
      await sendNtfy(alert);
      known.add(id);
      writeNtfyHistory({ sentIds: [...known] });
    }
  } catch (err) {
    console.warn('ntfy poll failed:', err.message);
  } finally {
    ntfyPollInFlight = false;
  }
}

// Discord webhook alert forwarding
// -----------------------------------------------------------------------------
const DISCORD_DEFAULT_CONFIG = {
  enabled: false,
  webhookUrl: '',
  mode: 'selected', // selected | filter | spotter
  filter: '',
  selectedLocation: null,
  alertKinds: ['Warning', 'Watch', 'Advisory', 'Statement'],
  includeAdminMessages: true,
  quietFirstRun: true,
  pollSeconds: 60
};

function readJsonFile(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJsonFile(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function normalizeDiscordConfig(raw = {}) {
  const cfg = { ...DISCORD_DEFAULT_CONFIG, ...(raw || {}) };
  cfg.enabled = Boolean(cfg.enabled);
  cfg.webhookUrl = String(cfg.webhookUrl || '').trim();
  cfg.mode = ['selected', 'filter', 'spotter'].includes(cfg.mode) ? cfg.mode : 'selected';
  cfg.filter = String(cfg.filter || '').trim();
  cfg.includeAdminMessages = cfg.includeAdminMessages !== false;
  cfg.quietFirstRun = cfg.quietFirstRun !== false;
  cfg.pollSeconds = Math.max(45, Math.min(900, Number(cfg.pollSeconds) || 60));
  cfg.alertKinds = Array.isArray(cfg.alertKinds) && cfg.alertKinds.length ? cfg.alertKinds.filter(Boolean) : DISCORD_DEFAULT_CONFIG.alertKinds;
  if (String(cfg.filter).toLowerCase() === 'spotter') cfg.mode = 'spotter';
  if (cfg.selectedLocation && !validCoord(Number(cfg.selectedLocation.lat), Number(cfg.selectedLocation.lon))) cfg.selectedLocation = null;
  return cfg;
}

function readDiscordConfig() {
  return normalizeDiscordConfig(readJsonFile(DISCORD_WEBHOOK_FILE, DISCORD_DEFAULT_CONFIG));
}

function writeDiscordConfig(cfg) {
  const clean = normalizeDiscordConfig(cfg);
  writeJsonFile(DISCORD_WEBHOOK_FILE, clean);
  return clean;
}

function publicDiscordConfig(cfg = readDiscordConfig()) {
  return {
    ...cfg,
    webhookUrl: cfg.webhookUrl ? `${cfg.webhookUrl.slice(0, 32)}…${cfg.webhookUrl.slice(-8)}` : '',
    webhookConfigured: Boolean(cfg.webhookUrl)
  };
}

function readDiscordHistory() {
  const raw = readJsonFile(DISCORD_HISTORY_FILE, { sentIds: [] });
  return { sentIds: Array.isArray(raw.sentIds) ? raw.sentIds.slice(-2000) : [] };
}

function writeDiscordHistory(history) {
  writeJsonFile(DISCORD_HISTORY_FILE, { sentIds: [...new Set(history.sentIds || [])].slice(-2000) });
}

function discordAlertKind(event = '') {
  event = String(event || '');
  if (event.includes('Warning')) return 'Warning';
  if (event.includes('Watch')) return 'Watch';
  if (event.includes('Advisory')) return 'Advisory';
  return 'Statement';
}

function discordAlertId(feature = {}) {
  const p = feature.properties || feature || {};
  return String(p.id || p['@id'] || feature.id || `${p.event || 'alert'}:${p.sent || p.effective || ''}:${p.areaDesc || ''}`).replace(/^https:\/\/api\.weather\.gov\/alerts\//, '');
}

function discordAlertAllowedByKind(feature, cfg) {
  if ((feature.properties || feature || {}).adminMessage) return Boolean(cfg.includeAdminMessages);
  const kind = discordAlertKind((feature.properties || feature || {}).event || '');
  return new Set(cfg.alertKinds || []).has(kind);
}

function normalizeStateToken(value = '') {
  const v = String(value || '').trim().toUpperCase();
  const map = {
    'INDIANA': 'IN', 'IN': 'IN', 'OHIO': 'OH', 'OH': 'OH', 'MICHIGAN': 'MI', 'MI': 'MI',
    'ILLINOIS': 'IL', 'IL': 'IL', 'KENTUCKY': 'KY', 'KY': 'KY', 'PENNSYLVANIA': 'PA', 'PA': 'PA',
    'NEW JERSEY': 'NJ', 'NJ': 'NJ', 'DELAWARE': 'DE', 'DE': 'DE', 'MARYLAND': 'MD', 'MD': 'MD',
    'VIRGINIA': 'VA', 'VA': 'VA', 'WEST VIRGINIA': 'WV', 'WV': 'WV', 'NEW YORK': 'NY', 'NY': 'NY',
    'NORTH CAROLINA': 'NC', 'NC': 'NC', 'SOUTH CAROLINA': 'SC', 'SC': 'SC', 'TENNESSEE': 'TN', 'TN': 'TN'
  };
  return map[v] || v;
}

async function resolveDiscordFilterTarget(filter = '', selectedLocation = null) {
  const f = String(filter || '').trim();
  if (!f && selectedLocation && validCoord(Number(selectedLocation.lat), Number(selectedLocation.lon))) {
    return { type: 'point', lat: Number(selectedLocation.lat), lon: Number(selectedLocation.lon), label: selectedLocation.label || 'Selected location' };
  }
  if (!f || f.toLowerCase() === 'selected') {
    if (!selectedLocation || !validCoord(Number(selectedLocation.lat), Number(selectedLocation.lon))) throw new Error('No selected location is saved for Discord webhook filtering.');
    return { type: 'point', lat: Number(selectedLocation.lat), lon: Number(selectedLocation.lon), label: selectedLocation.label || 'Selected location' };
  }
  if (f.toLowerCase() === 'spotter') return { type: 'spotter', label: 'Spotter Mode' };

  const bracket = f.match(/^\[\s*([^,\]]+)\s*,\s*([^\]]+)\s*\]$/);
  if (bracket) {
    const county = bracket[1].replace(/\s+county$/i, '').trim();
    const state = normalizeStateToken(bracket[2]);
    const geo = await getGeocodePoint(`${county} County, ${state}`);
    return { type: 'point', lat: geo.lat, lon: geo.lon, label: `${county} County, ${state}` };
  }

  const station = f.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/^[A-Z0-9]{3,4}$/.test(station)) {
    const stationId = station.length === 3 ? `K${station}` : station;
    try {
      const st = await nws(`https://api.weather.gov/stations/${stationId}`, 3600);
      const coords = st.geometry?.coordinates || [];
      const lon = Number(coords[0]);
      const lat = Number(coords[1]);
      if (validCoord(lat, lon)) return { type: 'point', lat, lon, label: `${stationId} ${st.properties?.name || ''}`.trim() };
    } catch {}
  }

  const geo = await getGeocodePoint(f);
  return { type: 'point', lat: geo.lat, lon: geo.lon, label: geo.label || f };
}

async function getGeocodePoint(query) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('addressdetails', '1');
  const results = await cachedJson(`discord-geo:${String(query).toLowerCase()}`, 86400, () => getJson(url.toString(), {
    'User-Agent': `(${APP_URL}, ${CONTACT})`,
    'Accept': 'application/json'
  }));
  if (!Array.isArray(results) || !results.length) throw new Error(`Discord webhook location filter could not be resolved: ${query}`);
  const r = results[0];
  const lat = Number(r.lat);
  const lon = Number(r.lon);
  if (!validCoord(lat, lon)) throw new Error(`Discord webhook location filter returned invalid coordinates: ${query}`);
  return { lat, lon, label: r.display_name?.split(',').slice(0, 3).join(',') || query };
}

async function fetchDiscordAlertsForConfig(cfg) {
  if (!cfg.enabled || !cfg.webhookUrl) return [];
  const target = cfg.mode === 'spotter'
    ? { type: 'spotter', label: 'Spotter Mode' }
    : await resolveDiscordFilterTarget(cfg.mode === 'filter' ? cfg.filter : '', cfg.selectedLocation);

  let features = [];
  if (target.type === 'spotter') {
    const data = await nws('https://api.weather.gov/alerts/active', 90);
    features = data.features || [];
  } else {
    const point = await nws(`https://api.weather.gov/points/${target.lat.toFixed(4)},${target.lon.toFixed(4)}`, 3600);
    const zone = point.properties.forecastZone?.split('/').pop();
    const county = point.properties.county?.split('/').pop();
    const zones = [zone, county].filter(Boolean).join(',');
    if (!zones) return [];
    const data = await nws(`https://api.weather.gov/alerts/active?zone=${zones}`, 90);
    features = data.features || [];
  }
  return features.filter(a => discordAlertAllowedByKind(a, cfg));
}

function discordEmbedColor(event = '', severity = '') {
  event = String(event || '');
  severity = String(severity || '').toLowerCase();
  if (event.includes('Tornado') || severity === 'extreme') return 0xff0033;
  if (event.includes('Warning')) return 0xff6600;
  if (event.includes('Watch')) return 0xffcc00;
  if (event.includes('Advisory')) return 0x3399ff;
  return 0x7c8798;
}

function shortDiscordText(text = '', max = 950) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trim()}…` : clean;
}

function alertDiscordPayload(feature = {}, useAttachmentImage = false) {
  const p = feature.properties || feature || {};
  const isAdmin = Boolean(p.adminMessage);
  const title = isAdmin ? `Administrative Message: ${p.headline || 'FCDR Message'}` : `${p.event || 'Weather Alert'}`;
  const description = shortDiscordText(compactAlertSummary(feature), 1600) || 'No message text provided.';
  const fields = [];
  if (!isAdmin && p.areaDesc) fields.push({ name: 'Areas', value: shortDiscordText(p.areaDesc, 900) || 'Unavailable' });
  if (p.severity || p.urgency) fields.push({ name: 'Severity / Urgency', value: [p.severity, p.urgency].filter(Boolean).join(' / ') || 'Unavailable', inline: true });
  if (p.sent || p.effective) fields.push({ name: 'Issued', value: new Date(p.sent || p.effective).toLocaleString('en-US', { timeZone: 'America/Indiana/Indianapolis' }), inline: true });
  if (p.expires || p.ends) fields.push({ name: 'Expires', value: new Date(p.expires || p.ends).toLocaleString('en-US', { timeZone: 'America/Indiana/Indianapolis' }), inline: true });
  const url = fullAlertUrlForFeature(feature);
  const payload = {
    username: 'Disaster Responder',
    allowed_mentions: { parse: [] },
    embeds: [{
      title,
      description,
      color: isAdmin ? (String(p.adminSeverity || '').toLowerCase() === 'red' ? 0xd92d20 : 0x12b76a) : discordEmbedColor(p.event, p.severity),
      fields,
      image: { url: useAttachmentImage ? 'attachment://alert-image.png' : alertImageUrlForFeature(feature) },
      footer: { text: isAdmin ? 'Fulton County Disaster Response · Rochester, Indiana' : 'National Weather Service via FCDR HWOS' },
      timestamp: p.sent || p.effective || new Date().toISOString()
    }]
  };
  if (url) {
    payload.components = [{
      type: 1,
      components: [{
        type: 2,
        style: 5,
        label: 'Open Full NWS Text',
        url
      }]
    }];
  }
  return payload;
}

async function sendDiscordWebhook(feature, cfg = readDiscordConfig()) {
  if (!cfg.enabled || !cfg.webhookUrl) return { skipped: true, reason: 'disabled' };
  const imagePath = alertImagePathForFeature(feature);
  let request;
  if (fs.existsSync(imagePath) && typeof FormData !== 'undefined' && typeof Blob !== 'undefined') {
    const form = new FormData();
    form.append('payload_json', JSON.stringify(alertDiscordPayload(feature, true)));
    form.append('files[0]', new Blob([fs.readFileSync(imagePath)], { type: 'image/png' }), 'alert-image.png');
    request = { method: 'POST', body: form };
  } else {
    request = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(alertDiscordPayload(feature, false))
    };
  }
  const res = await fetch(cfg.webhookUrl, request);
  const text = await res.text();
  if (!res.ok) throw new Error(`Discord webhook failed: ${res.status} ${res.statusText} ${text.slice(0, 200)}`);
  return { ok: true };
}

async function notifyDiscordForAlert(feature, options = {}) {
  const cfg = readDiscordConfig();
  if (!cfg.enabled || !cfg.webhookUrl) return;
  if (!options.force && !discordAlertAllowedByKind(feature, cfg)) return;
  const id = discordAlertId(feature);
  const history = readDiscordHistory();
  if (!options.force && id && history.sentIds.includes(id)) return;
  await sendDiscordWebhook(feature, cfg);
  if (id) {
    history.sentIds.push(id);
    writeDiscordHistory(history);
  }
}

let discordPollInFlight = false;
let discordPollStarted = false;
async function pollDiscordAlerts() {
  if (discordPollInFlight) return;
  discordPollInFlight = true;
  try {
    const cfg = readDiscordConfig();
    if (!cfg.enabled || !cfg.webhookUrl) return;
    const alerts = await fetchDiscordAlertsForConfig(cfg);
    const history = readDiscordHistory();
    const known = new Set(history.sentIds || []);
    const newAlerts = alerts.filter(a => {
      const id = discordAlertId(a);
      return id && !known.has(id);
    });
    if (!discordPollStarted && cfg.quietFirstRun) {
      for (const a of alerts) {
        const id = discordAlertId(a);
        if (id) known.add(id);
      }
      writeDiscordHistory({ sentIds: [...known] });
      discordPollStarted = true;
      return;
    }
    discordPollStarted = true;
    for (const alert of newAlerts) {
      await sendDiscordWebhook(alert, cfg);
      const id = discordAlertId(alert);
      if (id) known.add(id);
      writeDiscordHistory({ sentIds: [...known] });
    }
  } catch (err) {
    console.warn('Discord webhook poll failed:', err.message);
  } finally {
    discordPollInFlight = false;
  }
}

app.get('/api/discord-webhook/config', (req, res) => {
  res.json({ ok: true, config: publicDiscordConfig() });
});

app.post('/api/discord-webhook/config', (req, res) => {
  const body = req.body || {};
  const current = readDiscordConfig();
  const webhookUrl = String(body.webhookUrl || '').trim() || current.webhookUrl;
  if (webhookUrl && !/^https:\/\/discord(?:app)?\.com\/api\/webhooks\//.test(webhookUrl)) {
    return res.status(400).json({ ok: false, error: 'Discord webhook URL must start with https://discord.com/api/webhooks/ or https://discordapp.com/api/webhooks/.' });
  }
  const selectedLocation = body.selectedLocation && validCoord(Number(body.selectedLocation.lat), Number(body.selectedLocation.lon))
    ? { lat: Number(body.selectedLocation.lat), lon: Number(body.selectedLocation.lon), label: String(body.selectedLocation.label || 'Selected location') }
    : current.selectedLocation;
  const cfg = writeDiscordConfig({
    ...current,
    enabled: Boolean(body.enabled),
    webhookUrl,
    mode: body.mode || current.mode,
    filter: body.filter ?? current.filter,
    selectedLocation,
    alertKinds: Array.isArray(body.alertKinds) ? body.alertKinds : current.alertKinds,
    includeAdminMessages: body.includeAdminMessages !== false,
    quietFirstRun: body.quietFirstRun !== false,
    pollSeconds: Number(body.pollSeconds) || current.pollSeconds
  });
  // Prevent a webhook from dumping every already-active alert immediately after setup.
  if (cfg.enabled && cfg.webhookUrl && cfg.quietFirstRun) {
    fetchDiscordAlertsForConfig(cfg).then(alerts => {
      const history = readDiscordHistory();
      const ids = new Set(history.sentIds || []);
      alerts.forEach(a => { const id = discordAlertId(a); if (id) ids.add(id); });
      writeDiscordHistory({ sentIds: [...ids] });
      discordPollStarted = true;
    }).catch(err => console.warn('Discord webhook baseline failed:', err.message));
  }
  res.json({ ok: true, config: publicDiscordConfig(cfg) });
});

app.post('/api/discord-webhook/test', async (req, res) => {
  try {
    const cfg = readDiscordConfig();
    if (!cfg.enabled || !cfg.webhookUrl) return res.status(400).json({ ok: false, error: 'Discord webhook is not enabled/configured.' });
    const now = new Date().toISOString();
    await sendDiscordWebhook({ properties: {
      id: `discord-test-${Date.now()}`,
      event: 'Special Weather Statement',
      headline: 'FCDR HWOS Discord webhook test',
      description: 'This is a test message from the FCDR HWOS Discord webhook integration.',
      severity: 'Minor', urgency: 'Expected', sent: now, effective: now,
      source: 'FCDR HWOS'
    } }, cfg);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

setInterval(pollDiscordAlerts, 60_000);
setTimeout(pollDiscordAlerts, 12_000);
setInterval(pollNtfyAlerts, 60_000);
setTimeout(pollNtfyAlerts, 15_000);


app.get(['/tv.html/:region', '/tv/:region'], (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'tv.html'));
});

function tvRegionParam(region = '') {
  return decodeURIComponent(String(region || '')).trim();
}

function isGlobalStormEvent(event = '', severity = '') {
  const e = String(event || '').toLowerCase();
  const s = String(severity || '').toLowerCase();
  return s === 'extreme'
    || e.includes('tornado warning')
    || e.includes('tornado emergency')
    || e.includes('hurricane warning')
    || e.includes('hurricane local statement')
    || e.includes('extreme wind warning')
    || e.includes('storm surge warning')
    || e.includes('flash flood emergency')
    || e.includes('blizzard warning')
    || e.includes('tsunami warning')
    || e.includes('evacuation immediate')
    || e.includes('civil emergency');
}

async function resolveTvRegion(region = '') {
  const r = tvRegionParam(region);
  if (!r || r.toLowerCase() === 'spotter') return { type: 'spotter', label: 'Spotter Mode' };

  const bracket = r.match(/^\[\s*([^,\]]+)\s*,\s*([^\]]+)\s*\]$/);
  if (bracket) {
    const county = bracket[1].replace(/\s+county$/i, '').trim();
    const state = normalizeStateToken(bracket[2]);
    const geo = await getGeocodePoint(`${county} County, ${state}`);
    return { type: 'point', lat: geo.lat, lon: geo.lon, label: `${county} County, ${state}` };
  }

  const token = r.toUpperCase().replace(/[^A-Z0-9]/g, '');

  // Airport/station abbreviation first: RCR -> KRCR, KPHL -> KPHL.
  // If that is not a valid NWS station, fall through to NWS WFO / CWA code such as IWX or IND.
  if (/^[A-Z0-9]{3,4}$/.test(token)) {
    const stationId = token.length === 3 ? `K${token}` : token;
    try {
      const st = await nws(`https://api.weather.gov/stations/${stationId}`, 3600);
      const coords = st.geometry?.coordinates || [];
      const lon = Number(coords[0]);
      const lat = Number(coords[1]);
      if (validCoord(lat, lon)) return { type: 'point', lat, lon, label: `${stationId} ${st.properties?.name || ''}`.trim() };
    } catch {}
  }

  if (/^[A-Z]{3}$/.test(token)) {
    try {
      const data = await nws(`https://api.weather.gov/alerts/active?office=${token}`, 90);
      return { type: 'office', office: token, label: `NWS ${token}`, preload: data.features || [] };
    } catch {}
  }

  const geo = await getGeocodePoint(r);
  return { type: 'point', lat: geo.lat, lon: geo.lon, label: geo.label || r };
}

async function tvAlertsForResolvedTarget(target) {
  if (target.type === 'spotter') {
    const data = await nws('https://api.weather.gov/alerts/active', 90);
    return { alerts: data.features || [], zones: {}, center: null };
  }
  if (target.type === 'office') {
    const alerts = target.preload || (await nws(`https://api.weather.gov/alerts/active?office=${target.office}`, 90)).features || [];
    return { alerts, zones: { office: target.office }, center: null };
  }
  const point = await nws(`https://api.weather.gov/points/${target.lat.toFixed(4)},${target.lon.toFixed(4)}`, 3600);
  const zone = point.properties.forecastZone?.split('/').pop();
  const county = point.properties.county?.split('/').pop();
  const zones = [zone, county].filter(Boolean).join(',');
  const alerts = zones ? await nws(`https://api.weather.gov/alerts/active?zone=${zones}`, 90) : { features: [] };
  return { alerts: alerts.features || [], zones: { forecastZone: zone, county }, center: { lat: target.lat, lon: target.lon } };
}

app.get('/api/tv/region/:region', async (req, res) => {
  try {
    const target = await resolveTvRegion(req.params.region);
    const data = await tvAlertsForResolvedTarget(target);
    const globals = target.type === 'spotter'
      ? (data.alerts || []).filter(a => isGlobalStormEvent(a.properties?.event, a.properties?.severity))
      : [];
    res.json({ ok: true, target, ...data, globalAlerts: globals });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

app.get('/api/tv/focus-alerts', async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!validCoord(lat, lon)) return badRequest(res, 'lat/lon are required and must be valid coordinates.');
    const point = await nws(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, 3600);
    const zone = point.properties.forecastZone?.split('/').pop();
    const county = point.properties.county?.split('/').pop();
    const zones = [zone, county].filter(Boolean).join(',');
    const alerts = zones ? await nws(`https://api.weather.gov/alerts/active?zone=${zones}`, 90) : { features: [] };
    const location = point.properties.relativeLocation?.properties;
    const label = location ? [location.city, location.state].filter(Boolean).join(', ') : (county || zone || 'Map focus');
    res.json({ ok: true, label, zones: { forecastZone: zone, county }, alerts: alerts.features || [] });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, () => {
  console.log(`Hazardous Weather Observation System running on http://localhost:${PORT}`);
  console.log(`Set CONTACT_EMAIL and APP_URL env vars before real use.`);
});
