'use strict';

// ---------- Constants ----------

const MOODS = [
  { value: 5, label: 'Super', emoji: '🤩', color: '#a8e6cf' },
  { value: 4, label: 'Good',  emoji: '🙂', color: '#dcedc1' },
  { value: 3, label: 'Meh',   emoji: '😐', color: '#ffeaa7' },
  { value: 2, label: 'Bad',   emoji: '🙁', color: '#ffd3b6' },
  { value: 1, label: 'Awful', emoji: '😫', color: '#ffaaa5' },
];
const moodByValue = Object.fromEntries(MOODS.map(m => [m.value, m]));

const WEATHER = [
  { id: 'sunny',  label: 'Sunny',  emoji: '☀️' },
  { id: 'partly', label: 'Partly', emoji: '⛅' },
  { id: 'cloudy', label: 'Cloudy', emoji: '☁️' },
  { id: 'rainy',  label: 'Rainy',  emoji: '🌧️' },
  { id: 'stormy', label: 'Stormy', emoji: '⛈️' },
  { id: 'snowy',  label: 'Snowy',  emoji: '❄️' },
];
const weatherById = Object.fromEntries(WEATHER.map(w => [w.id, w]));

const DEFAULTS = { mood: null, social: 50, weather: null, sleep: 7, note: '', photo: null };
const SLEEP_MIN = 0;
const SLEEP_MAX = 16;
const BACKUP_KEY = 'moodTracker.lastBackup';
const BACKUP_NUDGE_DAYS = 30;

// ---------- Date helpers ----------

const pad = n => String(n).padStart(2, '0');
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const todayKey = () => keyOf(new Date());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const startOfWeek = d => addDays(d, -((d.getDay() + 6) % 7)); // Monday
const fmt = (d, opts) => d.toLocaleDateString('en-GB', opts);

// ---------- Storage (IndexedDB) ----------

const db = {
  _open: null,
  open() {
    if (!this._open) {
      this._open = new Promise((resolve, reject) => {
        const req = indexedDB.open('mood-tracker', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('entries', { keyPath: 'date' });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this._open;
  },
  async run(mode, fn) {
    const conn = await this.open();
    return new Promise((resolve, reject) => {
      const tx = conn.transaction('entries', mode);
      const req = fn(tx.objectStore('entries'));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  },
  getAll() { return this.run('readonly', s => s.getAll()); },
  put(entry) { return this.run('readwrite', s => s.put(entry)); },
  putMany(list) { return this.run('readwrite', s => { list.forEach(e => s.put(e)); }); },
  clear() { return this.run('readwrite', s => s.clear()); },
};

const entries = new Map(); // date key -> entry

async function loadEntries() {
  entries.clear();
  (await db.getAll()).forEach(e => entries.set(e.date, e));
}

// ---------- State ----------

const state = {
  editingDate: todayKey(),
  followToday: true, // when true, the Today tab jumps to the new day after midnight
  form: { ...DEFAULTS },
  monthCursor: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  selectedDay: null,
  statsRange: 'week',
  statsAnchor: new Date(),
};

const $ = id => document.getElementById(id);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
}

// ---------- Today (daily log) ----------

function buildTodayControls() {
  $('mood-options').innerHTML = MOODS.map(m => `
    <button type="button" class="mood-btn" data-mood="${m.value}" role="radio" aria-checked="false">
      <span class="emoji">${m.emoji}</span>${m.label}
    </button>`).join('');

  $('weather-options').innerHTML = WEATHER.map(w => `
    <button type="button" class="chip" data-weather="${w.id}" role="radio" aria-checked="false">
      <span class="emoji">${w.emoji}</span>${w.label}
    </button>`).join('');

  $('mood-options').addEventListener('click', e => {
    const btn = e.target.closest('.mood-btn');
    if (!btn) return;
    state.form.mood = Number(btn.dataset.mood);
    renderForm();
  });

  $('weather-options').addEventListener('click', e => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    // Tapping the selected weather again clears it
    state.form.weather = state.form.weather === btn.dataset.weather ? null : btn.dataset.weather;
    renderForm();
  });

  $('social').addEventListener('input', e => {
    state.form.social = Number(e.target.value);
    renderSocial();
  });

  $('sleep-minus').addEventListener('click', () => changeSleep(-0.5));
  $('sleep-plus').addEventListener('click', () => changeSleep(0.5));

  $('note').addEventListener('input', e => { state.form.note = e.target.value; });

  $('photo-input').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      state.form.photo = await compressImage(file);
      renderForm();
    } catch {
      toast('Could not load that photo');
    }
  });

  $('photo-remove').addEventListener('click', () => {
    state.form.photo = null;
    renderForm();
  });

  $('save-btn').addEventListener('click', saveEntry);
  $('back-today-btn').addEventListener('click', () => loadForm(todayKey()));
}

function changeSleep(delta) {
  state.form.sleep = Math.min(SLEEP_MAX, Math.max(SLEEP_MIN, state.form.sleep + delta));
  $('sleep-value').textContent = state.form.sleep;
}

function renderSocial() {
  const slider = $('social');
  slider.value = state.form.social;
  slider.style.setProperty('--fill', `${state.form.social}%`);
  $('social-value').textContent = `${state.form.social}%`;
}

function loadForm(dateKey) {
  const entry = entries.get(dateKey);
  state.editingDate = dateKey;
  state.followToday = dateKey === todayKey();
  state.form = entry
    ? { mood: entry.mood, social: entry.social, weather: entry.weather, sleep: entry.sleep, note: entry.note, photo: entry.photo }
    : { ...DEFAULTS };
  renderForm();
}

function renderForm() {
  const f = state.form;
  const isToday = state.editingDate === todayKey();
  const date = parseKey(state.editingDate);

  $('today-date').textContent = isToday
    ? `Today · ${fmt(date, { weekday: 'long', day: 'numeric', month: 'short' })}`
    : fmt(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  document.querySelectorAll('.mood-btn').forEach(b => {
    const on = Number(b.dataset.mood) === f.mood;
    b.classList.toggle('selected', on);
    b.setAttribute('aria-checked', on);
  });
  document.querySelectorAll('#weather-options .chip').forEach(b => {
    const on = b.dataset.weather === f.weather;
    b.classList.toggle('selected', on);
    b.setAttribute('aria-checked', on);
  });

  renderSocial();
  $('sleep-value').textContent = f.sleep;
  $('note').value = f.note;

  $('photo-preview').classList.toggle('hidden', !f.photo);
  $('photo-add').classList.toggle('hidden', !!f.photo);
  if (f.photo) $('photo-img').src = f.photo;
  else $('photo-img').removeAttribute('src');

  const exists = entries.has(state.editingDate);
  $('save-btn').textContent = exists ? 'Update' : (isToday ? 'Save today' : 'Save');
  $('back-today-btn').classList.toggle('hidden', isToday);

  renderBackupNudge();
}

async function saveEntry() {
  const f = state.form;
  if (!f.mood) {
    toast('Pick a mood first');
    return;
  }
  const entry = {
    date: state.editingDate,
    mood: f.mood,
    social: f.social,
    weather: f.weather,
    sleep: f.sleep,
    note: f.note.trim(),
    photo: f.photo,
    updatedAt: Date.now(),
  };
  try {
    await db.put(entry);
    entries.set(entry.date, entry);
    renderForm();
    toast(`Saved ${moodByValue[entry.mood].emoji}`);
  } catch {
    toast('Could not save. Storage may be full.');
  }
}

function compressImage(file, maxSize = 1200, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image load failed')); };
    img.src = url;
  });
}

// ---------- Month view ----------

function renderMonth() {
  const cursor = state.monthCursor;
  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  const today = todayKey();
  const offset = (new Date(y, m, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(y, m + 1, 0).getDate();

  $('month-title').textContent = fmt(cursor, { month: 'long', year: 'numeric' });
  const now = new Date();
  $('month-next').disabled = y > now.getFullYear() || (y === now.getFullYear() && m >= now.getMonth());
  $('month-next').style.visibility = $('month-next').disabled ? 'hidden' : 'visible';

  let html = '<span></span>'.repeat(offset);
  for (let d = 1; d <= daysInMonth; d++) {
    const key = keyOf(new Date(y, m, d));
    const entry = entries.get(key);
    const classes = ['day'];
    if (key === today) classes.push('today');
    if (key > today) classes.push('future');
    if (key === state.selectedDay) classes.push('selected');
    html += `
      <button type="button" class="${classes.join(' ')}" data-date="${key}" ${key > today ? 'disabled' : ''}>
        <span class="num">${d}</span>
        <span class="emoji">${entry ? moodByValue[entry.mood].emoji : ''}</span>
      </button>`;
  }
  $('calendar').innerHTML = html;
  renderDayDetail();
}

function renderDayDetail() {
  const key = state.selectedDay;
  const box = $('day-detail');
  if (!key || !key.startsWith(keyOf(state.monthCursor).slice(0, 7))) {
    box.innerHTML = '';
    return;
  }
  const dateLabel = fmt(parseKey(key), { weekday: 'long', day: 'numeric', month: 'long' });
  const entry = entries.get(key);

  if (!entry) {
    box.innerHTML = `
      <div class="card">
        <h2>${dateLabel}</h2>
        <p class="hint">Nothing logged on this day.</p>
        <button type="button" class="secondary-btn" data-edit="${key}">Add entry</button>
      </div>`;
    return;
  }

  const mood = moodByValue[entry.mood];
  const weather = entry.weather ? weatherById[entry.weather] : null;
  box.innerHTML = `
    <div class="card">
      <div class="detail-head">
        <span class="emoji">${mood.emoji}</span>
        <div>
          <h2>${mood.label}</h2>
          <p>${dateLabel}</p>
        </div>
      </div>
      <div class="detail-tags">
        ${weather ? `<span class="tag">${weather.emoji} ${weather.label}</span>` : ''}
        <span class="tag">😴 ${entry.sleep} h</span>
        <span class="tag">🔋 ${entry.social}%</span>
      </div>
      ${entry.note ? `<p class="detail-note">${escapeHtml(entry.note)}</p>` : ''}
      ${entry.photo ? `<img class="detail-photo" src="${entry.photo}" alt="Photo from ${dateLabel}">` : ''}
      <button type="button" class="secondary-btn" data-edit="${key}">Edit</button>
    </div>`;
}

function setupMonth() {
  $('month-prev').addEventListener('click', () => shiftMonth(-1));
  $('month-next').addEventListener('click', () => shiftMonth(1));
  $('calendar').addEventListener('click', e => {
    const btn = e.target.closest('.day');
    if (!btn || btn.disabled) return;
    state.selectedDay = btn.dataset.date;
    renderMonth();
  });
  $('day-detail').addEventListener('click', e => {
    const btn = e.target.closest('[data-edit]');
    if (!btn) return;
    loadForm(btn.dataset.edit);
    switchView('today');
  });
}

function shiftMonth(delta) {
  const c = state.monthCursor;
  state.monthCursor = new Date(c.getFullYear(), c.getMonth() + delta, 1);
  renderMonth();
}

// ---------- Stats ----------

function statsPeriod() {
  const a = state.statsAnchor;
  if (state.statsRange === 'week') {
    const start = startOfWeek(a);
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    const end = days[6];
    const title = `${fmt(start, { day: 'numeric', month: 'short' })} – ${fmt(end, { day: 'numeric', month: 'short' })}`;
    return { days, title };
  }
  const y = a.getFullYear();
  const m = a.getMonth();
  const count = new Date(y, m + 1, 0).getDate();
  const days = Array.from({ length: count }, (_, i) => new Date(y, m, i + 1));
  return { days, title: fmt(a, { month: 'long', year: 'numeric' }) };
}

function renderStats() {
  const { days, title } = statsPeriod();
  const keys = days.map(keyOf);
  const logged = keys.map(k => entries.get(k)).filter(Boolean);

  $('stats-title').textContent = title;
  const hasFuture = keys[keys.length - 1] >= todayKey();
  $('stats-next').style.visibility = hasFuture ? 'hidden' : 'visible';

  $('mood-chart').innerHTML = logged.length
    ? moodChartSvg(days)
    : '<p class="empty">No moods logged in this period yet.</p>';

  const avg = arr => arr.reduce((s, n) => s + n, 0) / arr.length;
  const avgMood = logged.length ? avg(logged.map(e => e.mood)) : null;
  const avgSleep = logged.length ? avg(logged.map(e => e.sleep)) : null;
  const avgSocial = logged.length ? avg(logged.map(e => e.social)) : null;

  $('stat-grid').innerHTML = `
    <div class="stat">
      <div class="big">${avgMood ? `${moodByValue[Math.round(avgMood)].emoji} ${avgMood.toFixed(1)}` : '–'}</div>
      <div class="label">Avg mood</div>
    </div>
    <div class="stat">
      <div class="big">${avgSleep !== null ? `${avgSleep.toFixed(1)}h` : '–'}</div>
      <div class="label">Avg sleep</div>
    </div>
    <div class="stat">
      <div class="big">${avgSocial !== null ? `${Math.round(avgSocial)}%` : '–'}</div>
      <div class="label">Social battery</div>
    </div>`;

  const counts = MOODS.map(m => logged.filter(e => e.mood === m.value).length);
  const max = Math.max(1, ...counts);
  $('mood-count').innerHTML = MOODS.map((m, i) => `
    <div class="count">
      <span class="n">${counts[i]}</span>
      <div class="bar-wrap"><div class="bar" style="height:${(counts[i] / max) * 100}%;background:${m.color}"></div></div>
      <span class="emoji">${m.emoji}</span>
    </div>`).join('');
}

function moodChartSvg(days) {
  const W = 340, H = 210;
  const left = 34, right = 12, top = 14, bottom = 28;
  const plotW = W - left - right;
  const plotH = H - top - bottom;
  const n = days.length;
  const x = i => left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = v => top + ((5 - v) / 4) * plotH;

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Mood chart">`;

  // Horizontal guides with emoji labels
  MOODS.forEach(m => {
    svg += `<line x1="${left}" x2="${W - right}" y1="${y(m.value)}" y2="${y(m.value)}" stroke="#efe7f2" stroke-dasharray="3 4"/>`;
    svg += `<text x="${left - 8}" y="${y(m.value)}" font-size="15" text-anchor="end" dominant-baseline="central">${m.emoji}</text>`;
  });

  // X labels
  const weekLetters = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  days.forEach((d, i) => {
    const day = d.getDate();
    const label = n === 7 ? weekLetters[i] : (day === 1 || day % 5 === 0 ? day : '');
    if (label !== '') {
      svg += `<text x="${x(i)}" y="${H - 8}" font-size="11" fill="#9a93a8" text-anchor="middle">${label}</text>`;
    }
  });

  // Line + points
  const points = days
    .map((d, i) => ({ i, entry: entries.get(keyOf(d)) }))
    .filter(p => p.entry);
  if (points.length > 1) {
    const path = points.map((p, j) => `${j ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.entry.mood).toFixed(1)}`).join(' ');
    svg += `<path d="${path}" fill="none" stroke="#b9a6e8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  const r = n === 7 ? 7 : 4.5;
  points.forEach(p => {
    svg += `<circle cx="${x(p.i)}" cy="${y(p.entry.mood)}" r="${r}" fill="${moodByValue[p.entry.mood].color}" stroke="#8f78d6" stroke-width="2"/>`;
  });

  return svg + '</svg>';
}

function setupStats() {
  document.querySelectorAll('.seg').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.seg').forEach(b => b.classList.toggle('active', b === btn));
    state.statsRange = btn.dataset.range;
    state.statsAnchor = new Date();
    renderStats();
  }));
  $('stats-prev').addEventListener('click', () => shiftStats(-1));
  $('stats-next').addEventListener('click', () => shiftStats(1));
}

function shiftStats(delta) {
  const a = state.statsAnchor;
  state.statsAnchor = state.statsRange === 'week'
    ? addDays(a, delta * 7)
    : new Date(a.getFullYear(), a.getMonth() + delta, 1);
  renderStats();
}

// ---------- Settings / backup ----------

function lastBackup() {
  const v = Number(localStorage.getItem(BACKUP_KEY));
  return v ? new Date(v) : null;
}

function renderBackupInfo() {
  const last = lastBackup();
  $('backup-info').textContent = last
    ? `Last backup: ${fmt(last, { day: 'numeric', month: 'long', year: 'numeric' })}`
    : 'No backup yet.';
}

function renderBackupNudge() {
  const last = lastBackup();
  const stale = !last || (Date.now() - last.getTime()) > BACKUP_NUDGE_DAYS * 86400000;
  $('backup-nudge').classList.toggle('hidden', !(stale && entries.size >= 7));
}

async function exportBackup() {
  const data = {
    app: 'mood-tracker',
    version: 1,
    exportedAt: new Date().toISOString(),
    entries: [...entries.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
  const name = `mood-backup-${todayKey()}.json`;
  const file = new File([JSON.stringify(data)], name, { type: 'application/json' });

  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Mood backup' });
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    localStorage.setItem(BACKUP_KEY, String(Date.now()));
    renderBackupInfo();
    renderBackupNudge();
    toast('Backup exported');
  } catch (err) {
    if (err.name !== 'AbortError') toast('Export failed');
  }
}

async function importBackup(file) {
  let list;
  try {
    const data = JSON.parse(await file.text());
    list = (Array.isArray(data) ? data : data.entries || []).filter(e =>
      e && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && moodByValue[e.mood]);
  } catch {
    toast('That file is not a valid backup');
    return;
  }
  if (!list.length) {
    toast('No entries found in that file');
    return;
  }
  if (!confirm(`Import ${list.length} entries? Days that already have an entry will be replaced.`)) return;

  const clean = list.map(e => ({
    date: e.date,
    mood: e.mood,
    social: Number.isFinite(e.social) ? e.social : DEFAULTS.social,
    weather: weatherById[e.weather] ? e.weather : null,
    sleep: Number.isFinite(e.sleep) ? e.sleep : DEFAULTS.sleep,
    note: typeof e.note === 'string' ? e.note : '',
    photo: typeof e.photo === 'string' && e.photo.startsWith('data:image/') ? e.photo : null,
    updatedAt: e.updatedAt || Date.now(),
  }));
  await db.putMany(clean);
  await loadEntries();
  loadForm(state.editingDate);
  toast(`Imported ${clean.length} entries`);
}

function setupSettings() {
  $('export-btn').addEventListener('click', exportBackup);
  $('import-input').addEventListener('change', e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) importBackup(file);
  });
  $('delete-btn').addEventListener('click', async () => {
    if (!confirm('Delete ALL entries and photos? This cannot be undone.')) return;
    await db.clear();
    entries.clear();
    state.selectedDay = null;
    loadForm(todayKey());
    toast('All data deleted');
  });
  $('backup-nudge-btn').addEventListener('click', () => switchView('settings'));
}

// ---------- Navigation ----------

function switchView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${name}`));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
  if (name === 'month') renderMonth();
  if (name === 'stats') renderStats();
  if (name === 'settings') renderBackupInfo();
  window.scrollTo(0, 0);
}

function setupTabs() {
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    if (t.dataset.view === 'today' && state.editingDate !== todayKey() && document.querySelector('#view-today.active')) {
      loadForm(todayKey()); // tapping Today again returns to today
    }
    switchView(t.dataset.view);
  }));
}

// ---------- Start ----------

async function init() {
  buildTodayControls();
  setupMonth();
  setupStats();
  setupSettings();
  setupTabs();

  try {
    await loadEntries();
  } catch {
    toast('Could not open storage');
  }
  loadForm(todayKey());

  // If the app stays open past midnight, move the log to the new day
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.followToday && state.editingDate !== todayKey()) {
      loadForm(todayKey());
    }
  });

  // Ask iOS to keep our data (reduces the chance it gets cleared)
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
