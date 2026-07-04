const TYPES = [
  'Tornado Warning', 'Tornado Watch', 'Severe Thunderstorm Warning', 'Severe Thunderstorm Watch',
  'Flash Flood Warning', 'Flash Flood Watch', 'Flood Warning', 'Flood Watch',
  'Winter Storm Warning', 'Winter Storm Watch', 'Winter Weather Advisory',
  'High Wind Warning', 'Wind Advisory', 'Dense Fog Advisory', 'Heat Advisory',
  'Special Weather Statement', 'Test Message', 'Custom Message'
];
const $ = (id) => document.getElementById(id);
const alertType = $('alertType');
const quick = $('quickButtons');
const result = $('result');

for (const type of TYPES) {
  const option = document.createElement('option');
  option.value = type;
  option.textContent = type;
  alertType.appendChild(option);
}

function soundEventForKey(event = '', soundKey = 'auto') {
  if (soundKey === 'tornado') return 'Tornado Warning';
  if (soundKey === 'warning') return 'Severe Thunderstorm Warning';
  if (soundKey === 'watch') return 'Tornado Watch';
  if (soundKey === 'advisory') return 'Wind Advisory';
  if (soundKey === 'statement') return 'Special Weather Statement';
  return event;
}

function playToneSequence(sequence = []) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx || !sequence.length) return;
  const ctx = new AudioCtx();
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.001, ctx.currentTime);
  master.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.02);
  master.connect(ctx.destination);
  let offset = 0;
  sequence.forEach(step => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const duration = Math.max(30, Number(step.duration || 120)) / 1000;
    osc.type = step.wave || 'sine';
    osc.frequency.setValueAtTime(Number(step.frequency || 440), ctx.currentTime + offset);
    gain.gain.setValueAtTime(0.001, ctx.currentTime + offset);
    gain.gain.exponentialRampToValueAtTime(1, ctx.currentTime + offset + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + Math.max(0.025, duration - 0.015));
    osc.connect(gain);
    gain.connect(master);
    osc.start(ctx.currentTime + offset);
    osc.stop(ctx.currentTime + offset + duration);
    offset += duration + 0.035;
  });
  master.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.12);
  setTimeout(() => ctx.close(), Math.ceil((offset + 0.4) * 1000));
}

function playSound(event = '', soundKey = 'auto', severity = '') {
  if (soundKey === 'silent') return;
  event = soundEventForKey(event, soundKey);
  if (soundKey === 'admin-green') return playToneSequence([
    { wave: 'sine', frequency: 659, duration: 110 },
    { wave: 'sine', frequency: 784, duration: 110 },
    { wave: 'sine', frequency: 988, duration: 180 }
  ]);
  if (soundKey === 'admin-red') return playToneSequence([
    { wave: 'square', frequency: 622, duration: 120 },
    { wave: 'square', frequency: 466, duration: 120 },
    { wave: 'square', frequency: 622, duration: 120 },
    { wave: 'sine', frequency: 740, duration: 220 }
  ]);
  if (event.includes('Tornado') || String(severity).toLowerCase() === 'extreme') return playToneSequence([
    { wave: 'square', frequency: 1563, duration: 90 },
    { wave: 'square', frequency: 2083, duration: 90 },
    { wave: 'square', frequency: 1563, duration: 90 },
    { wave: 'square', frequency: 2083, duration: 90 },
    { wave: 'sine', frequency: 960, duration: 180 },
    { wave: 'sine', frequency: 853, duration: 180 },
    { wave: 'square', frequency: 1563, duration: 120 }
  ]);
  if (event.includes('Warning')) return playToneSequence([
    { wave: 'square', frequency: 740, duration: 160 },
    { wave: 'square', frequency: 520, duration: 160 },
    { wave: 'square', frequency: 740, duration: 180 }
  ]);
  if (event.includes('Watch')) return playToneSequence([
    { wave: 'sine', frequency: 520, duration: 160 },
    { wave: 'sine', frequency: 440, duration: 220 }
  ]);
  return playToneSequence([{ wave: 'sine', frequency: 440, duration: 180 }]);
}

function kindClass(type) {
  if (type.includes('Warning')) return 'warning';
  if (type.includes('Watch')) return 'watch';
  if (type.includes('Advisory')) return 'advisory';
  return 'statement';
}

function defaultSeverity(type) {
  if (type.includes('Tornado') || type.includes('Warning')) return 'Severe';
  if (type.includes('Watch')) return 'Moderate';
  return 'Minor';
}

async function send(payload) {
  const res = await fetch('/api/admin/fake-alert', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}

for (const type of TYPES.filter(t => t !== 'Custom Message')) {
  const btn = document.createElement('button');
  btn.className = kindClass(type);
  btn.textContent = type;
  btn.addEventListener('click', async () => {
    try {
      const payload = {
        event: type,
        headline: `FCDR HWOS test: ${type}`,
        description: `This is a simulated ${type} sent from the HWOS admin console.`,
        severity: defaultSeverity(type),
        urgency: type.includes('Warning') ? 'Immediate' : 'Expected',
        soundKey: 'auto',
        targetRegion: $('targetRegion')?.value || 'all'
      };
      const json = await send(payload);
      result.textContent = `Sent ${type} to ${json.clients} connected client(s).`;
    } catch (err) { result.textContent = `Error: ${err.message}`; }
  });
  quick.appendChild(btn);
}


function defaultAdminExpirationValue() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function updateCategoryUi() {
  const isAdmin = $('messageCategory')?.value === 'admin';
  $('adminMessageOptions').hidden = !isAdmin;
  $('alertType').disabled = isAdmin;
  $('severity').disabled = isAdmin;
  $('urgency').disabled = isAdmin;
  $('soundKey').disabled = isAdmin;
  if (isAdmin && !$('adminExpires').value) $('adminExpires').value = defaultAdminExpirationValue();
}

$('messageCategory')?.addEventListener('change', updateCategoryUi);
updateCategoryUi();

$('previewSound').addEventListener('click', () => {
  if ($('messageCategory')?.value === 'admin') playSound('Administrative Message', `admin-${$('adminSeverity').value}`, $('adminSeverity').value);
  else playSound(alertType.value, $('soundKey').value, $('severity').value);
});

function datetimeLocalFromIso(value) {
  const d = new Date(value || Date.now());
  if (Number.isNaN(d.getTime())) return '';
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function renderCurrentAdminMessage(message) {
  const box = $('currentAdminMessage');
  const expiresInput = $('currentAdminExpires');
  if (!box) return;
  if (!message?.properties) {
    box.innerHTML = 'No active administrative message.';
    box.className = 'current-admin-message muted-box';
    if (expiresInput) expiresInput.value = '';
    return;
  }
  const p = message.properties;
  const sev = String(p.adminSeverity || 'green').toLowerCase() === 'red' ? 'red' : 'green';
  box.className = `current-admin-message ${sev}`;
  box.innerHTML = `<strong>${escapeHtml(p.headline || 'Administrative Message')}</strong><p>${escapeHtml(p.description || '')}</p><small>Expires ${escapeHtml(new Date(p.expires).toLocaleString())}</small>`;
  if (expiresInput) expiresInput.value = datetimeLocalFromIso(p.expires);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
}

async function loadCurrentAdminMessage() {
  try {
    const res = await fetch('/api/admin/current-message');
    const json = await res.json();
    renderCurrentAdminMessage(json.message || null);
  } catch {
    renderCurrentAdminMessage(null);
  }
}

$('updateAdminExpiration')?.addEventListener('click', async () => {
  try {
    const expires = $('currentAdminExpires')?.value;
    if (!expires) throw new Error('Choose an expiration date/time first.');
    const res = await fetch('/api/admin/admin-message/expiration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expires })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Unable to update expiration.');
    renderCurrentAdminMessage(json.message || null);
    result.textContent = 'Administrative message expiration updated.';
  } catch (err) { result.textContent = `Error: ${err.message}`; }
});

$('expireAdminNow')?.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/admin/admin-message/expire', { method: 'POST' });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Unable to expire message.');
    renderCurrentAdminMessage(null);
    result.textContent = 'Administrative message expired.';
  } catch (err) { result.textContent = `Error: ${err.message}`; }
});

$('alertForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const isAdmin = $('messageCategory')?.value === 'admin';
    const adminSeverity = $('adminSeverity')?.value || 'green';
    const payload = {
      event: isAdmin ? 'Administrative Message' : alertType.value,
      headline: $('headline').value || (isAdmin ? 'Administrative Message' : 'FCDR HWOS test alert'),
      description: $('message').value || 'Administrative test message.',
      severity: isAdmin ? (adminSeverity === 'red' ? 'Severe' : 'Minor') : $('severity').value,
      urgency: isAdmin ? 'Expected' : $('urgency').value,
      soundKey: isAdmin ? `admin-${adminSeverity}` : $('soundKey').value,
      adminMessage: isAdmin,
      adminSeverity,
      expires: isAdmin ? $('adminExpires').value : undefined,
      targetRegion: $('targetRegion')?.value || 'all'
    };
    const json = await send(payload);
    result.textContent = `Sent ${payload.event} to ${json.clients} connected client(s).`;
    if (isAdmin) loadCurrentAdminMessage();
  } catch (err) { result.textContent = `Error: ${err.message}`; }
});

loadCurrentAdminMessage();
