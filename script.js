(() => {
  const els = {
    sky: document.getElementById('sky'),
    stars: document.getElementById('stars'),
    sun: document.getElementById('sun'),
    moon: document.getElementById('moon'),
    moonDisc: document.getElementById('moonDisc'),
    moonUmbra: document.getElementById('moonUmbra'),
    moonPenumbra: document.getElementById('moonPenumbra'),
    moonEclipse: document.getElementById('moonEclipse'),
    sunShadow: document.getElementById('sunShadow'),
    skyTraffic: document.getElementById('skyTraffic'),
    clouds: document.getElementById('clouds'),
    deck: document.getElementById('deck'),
    fog: document.getElementById('fog'),
    rain: document.getElementById('rain'),
    eyebrow: document.getElementById('eyebrow'),
    timer: document.getElementById('timer'),
    timerLabel: document.getElementById('timerLabel'),
    status: document.getElementById('status'),
    progressFill: document.getElementById('progressFill'),
    arcFill: document.getElementById('arcFill'),
    traveler: document.getElementById('traveler'),
    travelerHalo: document.getElementById('travelerHalo'),
    arcPath: document.getElementById('arcPath'),
    scheduleSummary: document.getElementById('scheduleSummary'),
    formatToggle: document.getElementById('formatToggle'),
    themeToggle: document.getElementById('themeToggle'),
    card: document.querySelector('.card'),
    root: document.documentElement,
    themeColor: document.getElementById('themeColor'),
  };

  const SETTINGS_KEY = 'homeStretch.settings';
  const FORMAT_KEY = 'homeStretch.timeFormat';
  const THEME_KEY = 'homeStretch.theme';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- Small math helpers -------------------------------------------
  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rand(min, max) { return Math.random() * (max - min) + min; }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex([r, g, b]) {
    return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  }
  function lerpColor(hexA, hexB, t) {
    const a = hexToRgb(hexA), b = hexToRgb(hexB);
    return rgbToHex([lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]);
  }

  // Generic keyframe-stop interpolator. Each stop is { t, ...fields }
  // where fields are either hex color strings or plain numbers.
  function interpolate(stops, t) {
    const ct = clamp(t, 0, 1);
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i], b = stops[i + 1];
      if (ct >= a.t && ct <= b.t) {
        const lt = (ct - a.t) / ((b.t - a.t) || 1);
        const result = {};
        for (const key of Object.keys(a)) {
          if (key === 't') continue;
          const va = a[key], vb = b[key];
          result[key] = (typeof va === 'string' && va[0] === '#') ? lerpColor(va, vb, lt) : lerp(va, vb, lt);
        }
        return result;
      }
    }
    const { t: _t, ...rest } = stops[stops.length - 1];
    return rest;
  }

  function windowOpacity(h, start, end, fade) {
    if (h < start - fade || h > end + fade) return 0;
    if (h < start + fade) return clamp((h - (start - fade)) / (2 * fade), 0, 1);
    if (h > end - fade) return clamp(((end + fade) - h) / (2 * fade), 0, 1);
    return 1;
  }

  // Signed hours from a mark on the clock: negative before it, positive after,
  // and continuous through the moment itself. The modulo version of this ran
  // 23.99 -> 0 at sunset, which threw the moon from one horizon to the other
  // between two frames.
  function hoursSince(h, mark) {
    let d = h - mark;
    if (d < -12) d += 24;
    if (d > 12) d -= 24;
    return d;
  }

  function hourDecimal(d) { return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600; }

  // ---- Schedule state ------------------------------------------------
  // Times live as minutes since midnight so the 12h and 24h views are just
  // two ways of reading the same number.
  function parseStored(value, fallback) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
    if (!m) return fallback;
    const h = Number(m[1]), min = Number(m[2]);
    if (h > 23 || min > 59) return fallback;
    return h * 60 + min;
  }

  // Every weekday carries its own hours, because a Saturday shift is rarely
  // the same shape as a Tuesday one. Index matches Date#getDay, so 0 is Sunday.
  const DAY_DEFAULT = { on: false, start: 9 * 60, end: 18 * 60, lunchOn: false, lunchStart: 13 * 60, lunchEnd: 14 * 60 };
  const WORKWEEK = [false, true, true, true, true, true, false];

  function defaultDays() {
    return WORKWEEK.map(on => ({ ...DAY_DEFAULT, on }));
  }

  function parseDay(raw, fallback) {
    if (!raw || typeof raw !== 'object') return { ...fallback };
    return {
      on: raw.on === true,
      start: parseStored(raw.start, fallback.start),
      end: parseStored(raw.end, fallback.end),
      lunchOn: raw.lunchOn === true,
      lunchStart: parseStored(raw.lunchStart, fallback.lunchStart),
      lunchEnd: parseStored(raw.lunchEnd, fallback.lunchEnd),
    };
  }

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
      if (saved && Array.isArray(saved.days) && typeof saved.days[0] === 'object') {
        return {
          uniform: saved.uniform !== false,
          days: Array.from({ length: 7 }, (_, i) => parseDay(saved.days[i], DAY_DEFAULT)),
        };
      }
      if (saved) {
        // Migrate the single-schedule format: one set of hours, spread across
        // whichever days the old on/off string had enabled.
        const shared = {
          start: parseStored(saved.start, DAY_DEFAULT.start),
          end: parseStored(saved.end, DAY_DEFAULT.end),
          lunchOn: saved.lunchOn === true,
          lunchStart: parseStored(saved.lunchStart, DAY_DEFAULT.lunchStart),
          lunchEnd: parseStored(saved.lunchEnd, DAY_DEFAULT.lunchEnd),
        };
        const flags = /^[01]{7}$/.test(saved.days || '') ? saved.days : '0111110';
        return {
          uniform: true,
          days: Array.from({ length: 7 }, (_, i) => ({ ...shared, on: flags[i] === '1' })),
        };
      }
    } catch (e) { /* ignore malformed storage */ }
    return { uniform: true, days: defaultDays() };
  }

  const schedule = loadSettings();

  function saveSettings() {
    const toStr = (mins) => pad2(Math.floor(mins / 60)) + ':' + pad2(mins % 60);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        uniform: schedule.uniform,
        days: schedule.days.map(d => ({
          on: d.on,
          start: toStr(d.start),
          end: toStr(d.end),
          lunchOn: d.lunchOn,
          lunchStart: toStr(d.lunchStart),
          lunchEnd: toStr(d.lunchEnd),
        })),
      }));
    } catch (e) { /* storage unavailable, continue without persistence */ }
  }

  // The day whose hours the settings fields are currently editing.
  let editingDay = new Date().getDay();
  if (!schedule.days[editingDay].on) {
    const firstOn = schedule.days.findIndex(d => d.on);
    if (firstOn >= 0) editingDay = firstOn;
  }

  function editedDay() { return schedule.days[editingDay]; }

  // ---- 12h / 24h format ---------------------------------------------
  function loadFormat() {
    try {
      const saved = localStorage.getItem(FORMAT_KEY);
      if (saved === '12' || saved === '24') return saved;
    } catch (e) { /* ignore malformed storage */ }
    return '12';
  }
  let timeFormat = loadFormat();

  function formatMinutes(mins) {
    const h = Math.floor(mins / 60) % 24;
    const m = mins % 60;
    if (timeFormat === '24') return pad2(h) + ':' + pad2(m);
    const suffix = h < 12 ? 'AM' : 'PM';
    return ((h % 12) || 12) + ':' + pad2(m) + ' ' + suffix;
  }

  function formatClock(date) {
    return formatMinutes(date.getHours() * 60 + date.getMinutes());
  }

  function formatSpan(mins) {
    const h = Math.floor(mins / 60), m = mins % 60;
    if (!h) return `${m} min`;
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  // ---- Time fields ---------------------------------------------------
  // A native <input type="time"> renders 12h or 24h purely from the browser
  // locale, with no way to choose, which is what made 5:30 PM read as 5:30 AM.
  // These fields spell the meridiem out and let you set it directly.
  const fields = [...document.querySelectorAll('.timefield')].map(root => ({
    key: root.dataset.field,
    hour: root.querySelector('[data-part="hour"]'),
    minute: root.querySelector('[data-part="minute"]'),
    meridiemBtns: [...root.querySelectorAll('.meridiem__btn')],
  }));

  function renderFields() {
    els.root.setAttribute('data-clock', timeFormat);
    const day = editedDay();
    for (const f of fields) {
      const mins = day[f.key];
      const h24 = Math.floor(mins / 60);
      const shown = timeFormat === '24' ? h24 : ((h24 % 12) || 12);
      if (document.activeElement !== f.hour) f.hour.value = pad2(shown);
      if (document.activeElement !== f.minute) f.minute.value = pad2(mins % 60);
      const isPm = h24 >= 12;
      for (const btn of f.meridiemBtns) {
        btn.setAttribute('aria-pressed', String((btn.dataset.meridiem === 'pm') === isPm));
      }
    }
  }

  function setField(key, mins) {
    const value = ((mins % 1440) + 1440) % 1440;
    // In uniform mode one edit sets every day, including days that are
    // currently off, so switching a day on later inherits sensible hours.
    if (schedule.uniform) {
      for (const day of schedule.days) day[key] = value;
    } else {
      editedDay()[key] = value;
    }
    saveSettings();
    renderFields();
    adoptScheduleChange();
    tick();
  }

  function commitHour(f) {
    const mins = editedDay()[f.key];
    const h24 = Math.floor(mins / 60);
    const typed = parseInt(f.hour.value, 10);
    if (!Number.isFinite(typed)) { renderFields(); return; }

    let next;
    if (timeFormat === '24') {
      next = clamp(typed, 0, 23);
    } else {
      // Keep whichever half of the day is currently selected.
      const h12 = clamp(typed, 1, 12) % 12;
      next = h24 >= 12 ? h12 + 12 : h12;
    }
    setField(f.key, next * 60 + (mins % 60));
  }

  function commitMinute(f) {
    const typed = parseInt(f.minute.value, 10);
    if (!Number.isFinite(typed)) { renderFields(); return; }
    const h24 = Math.floor(editedDay()[f.key] / 60);
    setField(f.key, h24 * 60 + clamp(typed, 0, 59));
  }

  for (const f of fields) {
    for (const input of [f.hour, f.minute]) {
      input.addEventListener('focus', () => input.select());

      input.addEventListener('input', () => {
        const digits = input.value.replace(/\D/g, '').slice(0, 2);
        input.value = digits;
        // Two digits in the hour box means the user is done with it.
        if (input === f.hour && digits.length === 2) f.minute.focus();
      });

      input.addEventListener('blur', () => {
        input === f.hour ? commitHour(f) : commitMinute(f);
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); return; }
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        const step = (e.key === 'ArrowUp' ? 1 : -1) * (input === f.hour ? 60 : (e.shiftKey ? 15 : 1));
        setField(f.key, editedDay()[f.key] + step);
        input.select();
      });
    }

    for (const btn of f.meridiemBtns) {
      btn.addEventListener('click', () => {
        const mins = editedDay()[f.key];
        const h24 = Math.floor(mins / 60);
        const wantPm = btn.dataset.meridiem === 'pm';
        if ((h24 >= 12) === wantPm) return;
        setField(f.key, mins + (wantPm ? 720 : -720));
      });
    }
  }

  // ---- Lunch break toggle --------------------------------------------
  const lunchEls = {
    btn: document.getElementById('lunchToggle'),
    label: document.getElementById('lunchToggleLabel'),
    mark: document.getElementById('lunchMark'),
  };

  function renderLunchToggle() {
    const lunchOn = editedDay().lunchOn;
    els.root.setAttribute('data-lunch', lunchOn ? 'on' : 'off');
    lunchEls.btn.setAttribute('aria-pressed', String(lunchOn));
    lunchEls.label.textContent = lunchOn ? 'Lunch break on' : 'Lunch break';
  }

  lunchEls.btn.addEventListener('click', () => {
    const nextLunch = !editedDay().lunchOn;
    if (schedule.uniform) { for (const day of schedule.days) day.lunchOn = nextLunch; }
    else { editedDay().lunchOn = nextLunch; }
    saveSettings();
    renderLunchToggle();
    renderFields();
    adoptScheduleChange();
    tick();
  });

  function setFormat(fmt) {
    timeFormat = fmt;
    try { localStorage.setItem(FORMAT_KEY, fmt); } catch (e) { /* continue without persistence */ }
    for (const btn of els.formatToggle.querySelectorAll('.seg-btn')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.format === fmt));
    }
    renderFields();
    tick();
  }
  els.formatToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (btn) setFormat(btn.dataset.format);
  });

  // ---- Theme: light / dark / amoled ----------------------------------
  let theme = els.root.getAttribute('data-theme') || 'dark';
  let birdTimeout = null, planeTimeout = null;

  function setTheme(next) {
    theme = next;
    els.root.setAttribute('data-theme', theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* continue without persistence */ }
    for (const btn of els.themeToggle.querySelectorAll('.seg-btn')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.theme === theme));
    }
    stopTraffic();
    endEclipse();
    if (sceneActive()) {
      scheduleBirds(rand(1500, 5000));
      schedulePlanes(rand(4000, 12000));
      scheduleMeteors(rand(20000, 60000));
      scheduleEclipse(rand(300000, 700000));
    }
    tick();
  }
  els.themeToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (btn) setTheme(btn.dataset.theme);
  });

  // ---- Colour stops ----------------------------------------------------
  // Work-progress accent: drives the office to home arc, the progress bar, and
  // (in dark/AMOLED) the sky, regardless of what the clock says outside.
  const workStops = [
    { t: 0.00, top: '#1c2540', bottom: '#2b3a67', accent: '#6f8fc7', stars: 0 },
    { t: 0.28, top: '#2b3a67', bottom: '#4a5a8f', accent: '#f2a154', stars: 0 },
    { t: 0.58, top: '#3d4f86', bottom: '#e0985f', accent: '#f2a154', stars: 0 },
    { t: 0.82, top: '#6a4a63', bottom: '#e8613c', accent: '#e8613c', stars: 0.15 },
    { t: 1.00, top: '#10131c', bottom: '#1c2b28', accent: '#4f9c8a', stars: 1 },
  ];

  // Real sky, indexed by how high the sun is rather than by the clock. Every
  // band below is a real lighting regime: -18 is the end of astronomical
  // twilight, -6 the end of civil twilight, 0 the horizon itself.
  const skyByAltitude = [
    { at: -90, top: '#050813', bottom: '#0b1026' },  // deep night
    { at: -18, top: '#080d22', bottom: '#121a38' },  // astronomical dark
    { at: -12, top: '#101836', bottom: '#222b52' },  // nautical twilight
    { at: -6,  top: '#1e2b52', bottom: '#4a3f6b' },  // civil twilight
    { at: -3,  top: '#39396b', bottom: '#95566f' },  // the purple minutes
    { at: 0,   top: '#5b5090', bottom: '#e87a52' },  // sun on the horizon
    { at: 3,   top: '#6f83b6', bottom: '#f6a75d' },  // golden
    { at: 8,   top: '#5192d2', bottom: '#ffd6a4' },  // low and warm
    { at: 15,  top: '#4a90d8', bottom: '#ffe6c8' },  // the light already turning
    { at: 26,  top: '#3a8ede', bottom: '#dcefff' },  // afternoon
    { at: 40,  top: '#348ae0', bottom: '#d4ecff' },  // full morning
    { at: 45,  top: '#2b84e0', bottom: '#d2ecff' },  // midday
    { at: 90,  top: '#2077d6', bottom: '#dbf1ff' },  // overhead
  ];

  // Interpolates a stop list keyed on an arbitrary numeric field rather than
  // a normalised 0..1, so the ramp can be written in real-world units.
  function interpolateBy(stops, value) {
    const v = clamp(value, stops[0].at, stops[stops.length - 1].at);
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i], b = stops[i + 1];
      if (v >= a.at && v <= b.at) {
        const lt = (v - a.at) / ((b.at - a.at) || 1);
        const out = {};
        for (const key of Object.keys(a)) {
          if (key === 'at') continue;
          const va = a[key], vb = b[key];
          out[key] = (typeof va === 'string' && va[0] === '#') ? lerpColor(va, vb, lt) : lerp(va, vb, lt);
        }
        return out;
      }
    }
    const { at: _at, ...rest } = stops[stops.length - 1];
    return rest;
  }

  // The sun's own colours warm up near the horizon and stay bright at noon.
  const sunStops = [
    { t: 0.0, core: '#FFB765', ray: '#F2762F' },
    { t: 0.2, core: '#FFD91F', ray: '#FFB21D' },
    { t: 0.8, core: '#FFD91F', ray: '#FFB21D' },
    { t: 1.0, core: '#FFB765', ray: '#F2762F' },
  ];

  // Dark mode is the same sky at the same moment, seen at night: the moon
  // takes the arc the sun is on, so the scene still tracks the real day. The
  // palette is keyed to that height, which keeps the sky moving through the
  // hours instead of sitting on one flat black.
  const nightByAltitude = [
    { at: -90, top: '#03050f', bottom: '#070b1a' },  // moon well below: darkest
    { at: -18, top: '#050917', bottom: '#0b1124' },
    { at: -6,  top: '#070d1f', bottom: '#131a33' },
    { at: 0,   top: '#0a1228', bottom: '#22243f' },  // on the horizon, faint glow
    { at: 12,  top: '#0b1530', bottom: '#26304f' },
    { at: 35,  top: '#0d1a3c', bottom: '#2c3b62' },  // high and moonlit
    { at: 90,  top: '#102048', bottom: '#334a78' },
  ];

  // Weather repaints the sky it is happening in. A lid overhead takes the
  // colour out of it first and the light out of it second: an overcast sky is
  // a flat grey sheet, brighter towards the horizon than the zenith, and it
  // does not do sunsets. Fog goes further and removes the gradient entirely,
  // because in fog the sky is simply the nearest air you cannot see through.
  function weatherSky(top, bottom, w, ambient) {
    let a = hexToRgb(top), b = hexToRgb(bottom);
    const flatten = clamp(w.overcast * 0.72, 0, 1);
    const mid = [0, 1, 2].map(i => (a[i] + b[i]) / 2);
    a = [0, 1, 2].map(i => lerp(a[i], mid[i], flatten));
    b = [0, 1, 2].map(i => lerp(b[i], mid[i], flatten));

    // Grey, but not neutral: cloud light keeps a little blue in it.
    const desaturate = (c, amount) => {
      const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      return [lerp(c[0], l * 0.97, amount), lerp(c[1], l, amount), lerp(c[2], l * 1.06, amount)];
    };
    a = desaturate(a, w.overcast * 0.85);
    b = desaturate(b, w.overcast * 0.85);

    const dim = 1 - w.overcast * 0.16 - w.rain * 0.22;
    a = a.map(v => v * dim);
    b = b.map(v => v * dim);

    // Daytime fog is bright, night fog is whatever the city is throwing into
    // it, so the colour it settles on has to follow the light.
    if (w.fog > 0.01) {
      const veil = [lerp(58, 214, ambient), lerp(56, 218, ambient), lerp(60, 224, ambient)];
      const t = w.fog * 0.9;
      a = [0, 1, 2].map(i => lerp(a[i], veil[i], t));
      b = [0, 1, 2].map(i => lerp(b[i], veil[i], t * 0.94));
    }
    return { top: rgbToHex(a), bottom: rgbToHex(b) };
  }

  function computeSky(now, workColors, eclipsed) {
    if (theme === 'amoled') return { top: '#000000', bottom: '#000000', stars: 0 };

    let altitude = solarAltitude(now);
    // Obscuring the sun behaves like dropping it toward the horizon. Cubed,
    // because a partial eclipse barely dims the day: it is only the last few
    // percent before totality that the light really goes.
    if (eclipsed > 0 && altitude > -6) {
      altitude -= (altitude + 6) * Math.pow(eclipsed, 3);
    }

    if (theme === 'light') {
      const clear = interpolateBy(skyByAltitude, altitude);
      // Stars fade in through civil twilight and are fully out by the end of
      // astronomical twilight, which is roughly how the eye experiences it.
      const ambient = clamp((altitude + 6) / 14, 0, 1);
      // How dark it is, which is a question about the sun and nothing else.
      // Cloud hides the stars but it does not turn the city off, so the two
      // have to be separate numbers: overcast drives one to zero and must
      // leave the other alone.
      const darkness = clamp((-6 - altitude) / 12, 0, 1);
      const stars = darkness * (1 - weather.overcast) * (1 - weather.fog * 0.85);
      const { top, bottom } = weatherSky(clear.top, clear.bottom, weather, ambient);
      return { top, bottom, stars, darkness, ambient, altitude, night: false };
    }

    // Dark: always night, but never static. Moonlight stands in for ambient,
    // so clouds and the city still lift and fall across the day.
    const clear = interpolateBy(nightByAltitude, altitude);
    const moonlit = clamp((altitude + 10) / 55, 0, 1);
    const ambient = moonlit * 0.3;
    const darkness = clamp(1 - moonlit * 0.35, 0.6, 1);
    const { top, bottom } = weatherSky(clear.top, clear.bottom, weather, ambient);
    return {
      top,
      bottom,
      stars: darkness * (1 - weather.overcast) * (1 - weather.fog * 0.85),
      darkness,
      ambient,
      altitude,
      night: true,
    };
  }

  // ---- Where the sun actually is --------------------------------------
  // Sunrise and sunset come from the NOAA sunrise equation rather than a
  // hard-coded 6-to-6, because in August the sun sets nearer 8pm almost
  // everywhere and a fixed dawn made the whole sky read as wrong.
  const LOCATION_KEY = 'homeStretch.location';
  const RAD = Math.PI / 180;

  function loadLocation() {
    try {
      const saved = JSON.parse(localStorage.getItem(LOCATION_KEY));
      if (saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lon)) {
        return { lat: clamp(saved.lat, -89, 89), lon: saved.lon, exact: true };
      }
    } catch (e) { /* fall through to the estimate */ }

    // Without permission the timezone still pins longitude closely: each hour
    // of offset is 15 degrees. Latitude cannot be inferred, so it stays at a
    // mid-northern default until the reader offers something better.
    const offsetHours = -new Date().getTimezoneOffset() / 60;
    return { lat: 30, lon: clamp(offsetHours * 15, -180, 180), exact: false };
  }

  let place = loadLocation();

  function daysSinceEpoch(date) {
    // Julian day for local noon, then the 2000-01-01 offset the equation wants.
    const utcMidday = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12);
    return utcMidday / 86400000 + 2440587.5 - 2451545.0 + 0.0008;
  }

  // Returns { sunrise, sunset, noon } as decimal local hours. When the sun
  // never rises or never sets, cosH falls outside [-1, 1] and there is no
  // crossing to report.
  function solarEvents(date, lat, lon) {
    const n = daysSinceEpoch(date);
    const meanAnomaly = (357.5291 + 0.98560028 * n) % 360;
    const m = meanAnomaly * RAD;
    const centre = 1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m);
    const lambda = ((meanAnomaly + centre + 180 + 102.9372) % 360) * RAD;

    const solarTransit = 2451545.0 + n + 0.0053 * Math.sin(m) - 0.0069 * Math.sin(2 * lambda);
    const declination = Math.asin(Math.sin(lambda) * Math.sin(23.44 * RAD));
    // Kept on the result so the altitude calculation can reuse it.
    const dec = declination;

    const cosH = (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * Math.sin(declination))
      / (Math.cos(lat * RAD) * Math.cos(declination));

    // Julian day to local decimal hours, via the local midnight of this date.
    const localMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const toLocalHours = (julian) => ((julian - 2440587.5) * 86400000 - localMidnight) / 3600000;

    const noon = toLocalHours(solarTransit - lon / 360);
    if (cosH > 1) return { noon, dec, sunrise: null, sunset: null, polar: 'night' };
    if (cosH < -1) return { noon, dec, sunrise: null, sunset: null, polar: 'day' };

    const hourAngle = Math.acos(cosH) / RAD / 360;
    return {
      noon,
      dec,
      sunrise: toLocalHours(solarTransit - lon / 360 - hourAngle),
      sunset: toLocalHours(solarTransit - lon / 360 + hourAngle),
      polar: null,
    };
  }

  // How high the sun sits right now, in degrees above the horizon. This is
  // what actually drives the sky's colour: the same clock hour looks utterly
  // different in December and June, and altitude captures that for free.
  function solarAltitude(now) {
    const s = solarToday(now);
    const h = hourDecimal(now);
    const hourAngle = (h - s.noon) * 15 * RAD;
    const lat = place.lat * RAD;
    return Math.asin(
      Math.sin(lat) * Math.sin(s.dec) + Math.cos(lat) * Math.cos(s.dec) * Math.cos(hourAngle)
    ) / RAD;
  }

  let solarCache = { key: '', value: null };

  function solarToday(now) {
    const key = now.toDateString() + '|' + place.lat + '|' + place.lon;
    if (solarCache.key !== key) {
      solarCache = { key, value: solarEvents(now, place.lat, place.lon) };
    }
    return solarCache.value;
  }

  // Daylight window, falling back to a plain 6-to-6 inside the polar circles
  // so the sky still animates through something rather than freezing.
  function daylightWindow(now) {
    const s = solarToday(now);
    if (s.sunrise === null || s.sunset === null || s.sunset <= s.sunrise) {
      return { sunrise: 6, sunset: 18, allDay: s.polar === 'day', allNight: s.polar === 'night' };
    }
    return { sunrise: s.sunrise, sunset: s.sunset, allDay: false, allNight: false };
  }

  // ---- Real weather, when it can be had -----------------------------------
  // Open-Meteo needs no key and sends CORS headers, so the forecast can be read
  // straight from the page. Two things matter about how it is asked for.
  //
  // Coordinates are rounded to a tenth of a degree before they leave the
  // browser. That is about eleven kilometres: finer than weather varies, and
  // coarser than anywhere anyone lives. Rounding also makes the URL identical
  // for a whole town, which is friendlier to the cache at both ends.
  //
  // And it asks for cloud cover split by level, because the scene already
  // thinks in low, middle and high cloud. Sending those three straight to the
  // three tiers is closer to the truth than one number ever was: a clear
  // afternoon with cirrus over it is a real and common sky.
  const FORECAST_KEY = 'homeStretch.forecast';
  const FORECAST_TTL = 30 * 60 * 1000;
  const FORECAST_FIELDS = 'cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,precipitation,visibility';

  let forecast = null;
  let forecastPending = false;

  function forecastGrid() {
    return { lat: Math.round(place.lat * 10) / 10, lon: Math.round(place.lon * 10) / 10 };
  }

  function loadForecast() {
    try {
      const saved = JSON.parse(localStorage.getItem(FORECAST_KEY));
      if (saved && Array.isArray(saved.hours) && saved.hours.length) forecast = saved;
    } catch (e) { /* a bad cache is the same as no cache */ }
  }

  function forecastStale() {
    const { lat, lon } = forecastGrid();
    if (!forecast) return true;
    if (forecast.lat !== lat || forecast.lon !== lon) return true;
    return Date.now() - forecast.fetchedAt > FORECAST_TTL;
  }

  function refreshForecast() {
    if (forecastPending || !forecastStale() || !navigator.onLine) return;
    forecastPending = true;
    const { lat, lon } = forecastGrid();
    const url = 'https://api.open-meteo.com/v1/forecast'
      + '?latitude=' + lat + '&longitude=' + lon
      + '&hourly=' + FORECAST_FIELDS
      + '&past_days=1&forecast_days=2&timeformat=unixtime&timezone=UTC';

    fetch(url, { mode: 'cors', cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data) => {
        const h = data && data.hourly;
        if (!h || !Array.isArray(h.time) || !h.time.length) throw new Error('no hourly data');
        const hours = h.time.map((t, i) => ({
          t: t * 1000,
          all: h.cloud_cover[i],
          low: h.cloud_cover_low[i],
          mid: h.cloud_cover_mid[i],
          high: h.cloud_cover_high[i],
          precip: h.precipitation[i],
          vis: h.visibility[i],
        })).filter((row) => Number.isFinite(row.t) && Number.isFinite(row.all));
        if (!hours.length) throw new Error('no usable rows');
        forecast = { lat, lon, fetchedAt: Date.now(), hours };
        try { localStorage.setItem(FORECAST_KEY, JSON.stringify(forecast)); } catch (e) { /* private mode */ }
      })
      .catch(() => { /* offline, blocked or rate limited: the generator covers it */ })
      .then(() => { forecastPending = false; });
  }

  // Percentages arrive on the hour. Weather does not step on the hour, so the
  // two readings either side are blended, which also keeps the whole thing
  // continuous the way the generated version is.
  function forecastAt(now) {
    if (!forecast || !forecast.hours.length) return null;
    const t = now.getTime();
    const rows = forecast.hours;
    if (t < rows[0].t || t > rows[rows.length - 1].t) return null;

    let i = 0;
    while (i < rows.length - 2 && rows[i + 1].t <= t) i++;
    const a = rows[i], b = rows[i + 1] || a;
    const span = b.t - a.t;
    const f = span > 0 ? smoothstep(clamp((t - a.t) / span, 0, 1)) : 0;
    const at = (key) => lerp(Number(a[key]) || 0, Number(b[key]) || 0, f);

    const low = at('low') / 100, mid = at('mid') / 100, high = at('high') / 100;
    const visibility = at('vis'), precipitation = at('precip');
    // A lid is made of low and middle cloud. Cirrus can cover the whole sky
    // without shutting any light out, so it is deliberately not counted here.
    const deck = Math.max(low, mid * 0.9);
    return {
      cloudiness: clamp(at('all') / 100, 0, 1),
      cover: [clamp(low, 0, 1), clamp(mid, 0, 1), clamp(high, 0, 1)],
      overcast: smoothstep(clamp((deck - 0.55) / 0.38, 0, 1)),
      // Millimetres in the hour: a tenth is barely spitting, two is properly wet.
      rain: smoothstep(clamp(at('precip') / 2.2, 0, 1)),
      // Metres of visibility. Below a kilometre is fog by anyone's definition.
      fog: smoothstep(clamp((5000 - visibility) / 4200, 0, 1)),
      source: 'forecast',
      // Kept unscaled so the panel can report what was actually read rather
      // than the model's interpretation of it.
      reading: { low: at('low'), mid: at('mid'), high: at('high'), all: at('all'),
                 precipitation, visibility },
    };
  }

  // ---- Weather -----------------------------------------------------------
  // The scene knew what hour it was but not what the day was like, so every
  // sky came out clear. Weather is generated rather than fetched: no network,
  // no key, works offline, and it is deterministic, so two tabs open in the
  // same place agree about the sky and a reload does not reroll it.
  //
  // The generator is value noise on the clock. Each control point is a stable
  // hash of the hour it belongs to, and the curve smoothsteps between them, so
  // the result drifts the way weather drifts rather than jittering per frame.
  // Indexing on absolute hours rather than hour-of-day matters: midnight is
  // not a boundary in the atmosphere, and a front should be free to cross one.
  function hashUnit(seed, n) {
    let x = (seed ^ Math.imul(n | 0, 0x9e3779b9)) >>> 0;
    x = Math.imul(x ^ (x >>> 15), 0x85ebca6b) >>> 0;
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
  }

  function weatherNoise(seed, hours, period) {
    const x = hours / period;
    const i = Math.floor(x);
    return lerp(hashUnit(seed, i), hashUnit(seed, i + 1), smoothstep(x - i));
  }

  // Somewhere near a degree of resolution, so neighbouring towns share weather
  // and distant ones do not.
  function placeSeed(salt) {
    const la = Math.round(place.lat), lo = Math.round(place.lon);
    return (Math.imul(la + 90, 73856093) ^ Math.imul(lo + 180, 19349663) ^ Math.imul(salt, 83492791)) >>> 0;
  }

  // Cloud cover is not evenly distributed. Most days are decidedly clear or
  // decidedly grey, and the half-and-half sky is the rarer one, so the raw
  // noise gets pushed away from the middle before it is used.
  function polarise(v, strength) {
    return smoothstep(clamp((v - 0.5) * strength + 0.5, 0, 1));
  }

  function generatedWeather(now) {
    const hours = now.getTime() / 3600000;

    // A front takes most of a day to come through, with shorter swells riding
    // on top of it. Two periods, so the sky has both a mood and a texture.
    const raw = 0.62 * weatherNoise(placeSeed(1), hours, 15)
              + 0.38 * weatherNoise(placeSeed(2), hours, 4.5);

    // Winter is cloudier than summer, and which half of the year that falls in
    // depends on which hemisphere you are standing in.
    const dayOfYear = (now - new Date(now.getFullYear(), 0, 0)) / 86400000;
    const northern = place.lat >= 0;
    const winter = 0.5 + 0.5 * Math.cos((dayOfYear / 365.25) * 2 * Math.PI + (northern ? 0 : Math.PI));
    const seasonal = (winter - 0.5) * 0.30 * clamp(Math.abs(place.lat) / 45, 0, 1);

    const cloudiness = clamp(polarise(raw, 1.7) + seasonal, 0, 1);

    // Past about six tenths of cover the gaps close and it stops being a sky
    // with clouds in it and becomes a lid.
    const overcast = smoothstep(clamp((cloudiness - 0.58) / 0.34, 0, 1));

    // Rain needs the lid first, and then its own timing: showers come and go
    // over a few hours inside a wet day.
    const shower = weatherNoise(placeSeed(3), hours, 4.5);
    const rain = overcast * smoothstep(clamp((shower - 0.58) / 0.34, 0, 1));

    // Radiation fog is a clear-night phenomenon: the ground radiates its heat
    // away under an open sky, the air against it cools to its dew point, and
    // the fog that forms burns off through the couple of hours after sunrise.
    // A lid overhead keeps the heat in and prevents the whole business, so fog
    // and overcast are close to mutually exclusive.
    const { sunrise } = daylightWindow(now);
    const h = hourDecimal(now);
    const sinceDawn = hoursSince(h, sunrise);
    const fogWindow = sinceDawn < 0
      ? clamp((sinceDawn + 7) / 5, 0, 1)          // building through the small hours
      : clamp(1 - sinceDawn / 2.6, 0, 1);         // burning off after sunrise
    const fogGate = smoothstep(clamp((weatherNoise(placeSeed(4), hours, 26) - 0.62) / 0.22, 0, 1));
    const fog = fogGate * fogWindow * (1 - overcast) * 0.92;

    // Split the cover over the three levels. They move together, because one
    // weather system makes all of it, but not in lockstep: a sky can be clear
    // underneath and streaked with cirrus on top, and often is.
    const spread = (salt) => 0.5 + 1.0 * weatherNoise(placeSeed(salt), hours, 9);
    const cover = [
      clamp(cloudiness * spread(5), 0, 1),
      clamp(cloudiness * spread(6), 0, 1),
      clamp(cloudiness * spread(7), 0, 1),
    ];

    return { cloudiness, cover, overcast, rain, fog, source: 'generated' };
  }

  // Real weather if the forecast reached us, invented weather if it did not.
  // The two produce the same shape, so nothing downstream knows the difference
  // and the scene still works on a plane with the wifi off.
  function weatherAt(now) {
    return forecastAt(now) || generatedWeather(now);
  }

  // Clear weather is honest and can also be dull: a real forecast of nothing
  // leaves an empty sky for days at a stretch. This puts that back under the
  // reader's control without lying about the reading, which is still what the
  // panel reports and still what decides rain, fog and the light.
  const CLOUDS_KEY = 'homeStretch.clouds';
  const ALWAYS_CLOUDY = [0.52, 0.46, 0.58];

  let alwaysCloudy = false;
  try { alwaysCloudy = localStorage.getItem(CLOUDS_KEY) === 'always'; } catch (e) { /* default off */ }

  // What the sky is doing right now. Recomputed each tick; it is only a
  // handful of hashes, and keeping it live means a front can arrive while the
  // page is open rather than only between sessions.
  let weather = { cloudiness: 0, cover: [0, 0, 0], overcast: 0, rain: 0, fog: 0, source: 'generated' };

  function describeWeather(w) {
    if (w.fog > 0.4) return 'fog';
    if (w.rain > 0.35) return 'rain';
    if (w.overcast > 0.6) return 'overcast';
    if (w.cloudiness > 0.35) return 'cloudy';
    return 'clear';
  }

  // ---- Moon phase --------------------------------------------------------
  // The supplied sheet is a 7x4 grid of 28 drawings running thin-crescent
  // lit-on-the-left, through full, to thin-crescent lit-on-the-right. The
  // northern-hemisphere convention is that a waxing moon is lit on the right,
  // so the waxing half of the month reads backwards along the sheet.
  const MOON_COLS = [120.1, 311.6, 503.1, 694.6, 886.1, 1077.6, 1269.1];
  const MOON_ROWS = [161.3, 377.0, 587.0, 798.6];
  const MOON_CROP = 176;
  const SYNODIC = 29.530588853;          // days from one new moon to the next
  const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);

  // 0 is new, 0.25 first quarter, 0.5 full, 0.75 last quarter.
  function moonPhase(date) {
    const days = (date.getTime() - KNOWN_NEW_MOON) / 86400000;
    return ((days / SYNODIC) % 1 + 1) % 1;
  }

  function moonFrame(phase) {
    // Waxing runs 27 (thinnest, lit right) up to 14 (full); waning runs 14
    // back down to 0 (thinnest, lit left).
    return phase <= 0.5
      ? Math.round(27 - (phase / 0.5) * 13)
      : Math.round(14 - ((phase - 0.5) / 0.5) * 14);
  }

  let lastMoonFrame = -1;

  function updateMoonPhase(now) {
    let phase = moonPhase(now);
    // A lunar eclipse can only happen at full moon, when the Earth is between
    // the sun and the moon. Showing the umbra over a crescent would be nonsense,
    // so the disc is full for the duration.
    if (eclipse && eclipse.kind === 'lunar') phase = 0.5;

    const frame = clamp(moonFrame(phase), 0, 27);
    if (frame === lastMoonFrame) return;
    lastMoonFrame = frame;

    const cx = MOON_COLS[frame % 7];
    const cy = MOON_ROWS[Math.floor(frame / 7)];
    const disc = els.moonDisc;
    disc.style.setProperty('--moon-x', (-((cx - MOON_CROP / 2) / MOON_CROP) * 100).toFixed(3) + '%');
    disc.style.setProperty('--moon-y', (-((cy - MOON_CROP / 2) / MOON_CROP) * 100).toFixed(3) + '%');
    // Glow tracks how much of the disc is actually lit.
    disc.style.setProperty('--moon-lit', ((1 - Math.cos(phase * 2 * Math.PI)) / 2).toFixed(3));
  }

  // ---- Sun and moon arc across the sky --------------------------------
  // The arc is an ellipse anchored below the horizon, sized in viewport units
  // so the dome keeps its shape from a phone to a wide desktop. Previously the
  // path was a flat percentage sweep, which read as a shallow smear on wide
  // screens and a near-vertical climb on narrow ones.
  // On a phone the card owns the middle of the screen, so the same dome would
  // spend the whole afternoon hidden behind it. Narrow viewports get a
  // shallower arc that stays in the band of sky above the card.
  function arcGeometry() {
    const narrow = window.innerWidth < 620;
    return narrow
      ? { horizon: 44, amplitude: 37, spread: 44 }
      : { horizon: 92, amplitude: 78, spread: 46 };
  }

  // Height comes from the real solar altitude, not from how far through the
  // day the clock is. Those two disagree: at an hour before sunset the clock
  // fraction put the sun almost on the horizon while the sky, which is keyed
  // to altitude, was still painting midday blue. Sharing one source means the
  // sun touches the horizon exactly as the sky turns orange.
  // The arc runs a little past both ends so a body can go on sinking after it
  // reaches the horizon instead of parking on the line and fading out where it
  // stands. Something that sets has to keep moving while it goes.
  const BELOW_HORIZON = 0.16;

  // What is left of the sun or moon once there is weather in the way. It goes
  // soft before it goes: through thin cover you still get a bright smudge, and
  // only a closed deck takes the disc away completely.
  function skyVeil() {
    return clamp(1 - weather.overcast * 0.97 - weather.fog * 0.8, 0, 1);
  }

  function positionCelestial(el, t, rise, opacity) {
    const { horizon, amplitude, spread } = arcGeometry();
    const angle = (1 - clamp(t, -BELOW_HORIZON, 1 + BELOW_HORIZON)) * Math.PI;
    el.style.left = (50 + Math.cos(angle) * spread) + '%';
    el.style.top = (horizon - clamp(rise, -BELOW_HORIZON, 1) * amplitude) + '%';
    el.style.opacity = String(opacity * skyVeil());
  }

  // How high the sun stands as a fraction of the highest it reaches today.
  function altitudeRise(now) {
    const s = solarToday(now);
    const noonAltitude = 90 - Math.abs(place.lat - s.dec / RAD);
    return solarAltitude(now) / Math.max(12, noonAltitude);
  }

  function updateCelestial(now, night) {
    updateMoonPhase(now);
    const h = hourDecimal(now);
    const { sunrise, sunset } = daylightWindow(now);
    const dayLength = Math.max(0.5, sunset - sunrise);
    const nightLength = Math.max(0.5, 24 - dayLength);
    // Unclamped, so the sun keeps travelling west through its own setting
    // rather than stopping dead the instant it touches the horizon.
    const sunT = (h - sunrise) / dayLength;
    // Signed, so the moon spends the last minutes before sunset climbing
    // towards the eastern horizon instead of waiting, hidden, in the west.
    const sinceSet = hoursSince(h, sunset);
    const moonT = sinceSet / nightLength;
    const moonRise = Math.sin(clamp(moonT, -BELOW_HORIZON, 1 + BELOW_HORIZON) * Math.PI);

    if (night) {
      // The night twin: the moon rides exactly where the sun is, so dark mode
      // tracks the same day rather than inventing a second clock. Off the
      // daylight arc it falls back to its own path across the night.
      const daytime = h >= sunrise && h <= sunset;
      const rise = daytime ? altitudeRise(now) : moonRise;
      // Changing arcs means crossing the sky, and there is no honest way to
      // travel that far in one frame. Both changeovers happen at a horizon,
      // so the moon is set down at one edge and picked up at the other while
      // it is out of sight, and the swap reads as a set followed by a rise.
      const swapAt = Math.min(Math.abs(hoursSince(h, sunset)), Math.abs(hoursSince(h, sunrise)));
      const swap = clamp((swapAt - 0.18) / 0.45, 0, 1);
      positionCelestial(els.moon, daytime ? sunT : moonT, rise, swap);
      els.sun.style.opacity = '0';
      return;
    }

    positionCelestial(els.sun, sunT, altitudeRise(now), windowOpacity(h, sunrise, sunset, 0.6));
    const sunColors = interpolate(sunStops, clamp(sunT, 0, 1));
    els.sun.style.setProperty('--sun-core', sunColors.core);
    els.sun.style.setProperty('--sun-ray', sunColors.ray);

    // The moon takes the other half of the clock, riding the same arc. Its
    // fade-in now overlaps the sun's fade-out, which is what dusk actually
    // looks like: for a while both are up, one going down in the west and one
    // coming up in the east.
    positionCelestial(els.moon, moonT, moonRise, windowOpacity(sinceSet, 0, nightLength, 0.6));
  }

  // ---- What colour a cloud actually is ---------------------------------
  // A cloud has no colour of its own. It is a white diffuser, and what it
  // shows is whatever light reaches it, so the honest way to colour one is to
  // follow the light rather than pick from a ramp of sunset oranges.
  //
  // Sunlight crosses more air the lower the sun sits, and air scatters blue
  // out of the beam far faster than red. The Rayleigh cross-section goes as
  // roughly lambda^-4, which at the sRGB primaries (610, 550 and 470 nm)
  // gives these optical depths for one atmosphere at sea level.
  const RAYLEIGH = { r: 0.0656, g: 0.1001, b: 0.1902 };

  // Kasten-Young (1989). The naive 1/sin(h) runs away to infinity at the
  // horizon, which is exactly where all the interesting colour happens; this
  // settles near 38 air masses instead, which is what is really down there.
  function airMass(altitudeDeg) {
    const h = Math.max(altitudeDeg, -0.9);
    return 1 / (Math.sin(h * RAD) + 0.50572 * Math.pow(h + 6.07995, -1.6364));
  }

  function rayleighBeam(m) {
    const r = Math.exp(-RAYLEIGH.r * m);
    const g = Math.exp(-RAYLEIGH.g * m);
    const b = Math.exp(-RAYLEIGH.b * m);
    const peak = Math.max(r, g, b);
    return { rgb: [r / peak, g / peak, b / peak], transmittance: peak };
  }

  // A cloud is not lit by the disc of the sun alone. Most of what falls on it
  // near sunset comes from the blazing aureole of sky around the sun, which
  // took a shorter path through the air and so stayed much less red. Leave
  // that second term out and the maths is still right while the picture is
  // wrong: pure beam colour at 38 air masses is nearly blood red, and real
  // sunset clouds are orange.
  function illuminant(altitudeDeg) {
    const m = airMass(altitudeDeg);
    const direct = rayleighBeam(m);
    const aureole = rayleighBeam(m * 0.22);
    return {
      rgb: [0, 1, 2].map(i => lerp(direct.rgb[i], aureole.rgb[i], 0.55)),
      transmittance: direct.transmittance,
    };
  }

  // The eye adapts to daylight, so an overhead sun has to come out white
  // rather than the faintly yellow thing it measures as. Dividing through by
  // the overhead illuminant white-balances the model and leaves only the
  // reddening that is actually worth seeing.
  const WHITE_POINT = illuminant(90).rgb;

  function balancedSunlight(altitudeDeg) {
    const light = illuminant(altitudeDeg);
    const v = [0, 1, 2].map(i => light.rgb[i] / WHITE_POINT[i]);
    const peak = Math.max(v[0], v[1], v[2]);
    return { rgb: v.map(x => x / peak), transmittance: light.transmittance };
  }

  // How far the sun must drop below your horizon before it drops below a
  // cloud horizon: geometric dip for the height, plus the half degree that
  // refraction buys back and the semi-diameter of the sun itself. Nine
  // kilometres of cirrus keeps its sunlight for nearly four degrees after the
  // ground has lost it, which is the whole reason high cloud is still burning
  // pink when the street below has gone blue.
  const EARTH_RADIUS_KM = 6371;
  function horizonDip(km) {
    return Math.acos(EARTH_RADIUS_KM / (EARTH_RADIUS_KM + km)) / RAD + 0.84;
  }

  // Three levels, at the heights those cloud families really occupy. Every
  // shape carries its own height in km; cloudTier maps that onto the band
  // whose lighting it shares, and the tier decides both how long a cloud
  // stays lit after sunset and how much air its light crossed to reach it.
  const CLOUD_TIERS = [1.5, 3.5, 9];
  function cloudTier(km) { return km >= 6 ? 2 : km >= 3 ? 1 : 0; }

  // Sodium and warm LED, thrown up off a city and caught on the cloud base.
  const CITY_SKYGLOW = [152, 96, 44];

  function smoothstep(t) { return t * t * (3 - 2 * t); }

  function tierLighting(km, altitude, skyTop, skyBottom, night, w) {
    const seen = altitude + horizonDip(km);
    const sun = balancedSunlight(seen);
    // Under a lid there is no beam left to speak of. Everything below the deck
    // is lit by whatever finds its way through, which arrives from the whole
    // sky at once, so shape goes flat and a cloud stops having a sunlit side
    // at all. This is why an overcast sunset is grey and disappointing: the
    // colour is still up there, just not on anything you can see.
    const blocked = w ? w.overcast : 0;

    // The shaded side of a cloud is lit by the sky, but comes out far brighter
    // than the sky behind it, because light entering the sunlit face is
    // carried through the body droplet by droplet. Without that carry-through
    // clouds sink into the sky and disappear.
    const skylight = [0, 1, 2].map(i => lerp(255, lerp(skyBottom[i], skyTop[i], 0.25), 0.55));
    const ambient = Math.pow(clamp((altitude + 6) / 16, 0, 1), 0.6);
    const shadowLum = night ? 0.30 + 0.24 * ambient : 0.94 * (0.34 + 0.66 * ambient);
    const shadowFace = skylight.map(v => v * shadowLum);

    // The direct beam, dimmed by everything the air took out of it.
    const litLum = (0.62 + 0.38 * Math.pow(sun.transmittance, 0.30)) * (night ? 0.42 : 1);
    const beamFace = [0, 1, 2].map(i => 255 * sun.rgb[i] * litLum);
    // Even a sunlit face collects some sky fill.
    const sunlitFace = [0, 1, 2].map(i => lerp(beamFace[i], skylight[i] * 0.9, 0.18));
    // Below its own horizon a cloud sits in the shadow of the Earth and keeps
    // only what the sky still gives it.
    const lit = clamp(seen / 2.5, 0, 1) * (1 - blocked * 0.97);
    const litFace = [0, 1, 2].map(i => lerp(shadowFace[i] * 0.75, sunlitFace[i], lit));

    // The inversion that gives the whole thing away as real: with the sun high
    // the light lands on the tops and the bases are shadow, and as it drops
    // the beam swings round to the side and then to underneath, until it is
    // the bases that are burning and the tops that have gone dull.
    const under = smoothstep(clamp((14 - seen) / 14, 0, 1));
    let body = [0, 1, 2].map(i => lerp(litFace[i], shadowFace[i], 0.60 * under));
    let shade = [0, 1, 2].map(i => lerp(shadowFace[i], litFace[i], 0.95 * under));
    let deep = [0, 1, 2].map(i => lerp(shade[i] * 0.90, litFace[i] * 0.96, 0.30 * under));

    // Once the sun is properly gone a cloud base over a city is not black. It
    // is dull sodium orange: the light of the town, thrown up and bounced back
    // down off the underside.
    const glow = clamp((-2 - altitude) / 9, 0, 1) * 0.42;
    if (glow > 0) {
      shade = [0, 1, 2].map(i => lerp(shade[i], CITY_SKYGLOW[i], glow * 0.6));
      deep = [0, 1, 2].map(i => lerp(deep[i], CITY_SKYGLOW[i], glow));
    }

    // Moonlight is sunlight, so a low moon really does light a cloud amber.
    // What changes is the eye: at these levels colour vision has largely shut
    // down and the rods have taken over, which drains the hue and leaves the
    // cool grey-blue everyone recognises as night.
    if (night) {
      const scotopic = (c) => {
        const grey = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
        return [
          lerp(c[0], grey * 0.94, 0.62),
          lerp(c[1], grey, 0.62),
          lerp(c[2], grey * 1.16, 0.62),
        ];
      };
      body = scotopic(body); shade = scotopic(shade); deep = scotopic(deep);
    }

    // Diffuse light off a grey lid is dimmer and less coloured than sunlight,
    // and rain takes another bite out of it.
    if (blocked > 0.01 || (w && w.rain > 0.01)) {
      const dim = 1 - blocked * 0.20 - (w ? w.rain : 0) * 0.26;
      const flat = (c) => {
        const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
        return [lerp(c[0], l * 0.98, blocked * 0.8) * dim,
                lerp(c[1], l, blocked * 0.8) * dim,
                lerp(c[2], l * 1.05, blocked * 0.8) * dim];
      };
      body = flat(body); shade = flat(shade); deep = flat(deep);
    }

    return { body: rgbToHex(body), shade: rgbToHex(shade), deep: rgbToHex(deep) };
  }

  // Everything weather touches, in one place. The numbers go out as custom
  // properties so the reveal and the colour both happen in CSS, on the
  // compositor, rather than by writing to a few hundred elements each second.
  function updateWeather(sky) {
    const w = weather;
    const cover = w.cover || [w.cloudiness, w.cloudiness, w.cloudiness];
    for (let i = 0; i < 3; i++) {
      // The floor only ever adds cloud to a bare sky; a genuinely grey day is
      // already past it and is left alone.
      const c = alwaysCloudy ? Math.max(cover[i], ALWAYS_CLOUDY[i]) : cover[i];
      els.clouds.style.setProperty('--cover-' + i, c.toFixed(3));
    }
    // Individual clouds are inside the deck once it closes, so they go as it
    // arrives rather than piling up behind it.
    els.clouds.style.setProperty('--under-deck', (1 - w.overcast * 0.88).toFixed(3));
    els.deck.style.setProperty('--overcast', w.overcast.toFixed(3));

    // The sun does not switch off behind cloud, it goes soft first and then
    // out. How much of the disc survives is skyVeil(), applied where it is
    // positioned; the blur that comes first is the CSS half of the same idea.
    els.root.style.setProperty('--sky-blur', (w.cloudiness * 2.6 + w.fog * 5).toFixed(2) + 'px');

    els.rain.style.setProperty('--rain', w.rain.toFixed(3));
    els.rain.classList.toggle('is-falling', w.rain > 0.02);

    els.fog.style.setProperty('--fog', w.fog.toFixed(3));
    const ambient = sky.ambient ?? 1;
    const veil = [Math.round(lerp(58, 214, ambient)), Math.round(lerp(56, 218, ambient)), Math.round(lerp(60, 224, ambient))];
    els.fog.style.setProperty('--fog-color', `rgb(${veil[0]}, ${veil[1]}, ${veil[2]})`);

    els.root.dataset.weather = describeWeather(w);
    renderWeatherNote();
  }

  function updateClouds(sky) {
    const ambient = sky.ambient ?? 1;
    const skyTop = hexToRgb(sky.top);
    const skyBottom = hexToRgb(sky.bottom);
    CLOUD_TIERS.forEach((km, tier) => {
      const light = tierLighting(km, sky.altitude ?? 45, skyTop, skyBottom, !!sky.night, weather);
      els.root.style.setProperty('--cloud-body-' + tier, light.body);
      els.root.style.setProperty('--cloud-shade-' + tier, light.shade);
      els.root.style.setProperty('--cloud-deep-' + tier, light.deep);
    });
    // Colour now carries the light level, so opacity is only here to stop the
    // shapes reading as hard cut-outs once the sky goes dark.
    els.root.style.setProperty('--cloud-opacity', (0.55 + 0.35 * ambient).toFixed(2));
    els.root.style.setProperty('--bird-ink', (0.25 + 0.45 * ambient).toFixed(2));
  }

  // The city loses its colour as the light goes, and the windows take over.
  // The two layers pull apart deliberately: the far city stays pale and blue
  // enough to sit back, the near city goes dense. Too little separation and
  // the skyline flattens into one grey band.
  const cityFar = [
    { at: 0, r: 38, g: 50, b: 78, a: 0.5 },     // night: a hint of massing
    { at: 1, r: 132, g: 158, b: 194, a: 0.34 }, // day: washed out by distance
  ];
  const cityMid = [
    { at: 0, r: 22, g: 32, b: 56, a: 0.78 },
    { at: 1, r: 96, g: 120, b: 158, a: 0.56 },
  ];
  const cityNear = [
    { at: 0, r: 10, g: 15, b: 30, a: 0.92 },
    { at: 1, r: 62, g: 82, b: 116, a: 0.72 }, // daylight haze, not a night silhouette
  ];

  // ---- How much of the city is up ---------------------------------------
  // One number for the whole skyline, which each window then compares against
  // its own hour. That is what turns a block of light into a city: the value
  // slides, windows cross their thresholds a couple at a time, and the place
  // goes to bed unevenly the way a real one does.
  //
  // Note which end is tied to what. Lights come on with the dark, so the
  // evening follows sunset and the lit hours stretch and shrink with the
  // season. Bedtime does not: it is half past nine whatever the sun is doing,
  // so the far end of the curve is nailed to the clock.
  const CITY_SMALL_HOURS = 0.42;      // what is still burning at three in the morning
  const CITY_EARLY_RISERS = 0.58;

  function cityAwake(now) {
    const h = hourDecimal(now);
    const { sunset } = daylightWindow(now);
    // The whole day is measured from the moment the lights start going on,
    // which is a sunset thing. Running it on one axis that begins and ends
    // there is what keeps the curve continuous: there is no midnight in it to
    // fall off, and no hour where the city can jump brightness in one frame.
    const anchor = sunset - 0.7;
    const from = (hour) => (((hour - anchor) % 24) + 24) % 24;

    // Bedtime and the alarm clock are clock things: they do not move with the
    // season, which is exactly why winter evenings are lit for so much longer.
    // Far enough north in midsummer the sun sets after bedtime, and half nine
    // measured forward from dusk lands most of a day away. Where that happens
    // the evening is simply over before it started, and the city goes straight
    // from switching on to settling down.
    let bed = from(21.5);
    if (bed > 12) bed = 0;

    const stops = [
      { at: 0, v: 0 },                              // dusk, lights beginning
      { at: 1.4, v: 1 },                            // everyone home and lit
      { at: bed, v: 1 },                            // half nine
      { at: bed + 4.1, v: CITY_SMALL_HOURS },       // gone to bed by half one
      { at: from(5.25), v: CITY_SMALL_HOURS },      // the quiet stretch
      { at: from(7.2), v: CITY_EARLY_RISERS },      // up before it is light
      { at: from(11), v: 0 },                       // out, and daylight anyway
      { at: 24, v: 0 },                             // back round to dusk
    ];
    // A sunset late enough to fall the wrong side of bedtime would put these
    // out of order, so they are pushed apart rather than allowed to cross.
    for (let i = 1; i < stops.length; i++) {
      stops[i].at = Math.max(stops[i].at, stops[i - 1].at + 0.05);
    }
    return interpolateBy(stops, from(h)).v;
  }

  // Dark mode is night at every hour, so a wall clock is the wrong thing to
  // ask: at one in the afternoon it would answer that nobody has their lights
  // on, and leave a night city looking abandoned. What it runs on instead is
  // how far through the depicted night the scene has got, which is the same
  // parameter the moon is riding.
  function depictedNight(now) {
    const h = hourDecimal(now);
    const { sunrise, sunset } = daylightWindow(now);
    const dayLength = Math.max(0.5, sunset - sunrise);
    const nightLength = Math.max(0.5, 24 - dayLength);
    return (h >= sunrise && h <= sunset)
      ? clamp((h - sunrise) / dayLength, 0, 1)
      : clamp(hoursSince(h, sunset) / nightLength, 0, 1);
  }

  // Both ends of this are dusk and dawn, and both are busy, which is what lets
  // the moon change arcs at sunset without the city jumping with it.
  function cityAwakeAtNight(fraction) {
    return interpolateBy([
      { at: 0, v: 1 },                       // dusk
      { at: 0.28, v: CITY_SMALL_HOURS },     // settled
      { at: 0.72, v: CITY_SMALL_HOURS },     // the quiet stretch
      { at: 1, v: 1 },                       // up again by dawn
    ], clamp(fraction, 0, 1)).v;
  }

  let lastGlow = -1;
  let lastAwake = -1;

  function updateSkyline(sky) {
    const ambient = sky.ambient ?? 1;
    const darkness = sky.darkness ?? 0;
    // Aerial perspective, which fog only exaggerates: the far band goes first
    // and the near band last, because there is more air in the way of the one
    // than the other. Losing the back of the city before the front is what
    // makes fog read as depth rather than as a wash over the whole picture.
    const haze = weather.fog;
    const veil = [lerp(58, 214, ambient), lerp(56, 218, ambient), lerp(60, 224, ambient)];
    const mix = (stops, distance) => {
      const c = interpolateBy(stops, ambient);
      const t = clamp(haze * distance, 0, 0.97);
      return `rgba(${Math.round(lerp(c.r, veil[0], t))}, ${Math.round(lerp(c.g, veil[1], t))}, ` +
             `${Math.round(lerp(c.b, veil[2], t))}, ${lerp(c.a, c.a * 0.45 + 0.25, t).toFixed(2)})`;
    };
    els.root.style.setProperty('--city-far', mix(cityFar, 1.15));
    els.root.style.setProperty('--city-mid', mix(cityMid, 0.8));
    els.root.style.setProperty('--city-near', mix(cityNear, 0.45));

    // Offices light up before it is fully dark, and never quite all at once.
    // Thousands of windows inherit this, so it is only written when it has
    // actually moved rather than on every tick.
    const glow = Number(clamp(darkness * 1.25, 0, 1).toFixed(2));
    if (glow !== lastGlow) {
      lastGlow = glow;
      els.root.style.setProperty('--window-glow', String(glow));
    }

    // Three decimals, because this is what the windows are compared against
    // and rounding it harder would switch them off in visible batches.
    //
    // Light mode has a real clock to keep. Dark mode does not, because it is
    // night in it whatever the hour, so it keeps the depicted night instead.
    const now = new Date();
    const awake = Number((sky.night ? cityAwakeAtNight(depictedNight(now)) : cityAwake(now)).toFixed(3));
    if (awake !== lastAwake) {
      lastAwake = awake;
      els.root.style.setProperty('--city-awake', String(awake));
    }
  }

  // ---- Somebody is still up ----------------------------------------------
  // The curve above only ever moves one way at a time, so on its own the city
  // would empty out tidily and then hold perfectly still until morning. Real
  // ones do not: a light goes on at three because someone could not sleep, and
  // goes off again twenty minutes later. Overriding one window's --wake is
  // enough to do it, and costs a single style write.
  let stirTimer = null;

  function stirCity() {
    stirTimer = null;
    const awake = lastAwake;
    // Only in the small hours, and only when there is a city to look at.
    if (!document.hidden && lastGlow > 0.5 && awake >= 0 && awake < 0.62) {
      const windows = document.querySelectorAll('.skyline__windows rect');
      if (windows.length) {
        const win = windows[Math.floor(Math.random() * windows.length)];
        const wake = win.style.getPropertyValue('--wake');
        const owl = win.style.getPropertyValue('--owl');
        const lit = owl === '1' || parseFloat(wake) < awake;
        // Turn on what is off, and off what is on.
        win.style.setProperty('--wake', lit ? '2' : '0');
        if (lit) win.style.setProperty('--owl', '0');
        setTimeout(() => {
          win.style.setProperty('--wake', wake || '0.5');
          if (owl) win.style.setProperty('--owl', owl); else win.style.removeProperty('--owl');
        }, rand(90, 900) * 1000);
      }
    }
    scheduleStir();
  }

  function scheduleStir() {
    if (stirTimer) clearTimeout(stirTimer);
    stirTimer = setTimeout(stirCity, rand(24, 95) * 1000);
  }

  // ---- Birds and planes: spawned at random intervals, light theme only
  const PLANE_VIEWBOX = '0 0 133 88';

  // ---- Building the sky -------------------------------------------------
  // Stars are drawn as box-shadow constellations on three elements rather than
  // hundreds of nodes: one element carries fifty stars at no layout cost, and
  // viewport units keep them spread as the window resizes.
  function buildStarfield() {
    const layers = [
      { count: 150, size: 1, alpha: 0.5, period: 7 },
      { count: 92, size: 1.4, alpha: 0.72, period: 9.5 },
      { count: 38, size: 1.9, alpha: 0.92, period: 12 },
    ];

    document.querySelectorAll('.starfield').forEach((el, index) => {
      const layer = layers[index];
      const shadows = [];
      for (let i = 0; i < layer.count; i++) {
        // Weighted upward: the lower sky washes out first at dusk.
        const y = Math.pow(Math.random(), 1.5) * 96;
        shadows.push(`${(Math.random() * 100).toFixed(2)}vw ${y.toFixed(2)}vh 0 0 rgba(255,255,255,${layer.alpha})`);
      }
      el.style.width = layer.size + 'px';
      el.style.height = layer.size + 'px';
      el.style.boxShadow = shadows.join(',');
      el.style.animationDuration = layer.period + 's';
      el.style.animationDelay = (-index * 2.3) + 's';
    });


    // A handful of named-star-bright points, each twinkling on its own clock.
    const bright = document.getElementById('brightStars');
    const frag = document.createDocumentFragment();
    for (let i = 0; i < 16; i++) {
      const star = document.createElement('span');
      star.className = 'star';
      star.style.left = rand(4, 96).toFixed(2) + 'vw';
      star.style.top = (Math.pow(Math.random(), 1.6) * 70 + 2).toFixed(2) + 'vh';
      star.style.setProperty('--twinkle', rand(3.4, 7.2).toFixed(2) + 's');
      star.style.animationDelay = (-Math.random() * 7).toFixed(2) + 's';
      frag.appendChild(star);
    }
    bright.replaceChildren(frag);
  }

  // Clouds live on three depth bands. Nearer clouds are bigger, faster and
  // more opaque, which is what sells the sky as having depth at all.
  //
  // Fifteen shapes across four families. The family, not the individual
  // shape, is what each band draws from: cirrus belongs high and thin, a
  // towering congestus only makes sense close up, and a stratus sheet has to
  // be wide enough to read as a sheet. Weighting by family keeps the mix
  // plausible however the random draw falls.
  const CLOUD_SHAPES = [
    { id: '#art-cloud-1', viewBox: '45 108 77 22', family: 'bar', km: 3.2 },
    { id: '#art-cloud-2', viewBox: '231 106 90 32', family: 'bar', km: 3.2 },
    { id: '#art-cloud-3', viewBox: '237 183 74 35', family: 'bar', km: 3.2 },
    { id: '#art-cloud-4', viewBox: '20 172 78 29', family: 'bar', km: 3.2 },
    { id: '#art-cloud-9', viewBox: '0 0 150 52', family: 'bar', km: 3.2 },
    { id: '#art-cloud-5', viewBox: '0 0 128 64', family: 'cumulus', km: 1.6 },
    { id: '#art-cloud-6', viewBox: '0 0 168 74', family: 'cumulus', km: 1.7 },
    { id: '#art-cloud-8', viewBox: '0 0 84 42', family: 'cumulus', km: 1.4 },
    { id: '#art-cloud-10', viewBox: '0 0 62 34', family: 'cumulus', km: 1.2 },
    { id: '#art-cloud-15', viewBox: '0 0 142 70', family: 'cumulus', km: 1.8 },
    { id: '#art-cloud-11', viewBox: '0 0 120 92', family: 'cumulus', near: true, km: 2.2 },
    { id: '#art-cloud-7', viewBox: '0 0 180 44', family: 'cirrus', km: 9.0 },
    { id: '#art-cloud-13', viewBox: '0 0 162 32', family: 'cirrus', km: 4.5 },
    { id: '#art-cloud-14', viewBox: '0 0 204 56', family: 'cirrus', km: 9.5 },
    { id: '#art-cloud-12', viewBox: '0 0 212 28', family: 'stratus', km: 0.7 },
  ];

  // Weighted family mix per band, highest band first. High air is mostly ice
  // cloud; the bands nearer the ground carry the heaped water cloud.
  const CLOUD_MIX = [
    { cirrus: 46, bar: 30, cumulus: 24, stratus: 0 },
    { cirrus: 16, bar: 34, cumulus: 40, stratus: 10 },
    { cirrus: 0, bar: 24, cumulus: 56, stratus: 20 },
  ];

  function pickCloudShape(mix, allowNear, avoid) {
    // Draw a family first, then a shape from it, retrying once if the draw
    // repeats the previous cloud — back-to-back twins are the one thing that
    // gives a generated sky away.
    for (let attempt = 0; attempt < 6; attempt++) {
      let total = 0;
      for (const family of Object.keys(mix)) total += mix[family];
      let roll = Math.random() * total;
      let chosen = 'cumulus';
      for (const family of Object.keys(mix)) {
        roll -= mix[family];
        if (roll <= 0) { chosen = family; break; }
      }
      const pool = CLOUD_SHAPES.filter(
        (shape) => shape.family === chosen && (allowNear || !shape.near)
      );
      if (!pool.length) continue;
      const shape = pick(pool);
      if (shape !== avoid || attempt === 5) return shape;
    }
    return CLOUD_SHAPES[0];
  }

  // Three distances, and everything that flies or drifts picks one. A bird on
  // the far band is the same distance off as a cloud on the far band: it is
  // the same fraction of the size, carries the same haze, takes the same
  // unhurried time to cross, and sits at the same place in the stack, which is
  // what lets it go behind the cloud in front of it. One table, so the layers
  // cannot drift out of agreement with each other.
  const SKY_BANDS = [
    { depth: 0.45, cloud: { count: 7, width: [70, 120], speed: [200, 280], top: [2, 34] },
      bird: { scale: [0.30, 0.50], top: [3, 24], cross: [70, 115] } },
    { depth: 0.72, cloud: { count: 7, width: [130, 210], speed: [130, 190], top: [6, 48] },
      bird: { scale: [0.52, 0.84], top: [5, 38], cross: [40, 66] } },
    { depth: 1.00, cloud: { count: 5, width: [230, 330], speed: [85, 125], top: [12, 62] },
      bird: { scale: [0.95, 1.35], top: [8, 50], cross: [21, 34] } },
  ];

  function buildClouds() {
    const bands = SKY_BANDS.map(b => ({ ...b.cloud, depth: b.depth }));

    const frag = document.createDocumentFragment();
    bands.forEach((band, bandIndex) => {
      let previous = null;
      for (let i = 0; i < band.count; i++) {
        const shape = pickCloudShape(CLOUD_MIX[bandIndex], bandIndex === 2, previous);
        previous = shape;
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        svg.setAttribute('viewBox', shape.viewBox);
        svg.setAttribute('class', 'cloud');
        // The tier picks which set of lighting tokens this cloud reads, so a
        // cirrus at nine kilometres keeps its colour after the cumulus below
        // it has gone dark.
        svg.dataset.tier = cloudTier(shape.km);
        // Which distance it sits at, and so what it passes in front of.
        svg.dataset.band = String(bandIndex);
        use.setAttribute('href', shape.id);

        // Half of them are mirrored, which doubles the apparent number of
        // shapes for free. The flip has to live on the <use>, because the
        // drift animation owns the transform on the <svg> itself.
        if (Math.random() < 0.5) {
          const [minX, , width] = shape.viewBox.split(/\s+/).map(Number);
          use.setAttribute('transform', 'translate(' + (2 * minX + width) + ' 0) scale(-1 1)');
        }
        svg.appendChild(use);

        const duration = rand(band.speed[0], band.speed[1]);
        // A towering cumulus is as tall as it is wide, so it needs less width
        // than a flat bar to take up the same amount of sky.
        const bulk = shape.near ? 0.66 : 1;
        svg.style.width = (rand(band.width[0], band.width[1]) * bulk).toFixed(0) + 'px';
        // Cirrus rides above the weather and thinner, so it is pinned to the
        // top of whatever band it lands in and dialled back.
        const high = shape.family === 'cirrus';
        const topRange = high
          ? [band.top[0], band.top[0] + (band.top[1] - band.top[0]) * 0.4]
          : band.top;
        svg.style.top = rand(topRange[0], topRange[1]).toFixed(2) + '%';
        // A little jitter on every cloud, so even two of the same shape on the
        // same band do not read as a matched pair.
        svg.style.setProperty('--wisp', (high ? rand(0.5, 0.72) : rand(0.86, 1)).toFixed(2));
        svg.style.animationDuration = duration.toFixed(1) + 's';
        // Negative delays scatter them across the sky on first paint instead
        // of marching them all in from the left edge together.
        svg.style.animationDelay = (-Math.random() * duration).toFixed(1) + 's';
        svg.style.setProperty('--depth', band.depth.toFixed(2));
        // The cover a sky needs before this particular cloud is in it. Sorting
        // the reveal by threshold rather than rebuilding on every change means
        // clouds arrive and leave one at a time, which is how a sky fills in.
        svg.style.setProperty('--thresh', (i / band.count * 0.86 + Math.random() * 0.14).toFixed(3));
        frag.appendChild(svg);
      }
    });
    els.clouds.replaceChildren(frag);
    buildDeck();
  }

  // The lid itself is a soft band rather than more cloud shapes, because past
  // about eight tenths of cover you stop being able to pick out individual
  // clouds at all. A handful of very wide stratus sheets drift across it so it
  // still reads as weather and not as a panel someone dropped over the sky.
  function buildDeck() {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < 4; i++) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      svg.setAttribute('viewBox', '0 0 212 28');
      svg.setAttribute('class', 'cloud cloud--deck');
      use.setAttribute('href', '#art-cloud-12');
      svg.appendChild(use);
      const duration = rand(150, 230);
      svg.style.width = rand(340, 560).toFixed(0) + 'px';
      svg.style.top = (4 + i * 11 + rand(-3, 3)).toFixed(1) + '%';
      svg.style.animationDuration = duration.toFixed(1) + 's';
      svg.style.animationDelay = (-Math.random() * duration).toFixed(1) + 's';
      svg.dataset.tier = '0';
      frag.appendChild(svg);
    }
    els.deck.replaceChildren(frag);
  }

  // ---- Rain --------------------------------------------------------------
  // A fixed pool of drops, revealed by intensity the same way the clouds are
  // revealed by cover, so a shower builds and eases instead of switching on.
  // Three depths: near drops are longer, faster and darker, which is most of
  // what sells rain as having volume rather than being a texture.
  const RAIN_DROPS = 90;

  function buildRain() {
    if (reduceMotion) return;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < RAIN_DROPS; i++) {
      const drop = document.createElement('span');
      drop.className = 'drop';
      const depth = Math.random();
      drop.style.left = (Math.random() * 108 - 4).toFixed(2) + '%';
      drop.style.setProperty('--len', (8 + depth * 26).toFixed(1) + 'px');
      drop.style.setProperty('--fade', (0.16 + depth * 0.34).toFixed(2));
      drop.style.setProperty('--thresh', (i / RAIN_DROPS).toFixed(3));
      const fall = (1.35 - depth * 0.75).toFixed(2);
      drop.style.animationDuration = fall + 's';
      drop.style.animationDelay = (-Math.random() * fall).toFixed(2) + 's';
      frag.appendChild(drop);
    }
    els.rain.replaceChildren(frag);
  }

  // ---- Meteors -----------------------------------------------------------
  // A meteor's colour comes from what is burning off it: sodium glows amber,
  // magnesium blue-green, calcium violet, iron a soft gold, and the shocked
  // air itself adds the red of nitrogen and oxygen. These are the real
  // dominant lines, so the sky ends up mostly gold with the occasional
  // startling green.
  const METEOR_ELEMENTS = [
    { name: 'sodium', core: '#fff4d6', trail: '#ffb648', weight: 30 },
    { name: 'iron', core: '#fff2cf', trail: '#ffd27a', weight: 26 },
    { name: 'magnesium', core: '#e8fff6', trail: '#57ffc8', weight: 16 },
    { name: 'nitrogen and oxygen', core: '#ffe6e6', trail: '#ff5f6d', weight: 12 },
    { name: 'calcium', core: '#f3ecff', trail: '#a97bff', weight: 9 },
    { name: 'nickel', core: '#eefaff', trail: '#8fd8ff', weight: 7 },
  ];

  let meteorTimeout = null;

  function spawnMeteor() {
    const element = pickWeighted(METEOR_ELEMENTS);
    // Real showers radiate from a point, but sporadics come from anywhere, so
    // the entry angle is drawn across a wide range rather than fixed.
    const angle = rand(18, 62) * (Math.random() < 0.5 ? 1 : -1);
    const length = rand(90, 260);
    const travel = rand(320, 760);
    // A real meteor is gone in well under a second, which is true and useless:
    // by the time your eye has found it there is nothing left to look at. This
    // is roughly half the old speed, slow enough to actually follow one.
    const life = rand(1.2, 2.8);

    const meteor = document.createElement('div');
    meteor.className = 'meteor';
    meteor.style.left = rand(-5, 95) + 'vw';
    meteor.style.top = rand(-2, 46) + 'vh';
    meteor.style.setProperty('--angle', angle.toFixed(1) + 'deg');
    meteor.style.setProperty('--len', length.toFixed(0) + 'px');
    meteor.style.setProperty('--travel', travel.toFixed(0) + 'px');
    meteor.style.setProperty('--core', element.core);
    meteor.style.setProperty('--trail', element.trail);
    meteor.style.animationDuration = life.toFixed(2) + 's';

    const remove = () => { clearTimeout(meteor._expiry); meteor.remove(); };
    meteor.addEventListener('animationend', remove);
    meteor._expiry = setTimeout(remove, (life + 2) * 1000);
    els.skyTraffic.appendChild(meteor);

    // Bright ones sometimes arrive in twos, as a fragmenting body does.
    if (Math.random() < 0.1) setTimeout(() => { if (trafficAllowed()) spawnMeteor(); }, rand(200, 700));
  }

  function scheduleMeteors(delay) {
    if (!sceneActive()) return;
    meteorTimeout = setTimeout(() => {
      // Only worth watching against a dark sky.
      if (trafficAllowed() && isNightScene()) spawnMeteor();
      scheduleMeteors(isNightScene() ? rand(70000, 190000) : rand(240000, 420000));
    }, delay);
  }

  // ---- Eclipses ----------------------------------------------------------
  // Modelled on the real geometry rather than a timed fade.
  //
  // Lunar: the moon crosses Earth's shadow, so it can only happen at full
  // moon. The umbra is about 2.6 lunar radii across and the penumbra about
  // 4.6, so the shadow centre travels +/-5.6 radii from first to last contact.
  // Those numbers alone produce the real contact order: penumbral, partial,
  // totality, and back out again, in roughly the real proportions.
  //
  // Solar: the moon crosses in front of the sun, so it can only happen at new
  // moon. Their apparent discs are almost the same size, which is why totality
  // is a sliver of the event rather than a comfortable half of it.
  const MOON_R = 1;
  const UMBRA_R = 2.6 * MOON_R;
  const PENUMBRA_R = 4.6 * MOON_R;
  const LUNAR_SWEEP = PENUMBRA_R + MOON_R;      // 5.6 radii each side
  const SOLAR_MOON_R = 1.03;                    // moon looks a touch bigger
  const SOLAR_SWEEP = SOLAR_MOON_R + 1;

  let eclipse = null;
  let eclipseTimeout = null;

  // Only near full for a lunar eclipse, only near new for a solar one.
  function eclipseSeason(now) {
    const phase = moonPhase(now);
    if (Math.abs(phase - 0.5) < 0.035) return 'lunar';
    if (phase < 0.035 || phase > 0.965) return 'solar';
    return null;
  }

  function startEclipse(kind) {
    if (eclipse) return;
    // Compressed from the real thing: a lunar eclipse runs about five and a
    // half hours and a solar one about three. Kept in proportion, so the
    // stages last as long relative to each other as they really do.
    const duration = kind === 'lunar' ? rand(11, 16) * 60000 : rand(7, 11) * 60000;
    eclipse = { kind, start: Date.now(), duration, stage: '' };
    if (kind === 'lunar') els.moonEclipse.classList.add('is-running');
    else els.sunShadow.classList.add('is-running');
  }

  function endEclipse() {
    eclipse = null;
    els.sunShadow.classList.remove('is-running');
    els.moonEclipse.classList.remove('is-running');
    els.sky.classList.remove('is-totality');
  }

  // Advances the running eclipse and returns how much of the sun is covered,
  // which is 0 for a lunar one since the daylight is unaffected.
  function updateEclipse() {
    if (!eclipse) return 0;

    const t = (Date.now() - eclipse.start) / eclipse.duration;
    if (t >= 1) { endEclipse(); return 0; }

    if (eclipse.kind === 'lunar') {
      // Shadow centre sweeps across in lunar radii. A percentage inside
      // translate() resolves against the element's own width, and these
      // shadows are several times wider than the disc, so the offset has to be
      // divided by each one's own scale to move it by the intended distance.
      const d = (t * 2 - 1) * LUNAR_SWEEP;
      const shift = (radii, scale) => ((radii * 50) / scale).toFixed(2) + '%';
      els.moonPenumbra.style.setProperty('--shadow-x', shift(d, PENUMBRA_R));
      els.moonUmbra.style.setProperty('--shadow-x', shift(d, UMBRA_R));

      const far = Math.abs(d);
      eclipse.stage = far < UMBRA_R - MOON_R ? 'total'
        : far < UMBRA_R + MOON_R ? 'partial'
        : far < PENUMBRA_R + MOON_R ? 'penumbral' : '';
      return 0;
    }

    // Solar: the moon's disc slides over the sun's.
    const d = Math.abs((t * 2 - 1) * SOLAR_SWEEP);
    const span = els.sun.getBoundingClientRect().width || 100;
    els.sunShadow.style.setProperty('--eclipse-x', ((t * 2 - 1) * SOLAR_SWEEP * span * 0.5).toFixed(1) + 'px');
    els.sunShadow.style.left = els.sun.style.left;
    els.sunShadow.style.top = els.sun.style.top;

    // Fully covered while the moon's disc contains the sun's.
    const inner = SOLAR_MOON_R - 1;
    const covered = d <= inner ? 1
      : clamp(1 - (d - inner) / ((SOLAR_MOON_R + 1) - inner), 0, 1);
    eclipse.stage = covered >= 1 ? 'total' : covered > 0 ? 'partial' : '';
    els.sky.classList.toggle('is-totality', covered > 0.98);
    return covered;
  }

  function scheduleEclipse(delay) {
    if (!sceneActive()) return;
    eclipseTimeout = setTimeout(() => {
      const season = eclipseSeason(new Date());
      // A solar eclipse needs the sun up to be worth anything.
      const possible = season === 'lunar' ? isNightScene() : season === 'solar' && !isNightScene();
      if (trafficAllowed() && !eclipse && possible) startEclipse(season);
      scheduleEclipse(rand(240000, 600000));
    }, delay);
  }

  // ---- Skyline ----------------------------------------------------------
  // A city drawn from rules rather than a fixed asset: two depth layers, the
  // far one hazier and shorter, so the horizon reads as distance rather than
  // as a band of colour. Windows are real rects, which is what lets them come
  // on at dusk.
  const SVGNS = 'http://www.w3.org/2000/svg';

  function el(name, attrs) {
    const node = document.createElementNS(SVGNS, name);
    for (const key in attrs) node.setAttribute(key, attrs[key]);
    return node;
  }

  // Rooftop clutter is what stops a skyline reading as a bar chart, so each
  // flat roof gets a chance at a water tank, a plant room or a lit mast.
  function roofKit(group, x, w, y, scale) {
    const roll = Math.random();
    if (roll < 0.28) {
      // Water tank on legs, the classic rooftop silhouette.
      const tw = clamp(w * 0.22, 7, 15) * scale;
      const tx = x + w * rand(0.2, 0.62);
      const th = tw * 1.15;
      group.appendChild(el('path', { d:
        `M${tx} ${y} v${-th} l${tw / 2} ${-tw * 0.42} l${tw / 2} ${tw * 0.42} v${th} Z` }));
      group.appendChild(el('rect', { x: tx + 1, y: y - 5, width: 2, height: 5 }));
      group.appendChild(el('rect', { x: tx + tw - 3, y: y - 5, width: 2, height: 5 }));
    } else if (roll < 0.55) {
      // Plant room, sometimes two of different heights.
      const bw = w * rand(0.2, 0.34);
      const bx = x + w * rand(0.1, 0.5);
      group.appendChild(el('rect', { x: bx, y: y - bw * 0.5, width: bw, height: bw * 0.5 }));
      if (Math.random() < 0.5) {
        const b2 = w * rand(0.12, 0.2);
        group.appendChild(el('rect', { x: bx + bw + 3, y: y - b2 * 0.8, width: b2, height: b2 * 0.8 }));
      }
    } else if (roll < 0.78) {
      const mastH = rand(16, 40) * scale;
      const mx = x + w * rand(0.35, 0.65);
      group.appendChild(el('rect', { x: mx, y: y - mastH, width: 2.4, height: mastH }));
      // Aircraft warning light, which blinks once the city is lit.
      const beacon = el('circle', { cx: mx + 1.2, cy: y - mastH, r: 2.6 });
      beacon.setAttribute('class', 'skyline__beacon');
      beacon.style.animationDelay = (-Math.random() * 3).toFixed(2) + 's';
      group.appendChild(beacon);
    }
  }

  // Windows laid out floor by floor. Scattering them at random was what made
  // the facades look like static; real buildings light up by storey, and a
  // floor that is working late lights nearly all of its windows at once.
  function facade(group, x, w, y, h, spec) {
    const inset = spec.inset;
    const usableW = w - inset * 2;
    const usableH = h - spec.roofGap - spec.baseGap;
    if (usableW < spec.colW || usableH < spec.floorH) return;

    const cols = Math.max(1, Math.floor(usableW / spec.colW));
    const rows = Math.max(1, Math.floor(usableH / spec.floorH));
    const padX = (usableW - cols * spec.colW) / 2;

    const windows = el('g', {});
    windows.setAttribute('class', 'skyline__windows');

    for (let r = 0; r < rows; r++) {
      const wy = y + spec.roofGap + r * spec.floorH;
      // Roughly a third of floors are properly occupied.
      const busy = Math.random() < 0.34;
      const chance = busy ? rand(0.7, 0.95) : rand(0.05, 0.2);

      // How late this floor keeps its lights on. --wake is the point on the
      // city's own evening at which a window gives up: a low number means it
      // burns until the small hours, a high one that it goes off with the news.
      // A working floor keeps stranger hours than a flat does, so it draws from
      // a wider spread and is likelier to hold a light all night.
      const owlChance = busy ? 0.12 : 0.05;
      const wakeFrom = busy ? 0.08 : 0.30;
      const dress = (rect) => {
        rect.style.setProperty('--wake', rand(wakeFrom, 1).toFixed(3));
        // Stairwells, corridors, server rooms, the lamp nobody turns off.
        if (Math.random() < owlChance) rect.style.setProperty('--owl', '1');
      };

      if (spec.style === 'ribbon') {
        // Continuous glazing: one band per floor, occasionally interrupted.
        let cx = x + inset + padX;
        while (cx < x + w - inset - 4) {
          const runLen = Math.min(spec.colW * Math.round(rand(2, 5)), x + w - inset - cx);
          if (Math.random() < chance) {
            const bar = el('rect', { x: cx, y: wy, width: runLen - 2.5, height: spec.winH, rx: 0.8 });
            bar.style.setProperty('--lit', rand(0.4, 1).toFixed(2));
            dress(bar);
            windows.appendChild(bar);
          }
          cx += runLen;
        }
      } else {
        for (let c = 0; c < cols; c++) {
          if (Math.random() > chance) continue;
          const win = el('rect', {
            x: x + inset + padX + c * spec.colW,
            y: wy,
            width: spec.winW,
            height: spec.winH,
            rx: 0.8,
          });
          win.style.setProperty('--lit', rand(0.45, 1).toFixed(2));
          dress(win);
          windows.appendChild(win);
        }
      }
    }
    group.appendChild(windows);
  }

  function buildSkyline() {
    const svg = document.getElementById('skyline');
    svg.replaceChildren();

    // Three bands rather than two: the extra one gives the horizon somewhere
    // to recede into instead of jumping straight from haze to foreground.
    const layers = [
      { klass: 'skyline__far', minW: 40, maxW: 84, minH: 44, maxH: 128, gap: [-10, 10],
        floorH: 13, colW: 11, winW: 4.5, winH: 5, inset: 6, roofGap: 10, baseGap: 4,
        roofChance: 0.25, scale: 0.7, tone: [0.55, 0.8] },
      { klass: 'skyline__mid', minW: 48, maxW: 104, minH: 60, maxH: 176, gap: [-16, 8],
        floorH: 14, colW: 12, winW: 5, winH: 5.5, inset: 7, roofGap: 11, baseGap: 5,
        roofChance: 0.5, scale: 0.85, tone: [0.7, 0.95] },
      { klass: 'skyline__near', minW: 56, maxW: 128, minH: 76, maxH: 226, gap: [-20, 6],
        floorH: 16, colW: 13, winW: 5.5, winH: 6.5, inset: 8, roofGap: 13, baseGap: 6,
        roofChance: 0.72, scale: 1, tone: [0.85, 1] },
    ];

    for (const layer of layers) {
      const group = el('g', {});
      group.setAttribute('class', layer.klass);

      let x = -50;
      let lastShape = '';
      while (x < 1650) {
        // Height and slenderness correlate, the way real towers do.
        const tall = Math.pow(Math.random(), 1.5);
        const h = layer.minH + tall * (layer.maxH - layer.minH);
        const w = layer.minW + (1 - tall * 0.7) * (layer.maxW - layer.minW) * rand(0.7, 1);
        const y = 300 - h;

        // Tall forms belong to towers, squat ones to blocks; a domed low-rise
        // reads as civic, a domed skyscraper reads as a mistake.
        const options = tall > 0.6
          ? ['tower', 'setback', 'ziggurat', 'taper', 'spire', 'crown', 'notch', 'chamfer', 'tower']
          : ['slab', 'block', 'crown', 'pitched', 'chamfer', 'slab', 'block', 'dome'];
        let shape = pick(options);
        if (shape === lastShape) shape = pick(options.filter(s => s !== lastShape));
        lastShape = shape;

        // Each building carries its own weight so neighbours separate instead
        // of fusing into a single silhouette.
        const building = el('g', {});
        building.style.setProperty('--tone', rand(layer.tone[0], layer.tone[1]).toFixed(3));

        // The flat part of the roof, which is rarely the full width. Cornices
        // and rooftop clutter are placed against this rather than against the
        // footprint, otherwise they float out past a tapered top.
        let roofX = x, roofW = w;
        let d, flatRoof = true;
        if (shape === 'setback') {
          const i1 = w * rand(0.1, 0.18), i2 = w * rand(0.24, 0.34);
          const s1 = y + h * rand(0.18, 0.28), s2 = y + h * rand(0.06, 0.13);
          d = `M${x} 300 V${s1} H${x + i1} V${s2} H${x + i2} V${y} H${x + w - i2} V${s2} `
            + `H${x + w - i1} V${s1} H${x + w} V300 Z`;
          roofX = x + i2; roofW = w - i2 * 2;
        } else if (shape === 'ziggurat') {
          // Four shallow steps, the pre-war setback ordinance silhouette.
          const i = w * 0.11, s = h * 0.13;
          d = `M${x} 300 V${y + s * 3} H${x + i} V${y + s * 2} H${x + i * 2} V${y + s} `
            + `H${x + i * 3} V${y} H${x + w - i * 3} V${y + s} H${x + w - i * 2} V${y + s * 2} `
            + `H${x + w - i} V${y + s * 3} H${x + w} V300 Z`;
          roofX = x + i * 3; roofW = w - i * 6;
        } else if (shape === 'taper') {
          // Walls that lean in the whole way up.
          const i = w * rand(0.16, 0.26);
          d = `M${x} 300 V${y + h * 0.3} L${x + i} ${y} H${x + w - i} L${x + w} ${y + h * 0.3} V300 Z`;
          roofX = x + i; roofW = w - i * 2;
        } else if (shape === 'dome') {
          // A shallow cap. A radius of half the width turned low-rises into
          // hemispheres that read as hills rather than buildings.
          const r = Math.min(w * 0.34, h * 0.16);
          d = `M${x} 300 V${y + r} C${x} ${y} ${x + w} ${y} ${x + w} ${y + r} V300 Z`;
          flatRoof = false;
        } else if (shape === 'notch') {
          // Twin peaks with a service well between them.
          const g1 = w * rand(0.38, 0.44), g2 = w * rand(0.56, 0.62);
          d = `M${x} 300 V${y} H${x + g1} V${y + h * rand(0.1, 0.18)} H${x + g2} V${y} `
            + `H${x + w} V300 Z`;
          roofX = x; roofW = g1;
        } else if (shape === 'chamfer') {
          const c = Math.min(w * 0.22, h * 0.14);
          d = `M${x} 300 V${y + c} L${x + c} ${y} H${x + w - c} L${x + w} ${y + c} V300 Z`;
          roofX = x + c; roofW = w - c * 2;
        } else if (shape === 'crown') {
          const i = w * rand(0.22, 0.32), cap = h * rand(0.06, 0.12);
          d = `M${x} 300 V${y + cap} H${x + i} V${y} H${x + w - i} V${y + cap} H${x + w} V300 Z`;
          roofX = x + i; roofW = w - i * 2;
        } else if (shape === 'spire') {
          const i = w * rand(0.28, 0.4);
          d = `M${x} 300 V${y + h * 0.15} L${x + i} ${y} H${x + w - i} L${x + w} ${y + h * 0.15} V300 Z`;
          flatRoof = false;
        } else if (shape === 'pitched') {
          d = `M${x} 300 V${y + 12} L${x + w / 2} ${y} L${x + w} ${y + 12} V300 Z`;
          flatRoof = false;
        } else {
          d = `M${x} 300 V${y} H${x + w} V300 Z`;
        }
        building.appendChild(el('path', { d }));

        // A wider podium grounds a tall tower instead of letting it rise
        // straight out of nothing.
        if (tall > 0.55 && Math.random() < 0.4) {
          const pod = w * rand(0.1, 0.2);
          const podH = Math.min(h * rand(0.1, 0.18), 46);
          building.appendChild(el('path', {
            d: `M${x - pod} 300 V${300 - podH} H${x + w + pod} V300 Z`,
          }));
        }

        // Structural piers, which is what actually reads as a tall building
        // rather than a rectangle with dots on it.
        if (tall > 0.5 && Math.random() < 0.34) {
          const piers = Math.max(2, Math.round(w / 26));
          for (let i = 1; i < piers; i++) {
            building.appendChild(el('rect', {
              x: x + (w / piers) * i - 1, y: y + h * 0.06,
              width: 2, height: h * 0.9, opacity: 0.5,
            }));
          }
        }

        // A cornice reads as a roof edge and stops the top looking cut off.
        if (flatRoof && roofW > 14 && Math.random() < 0.45) {
          building.appendChild(el('rect', {
            x: roofX - 2, y: y - 2.5, width: roofW + 4, height: 3, rx: 1,
          }));
        }

        if (flatRoof && roofW > 20 && Math.random() < layer.roofChance) {
          roofKit(building, roofX, roofW, y, layer.scale);
        }

        // Curtain-wall towers get banded glazing, older blocks punched windows.
        const style = tall > 0.55 && Math.random() < 0.45 ? 'ribbon' : 'punched';
        const shapeTop = shape === 'pitched' || shape === 'spire' ? y + h * 0.18 : y;
        facade(building, x, w, shapeTop, 300 - shapeTop, { ...layer, style });

        // Warm offices and cool fluorescent floors, mixed across the city.
        building.style.setProperty('--window-color', Math.random() < 0.68 ? '#ffd489' : '#cfe4ff');

        group.appendChild(building);
        x += w + rand(layer.gap[0], layer.gap[1]);
      }
      svg.appendChild(group);
    }
  }

  // Hard ceilings, so no combination of timing accidents can fill the sky.
  const MAX_BIRDS = 40;
  const MAX_PLANES = 4;

  function isDaylightNow() {
    return solarAltitude(new Date()) > -6;
  }

  // Dark mode is night by definition; light mode is night only after dusk.
  function isNightScene() {
    return theme === 'dark' || !isDaylightNow();
  }

  // A background tab suspends CSS animations but keeps firing timers, so
  // `animationend` never arrives and sprites used to stack up at the spawn
  // point, then all set off at once on return. Every flyer now carries its own
  // expiry, and nothing spawns while the tab is hidden.
  function launch(el, seconds, drift) {
    el.style.animationDuration = seconds + 's';
    el.style.setProperty('--flyer-drift', drift + 'px');
    const remove = () => {
      clearTimeout(el._expiry);
      el.remove();
    };
    el.addEventListener('animationend', remove);
    el._expiry = setTimeout(remove, (Number(seconds) + 2) * 1000);
    els.skyTraffic.appendChild(el);
  }

  function countFlyers(selector) {
    return els.skyTraffic.querySelectorAll(selector).length;
  }

  function pickWeighted(items) {
    const total = items.reduce((sum, item) => sum + item.weight, 0);
    let roll = Math.random() * total;
    for (const item of items) {
      roll -= item.weight;
      if (roll <= 0) return item;
    }
    return items[items.length - 1];
  }

  const BIRD_FRAMES = ['#art-bird-down', '#art-bird-mid', '#art-bird-up', '#art-bird-mid'];

  // One gull: four stacked poses, each lit for a quarter of the wingbeat.
  function makeBird(scale) {
    const bird = document.createElement('div');
    bird.className = 'flyer bird';
    bird.style.width = (52 * scale).toFixed(1) + 'px';
    // Small birds are distant birds: they beat faster and bob less, which is
    // what actually sells the depth.
    bird.style.setProperty('--flap', (rand(0.58, 0.8) * (0.55 + 0.45 * scale)).toFixed(2) + 's');
    bird.style.setProperty('--bob', rand(3, 5.2).toFixed(2) + 's');
    bird.style.setProperty('--bob-shift', (7 * scale).toFixed(1) + 'px');

    const flap = document.createElement('div');
    flap.className = 'bird__flap';
    BIRD_FRAMES.forEach((id, frame) => {
      const svg = document.createElementNS(SVGNS, 'svg');
      const use = document.createElementNS(SVGNS, 'use');
      svg.setAttribute('viewBox', '0 0 420 220');
      svg.setAttribute('class', 'bird__frame');
      svg.style.animationDelay = 'calc(var(--flap) * ' + (-frame / 4).toFixed(2) + ')';
      use.setAttribute('href', id);
      svg.appendChild(use);
      flap.appendChild(svg);
    });
    // Birds in a group are never quite in step with each other.
    flap.style.animationDelay = (-Math.random() * 5).toFixed(2) + 's';
    bird.appendChild(flap);
    return bird;
  }

  // Gulls do not all travel the same way, so neither do these. A lone bird
  // crossing high, a pair, a loose skein, or a far-off flock in a ragged V.
  // How many there are and how far off they are is not independent: you notice
  // one bird when it is near, and a big flock only reads as a flock at a
  // distance, so the size of a group and the band it flies on go together.
  const FLOCKS = [
    { kind: 'single', size: [1, 1], band: 2, weight: 4 },
    { kind: 'pair', size: [2, 2], band: 2, weight: 2 },
    { kind: 'pair', size: [2, 2], band: 1, weight: 2 },
    { kind: 'skein', size: [3, 6], band: 1, weight: 4 },
    { kind: 'skein', size: [3, 5], band: 0, weight: 2 },
    { kind: 'flock', size: [10, 18], band: 0, weight: 2 },
  ];

  function spawnFlock() {
    if (countFlyers('.bird') >= MAX_BIRDS) return;

    const shape = pickWeighted(FLOCKS);
    const band = SKY_BANDS[shape.band];
    const size = Math.round(rand(shape.size[0], shape.size[1]));
    const baseTop = rand(band.bird.top[0], band.bird.top[1]);
    const baseScale = rand(band.bird.scale[0], band.bird.scale[1]);
    // The whole group holds formation, so it shares one crossing time, and the
    // far band takes the longest over it the way the far clouds do.
    const baseDur = rand(band.bird.cross[0], band.bird.cross[1]);
    const drift = rand(-90, 30) * band.depth;

    for (let i = 0; i < size; i++) {
      if (countFlyers('.bird') >= MAX_BIRDS) break;

      // Individuals vary around the group's size rather than being identical.
      const scale = clamp(baseScale * rand(0.86, 1.14), 0.18, 1.35);
      const bird = makeBird(scale);
      bird.dataset.band = String(shape.band);
      bird.style.setProperty('--depth', band.depth.toFixed(2));

      let offsetX, offsetY;
      if (shape.kind === 'flock') {
        // A ragged V: two arms sweeping back from a leader, loosely held.
        const arm = i === 0 ? 0 : (i % 2 === 1 ? -1 : 1);
        const rank = Math.ceil(i / 2);
        offsetX = -rank * rand(26, 40);
        offsetY = arm * rank * rand(0.7, 1.3) + rand(-0.6, 0.6);
      } else if (shape.kind === 'skein') {
        offsetX = -i * rand(54, 92);
        offsetY = i * rand(-2.6, -0.8) + rand(-1.2, 1.2);
      } else {
        offsetX = -i * rand(60, 110);
        offsetY = rand(-3, 3);
      }

      // Spacing is in pixels on screen, so it has to shrink with distance or a
      // far flock comes out strung across the whole sky.
      bird.style.marginLeft = (offsetX * baseScale).toFixed(0) + 'px';
      bird.style.top = clamp(baseTop + offsetY, 2, 56).toFixed(2) + '%';

      // The whole group holds formation, so it shares one crossing time.
      launch(bird, baseDur.toFixed(1), drift + rand(-8, 8));
    }
  }

  // One airframe drawing wears many liveries, so the sky gets variety without
  // another sprite for every airline.
  const LIVERIES = [
    { accent: '#FFCC06', body: '#FFFFFF', shade: '#CAA32D', ink: '#1B1B1B' }, // the original
    { accent: '#E23B4C', body: '#FFFFFF', shade: '#A62634', ink: '#26262B' }, // red tail
    { accent: '#1F6FD0', body: '#F4F8FF', shade: '#154C93', ink: '#1B2430' }, // navy
    { accent: '#12A47E', body: '#FFFFFF', shade: '#0B7359', ink: '#1B2A28' }, // green
    { accent: '#F07B22', body: '#FFF6EC', shade: '#B4571339', ink: '#2A2118' }, // sunset orange
    { accent: '#6B4FD0', body: '#FAF7FF', shade: '#4A3596', ink: '#231E33' }, // violet
    { accent: '#2C3440', body: '#E9EDF3', shade: '#1B2029', ink: '#11151B' }, // charcoal
  ];

  // The host viewBox always starts at 0 0 even though each symbol carries its
  // own crop: <use> drops the symbol's viewport at the user-space origin, so a
  // shifted host box would push the aircraft off screen.
  // Seven airframes. Altitude, speed and contrail follow the real thing: the
  // heavy metal cruises high and leaves a trail, props and helicopters work
  // low down and leave nothing.
  // `lights` is given in each sprite's own viewBox units, not as a percentage
  // of the element. Percentages put the tail light of a helicopter wherever
  // the tail of an airliner happened to be, because the sprites have entirely
  // different proportions. In viewBox space every lamp sits on the airframe.
  const AIRCRAFT = [
    { type: 'jet', sprite: 'art-plane', viewBox: PLANE_VIEWBOX, width: [58, 106], top: [4, 20], speed: [30, 48], contrail: true, weight: 6,
      lights: { red: [7, 36], green: [126, 44], strobe: [64, 56] } },
    { type: 'jumbo', sprite: 'art-jumbo', viewBox: '0 0 186 96', width: [96, 148], top: [2, 12], speed: [44, 62], contrail: true, weight: 2,
      lights: { red: [10, 42], green: [172, 50], strobe: [88, 64] } },
    { type: 'widebody', sprite: 'art-widebody', viewBox: '0 0 168 92', width: [84, 132], top: [3, 15], speed: [40, 56], contrail: true, weight: 3,
      lights: { red: [9, 39], green: [156, 47], strobe: [78, 60] } },
    { type: 'regional', sprite: 'art-regional', viewBox: '0 0 120 88', width: [48, 74], top: [8, 26], speed: [24, 36], contrail: true, weight: 3,
      lights: { red: [7, 36], green: [90, 44], strobe: [50, 56] } },
    { type: 'bizjet', sprite: 'art-bizjet', viewBox: '0 0 112 88', width: [42, 64], top: [6, 22], speed: [20, 30], contrail: true, weight: 2,
      lights: { red: [7, 36], green: [76, 44], strobe: [44, 56] } },
    { type: 'prop', sprite: 'art-prop', viewBox: '0 0 126 96', width: [44, 70], top: [20, 40], speed: [24, 36], contrail: false, weight: 3,
      lights: { red: [9, 40], green: [98, 48], strobe: [54, 60] } },
    // Helicopters work the low airspace over the city, slow and trail-free.
    // Their beacon sits on the tail boom, not under a wing they do not have.
    { type: 'heli', sprite: 'art-heli', viewBox: '0 0 200 120', width: [46, 74], top: [30, 52], speed: [26, 40], contrail: false, weight: 2,
      lights: { red: [16, 66], green: [162, 70], strobe: [104, 96] } },
  ];


  function spawnPlane() {
    if (countFlyers('.plane') >= MAX_PLANES) return;

    const kind = pickWeighted(AIRCRAFT);
    const livery = pick(LIVERIES);
    const night = isNightScene();

    const plane = document.createElement('div');
    plane.className = 'flyer plane plane--' + kind.type + (night ? ' is-night' : '');
    // An airliner at cruise is above all of this, so every cloud nearer than
    // the far band crosses in front of it. That reads as height rather than as
    // the plane being tucked behind something.
    plane.dataset.band = '0';
    // Roughly a third of the traffic is heading the other way.
    if (Math.random() < 0.38) plane.classList.add('is-westbound');

    plane.style.top = rand(kind.top[0], kind.top[1]).toFixed(1) + '%';
    plane.style.width = rand(kind.width[0], kind.width[1]).toFixed(0) + 'px';
    plane.style.setProperty('--livery-accent', livery.accent);
    plane.style.setProperty('--livery-body', livery.body);
    plane.style.setProperty('--livery-shade', livery.shade);
    plane.style.setProperty('--livery-ink', livery.ink);

    // Lights are drawn into an overlay that shares the artwork's viewBox, so
    // their coordinates are airframe coordinates and hold at any rendered size.
    const L = kind.lights;
    const r = (Number(kind.viewBox.split(' ')[2]) / 46).toFixed(2);
    const lamp = (cls, at) => `<circle class="nav nav--${cls}" cx="${at[0]}" cy="${at[1]}" r="${r}"/>`;

    plane.innerHTML =
      (kind.contrail ? '<div class="plane__contrail"></div>' : '') +
      '<svg class="plane__art" viewBox="' + kind.viewBox + '"><use href="#' + kind.sprite + '"/></svg>' +
      '<svg class="plane__lights" viewBox="' + kind.viewBox + '">' +
        lamp('red', L.red) + lamp('green', L.green) + lamp('strobe', L.strobe) +
      '</svg>';
    launch(plane, rand(kind.speed[0], kind.speed[1]).toFixed(1), rand(-40, -10));
  }

  function sceneActive() {
    return theme !== 'amoled' && !reduceMotion;
  }

  function trafficAllowed() {
    // Birds do not fly through a downpour, and you cannot see much through
    // thick fog either.
    return sceneActive() && !document.hidden && weather.rain < 0.5 && weather.fog < 0.6;
  }

  // Birds roost after dark, so the night sky belongs to the aircraft.
  function scheduleBirds(delay) {
    if (!sceneActive()) return;
    birdTimeout = setTimeout(() => {
      if (trafficAllowed() && !isNightScene()) spawnFlock();
      // A long wait when nothing will be spawned anyway keeps timers cheap.
      scheduleBirds(isNightScene() ? rand(40000, 70000) : rand(6000, 15000));
    }, delay);
  }

  function schedulePlanes(delay) {
    if (!sceneActive()) return;
    planeTimeout = setTimeout(() => {
      if (trafficAllowed()) spawnPlane();
      // Night traffic runs much heavier, which is also when it is most visible.
      schedulePlanes(isNightScene() ? rand(9000, 22000) : rand(34000, 72000));
    }, delay);
  }
  function stopTraffic() {
    clearTimeout(birdTimeout);
    clearTimeout(planeTimeout);
    clearTimeout(meteorTimeout);
    clearTimeout(eclipseTimeout);
    // A running eclipse is deliberately left alone. It is a timed astronomical
    // event driven by wall clock, not by frames, so it survives a tab switch
    // and is picked up at whatever stage it has reached, exactly as the real
    // sky would. Ending it here meant glancing at another tab silently
    // cancelled a twelve minute event.
    birdTimeout = null;
    planeTimeout = null;
    meteorTimeout = null;
    eclipseTimeout = null;
    for (const el of els.skyTraffic.children) clearTimeout(el._expiry);
    els.skyTraffic.replaceChildren();
  }

  // Coming back to a tab that has been parked for an hour should look like a
  // sky, not a queue. Clear whatever survived and start the schedule fresh.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopTraffic();
    } else if (sceneActive()) {
      stopTraffic();
      scheduleBirds(rand(1200, 4000));
      schedulePlanes(rand(5000, 14000));
      scheduleMeteors(rand(18000, 55000));
      scheduleEclipse(rand(240000, 620000));
    }
  });

  // ---- Something to read ----------------------------------------------
  // Three flavours: a fact to chew on, a nudge to get out of the chair, and a
  // question worth thirty seconds. All bundled, so it works with no network.
  const TIDBITS = [
    ['Did you know', 'A day on Venus lasts longer than a year on Venus. It takes 243 Earth days to spin once, and 225 to go around the Sun.'],
    ['Did you know', 'Honey does not spoil. Sealed jars found in ancient Egyptian tombs were still edible thousands of years later.'],
    ['Did you know', 'Octopuses have three hearts and blue blood. Two hearts pump to the gills, one to the rest of the body.'],
    ['Did you know', 'The Eiffel Tower can stand about 15 cm taller in summer, because the iron expands in the heat.'],
    ['Did you know', 'Bananas are berries. Strawberries are not.'],
    ['Did you know', 'There are more possible games of chess than there are atoms in the observable universe.'],
    ['Did you know', 'Wombats produce cube-shaped droppings, which is how they stack them on rocks without rolling away.'],
    ['Did you know', 'Sharks are older than trees. Sharks have been around roughly 450 million years, trees about 390 million.'],
    ['Did you know', 'Cleopatra lived closer in time to the Moon landing than to the building of the Great Pyramid.'],
    ['Did you know', 'Oxford University was already teaching students before the Aztec Empire existed.'],
    ['Did you know', 'A group of flamingos is called a flamboyance.'],
    ['Did you know', "Scotland's national animal is the unicorn."],
    ['Did you know', 'The dot over a lowercase i or j has a name. It is called a tittle.'],
    ['Did you know', 'Nintendo was founded in 1889. For its first seventy years it made playing cards.'],
    ['Did you know', 'The shortest war on record lasted about forty minutes, between Britain and Zanzibar in 1896.'],
    ['Did you know', 'Sea otters sometimes hold hands while they sleep so the current does not drift them apart.'],
    ['Did you know', 'The man who invented the Pringles can asked to be buried in one. He was.'],
    ['Did you know', 'Antarctica is the largest desert on Earth. A desert is defined by how little falls, not by heat.'],
    ['Did you know', 'The Moon drifts about 3.8 cm further from Earth every year.'],
    ['Did you know', 'Sunlight takes roughly eight minutes and twenty seconds to reach you.'],
    ['Did you know', 'Saturn is less dense than water. Given a big enough bathtub, it would float.'],
    ['Did you know', 'There are more trees on Earth than there are stars in the Milky Way.'],
    ['Did you know', 'Iceland has no mosquitoes.'],
    ['Did you know', 'Bubble wrap was invented as textured wallpaper. Nobody wanted it for that.'],
    ['Did you know', 'The first recorded computer bug was a literal moth, taped into a logbook in 1947.'],
    ['Did you know', 'Norway has knighted a penguin. His name is Sir Nils Olav, and he lives in Edinburgh Zoo.'],
    ['Did you know', 'Finland has more saunas than cars.'],
    ['Did you know', 'The word quarantine comes from the Italian for forty days.'],
    ['Did you know', 'A pineapple takes about two years to grow.'],
    ['Did you know', 'Astronauts get a couple of inches taller in orbit, as the spine decompresses without gravity.'],
    ['Did you know', 'The Hawaiian alphabet has thirteen letters.'],
    ['Did you know', 'That smell after rain has a name. Petrichor, from the Greek for stone and the blood of the gods.'],
    ['Did you know', 'The Statue of Liberty started out shiny copper. The green is a century of weathering.'],
    ['Did you know', 'Butterflies taste with their feet.'],
    ['Did you know', 'A shrimp keeps its heart in its head.'],
    ['Did you know', 'Time runs very slightly faster at your head than at your feet. It has been measured.'],
    ['Did you know', 'The longest recorded chicken flight lasted thirteen seconds.'],
    ['Did you know', 'A jiffy is a real unit of time, though what it equals depends on who you ask.'],
    ['Did you know', 'Some snails can sleep for up to three years when conditions get dry.'],
    ['Did you know', 'Roughly half the cells you are carrying around are not human. Most of the rest are bacteria.'],

    ['Did you know', 'A meteor gets its colour from what is burning off it. Sodium glows amber, magnesium blue-green, calcium violet, and the shocked air adds red.'],
    ['Did you know', 'Most meteors are smaller than a grain of rice. The streak is air being crushed and heated, not the rock itself glowing.'],
    ['Did you know', 'About 48 tonnes of meteoritic material hits the Earth every day, almost all of it as dust.'],
    ['Did you know', 'The Milky Way looks like a band because we are inside the disc, looking along it from within.'],
    ['Did you know', 'The dark lane splitting the Milky Way is not empty. It is dust, blocking the light of the stars behind it.'],
    ['Did you know', 'Aircraft carry a red light on the left wing and a green one on the right, so you can tell which way one is heading in the dark.'],
    ['Did you know', 'Contrails are clouds. Engine exhaust adds water vapour to air already cold enough to freeze it.'],
    ['Did you know', 'The Sun makes up about 99.86 per cent of all the mass in the solar system.'],
    ['Did you know', 'Betelgeuse is so large that if it replaced the Sun, it would swallow the orbit of Mars.'],
    ['Did you know', 'There is no sound in space, because sound needs something to travel through and there is almost nothing there.'],
    ['Did you know', 'A day on Mars is 24 hours 37 minutes, which is why Mars mission crews drift out of sync with Earth.'],
    ['Did you know', 'Neutron star material is so dense that a teaspoon of it would weigh about a billion tonnes.'],
    ['Did you know', 'Venus spins backwards. On Venus the Sun rises in the west.'],
    ['Did you know', 'Jupiter has no surface to stand on. The gas just gets thicker until it becomes liquid.'],
    ['Did you know', 'Light from the nearest star after the Sun takes four years and three months to get here.'],
    ['Did you know', 'The tallest known mountain in the solar system is on Mars, and it is nearly three times the height of Everest.'],
    ['Did you know', 'Skyscrapers sway on purpose. A rigid tower would tear itself apart in high wind.'],
    ['Did you know', 'The Empire State Building has its own postcode.'],
    ['Did you know', 'Seagulls can drink seawater. Glands above their eyes strip the salt back out.'],
    ['Did you know', 'Birds have hollow bones braced with internal struts, which is how they stay both light and strong.'],
    ['Did you know', 'Migrating birds fly in a V because each one rides the upwash off the wingtip ahead, saving energy.'],
    ['Did you know', 'Some swifts stay airborne for ten months at a stretch, eating and even sleeping on the wing.'],
    ['Did you know', 'The albatross can glide for hours without flapping, using the wind gradient just above the waves.'],
    ['Did you know', 'Clouds are not weightless. An average cumulus holds roughly the water of a hundred elephants.'],
    ['Did you know', 'The sky is blue because air scatters short wavelengths hardest. At sunset the light travels further, so only the reds survive.'],
    ['Did you know', 'Golden hour is warm because low sunlight passes through much more atmosphere, which filters out the blue.'],
    ['Did you know', 'The Moon is drifting away fast enough that total solar eclipses will eventually stop happening.'],
    ['Did you know', 'Every atom of iron in your blood was forged inside a star that died before the Sun existed.'],

    ['Two minute break', 'Look at something twenty feet away for twenty seconds. Your eyes have been locked at one distance for a while.'],
    ['Two minute break', 'Stand up. Roll your shoulders back five times, slowly.'],
    ['Two minute break', 'Drink a glass of water. You probably have not in a while.'],
    ['Two minute break', 'Unclench your jaw. Drop your shoulders. They crept up again.'],
    ['Two minute break', 'Four slow breaths, and make the exhale longer than the inhale.'],
    ['Two minute break', 'Walk to the farthest window and look outside for a minute.'],
    ['Two minute break', 'Stretch your wrists, fifteen seconds each way. You have been typing for hours.'],
    ['Two minute break', 'Close your eyes and name five sounds you can hear right now.'],
    ['Two minute break', 'Fix your setup: feet flat, back supported, screen at eye level.'],
    ['Two minute break', 'Message someone you like, for no reason at all.'],
    ['Two minute break', 'Tidy exactly one small thing on your desk. Just one.'],
    ['Two minute break', 'Five slow neck rolls each direction. Stop if anything pinches.'],
    ['Two minute break', 'Step outside for two minutes, if you can get away with it.'],

    ['Worth a thought', 'What is the one task you keep avoiding? It is probably about ten minutes long.'],
    ['Worth a thought', 'Name three things that went right today. Small ones count.'],
    ['Worth a thought', 'If the day ended right now, what would you be glad you got done?'],
    ['Worth a thought', 'Pick one thing off your list and delete it. Nothing will happen.'],
    ['Worth a thought', 'What would you do with one extra hour tonight?'],
    ['Worth a thought', 'Write down the thing you keep meaning to remember, before it goes again.'],
    ['Worth a thought', 'Who made your day easier today? Consider telling them.'],
    ['Worth a thought', 'What is the first thing you want to do when you walk through the door?'],
    ['Worth a thought', 'If tomorrow had room for one task only, which would you pick?'],
    ['Worth a thought', 'What are you doing now that will not matter at all in a week?'],
    ['Worth a thought', 'What would the version of you from five years ago be impressed by right now?'],
    ['Worth a thought', 'Is the thing stressing you a problem, or just an unmade decision?'],
    ['Worth a thought', 'What is one thing you could stop doing entirely, with nobody noticing?'],
    ['Worth a thought', 'Who would you ask for help, if asking were free?'],
    ['Worth a thought', 'What did you learn today? Anything counts.'],
    ['Worth a thought', 'If this week were a chapter, what would it be called?'],

    ['Two minute break', 'Look up. Actually look up, out of a window if there is one.'],
    ['Two minute break', 'Put both feet flat on the floor and take one very slow breath.'],
    ['Two minute break', 'Roll your ankles under the desk. They have been still for hours.'],
    ['Two minute break', 'Wash your hands with cold water and dry them properly. It resets you more than it should.'],
    ['Two minute break', 'Clear the tabs you are not using. All of them.'],
    ['Two minute break', 'Stand and reach overhead for ten seconds. Your spine has been compressing all day.'],
    ['Two minute break', "Write tomorrow's first task on paper, so you can stop holding it."],
  ];

  const TIDBIT_KEY = 'homeStretch.tidbits';
  const TIDBIT_ROTATE_MS = 60000;

  const tidbitEls = {
    panel: document.getElementById('tidbit'),
    kicker: document.getElementById('tidbitKicker'),
    text: document.getElementById('tidbitText'),
    next: document.getElementById('tidbitNext'),
    hide: document.getElementById('tidbitHide'),
    show: document.getElementById('tidbitShow'),
  };

  // Draw without replacement so you see the whole set before anything repeats.
  let tidbitBag = [];
  let tidbitTimer = null;

  function drawTidbit() {
    if (!tidbitBag.length) {
      tidbitBag = TIDBITS.map((_, i) => i);
      for (let i = tidbitBag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [tidbitBag[i], tidbitBag[j]] = [tidbitBag[j], tidbitBag[i]];
      }
    }
    return TIDBITS[tidbitBag.pop()];
  }

  function showTidbit(animated) {
    const [kicker, text] = drawTidbit();
    const paint = () => {
      tidbitEls.kicker.textContent = kicker;
      tidbitEls.text.textContent = text;
      tidbitEls.panel.classList.remove('is-swapping');
    };
    if (animated && !reduceMotion) {
      tidbitEls.panel.classList.add('is-swapping');
      setTimeout(paint, 320);
    } else {
      paint();
    }
  }

  function restartTidbitTimer() {
    clearInterval(tidbitTimer);
    tidbitTimer = setInterval(() => {
      // No point burning through the set while the tab is in the background.
      if (!document.hidden) showTidbit(true);
    }, TIDBIT_ROTATE_MS);
  }

  function setTidbitsVisible(visible) {
    tidbitEls.panel.hidden = !visible;
    tidbitEls.show.hidden = visible;
    try { localStorage.setItem(TIDBIT_KEY, visible ? 'on' : 'off'); }
    catch (e) { /* continue without persistence */ }
    if (visible) restartTidbitTimer(); else clearInterval(tidbitTimer);
  }

  tidbitEls.next.addEventListener('click', () => { showTidbit(true); restartTidbitTimer(); });
  tidbitEls.hide.addEventListener('click', () => setTidbitsVisible(false));
  tidbitEls.show.addEventListener('click', () => { showTidbit(false); setTidbitsVisible(true); });

  // ---- Reminder when the day ends -------------------------------------
  const NOTIFY_KEY = 'homeStretch.notify';
  const NOTIFY_FIRED_KEY = 'homeStretch.notifyFired';
  const notifySupported = 'Notification' in window;

  const remindEls = {
    btn: document.getElementById('remindToggle'),
    label: document.getElementById('remindToggleLabel'),
    note: document.getElementById('actionsNote'),
  };

  let notifyOn = false;
  try { notifyOn = localStorage.getItem(NOTIFY_KEY) === 'on'; } catch (e) { /* default off */ }
  if (!notifySupported || (notifyOn && Notification.permission !== 'granted')) notifyOn = false;

  function setNote(text) {
    remindEls.note.textContent = text || '';
    remindEls.note.hidden = !text;
  }

  function renderRemind() {
    remindEls.btn.setAttribute('aria-pressed', String(notifyOn));
    remindEls.label.textContent = notifyOn ? 'Reminder on' : 'Remind me';
  }

  function setNotify(on) {
    notifyOn = on;
    try { localStorage.setItem(NOTIFY_KEY, on ? 'on' : 'off'); } catch (e) { /* no persistence */ }
    renderRemind();
  }

  if (!notifySupported) {
    remindEls.btn.disabled = true;
    remindEls.label.textContent = 'Reminders unavailable';
  } else {
    remindEls.btn.addEventListener('click', async () => {
      if (notifyOn) { setNotify(false); setNote(''); return; }

      if (Notification.permission === 'denied') {
        setNote('Notifications are blocked for this site. Allow them in your browser settings, then try again.');
        return;
      }
      const result = Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission();

      if (result === 'granted') {
        setNotify(true);
        setNote('You will get a notification at going-home time, as long as this page is still open.');
      } else {
        setNote('Permission was not granted, so no reminder can be sent.');
      }
    });
  }

  // Keyed on the exact end instant, so it fires once per workday even if the
  // page is reloaded, and never for a day that ended hours ago.
  function maybeAnnounceEnd(now, end, pastEnd, workToday) {
    if (!pastEnd || !workToday) return;
    if (!notifyOn && !chimeOn) return;
    if (now - end > 5 * 60 * 1000) return;

    const key = String(+end);
    try {
      if (localStorage.getItem(NOTIFY_FIRED_KEY) === key) return;
      localStorage.setItem(NOTIFY_FIRED_KEY, key);
    } catch (e) { /* without storage it may repeat on reload */ }

    if (chimeOn) playChime();
    if (!notifyOn) return;

    try {
      new Notification("That's the day done", {
        body: `It is ${formatClock(end)}. Go home.`,
        icon: 'icons/icon-192.png',
        badge: 'icons/icon-192.png',
        tag: 'home-stretch-end',
      });
    } catch (e) { /* some platforms need a service worker registration instead */ }
  }

  // ---- Chime -----------------------------------------------------------
  // Synthesised rather than loaded, so there is no audio file to ship and no
  // request to make. A rising triad on soft sines, each one decaying away.
  const CHIME_KEY = 'homeStretch.chime';
  const CHIME_NOTES = [
    { at: 0.00, hz: 587.33 }, // D5
    { at: 0.13, hz: 880.00 }, // A5
    { at: 0.27, hz: 1174.66 }, // D6
  ];

  const chimeEls = {
    btn: document.getElementById('chimeToggle'),
    label: document.getElementById('chimeToggleLabel'),
  };

  let chimeOn = false;
  try { chimeOn = localStorage.getItem(CHIME_KEY) === 'on'; } catch (e) { /* default off */ }

  let audioCtx = null;
  const audioSupported = 'AudioContext' in window || 'webkitAudioContext' in window;

  function ensureAudio() {
    if (!audioSupported) return null;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!audioCtx) audioCtx = new Ctor();
    // Browsers suspend contexts created outside a gesture; nudge it awake.
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return audioCtx;
  }

  function playChime() {
    const ctx = ensureAudio();
    if (!ctx) return;

    const tone = ctx.createGain();
    tone.gain.value = 0.16;

    const soften = ctx.createBiquadFilter();
    soften.type = 'lowpass';
    soften.frequency.value = 2600;

    tone.connect(soften).connect(ctx.destination);

    for (const note of CHIME_NOTES) {
      const t = ctx.currentTime + note.at;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = note.hz;
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(1, t + 0.012);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 1.9);
      osc.connect(env).connect(tone);
      osc.start(t);
      osc.stop(t + 2);
    }
  }

  function renderChime() {
    chimeEls.btn.setAttribute('aria-pressed', String(chimeOn));
    chimeEls.label.textContent = chimeOn ? 'Chime on' : 'Chime';
  }

  if (!audioSupported) {
    chimeEls.btn.disabled = true;
  } else {
    chimeEls.btn.addEventListener('click', () => {
      chimeOn = !chimeOn;
      try { localStorage.setItem(CHIME_KEY, chimeOn ? 'on' : 'off'); } catch (e) { /* no persistence */ }
      renderChime();
      // Turning it on is a user gesture, so this both unlocks audio and
      // lets you hear what you have signed up for.
      if (chimeOn) playChime();
    });
  }

  // ---- Milestones ------------------------------------------------------
  const MILESTONES = [
    { key: 0.25, at: 0.25, text: 'A quarter of the way through.' },
    { key: 0.5, at: 0.5, text: "Halfway. It's downhill from here." },
    { key: 0.75, at: 0.75, text: 'Three quarters done.' },
  ];
  const FLOURISH_MS = 7000;

  let announced = null;       // null until the first tick adopts the current state
  let flourishText = '';
  let flourishUntil = 0;

  // Editing the schedule moves progress artificially, which is neither
  // something to congratulate anyone for nor a day that just ended. Adopt the
  // new state silently: forget the announced milestones, and if the edited day
  // is already over, record it as announced so nothing chimes for it.
  function adoptScheduleChange() {
    announced = null;
    flourishUntil = 0;

    const now = new Date();
    const { end } = dayWindow(now);
    if (now >= end) {
      try { localStorage.setItem(NOTIFY_FIRED_KEY, String(+end)); }
      catch (e) { /* without storage the worst case is one extra chime */ }
    }
  }

  function updateMilestones(p, remainingMs, running) {
    const reached = new Set();
    if (running) {
      for (const m of MILESTONES) if (p >= m.at) reached.add(m.key);
      if (remainingMs <= 60 * 1000) reached.add('final');
    }

    // On the first tick we adopt whatever has already passed, silently, so
    // opening the page at 4pm does not replay the whole day.
    if (announced === null) { announced = reached; return; }

    for (const key of reached) {
      if (announced.has(key)) continue;
      const found = MILESTONES.find(m => m.key === key);
      flourishText = found ? found.text : 'Under a minute. Start packing up.';
      flourishUntil = Date.now() + FLOURISH_MS;
    }
    // Re-arm anything the progress has fallen back below, e.g. after an edit.
    announced = reached;
  }

  // ---- Status copy -----------------------------------------------------
  const GRACE_MS = 10 * 60 * 1000; // how long past the end still counts as "done"

  function statusMessage(p, notStarted, lunch, now) {
    if (Date.now() < flourishUntil) return flourishText;
    if (notStarted) return "Workday hasn't started yet.";
    if (lunch && now >= lunch.start && now < lunch.end) {
      return `Lunch break. Back at ${formatClock(lunch.end)}.`;
    }
    if (p < 0.25) return 'Just getting going.';
    if (p < 0.5) return 'Steady progress.';
    if (p < 0.75) return 'Past the halfway point.';
    if (p < 0.95) return 'Home stretch, almost there.';
    return 'So close now.';
  }

  function overtimeMessage(overMs) {
    const mins = overMs / 60000;
    if (mins < 10) return "That's the day done. Go home.";
    if (mins < 30) return 'Still here? Your hours ended a while ago.';
    if (mins < 60) return 'Over half an hour past. Whatever it is, it will keep.';
    if (mins < 120) return 'More than an hour past your hours.';
    return 'This is a long way past going-home time.';
  }

  // ---- Tab title -------------------------------------------------------
  // Coarse on purpose: a title that ticks every second is distracting, and the
  // browser only shows a few characters anyway.
  function shortDuration(ms) {
    const totalMins = Math.max(0, Math.floor(ms / 60000));
    const h = Math.floor(totalMins / 60);
    return h ? `${h}:${pad2(totalMins % 60)}` : `${totalMins} min`;
  }

  let lastTitle = '';
  function setTitle(text) {
    const full = text ? `${text} · Home Stretch` : 'Home Stretch';
    if (full !== lastTitle) {
      document.title = full;
      lastTitle = full;
    }
  }

  function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return [h, m, s].map(pad2).join(':');
  }

  function minutesToday(mins, base) {
    const d = new Date(base);
    d.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
    return d;
  }

  function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  }

  // The pair of instants bounding the shift that `now` belongs to, along with
  // the weekday config those hours came from.
  function dayWindow(now) {
    const todayIndex = now.getDay();
    const today = schedule.days[todayIndex];
    let start = minutesToday(today.start, now);
    let end = minutesToday(today.end, now);
    if (end <= start) end = addDays(end, 1); // overnight shift

    // A shift that began yesterday, on yesterday's hours, may still be running.
    const yesterdayIndex = (todayIndex + 6) % 7;
    const yesterday = schedule.days[yesterdayIndex];
    const prevStart = addDays(minutesToday(yesterday.start, now), -1);
    let prevEnd = addDays(minutesToday(yesterday.end, now), -1);
    if (prevEnd <= prevStart) prevEnd = addDays(prevEnd, 1);

    if (yesterday.on && now < start && now >= prevStart && now < prevEnd) {
      return { start: prevStart, end: prevEnd, cfg: yesterday, dayIndex: yesterdayIndex };
    }
    return { start, end, cfg: today, dayIndex: todayIndex };
  }

  // Lunch as an absolute interval, anchored to the shift and clipped to it.
  // Returns null when lunch is off or falls entirely outside the workday.
  function lunchWindow(start, end, cfg) {
    if (!cfg || !cfg.lunchOn) return null;

    let ls = minutesToday(cfg.lunchStart, start);
    let le = minutesToday(cfg.lunchEnd, start);
    if (le <= ls) le = addDays(le, 1);
    if (ls < start) { ls = addDays(ls, 1); le = addDays(le, 1); }

    const clippedStart = Math.max(+ls, +start);
    const clippedEnd = Math.min(+le, +end);
    return clippedEnd > clippedStart
      ? { start: new Date(clippedStart), end: new Date(clippedEnd) }
      : null;
  }

  function overlapMs(from, to, window) {
    if (!window) return 0;
    return Math.max(0, Math.min(+to, +window.end) - Math.max(+from, +window.start));
  }

  // ---- Work days -------------------------------------------------------
  function anyWorkDays() { return schedule.days.some(d => d.on); }

  // A shift belongs to the day it starts on, so an overnight Friday shift
  // still counts as Friday once the clock has rolled past midnight.
  function isWorkDay(dayIndex) { return schedule.days[dayIndex].on === true; }

  function nextWorkStart(now) {
    if (!anyWorkDays()) return null;
    for (let i = 0; i < 8; i++) {
      const date = addDays(now, i);
      const cfg = schedule.days[date.getDay()];
      if (!cfg.on) continue;
      // Each day opens on its own hours, not one shared clock-in time.
      const candidate = minutesToday(cfg.start, date);
      if (candidate > now) return candidate;
    }
    return null;
  }

  function relativeDayName(target, now) {
    const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const days = Math.round((midnight(target) - midnight(now)) / 86400000);
    if (days === 0) return 'later today';
    if (days === 1) return 'tomorrow';
    return target.toLocaleDateString(undefined, { weekday: 'long' });
  }

  // The picker is built here so the labels and the week's starting day come
  // from the reader's locale rather than being hard-coded to Monday.
  function weekStartDay() {
    try {
      const locale = new Intl.Locale(navigator.language);
      const info = typeof locale.getWeekInfo === 'function' ? locale.getWeekInfo() : locale.weekInfo;
      if (info && Number.isInteger(info.firstDay)) return info.firstDay % 7; // 7 means Sunday
    } catch (e) { /* fall through to Monday */ }
    return 1;
  }

  const weekdaysEl = document.getElementById('weekdays');
  const dayButtons = [];

  (function buildWeekdayPicker() {
    const first = weekStartDay();
    // 4 Jan 1970 was a Sunday, which makes it a convenient index-to-name base.
    for (let i = 0; i < 7; i++) {
      const index = (first + i) % 7;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'weekday';
      btn.dataset.day = String(index);
      btn.innerHTML = '<span aria-hidden="true">' + dayName(index, { weekday: 'narrow' }) + '</span>'
        + '<span class="sr-only">' + dayName(index, { weekday: 'long' }) + '</span>';
      weekdaysEl.appendChild(btn);
      dayButtons.push(btn);
    }
  })();

  function renderWeekdays() {
    for (const btn of dayButtons) {
      btn.setAttribute('aria-pressed', String(isWorkDay(Number(btn.dataset.day))));
    }
  }

  // ---- Hours mode: one schedule for the week, or one per day -----------
  const hoursModeEl = document.getElementById('hoursMode');
  const dayTabsEl = document.getElementById('dayTabs');

  function dayName(index, opts) {
    return new Date(1970, 0, 4 + index).toLocaleDateString(undefined, opts);
  }

  function renderHoursMode() {
    for (const btn of hoursModeEl.querySelectorAll('.seg-btn')) {
      btn.setAttribute('aria-pressed', String((btn.dataset.mode === 'uniform') === schedule.uniform));
    }
    dayTabsEl.hidden = schedule.uniform;
    if (schedule.uniform) return;

    // Only worked days get a tab; there are no hours to set for a day off.
    const frag = document.createDocumentFragment();
    schedule.days.forEach((day, index) => {
      if (!day.on) return;
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'daytab';
      tab.dataset.day = String(index);
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(index === editingDay));
      tab.textContent = dayName(index, { weekday: 'short' });
      frag.appendChild(tab);
    });
    dayTabsEl.replaceChildren(frag);
  }

  hoursModeEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    const uniform = btn.dataset.mode === 'uniform';
    if (uniform === schedule.uniform) return;

    schedule.uniform = uniform;
    // Switching back to one shared schedule copies the day on screen outward,
    // rather than silently picking one of seven.
    if (uniform) {
      const source = editedDay();
      for (const day of schedule.days) {
        day.start = source.start;
        day.end = source.end;
        day.lunchOn = source.lunchOn;
        day.lunchStart = source.lunchStart;
        day.lunchEnd = source.lunchEnd;
      }
    }
    saveSettings();
    renderHoursMode();
    renderFields();
    renderLunchToggle();
    adoptScheduleChange();
    tick();
  });

  dayTabsEl.addEventListener('click', (e) => {
    const tab = e.target.closest('.daytab');
    if (!tab) return;
    editingDay = Number(tab.dataset.day);
    renderHoursMode();
    renderFields();
    renderLunchToggle();
  });

  weekdaysEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.weekday');
    if (!btn) return;
    const index = Number(btn.dataset.day);
    schedule.days[index].on = !schedule.days[index].on;
    // Keep the hours editor pointed at a day that is actually worked.
    if (schedule.days[index].on) editingDay = index;
    else if (!schedule.days[editingDay].on) {
      const firstOn = schedule.days.findIndex(d => d.on);
      if (firstOn >= 0) editingDay = firstOn;
    }
    renderFields();
    renderLunchToggle();
    renderHoursMode();
    saveSettings();
    renderWeekdays();
    adoptScheduleChange();
    tick();
  });

  // ---- Week progress ---------------------------------------------------
  // On a Wednesday afternoon the other question is how much of the week is
  // left, so the worked days get their own row: filled behind you, hollow
  // ahead, and the current day carries the day's own progress.
  const weekEl = document.getElementById('week');
  let weekSignature = '';

  function renderWeek(now, todayIndex, dayProgress, isDayOff) {
    const worked = schedule.days
      .map((day, index) => ({ index, on: day.on }))
      .filter(d => d.on);

    // Rebuild only when the shape changes; the fill updates every tick.
    const signature = worked.map(d => d.index).join(',') + '|' + weekStartDay();
    if (signature !== weekSignature) {
      weekSignature = signature;
      const first = weekStartDay();
      const ordered = worked.slice().sort(
        (a, b) => ((a.index - first + 7) % 7) - ((b.index - first + 7) % 7)
      );
      weekEl.replaceChildren(...ordered.map(d => {
        const mark = document.createElement('span');
        mark.className = 'week__day';
        mark.dataset.day = String(d.index);
        // The initial makes the row self-explanatory and stops it reading as a
        // second, unlabelled copy of the day's progress bar.
        mark.innerHTML = '<i class="week__track"><i class="week__fill"></i></i>'
          + '<b class="week__letter">' + dayName(d.index, { weekday: 'narrow' }) + '</b>';
        mark.title = dayName(d.index, { weekday: 'long' });
        return mark;
      }));
    }

    // Where the current day sits in the week, measured from the week's start.
    const first = weekStartDay();
    const position = (todayIndex - first + 7) % 7;
    for (const mark of weekEl.children) {
      const index = Number(mark.dataset.day);
      const at = (index - first + 7) % 7;
      const isToday = index === todayIndex && !isDayOff;
      const fill = at < position ? 1 : (isToday ? dayProgress : 0);
      mark.classList.toggle('is-today', isToday);
      mark.querySelector('.week__fill').style.transform = `scaleX(${fill.toFixed(3)})`;
      // Days already behind you read at full strength; days ahead stay quiet.
      mark.querySelector('.week__letter').style.opacity = at < position ? '0.8' : '';
    }
  }

  // ---- Location, for an accurate sunrise and sunset --------------------
  const locationEls = {
    btn: document.getElementById('locationToggle'),
    label: document.getElementById('locationLabel'),
    note: document.getElementById('locationNote'),
  };

  function describeSun() {
    const { sunrise, sunset } = daylightWindow(new Date());
    const asClock = (h) => formatMinutes(Math.round(((h % 24) + 24) % 24 * 60));
    return `Sunrise ${asClock(sunrise)}, sunset ${asClock(sunset)}.`;
  }

  // A sky with nothing in it is a fair reading of a clear forecast, but from
  // the outside it is indistinguishable from something being broken. So the
  // panel says what was read, for which point, and from where it came.
  function describeWeatherReading() {
    const w = weather;
    const grid = forecastGrid();
    const where = Math.abs(grid.lat).toFixed(1) + (grid.lat >= 0 ? 'N' : 'S') + ' '
                + Math.abs(grid.lon).toFixed(1) + (grid.lon >= 0 ? 'E' : 'W');

    if (w.source !== 'forecast' || !w.reading) {
      return 'No forecast reached this device, so the sky is generated from the date and '
           + where + '. It will not match what is outside your window.';
    }

    const r = w.reading;
    const pct = (v) => Math.round(v) + '%';
    const parts = ['Open-Meteo for ' + where + ', to the nearest tenth of a degree.'];
    parts.push('Cloud ' + pct(r.all) + ': ' + pct(r.low) + ' low, ' + pct(r.mid) + ' middle, '
             + pct(r.high) + ' high.');
    if (r.precipitation >= 0.05) parts.push('Rain ' + r.precipitation.toFixed(1) + ' mm an hour.');
    parts.push('Visibility ' + (r.visibility >= 1000
      ? Math.round(r.visibility / 1000) + ' km.' : Math.round(r.visibility) + ' m.'));
    if (r.all < 10 && !alwaysCloudy) {
      parts.push('That is a clear sky, which is why there are no clouds in it. '
               + 'Always cloudy overrides that.');
    }
    if (!place.exact) parts.push('Position is estimated from your time zone; sharing your location will sharpen it.');
    return parts.join(' ');
  }

  let lastWeatherNote = '';

  function renderWeatherNote() {
    const text = describeWeatherReading();
    if (text === lastWeatherNote) return;
    lastWeatherNote = text;
    if (weatherEls.note) weatherEls.note.textContent = text;
  }

  const weatherEls = {
    btn: document.getElementById('cloudToggle'),
    label: document.getElementById('cloudToggleLabel'),
    note: document.getElementById('weatherNote'),
  };

  function renderClouds() {
    if (!weatherEls.btn) return;
    weatherEls.btn.setAttribute('aria-pressed', String(alwaysCloudy));
    weatherEls.label.textContent = alwaysCloudy ? 'Always cloudy' : 'Follow the forecast';
  }

  if (weatherEls.btn) {
    weatherEls.btn.addEventListener('click', () => {
      alwaysCloudy = !alwaysCloudy;
      try { localStorage.setItem(CLOUDS_KEY, alwaysCloudy ? 'always' : 'weather'); }
      catch (e) { /* no persistence */ }
      renderClouds();
      lastWeatherNote = '';
      tick();
    });
  }

  function renderLocation() {
    locationEls.btn.setAttribute('aria-pressed', String(place.exact));
    locationEls.label.textContent = place.exact ? 'Using your location' : 'Use my location';
    locationEls.note.textContent = place.exact
      ? describeSun()
      : `Estimated from your time zone. ${describeSun()}`;
  }

  if (!('geolocation' in navigator)) {
    locationEls.btn.disabled = true;
  } else {
    locationEls.btn.addEventListener('click', () => {
      if (place.exact) {
        // Turning it off returns to the time-zone estimate and forgets the fix.
        try { localStorage.removeItem(LOCATION_KEY); } catch (e) { /* nothing to clear */ }
        place = loadLocation();
        solarCache = { key: '', value: null };
        renderLocation();
        tick();
        return;
      }

      locationEls.note.textContent = 'Asking your browser for a rough position...';
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          place = { lat: pos.coords.latitude, lon: pos.coords.longitude, exact: true };
          // Only latitude and longitude are kept, and only on this device.
          try { localStorage.setItem(LOCATION_KEY, JSON.stringify({ lat: place.lat, lon: place.lon })); }
          catch (e) { /* continue without persistence */ }
          solarCache = { key: '', value: null };
          lastWeatherNote = '';
          renderLocation();
          tick();
        },
        () => {
          locationEls.note.textContent = 'Location was not shared, so the sky stays on the time-zone estimate.';
        },
        { timeout: 10000, maximumAge: 3600000 }
      );
    });
  }

  // ---- Compact card ----------------------------------------------------
  // Shrinks the card to the countdown alone, which is all it needs to be once
  // the schedule is set. It also hands the sky back most of the screen.
  const COMPACT_KEY = 'homeStretch.compact';
  const compactBtn = document.getElementById('compactToggle');

  // Three sizes rather than two. The whole card, then the number and its bar,
  // then a pill at the top of the screen: small enough and far enough out of
  // the middle that the sky underneath is the thing you are looking at.
  const CARD_SIZES = ['full', 'compact', 'pill'];
  const SIZE_LABEL = {
    full: 'Shrink the card',
    compact: 'Shrink to a pill',
    pill: 'Bring the card back',
  };

  let cardSize = 'full';
  try {
    const saved = localStorage.getItem(COMPACT_KEY);
    // 'on' and 'off' are what the two-size version wrote, so anyone who had it
    // shrunk stays shrunk rather than being expanded out from under them.
    cardSize = saved === 'on' ? 'compact'
      : CARD_SIZES.indexOf(saved) >= 0 ? saved : 'full';
  } catch (e) { /* default open */ }

  function setCardSize(size, persist) {
    cardSize = CARD_SIZES.indexOf(size) >= 0 ? size : 'full';
    els.card.classList.toggle('is-compact', cardSize === 'compact');
    els.card.classList.toggle('is-pill', cardSize === 'pill');
    compactBtn.setAttribute('aria-pressed', String(cardSize !== 'full'));
    compactBtn.setAttribute('aria-label', SIZE_LABEL[cardSize]);
    if (persist !== false) {
      try { localStorage.setItem(COMPACT_KEY, cardSize); }
      catch (e) { /* continue without persistence */ }
    }
  }

  // One control for all three, so it is always the same button in the same
  // place. From the pill it goes back to the whole card rather than stepping
  // back through compact, because that is what you want after watching the sky.
  function cycleCardSize() {
    setCardSize(CARD_SIZES[(CARD_SIZES.indexOf(cardSize) + 1) % CARD_SIZES.length]);
  }

  compactBtn.addEventListener('click', cycleCardSize);

  // ---- Settings panel --------------------------------------------------
  // Settings is a floating dialog over a backdrop, not content inside the
  // card, so opening it never stretches the countdown down the page.
  const settingsEls = {
    btn: document.getElementById('settingsToggle'),
    panel: document.getElementById('settings'),
    closeBtn: document.getElementById('settingsClose'),
    backdrop: document.getElementById('modalBackdrop'),
  };

  let settingsCloseTimer = null;

  function setSettingsOpen(open) {
    clearTimeout(settingsCloseTimer);
    settingsEls.btn.setAttribute('aria-expanded', String(open));

    if (open) {
      settingsEls.panel.hidden = false;
      els.card.classList.add('is-settings-open');
      // Force a layout flush so removing `hidden` and adding `is-open` land
      // in separate frames — otherwise the browser coalesces them and the
      // entrance transition never plays.
      void settingsEls.panel.offsetWidth;
      settingsEls.panel.classList.add('is-open');
      settingsEls.backdrop.classList.add('is-open');
      settingsCloseTimer = setTimeout(() => settingsEls.closeBtn.focus(), reduceMotion ? 0 : 220);
    } else {
      const wasOpen = !settingsEls.panel.hidden;
      settingsEls.panel.classList.remove('is-open');
      settingsEls.backdrop.classList.remove('is-open');
      els.card.classList.remove('is-settings-open');
      settingsCloseTimer = setTimeout(() => { settingsEls.panel.hidden = true; }, reduceMotion ? 0 : 220);
      if (wasOpen && settingsEls.panel.contains(document.activeElement)) settingsEls.btn.focus();
    }
  }

  settingsEls.btn.addEventListener('click', () => setSettingsOpen(settingsEls.panel.hidden));
  settingsEls.closeBtn.addEventListener('click', () => setSettingsOpen(false));
  settingsEls.backdrop.addEventListener('click', () => setSettingsOpen(false));

  // ---- Keyboard shortcuts ---------------------------------------------
  // Skipped while typing, and while a control has focus, so the keys never
  // fight with the thing the user is actually operating.
  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTypingTarget(e.target)) return;

    if (e.key === 'Escape' && !settingsEls.panel.hidden) {
      setSettingsOpen(false);
      settingsEls.btn.focus();
      return;
    }

    // e.code is checked too: it names the physical key, so it survives layouts
    // that put something else on the spacebar's key value.
    if (e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar') {
      // Space still belongs to a focused button, whatever that button is.
      if (document.activeElement && document.activeElement.tagName === 'BUTTON') return;
      e.preventDefault();
      if (tidbitEls.panel.hidden) setTidbitsVisible(true);
      showTidbit(true);
      restartTidbitTimer();
      return;
    }

    switch ((e.key || '').toLowerCase()) {
      case 'l': setTheme('light'); break;
      case 'd': setTheme('dark'); break;
      case 'a': setTheme('amoled'); break;
      case 'h': setFormat(timeFormat === '12' ? '24' : '12'); break;
      case 's': setSettingsOpen(settingsEls.panel.hidden); break;
      case 'm': cycleCardSize(); break;
      default: return;
    }
    e.preventDefault();
  });

  // ---- Path length for the office to home arc -------------------------
  const pathLength = els.arcPath.getTotalLength();
  els.arcFill.style.strokeDasharray = String(pathLength);

  // ---- Main tick ---------------------------------------------------
  function tick() {
    const now = new Date();

    const { start, end, cfg } = dayWindow(now);
    const lunch = lunchWindow(start, end, cfg);

    const remainingMs = end - now;
    const overMs = now - end;
    const notStarted = now < start;
    const pastEnd = now >= end;
    const workToday = isWorkDay(start.getDay());
    const dayOff = !workToday;

    // Progress measures time actually worked, so it holds still over lunch.
    const totalWorkMs = (end - start) - overlapMs(start, end, lunch);
    const cappedNow = Math.min(+now, +end);
    const workedMs = Math.max(0, cappedNow - start) - overlapMs(start, cappedNow, lunch);
    const p = dayOff ? 0 : clamp(totalWorkMs > 0 ? workedMs / totalWorkMs : 0, 0, 1);

    updateMilestones(p, remainingMs, workToday && !notStarted && !pastEnd);
    maybeAnnounceEnd(now, end, pastEnd, workToday);

    // Timer text. Three shapes: counting down, counting up past your hours,
    // or counting down the time off until the next shift.
    if (dayOff) {
      const next = nextWorkStart(now);
      if (next) {
        els.timer.textContent = formatDuration(next - now);
        els.timerLabel.textContent = 'of time off left';
        els.status.textContent = `Day off. Back ${relativeDayName(next, now)} at ${formatClock(next)}.`;
        setTitle('Day off');
      } else {
        els.timer.textContent = '00:00:00';
        els.timerLabel.textContent = 'no days set';
        els.status.textContent = 'Pick at least one work day above.';
        setTitle('No work days');
      }
    } else if (pastEnd) {
      els.timer.textContent = formatDuration(overMs);
      els.timerLabel.textContent = 'since going-home time';
      els.status.textContent = overtimeMessage(overMs);
      setTitle(overMs < GRACE_MS ? 'Done' : `+${shortDuration(overMs)} over`);
    } else if (notStarted) {
      els.timer.textContent = formatDuration(start - now);
      els.timerLabel.textContent = 'until you clock in';
      els.status.textContent = statusMessage(p, notStarted, lunch, now);
      setTitle(`Starts ${formatClock(start)}`);
    } else {
      els.timer.textContent = formatDuration(remainingMs);
      els.timerLabel.textContent = "until you're home";
      els.status.textContent = statusMessage(p, notStarted, lunch, now);
      setTitle(`${shortDuration(remainingMs)} left`);
    }

    els.card.classList.toggle('is-milestone', Date.now() < flourishUntil);
    els.card.classList.toggle('is-dayoff', dayOff);
    renderWeek(now, dayWindow(now).dayIndex, p, dayOff);

    // Progress bar and arc
    els.progressFill.style.transform = `scaleX(${p.toFixed(4)})`;
    els.arcFill.style.strokeDashoffset = String(pathLength * (1 - p));
    const pt = els.arcPath.getPointAtLength(pathLength * p);
    for (const dot of [els.traveler, els.travelerHalo]) {
      dot.setAttribute('cx', pt.x);
      dot.setAttribute('cy', pt.y);
    }

    // Lunch sits at the point of the day's work you reach before pausing.
    if (lunch && totalWorkMs > 0 && !dayOff) {
      const lunchP = clamp((lunch.start - start - overlapMs(start, lunch.start, lunch)) / totalWorkMs, 0, 1);
      const lp = els.arcPath.getPointAtLength(pathLength * lunchP);
      lunchEls.mark.setAttribute('cx', lp.x);
      lunchEls.mark.setAttribute('cy', lp.y);
      lunchEls.mark.classList.remove('is-hidden');
    } else {
      lunchEls.mark.classList.add('is-hidden');
    }

    // Accent colour always follows work progress, in every theme
    const workColors = interpolate(workStops, p);
    els.root.style.setProperty('--accent', workColors.accent);

    // Sky: work-progress driven (dark), flat black (AMOLED), or real time of day (light)
    // Weather first: the sky, the clouds and the city all read it below.
    refreshForecast();
    weather = weatherAt(now);

    const eclipseDepth = updateEclipse();
    // A deep solar eclipse is not just darker daylight, it looks like dusk.
    // Feeding the coverage back into the sun's altitude walks the sky down its
    // own ramp toward civil twilight, so colour, stars and city all follow.
    const sky = computeSky(now, workColors, eclipseDepth);
    els.sky.style.setProperty('--sky-top', sky.top);
    els.sky.style.setProperty('--sky-bottom', sky.bottom);
    els.stars.style.setProperty('--stars-opacity', sky.stars.toFixed(2));

    // Light and dark are two views of the same sky, so both drive the scene;
    // only AMOLED drops it for a flat black canvas.
    if (theme === 'amoled') {
      els.sun.style.opacity = 0;
      els.moon.style.opacity = 0;
    } else {
      updateCelestial(now, sky.night);
      updateWeather(sky);
      updateClouds(sky);
      updateSkyline(sky);
    }

    // The first stretch past your hours reads as a win; after that it does not.
    els.card.classList.toggle('is-home', !dayOff && pastEnd && overMs < GRACE_MS);
    els.card.classList.toggle('is-overtime', !dayOff && pastEnd && overMs >= GRACE_MS);

    // Colour the browser chrome to match the sky, for installed windows
    els.themeColor.setAttribute('content', sky.bottom);

    // Eyebrow and schedule summary, in the selected time format
    const weekday = now.toLocaleDateString(undefined, { weekday: 'long' });
    els.eyebrow.textContent = `${weekday} · ${formatClock(now)}`;

    let summary = `${formatMinutes(cfg.start)} to ${formatMinutes(cfg.end)}`;
    if (lunch) {
      const lunchMins = Math.round((lunch.end - lunch.start) / 60000);
      summary += `, minus ${formatSpan(lunchMins)} for lunch`;
    }
    els.scheduleSummary.textContent = summary;
  }

  // ---- Installable app -------------------------------------------------
  // Service workers need http(s); opening the file directly is still fine,
  // it just does not get offline support.
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
    });
  }

  loadForecast();
  scheduleStir();
  buildStarfield();
  buildClouds();
  buildRain();
  buildSkyline();
  setCardSize(cardSize, false);
  renderWeekdays();
  renderHoursMode();
  renderLunchToggle();
  renderRemind();
  renderChime();
  renderLocation();
  renderClouds();
  setFormat(timeFormat);
  setTheme(theme);
  showTidbit(false);
  let tidbitsOn = true;
  try { tidbitsOn = localStorage.getItem(TIDBIT_KEY) !== 'off'; } catch (e) { /* default to on */ }
  setTidbitsVisible(tidbitsOn);
  tick();
  // The first tick has now put real light on the clouds. Only after that is
  // the colour cross-fade armed, so a page opened at midnight does not spend
  // its first second fading a noon sky out.
  requestAnimationFrame(() => els.root.classList.add('clouds-lit'));
  setInterval(tick, 1000);
})();
