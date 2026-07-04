const qs = id => document.getElementById(id);
const safe = v => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const region = decodeURIComponent((location.pathname.match(/\/(?:tv\.html|tv)\/([^/?#]+)/)?.[1] || 'spotter')).trim();
const normalizeRegionTarget = v => String(v || 'all').trim().toLowerCase().replace(/%20/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'all';
const isSpotter = normalizeRegionTarget(region) === 'spotter';
const state = { map:null, base:null, local:[], global:[], seen:new Set(), bannerTimer:null, focus:null, alertsLayer:null, radarLayer:null, radarFrames:[], radarIndex:0, radarRequestId:0, theme:'standard', sound:true, tts:true, ttsVoice:'', dark:false, timeout:60000, zoneGeometryCache:new Map(), alertLayerRenderToken:0, tvAudioNotified:new Set() };
const regionKey = normalizeRegionTarget(region);

const RADAR_IMAGE_SERVER = 'https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity_time/ImageServer';
function tvBoundsBbox(){ const b=state.map.getBounds(); const sw=L.CRS.EPSG3857.project(b.getSouthWest()); const ne=L.CRS.EPSG3857.project(b.getNorthEast()); return `${sw.x},${sw.y},${ne.x},${ne.y}`; }
function tvRadarUrl(frameMs){ const size=state.map.getSize(); const url=new URL(`${RADAR_IMAGE_SERVER}/exportImage`); url.searchParams.set('f','image'); url.searchParams.set('format','png32'); url.searchParams.set('transparent','true'); url.searchParams.set('bbox', tvBoundsBbox()); url.searchParams.set('bboxSR','3857'); url.searchParams.set('imageSR','3857'); url.searchParams.set('size', `${Math.max(256,size.x)},${Math.max(256,size.y)}`); url.searchParams.set('time', String(frameMs || Date.now())); return url.toString(); }
async function loadRadarFrames(){ try{ const data=await fetchJson('/api/radar/frames'); state.radarFrames=(data.frames||[]).map(Number).filter(Number.isFinite).sort((a,b)=>a-b); state.radarIndex=Math.max(0,state.radarFrames.length-1); }catch(e){ const now=Date.now(); const step=5*60*1000; const rounded=Math.floor(now/step)*step; state.radarFrames=[rounded]; state.radarIndex=0; } updateTvRadar(); }
function updateTvRadar(){ if(!state.map) return; const frame=state.radarFrames[state.radarIndex] || Date.now(); const requestId=++state.radarRequestId; const next=L.imageOverlay(tvRadarUrl(frame), state.map.getBounds(), { opacity:.68, interactive:false, crossOrigin:false }); next.once('load',()=>{ if(requestId!==state.radarRequestId){ state.map.removeLayer(next); return; } if(state.radarLayer) state.map.removeLayer(state.radarLayer); state.radarLayer=next; state.radarLayer.addTo(state.map); state.radarLayer.bringToFront(); if(state.alertsLayer) state.alertsLayer.bringToFront(); }); next.once('error',()=>{ if(requestId===state.radarRequestId) console.warn('TV radar frame failed to load'); }); next.addTo(state.map); }

const basemaps = {
  standard:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  hot:'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
  opentopo:'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png'
};
function kind(event='') { const e=event.toLowerCase(); if(e.includes('warning')) return 'Warning'; if(e.includes('watch')) return 'Watch'; if(e.includes('advisory')) return 'Advisory'; return 'Statement'; }
function cls(event='') { const k=kind(event); return k==='Warning'?'warning':k==='Watch'?'watch':k==='Advisory'?'advisory':'statement'; }
function idOf(a){ const p=a.properties||a; return String(p.id||p['@id']||a.id||`${p.event}-${p.sent}-${p.areaDesc}`); }
function center(feature){
  const pts=[]; (function flat(c){ if(!Array.isArray(c))return; if(typeof c[0]==='number'&&typeof c[1]==='number') pts.push([c[1],c[0]]); else c.forEach(flat); })(feature.geometry?.coordinates||[]);
  if(!pts.length) return state.focus ? [state.focus.lat,state.focus.lon] : [41.064,-86.215];
  return [pts.reduce((s,p)=>s+p[0],0)/pts.length, pts.reduce((s,p)=>s+p[1],0)/pts.length];
}
function fmt(t){ if(!t) return '—'; try { return new Date(t).toLocaleString([], { month:'short', day:'numeric', hour:'numeric', minute:'2-digit'}); } catch { return t; } }
function areaShort(s='', limit=120){ const parts=String(s).split(/;|,/).map(x=>x.trim()).filter(Boolean); if(!parts.length) return '—'; const out=[]; let len=0; for(const p of parts){ if(out.length>=6 || len+p.length>limit) break; out.push(p); len+=p.length+3; } return out.join(' • ') + (parts.length>out.length ? ` and ${parts.length-out.length} more` : ''); }
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

function office(p){ return (p.senderName||p.source||'NWS Office').replace(/^National Weather Service\s*/i,'NWS '); }
function setBase(theme){ state.theme=theme; if(state.base) state.map.removeLayer(state.base); state.base=L.tileLayer(basemaps[theme]||basemaps.standard,{maxZoom:19, attribution:'&copy; OpenStreetMap contributors'}).addTo(state.map); localStorage.setItem('hwosTvTheme',theme); }
function loadPrefs(){ state.theme=localStorage.getItem('hwosTvTheme')||'standard'; state.sound=localStorage.getItem('hwosTvSound')!=='false'; state.tts=localStorage.getItem('hwosTvTts')!=='false'; state.ttsVoice=localStorage.getItem('hwosTvTtsVoice')||''; state.dark=localStorage.getItem('hwosTvDarkMode')==='true'; state.timeout=Number(localStorage.getItem('hwosTvTimeout')||60000); }
function savePrefs(){ localStorage.setItem('hwosTvSound', String(state.sound)); localStorage.setItem('hwosTvTts', String(state.tts)); localStorage.setItem('hwosTvTtsVoice', String(state.ttsVoice||'')); localStorage.setItem('hwosTvDarkMode', String(state.dark)); localStorage.setItem('hwosTvTimeout', String(state.timeout)); }
function applyTvDarkMode(){ const app=qs('tvApp'); if(app) app.dataset.colorScheme=state.dark?'dark':'light'; }
function populateTtsVoices(){ const sel=qs('tvTtsVoiceSelect'); if(!sel || !('speechSynthesis' in window)) return; const current=state.ttsVoice; const voices=speechSynthesis.getVoices(); sel.innerHTML='<option value="">System default</option>'+voices.map(v=>`<option value="${safe(v.voiceURI)}">${safe(v.name)}${v.lang?` (${safe(v.lang)})`:''}</option>`).join(''); sel.value=current; }
const TV_STATE_NAMES = {
  AL:'Alabama', AK:'Alaska', AZ:'Arizona', AR:'Arkansas', CA:'California', CO:'Colorado', CT:'Connecticut', DE:'Delaware', FL:'Florida', GA:'Georgia', HI:'Hawaii', IA:'Iowa', ID:'Idaho', IL:'Illinois', IN:'Indiana', KS:'Kansas', KY:'Kentucky', LA:'Louisiana', MA:'Massachusetts', MD:'Maryland', ME:'Maine', MI:'Michigan', MN:'Minnesota', MO:'Missouri', MS:'Mississippi', MT:'Montana', NC:'North Carolina', ND:'North Dakota', NE:'Nebraska', NH:'New Hampshire', NJ:'New Jersey', NM:'New Mexico', NV:'Nevada', NY:'New York', OH:'Ohio', OK:'Oklahoma', OR:'Oregon', PA:'Pennsylvania', RI:'Rhode Island', SC:'South Carolina', SD:'South Dakota', TN:'Tennessee', TX:'Texas', UT:'Utah', VA:'Virginia', VT:'Vermont', WA:'Washington', WI:'Wisconsin', WV:'West Virginia', WY:'Wyoming', DC:'District of Columbia'
};
function tvStateFromAlert(alert){
  const p = alert?.properties || alert || {};
  const candidates = [];
  if (p.state) candidates.push(p.state);
  if (p.stateCode) candidates.push(p.stateCode);
  if (p.targetRegion && !['all','spotter','global','everyone'].includes(normalizeRegionTarget(p.targetRegion))) candidates.push(p.targetRegion);
  if (state.focus?.label) candidates.push(state.focus.label);
  if (p.areaDesc) candidates.push(p.areaDesc);
  const ugc = Array.isArray(p.geocode?.UGC) ? p.geocode.UGC : [];
  for (const code of ugc) {
    const m = String(code || '').match(/^([A-Z]{2})[CZ]\d{3}$/i);
    if (m && TV_STATE_NAMES[m[1].toUpperCase()]) return TV_STATE_NAMES[m[1].toUpperCase()];
  }
  const zones = Array.isArray(p.affectedZones) ? p.affectedZones : [];
  for (const z of zones) {
    const m = String(z || '').match(/\/([A-Z]{2})[CZ]\d{3}(?:\b|$)/i);
    if (m && TV_STATE_NAMES[m[1].toUpperCase()]) return TV_STATE_NAMES[m[1].toUpperCase()];
  }
  for (const item of candidates) {
    const text = String(item || '');
    for (const [abbr, name] of Object.entries(TV_STATE_NAMES)) {
      if (new RegExp(`(?:^|[\\s,;/-])${abbr}(?:$|[\\s,;/-])`, 'i').test(text)) return name;
      if (new RegExp(`\\b${name.replace(/ /g, '\\s+')}\\b`, 'i').test(text)) return name;
    }
  }
  return state.focus?.label || 'the selected area';
}
function tvAlertTtsText(alert){
  const p = alert?.properties || alert || {};
  const event = String(p.event || 'weather alert').trim();
  const stateName = tvStateFromAlert(alert);
  return `A new ${event} has been issued for ${stateName}.`;
}
function getTvAlertAudio(){
  const existing = qs('tvAlertAudioPreload');
  if(existing) return existing;
  const a = document.createElement('audio');
  a.id = 'tvAlertAudioPreload';
  a.src = '/sounds/alert.wav';
  a.preload = 'auto';
  document.body.appendChild(a);
  return a;
}
function primeTvAlertAudio(){
  try {
    const a = getTvAlertAudio();
    a.load?.();
  } catch {}
  if('speechSynthesis' in window) {
    try { speechSynthesis.resume?.(); speechSynthesis.getVoices(); } catch {}
  }
}
function playSound(){
  if(!state.sound) return Promise.resolve(false);
  return new Promise(resolve=>{
    let done=false;
    const finish=(played=false)=>{ if(done) return; done=true; resolve(played); };
    const sources = ['/sounds/alert.wav', 'sounds/alert.wav', './sounds/alert.wav'];
    let i = 0;
    const trySource = () => {
      const src = sources[i++];
      if(!src) return finish(false);
      try {
        const audio = new Audio(src);
        audio.volume = 1;
        audio.preload = 'auto';
        audio.addEventListener('ended', ()=>finish(true), { once:true });
        audio.addEventListener('error', trySource, { once:true });
        const result = audio.play();
        if(result && typeof result.then === 'function') {
          result.then(()=>{}).catch(()=>{
            // If the browser blocks autoplay, try the preloaded element once, then resolve so TTS still runs.
            try {
              const preload = getTvAlertAudio();
              preload.currentTime = 0;
              preload.volume = 1;
              const preloadResult = preload.play();
              if(preloadResult && typeof preloadResult.then === 'function') preloadResult.then(()=>{}).catch(()=>finish(false));
              else finish(true);
            } catch { finish(false); }
          });
        }
        setTimeout(()=>finish(true), 6500);
      } catch {
        trySource();
      }
    };
    trySource();
  });
}
function speak(alert){
  if(!state.tts || !('speechSynthesis' in window) || !window.SpeechSynthesisUtterance) return false;
  const say = () => {
    try { speechSynthesis.resume?.(); speechSynthesis.cancel(); } catch {}
    const u=new SpeechSynthesisUtterance(tvAlertTtsText(alert));
    const voices=speechSynthesis.getVoices();
    const voice=voices.find(v=>v.voiceURI===state.ttsVoice) || voices.find(v=>/en[-_]?US/i.test(v.lang||'')) || voices[0];
    if(voice) u.voice=voice;
    u.rate=.96;
    u.pitch=1;
    u.volume=1;
    try { speechSynthesis.speak(u); return true; } catch { return false; }
  };
  if(!speechSynthesis.getVoices().length) {
    try { speechSynthesis.onvoiceschanged = () => { populateTtsVoices(); say(); }; } catch {}
    setTimeout(say, 350);
  } else {
    setTimeout(say, 120);
  }
  return true;
}
function playIncomingAlertAudio(alert){
  primeTvAlertAudio();
  let spoke=false;
  const doSpeak=()=>{ if(spoke) return; spoke=true; speak(alert); };
  // Start the WAV immediately, then TTS. TTS also fires on a timer so a blocked WAV cannot suppress speech.
  playSound().then(()=>setTimeout(doSpeak, 250));
  setTimeout(doSpeak, state.sound ? 1250 : 120);
}
function popupHtml(alert){ const p=alert.properties||{}; const event=p.event||'Weather Alert'; return `<div class="tv-popup"><img class="tv-alert-image" src="${safe(alertImageUrl(event))}" alt="${safe(event)} image" onerror="this.onerror=null;this.src='/assets/weather-alerts/statement.png';"><div class="tv-popup-body"><h3>${safe(event)}</h3><p><strong>${safe(office(p))}</strong></p><p><strong>Issued:</strong> ${safe(fmt(p.sent||p.effective))}<br><strong>Expires:</strong> ${safe(fmt(p.expires||p.ends))}</p><p><strong>Areas:</strong> ${safe(areaShort(p.areaDesc,160))}</p><p>${safe(p.headline||p.description||'')}</p></div></div>`; }
async function zoneGeometryForAlert(alert){
  const p = alert.properties || {};
  const zones = Array.isArray(p.affectedZones) ? p.affectedZones : [];
  const out = [];
  for (const zoneUrl of zones.slice(0,35)) {
    if (!/api\.weather\.gov\/zones\/(county|forecast|fire)\//i.test(String(zoneUrl))) continue;
    try {
      if (!state.zoneGeometryCache.has(zoneUrl)) {
        state.zoneGeometryCache.set(zoneUrl, fetchJson(`/api/nws-zone?url=${encodeURIComponent(zoneUrl)}`).catch(()=>null));
      }
      const zone = await state.zoneGeometryCache.get(zoneUrl);
      if (!zone?.geometry) continue;
      out.push({ type:'Feature', geometry: zone.geometry, properties: { ...p, _derivedZone:true, _zoneName: zone.name || zone.id || '' } });
    } catch {}
  }
  return out;
}
async function drawAlerts(alerts){
  const token = ++state.alertLayerRenderToken;
  state.alertsLayer.clearLayers();
  const direct = alerts.filter(a=>a.geometry);
  if (direct.length) state.alertsLayer.addData({type:'FeatureCollection',features:direct});
  const missing = alerts.filter(a=>!a.geometry && Array.isArray(a.properties?.affectedZones));
  for (const alert of missing) {
    const zoneFeatures = await zoneGeometryForAlert(alert);
    if (token !== state.alertLayerRenderToken) return;
    if (zoneFeatures.length) state.alertsLayer.addData({type:'FeatureCollection',features:zoneFeatures});
  }
}
function showBanner(alert){ const p=alert.properties||{}; qs('tvBannerOffice').textContent=office(p); qs('tvBannerTitle').textContent=p.event||'Weather Alert'; qs('tvBannerTimes').textContent=`Issued ${fmt(p.sent||p.effective)} • Expires ${fmt(p.expires||p.ends)}`; qs('tvBannerAreas').textContent=`Areas: ${areaShort(p.areaDesc,135)}`; qs('tvBottomBanner').classList.remove('d-none'); clearTimeout(state.bannerTimer); state.bannerTimer=setTimeout(()=>qs('tvBottomBanner').classList.add('d-none'), state.timeout); }
function activateAlert(alert, realtime=false){ const c=center(alert); state.map.flyTo(c, Math.max(state.map.getZoom(), 8), { duration:.75 }); L.popup({className:'tv-alert-popup', maxWidth:360}).setLatLng(c).setContent(popupHtml(alert)).openOn(state.map); showBanner(alert); if(realtime){ playIncomingAlertAudio(alert); } if(isSpotter) loadLocalForCenter(c[0], c[1]); }
function renderList(el, alerts){
  el?.style?.setProperty('--tv-alert-count', String(Math.max(1, alerts.length)));
  el?.closest?.('.tv-panel')?.style?.setProperty('--tv-alert-count', String(Math.max(1, alerts.length)));
  const max=6; const shown=alerts.slice(0,max); const more=Math.max(0, alerts.length-shown.length);
  el.innerHTML = shown.map((a,i)=>{ const p=a.properties||{}; return `<div class="tv-alert-card ${cls(p.event)}" data-alert-index="${i}"><div class="tv-alert-title">${safe(p.event||'Weather Alert')}</div><div class="tv-alert-small">${safe(areaShort(p.areaDesc,80))}</div><div class="tv-alert-small">Expires ${safe(fmt(p.expires||p.ends))}</div></div>`; }).join('') + (more?`<div class="tv-more">and ${more} more alerts<br><small>Visit hwos.alamostudios.net for more information</small></div>`:'');
  [...el.querySelectorAll('[data-alert-index]')].forEach(node=>node.addEventListener('click',()=>activateAlert(alerts[Number(node.dataset.alertIndex)], false)));
}
function alertTargetsThisTv(alert){
  const p=alert.properties||{};
  const target=normalizeRegionTarget(p.targetRegionKey || p.targetRegion || 'all');
  if (!target || target === 'all' || target === 'everyone' || target === 'global') return true;
  if (target === 'spotter') return isSpotter;
  const labelKey=normalizeRegionTarget(state.focus?.label || '');
  return target === regionKey || target === labelKey || labelKey.includes(target) || target.includes(labelKey);
}
function notifyTvAlertOnce(alert){
  if(!alert?.properties) return;
  const p = alert.properties || {};
  const id = `admin-audio:${idOf(alert)}:${p.event || ''}:${p.sent || p.effective || ''}`;
  if(state.tvAudioNotified.has(id)) return;
  state.tvAudioNotified.add(id);
  if(state.tvAudioNotified.size > 120) state.tvAudioNotified = new Set([...state.tvAudioNotified].slice(-60));
  playIncomingAlertAudio(alert);
}
function receiveAdminTvAlert(alert){
  if(!alert?.properties || !alertTargetsThisTv(alert)) return;
  // Any admin-sent alert type (tornado, winter weather, admin message, etc.) must trigger the same TV audio/TTS path.
  // Do this before map/list rendering so a popup, geometry, or region-render failure cannot skip audio.
  notifyTvAlertOnce(alert);
  if(isSpotter){
    state.global=[alert, ...state.global.filter(a=>idOf(a)!==idOf(alert))].slice(0,60);
  } else {
    state.local=[alert, ...state.local.filter(a=>idOf(a)!==idOf(alert))].slice(0,60);
  }
  activateAlert(alert, false);
  render();
}
function connectAdminAlertStream(){
  if(!window.EventSource) return;
  const events=new EventSource('/api/events');
  const handle = message => { try{ receiveAdminTvAlert(JSON.parse(message.data)); }catch{} };
  events.addEventListener('connected', ()=>primeTvAlertAudio());
  events.addEventListener('fake-alert', handle);
  events.addEventListener('tv-alert', handle);
  events.addEventListener('alert', handle);
  events.addEventListener('warning', handle);
  events.addEventListener('admin-message-updated', handle);
  events.onmessage = handle;
  events.onerror=()=>{};
}
function render(){
  qs('tvGlobalPanel').classList.toggle('d-none', !isSpotter);
  renderList(qs('tvLocalAlerts'), state.local);
  if(isSpotter) renderList(qs('tvGlobalAlerts'), state.global);
  drawAlerts(isSpotter ? [...state.global, ...state.local] : state.local);
}
async function fetchJson(url){ const r=await fetch(url); if(!r.ok) throw new Error(await r.text()); return r.json(); }
async function loadLocalForCenter(lat,lon){ try{ const data=await fetchJson(`/api/alerts?lat=${lat}&lon=${lon}`); state.local=data.alerts||[]; render(); }catch(e){ console.warn(e); } }
async function poll(){
  try{
    if(isSpotter){
      const data=await fetchJson('/api/alerts/spotter');
      state.global=data.alerts||[];
      const newest=state.global.find(a=>!state.seen.has(idOf(a)));
      state.global.forEach(a=>state.seen.add(idOf(a)));
      if(newest) activateAlert(newest, true);
      render();
    } else if(state.focus){
      const data=await fetchJson(`/api/alerts?lat=${state.focus.lat}&lon=${state.focus.lon}`);
      const alerts=data.alerts||[];
      const newest=alerts.find(a=>!state.seen.has(idOf(a)));
      alerts.forEach(a=>state.seen.add(idOf(a)));
      state.local=alerts;
      if(newest) activateAlert(newest, true);
      render();
    }
  } catch(e){ console.warn(e); }
}
async function resolveRegion(){
  if(isSpotter){ state.focus={lat:39.8,lon:-98.6,label:'Spotter Mode'}; qs('tvRegionLabel').textContent='Spotter Mode'; state.map.setView([39.8,-98.6],5); qs('tvGlobalPanel').classList.remove('d-none'); await poll(); return; }
  const data=await fetchJson(`/api/location/resolve?q=${encodeURIComponent(region)}`);
  state.focus={lat:data.lat, lon:data.lon, label:data.label||region}; qs('tvRegionLabel').textContent=state.focus.label; state.map.setView([data.lat,data.lon],8); await loadLocalForCenter(data.lat,data.lon); state.local.forEach(a=>state.seen.add(idOf(a)));
}
function init(){
  loadPrefs();
  applyTvDarkMode();
  state.map=L.map('tvMap',{zoomControl:false, attributionControl:false}).setView([41.064,-86.215],8);
  setBase(state.theme);
  state.alertsLayer=L.geoJSON(null,{style:f=>({color: cls(f.properties?.event)==='warning'?'#b91c1c':'#b45309', weight:2, fillOpacity:.28}), onEachFeature:(f,l)=>l.on('click',()=>activateAlert(f,false))}).addTo(state.map);
  state.map.on('moveend zoomend resize',()=>updateTvRadar());
  state.map.whenReady(()=>setTimeout(updateTvRadar, 250));
  loadRadarFrames();
  qs('tvSettingsBtn').onclick=()=>{ primeTvAlertAudio(); qs('tvSettings').classList.add('open'); }; qs('tvCloseSettings').onclick=()=>qs('tvSettings').classList.remove('open'); document.addEventListener('pointerdown', primeTvAlertAudio, { once:true }); document.addEventListener('keydown', primeTvAlertAudio, { once:true });
  qs('tvSoundToggle').checked=state.sound; qs('tvTtsToggle').checked=state.tts; qs('tvThemeSelect').value=state.theme; qs('tvTimeoutSelect').value=String(state.timeout); if(qs('tvDarkModeToggle')) qs('tvDarkModeToggle').checked=state.dark; populateTtsVoices(); if('speechSynthesis' in window) speechSynthesis.onvoiceschanged=populateTtsVoices;
  qs('tvSoundToggle').onchange=e=>{state.sound=e.target.checked; savePrefs();}; qs('tvTtsToggle').onchange=e=>{state.tts=e.target.checked; savePrefs();}; qs('tvTtsVoiceSelect')&&(qs('tvTtsVoiceSelect').onchange=e=>{state.ttsVoice=e.target.value; savePrefs();}); qs('tvDarkModeToggle')&&(qs('tvDarkModeToggle').onchange=e=>{state.dark=e.target.checked; applyTvDarkMode(); savePrefs();}); qs('tvTimeoutSelect').onchange=e=>{state.timeout=Number(e.target.value); savePrefs();}; qs('tvThemeSelect').onchange=e=>setBase(e.target.value);
  connectAdminAlertStream();
  resolveRegion().catch(e=>{ qs('tvRegionLabel').textContent='Region unavailable'; console.error(e); });
  setInterval(poll, 60000);
}
init();
