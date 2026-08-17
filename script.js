(() => {
  const els = {
    sky: document.getElementById('sky'),
    stars: document.getElementById('stars'),
    sun: document.getElementById('sun'),
    moon: document.getElementById('moon'),
    skyTraffic: document.getElementById('skyTraffic'),
    clouds: document.getElementById('clouds'),
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
    if (theme === 'light' && !reduceMotion) {
      scheduleBirds(rand(1500, 5000));
      schedulePlanes(rand(6000, 14000));
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
    { at: 20,  top: '#3a8ede', bottom: '#c2e6ff' },  // full morning
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

  function computeSky(now, workColors) {
    if (theme === 'amoled') return { top: '#000000', bottom: '#000000', stars: 0 };
    if (theme === 'light') {
      const altitude = solarAltitude(now);
      const { top, bottom } = interpolateBy(skyByAltitude, altitude);
      // Stars fade in through civil twilight and are fully out by the end of
      // astronomical twilight, which is roughly how the eye experiences it.
      const stars = clamp((-6 - altitude) / 12, 0, 1);
      const ambient = clamp((altitude + 6) / 14, 0, 1);
      return { top, bottom, stars, ambient, altitude };
    }
    return { top: workColors.top, bottom: workColors.bottom, stars: workColors.stars };
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

  // ---- Sun and moon arc across the sky --------------------------------
  // The arc is an ellipse anchored below the horizon, sized in viewport units
  // so the dome keeps its shape from a phone to a wide desktop. Previously the
  // path was a flat percentage sweep, which read as a shallow smear on wide
  // screens and a near-vertical climb on narrow ones.
  function positionCelestial(el, t, opacity) {
    // angle runs pi to 0 across the day, so cos sweeps -1 to 1: the sun comes
    // up on the left, peaks overhead at noon, and goes down on the right.
    const angle = (1 - clamp(t, 0, 1)) * Math.PI;
    const x = 50 + Math.cos(angle) * 46;
    const y = 92 - Math.sin(angle) * 78;
    el.style.left = x + '%';
    el.style.top = y + '%';
    el.style.opacity = String(opacity);
  }

  function updateCelestial(now) {
    const h = hourDecimal(now);
    const { sunrise, sunset } = daylightWindow(now);
    const dayLength = Math.max(0.5, sunset - sunrise);

    const sunT = clamp((h - sunrise) / dayLength, 0, 1);
    positionCelestial(els.sun, sunT, windowOpacity(h, sunrise, sunset, 0.6));
    const sunColors = interpolate(sunStops, sunT);
    els.sun.style.setProperty('--sun-core', sunColors.core);
    els.sun.style.setProperty('--sun-ray', sunColors.ray);

    // The moon takes the other half of the clock, riding the same arc.
    const nightLength = Math.max(0.5, 24 - dayLength);
    const sinceSet = ((h - sunset) + 24) % 24;
    positionCelestial(els.moon, clamp(sinceSet / nightLength, 0, 1), windowOpacity(sinceSet, 0, nightLength, 0.6));
  }

  function updateClouds(ambient) {
    els.root.style.setProperty('--cloud-opacity', (0.35 + 0.55 * ambient).toFixed(2));
    els.root.style.setProperty('--cloud-brightness', (0.5 + 0.55 * ambient).toFixed(2));
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
  const cityNear = [
    { at: 0, r: 10, g: 15, b: 30, a: 0.92 },
    { at: 1, r: 62, g: 82, b: 116, a: 0.72 }, // daylight haze, not a night silhouette
  ];

  function updateSkyline(ambient, darkness) {
    const mix = (stops) => {
      const c = interpolateBy(stops, ambient);
      return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${c.a.toFixed(2)})`;
    };
    els.root.style.setProperty('--city-far', mix(cityFar));
    els.root.style.setProperty('--city-near', mix(cityNear));
    // Offices light up before it is fully dark, and never quite all at once.
    els.root.style.setProperty('--window-glow', clamp(darkness * 1.25, 0, 1).toFixed(2));
  }

  // ---- Birds and planes: spawned at random intervals, light theme only
  const PLANE_VIEWBOX = '0 0 133 88';

  // ---- Building the sky -------------------------------------------------
  // Stars are drawn as box-shadow constellations on three elements rather than
  // hundreds of nodes: one element carries fifty stars at no layout cost, and
  // viewport units keep them spread as the window resizes.
  function buildStarfield() {
    const layers = [
      { count: 78, size: 1, alpha: 0.5, period: 7 },
      { count: 46, size: 1.4, alpha: 0.72, period: 9.5 },
      { count: 20, size: 1.9, alpha: 0.92, period: 12 },
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
    for (let i = 0; i < 11; i++) {
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
  const CLOUD_SHAPES = [
    { id: '#art-cloud-1', viewBox: '0 0 77 22' },
    { id: '#art-cloud-2', viewBox: '0 0 90 32' },
    { id: '#art-cloud-3', viewBox: '0 0 74 35' },
    { id: '#art-cloud-4', viewBox: '0 0 78 29' },
  ];

  function buildClouds() {
    const bands = [
      { count: 6, width: [70, 120], speed: [200, 280], top: [2, 34], depth: 0.45 },
      { count: 6, width: [130, 210], speed: [130, 190], top: [6, 48], depth: 0.72 },
      { count: 4, width: [230, 330], speed: [85, 125], top: [12, 62], depth: 1 },
    ];

    const frag = document.createDocumentFragment();
    for (const band of bands) {
      for (let i = 0; i < band.count; i++) {
        const shape = pick(CLOUD_SHAPES);
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        svg.setAttribute('viewBox', shape.viewBox);
        svg.setAttribute('class', 'cloud');
        use.setAttribute('href', shape.id);
        svg.appendChild(use);

        const duration = rand(band.speed[0], band.speed[1]);
        svg.style.width = rand(band.width[0], band.width[1]).toFixed(0) + 'px';
        svg.style.top = rand(band.top[0], band.top[1]).toFixed(2) + '%';
        svg.style.animationDuration = duration.toFixed(1) + 's';
        // Negative delays scatter them across the sky on first paint instead
        // of marching them all in from the left edge together.
        svg.style.animationDelay = (-Math.random() * duration).toFixed(1) + 's';
        svg.style.setProperty('--depth', band.depth.toFixed(2));
        frag.appendChild(svg);
      }
    }
    els.clouds.replaceChildren(frag);
  }

  // ---- Skyline ----------------------------------------------------------
  // A city drawn from rules rather than a fixed asset: two depth layers, the
  // far one hazier and shorter, so the horizon reads as distance rather than
  // as a band of colour. Windows are real rects, which is what lets them come
  // on at dusk.
  const SVGNS = 'http://www.w3.org/2000/svg';

  function buildSkyline() {
    const svg = document.getElementById('skyline');
    svg.replaceChildren();

    const layers = [
      { klass: 'skyline__far', y: 118, minW: 46, maxW: 96, minH: 60, maxH: 150, gap: -8, windows: 0.5, step: 26 },
      { klass: 'skyline__near', y: 168, minW: 58, maxW: 132, minH: 70, maxH: 210, gap: -14, windows: 1, step: 22 },
    ];

    for (const layer of layers) {
      const group = document.createElementNS(SVGNS, 'g');
      group.setAttribute('class', layer.klass);

      let x = -40;
      while (x < 1640) {
        const w = rand(layer.minW, layer.maxW);
        const h = rand(layer.minH, layer.maxH);
        const top = 300 - layer.y - h + layer.y;
        const y = 300 - h;

        const block = document.createElementNS(SVGNS, 'path');
        // Occasional setback shoulders and a crown, so the roofline is not a
        // row of plain boxes.
        const roll = Math.random();
        let d;
        if (roll < 0.18) {
          const inset = w * rand(0.16, 0.28);
          const shoulder = y + h * rand(0.12, 0.24);
          d = `M${x} 300 V${shoulder} H${x + inset} V${y} H${x + w - inset} V${shoulder} H${x + w} V300 Z`;
        } else if (roll < 0.3) {
          d = `M${x} 300 V${y + 14} L${x + w / 2} ${y} L${x + w} ${y + 14} V300 Z`;
        } else {
          d = `M${x} 300 V${y} H${x + w} V300 Z`;
        }
        block.setAttribute('d', d);
        group.appendChild(block);

        // Masts on the taller towers only.
        if (h > layer.maxH * 0.72 && Math.random() < 0.55) {
          const mast = document.createElementNS(SVGNS, 'rect');
          mast.setAttribute('x', (x + w / 2 - 1.5).toFixed(1));
          mast.setAttribute('y', (y - rand(18, 40)).toFixed(1));
          mast.setAttribute('width', '3');
          mast.setAttribute('height', '44');
          group.appendChild(mast);
        }

        // Window grid, inset from the edges so it reads as a facade.
        const cols = Math.max(1, Math.floor((w - 14) / layer.step));
        const rows = Math.max(1, Math.floor((h - 20) / layer.step));
        const lit = document.createElementNS(SVGNS, 'g');
        lit.setAttribute('class', 'skyline__windows');
        for (let c = 0; c < cols; c++) {
          for (let r = 0; r < rows; r++) {
            if (Math.random() > layer.windows * 0.55) continue;
            const win = document.createElementNS(SVGNS, 'rect');
            win.setAttribute('x', (x + 9 + c * layer.step).toFixed(1));
            win.setAttribute('y', (y + 12 + r * layer.step).toFixed(1));
            win.setAttribute('width', '7');
            win.setAttribute('height', '9');
            win.setAttribute('rx', '1');
            // Each window keeps its own brightness so the facade is not uniform.
            win.style.setProperty('--lit', rand(0.35, 1).toFixed(2));
            lit.appendChild(win);
          }
        }
        group.appendChild(lit);

        x += w + layer.gap + rand(4, 26);
      }
      svg.appendChild(group);
    }
  }

  // Hard ceilings, so no combination of timing accidents can fill the sky.
  const MAX_BIRDS = 26;
  const MAX_PLANES = 2;

  function isDaylightNow() {
    return solarAltitude(new Date()) > -6;
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
  const FLOCKS = [
    { kind: 'single', size: [1, 1], scale: [0.85, 1.25], top: [6, 46], weight: 4 },
    { kind: 'pair', size: [2, 2], scale: [0.7, 1.0], top: [8, 44], weight: 3 },
    { kind: 'skein', size: [3, 6], scale: [0.55, 0.9], top: [6, 40], weight: 4 },
    { kind: 'flock', size: [10, 18], scale: [0.24, 0.42], top: [4, 26], weight: 2 },
  ];

  function spawnFlock() {
    if (countFlyers('.bird') >= MAX_BIRDS) return;

    const shape = pickWeighted(FLOCKS);
    const size = Math.round(rand(shape.size[0], shape.size[1]));
    const baseTop = rand(shape.top[0], shape.top[1]);
    const baseScale = rand(shape.scale[0], shape.scale[1]);
    const baseDur = rand(22, 36);
    const drift = rand(-90, 30);

    for (let i = 0; i < size; i++) {
      if (countFlyers('.bird') >= MAX_BIRDS) break;

      // Individuals vary around the group's size rather than being identical.
      const scale = clamp(baseScale * rand(0.86, 1.14), 0.2, 1.35);
      const bird = makeBird(scale);

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

      bird.style.marginLeft = offsetX.toFixed(0) + 'px';
      bird.style.top = clamp(baseTop + offsetY, 2, 56).toFixed(2) + '%';

      // The whole group holds formation, so it shares one crossing time.
      launch(bird, (baseDur / Math.max(0.5, baseScale)).toFixed(1), drift + rand(-8, 8));
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

  const AIRCRAFT = [
    // Jets fly high and fast and leave a contrail behind them.
    { type: 'jet', sprite: '#art-plane', viewBox: PLANE_VIEWBOX, width: [58, 112], top: [3, 22], speed: [30, 48], contrail: true, weight: 6 },
    // Props sit lower, run slower, and leave nothing at all.
    { type: 'prop', sprite: '#art-prop', viewBox: '0 0 140 84', width: [44, 74], top: [18, 40], speed: [22, 34], contrail: false, weight: 4 },
  ];


  function spawnPlane() {
    if (countFlyers('.plane') >= MAX_PLANES) return;

    const kind = pickWeighted(AIRCRAFT);
    const livery = pick(LIVERIES);

    const plane = document.createElement('div');
    plane.className = 'flyer plane plane--' + kind.type + (isDaylightNow() ? '' : ' is-night');
    plane.style.top = rand(kind.top[0], kind.top[1]).toFixed(1) + '%';
    plane.style.width = rand(kind.width[0], kind.width[1]).toFixed(0) + 'px';
    plane.style.setProperty('--livery-accent', livery.accent);
    plane.style.setProperty('--livery-body', livery.body);
    plane.style.setProperty('--livery-shade', livery.shade);
    plane.style.setProperty('--livery-ink', livery.ink);

    plane.innerHTML =
      (kind.contrail ? '<div class="plane__contrail"></div>' : '') +
      '<svg class="plane__art" viewBox="' + kind.viewBox + '"><use href="#' + kind.sprite.slice(1) + '"/></svg>' +
      '<div class="plane__lights"><span class="red"></span><span class="green"></span></div>';
    launch(plane, rand(kind.speed[0], kind.speed[1]).toFixed(1), rand(-40, -10));
  }

  function trafficAllowed() {
    return theme === 'light' && !reduceMotion && !document.hidden;
  }

  function scheduleBirds(delay) {
    if (theme === 'light' && !reduceMotion) {
      birdTimeout = setTimeout(() => {
        if (trafficAllowed() && isDaylightNow()) spawnFlock();
        scheduleBirds(rand(9000, 22000));
      }, delay);
    }
  }
  function schedulePlanes(delay) {
    if (theme === 'light' && !reduceMotion) {
      planeTimeout = setTimeout(() => {
        if (trafficAllowed()) spawnPlane();
        schedulePlanes(rand(38000, 85000));
      }, delay);
    }
  }
  function stopTraffic() {
    clearTimeout(birdTimeout);
    clearTimeout(planeTimeout);
    birdTimeout = null;
    planeTimeout = null;
    for (const el of els.skyTraffic.children) clearTimeout(el._expiry);
    els.skyTraffic.replaceChildren();
  }

  // Coming back to a tab that has been parked for an hour should look like a
  // sky, not a queue. Clear whatever survived and start the schedule fresh.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopTraffic();
    } else if (theme === 'light' && !reduceMotion) {
      stopTraffic();
      scheduleBirds(rand(1200, 4000));
      schedulePlanes(rand(8000, 20000));
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
        mark.innerHTML = '<i class="week__fill"></i>';
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
    const sky = computeSky(now, workColors);
    els.sky.style.setProperty('--sky-top', sky.top);
    els.sky.style.setProperty('--sky-bottom', sky.bottom);
    els.stars.style.setProperty('--stars-opacity', sky.stars.toFixed(2));

    if (theme === 'light') {
      updateCelestial(now);
      updateClouds(sky.ambient ?? 1);
      updateSkyline(sky.ambient ?? 1, sky.stars ?? 0);
    } else {
      els.sun.style.opacity = 0;
      els.moon.style.opacity = 0;
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

  buildStarfield();
  buildClouds();
  buildSkyline();
  renderWeekdays();
  renderHoursMode();
  renderLunchToggle();
  renderRemind();
  renderChime();
  renderLocation();
  setFormat(timeFormat);
  setTheme(theme);
  showTidbit(false);
  let tidbitsOn = true;
  try { tidbitsOn = localStorage.getItem(TIDBIT_KEY) !== 'off'; } catch (e) { /* default to on */ }
  setTidbitsVisible(tidbitsOn);
  tick();
  setInterval(tick, 1000);
})();
