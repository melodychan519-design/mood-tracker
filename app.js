'use strict';

// ---------- Constants ----------

const MOODS = [
  { value: 5, label: 'Super', color: '#fbe3a4', stroke: '#e0a940' },
  { value: 4, label: 'Good',  color: '#d8e8c4', stroke: '#7f9e64' },
  { value: 3, label: 'Meh',   color: '#f8e2c4', stroke: '#c4955f' },
  { value: 2, label: 'Bad',   color: '#c3dbf3', stroke: '#5c88bf' },
  { value: 1, label: 'Awful', color: '#d9cff0', stroke: '#8a7bbd' },
];
const moodByValue = Object.fromEntries(MOODS.map(m => [m.value, m]));

// Hand-drawn pastel faces (100x100 viewBox)
const INK = '#5a4038';
const line = d => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>`;
const CHEEKS = '<ellipse cx="26" cy="60" rx="7" ry="5" fill="#f0a49c" opacity=".55"/><ellipse cx="74" cy="60" rx="7" ry="5" fill="#f0a49c" opacity=".55"/>';
const HAPPY_EYES = line('M26 46 Q33 36 40 46') + line('M60 46 Q67 36 74 46');
const OPEN_MOUTH = d => `<path d="${d}" fill="#e57f72" stroke="#8b4a46" stroke-width="3" stroke-linejoin="round"/>`;
const ray = d => line(d).replace(INK, '#f2c45a');
const FACE_PARTS = {
  5: ray('M12 28 L5 24') + ray('M29 11 L26 4') + ray('M88 28 L95 24') + ray('M71 11 L74 4')
     + CHEEKS + HAPPY_EYES + OPEN_MOUTH('M38 56 H62 Q62 73 50 73 Q38 73 38 56 Z'),
  4: CHEEKS + HAPPY_EYES + line('M41 60 Q50 69 59 60'),
  3: CHEEKS + `<ellipse cx="36" cy="46" rx="4.5" ry="6" fill="${INK}"/><ellipse cx="64" cy="46" rx="4.5" ry="6" fill="${INK}"/>` + line('M43 63 H57'),
  2: CHEEKS + `<path d="M30 45 A6.5 6.5 0 0 0 43 45 Z" fill="${INK}"/><path d="M57 45 A6.5 6.5 0 0 0 70 45 Z" fill="${INK}"/>`
     + line('M28 40 L42 36') + line('M58 36 L72 40') + line('M40 67 Q50 58 60 67'),
  1: line('M28 37 L41 44 L28 51') + line('M72 37 L59 44 L72 51')
     + '<path d="M25 54 Q18 64 25 67 Q32 64 25 54 Z M75 54 Q68 64 75 67 Q82 64 75 54 Z" fill="#a7cdec" stroke="#6ea4d6" stroke-width="2"/>'
     + OPEN_MOUTH('M40 72 Q40 59 50 59 Q60 59 60 72 Z'),
};

function face(value, attrs = 'class="face"') {
  const m = moodByValue[value];
  return `<svg ${attrs} viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="50" r="38" fill="${m.color}" stroke="${m.stroke}" stroke-width="4"/>
    <path d="M27 34 Q33 22 46 18" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".55"/>
    ${FACE_PARTS[value]}
  </svg>`;
}

const WEATHER = [
  { id: 'sunny',  label: 'Sunny',  icon: 'ui-sunny.png' },
  { id: 'partly', label: 'Partly', icon: 'ui-partly.png' },
  { id: 'cloudy', label: 'Cloudy', icon: 'ui-cloudy.png' },
  { id: 'rainy',  label: 'Rainy',  icon: 'ui-rainy.png' },
  { id: 'stormy', label: 'Stormy', icon: 'ui-stormy.png' },
  { id: 'snowy',  label: 'Snowy',  icon: 'ui-snowy.png' },
];
const weatherById = Object.fromEntries(WEATHER.map(w => [w.id, w]));

// Social battery level -> icon (checked from highest threshold down)
const BATTERY_LEVELS = [
  { min: 80, icon: 'ui-battery-full.png' },
  { min: 60, icon: 'ui-battery-high.png' },
  { min: 40, icon: 'ui-battery-medium.png' },
  { min: 20, icon: 'ui-battery-low.png' },
  { min: 0,  icon: 'ui-battery-verylow.png' },
];
const batteryIcon = level => BATTERY_LEVELS.find(b => level >= b.min).icon;
// Preload so the icon swaps instantly while sliding
BATTERY_LEVELS.forEach(b => { new Image().src = b.icon; });

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
      <span class="emoji">${face(m.value)}</span>${m.label}
    </button>`).join('');

  $('weather-options').innerHTML = WEATHER.map(w => `
    <button type="button" class="chip" data-weather="${w.id}" role="radio" aria-checked="false">
      <img class="emoji" src="${w.icon}" alt="">${w.label}
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
  $('social-icon').src = batteryIcon(state.form.social);
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
    toast("Saved ✨");
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
        <span class="emoji">${entry ? face(entry.mood) : ''}</span>
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
        <span class="emoji">${face(mood.value)}</span>
        <div>
          <h2>${mood.label}</h2>
          <p>${dateLabel}</p>
        </div>
      </div>
      <div class="detail-tags">
        ${weather ? `<span class="tag"><img class="tag-ico" src="${weather.icon}" alt="">${weather.label}</span>` : ''}
        <span class="tag"><img class="tag-ico" src="ui-sleep.png" alt="">${entry.sleep} h</span>
        <span class="tag"><img class="tag-ico" src="${batteryIcon(entry.social)}" alt="">${entry.social}%</span>
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
      <div class="big">${avgMood ? `${face(Math.round(avgMood))} ${avgMood.toFixed(1)}` : '–'}</div>
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
      <span class="emoji">${face(m.value)}</span>
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

  // Horizontal guides with face labels
  MOODS.forEach(m => {
    svg += `<line x1="${left}" x2="${W - right}" y1="${y(m.value)}" y2="${y(m.value)}" stroke="#efe7f2" stroke-dasharray="3 4"/>`;
    svg += face(m.value, `x="${left - 26}" y="${y(m.value) - 10}" width="20" height="20"`);
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
    svg += `<circle cx="${x(p.i)}" cy="${y(p.entry.mood)}" r="${r}" fill="${moodByValue[p.entry.mood].color}" stroke="${moodByValue[p.entry.mood].stroke}" stroke-width="2"/>`;
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
