(() => {
  const els = {
    sky: document.getElementById('sky'),
    stars: document.getElementById('stars'),
    sun: document.getElementById('sun'),
    moon: document.getElementById('moon'),
    skyTraffic: document.getElementById('skyTraffic'),
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

  // days is indexed by Date#getDay, so 0 is Sunday. Monday to Friday by default.
  const DEFAULT_DAYS = [false, true, true, true, true, true, false];
  const DEFAULTS = {
    start: 9 * 60, end: 18 * 60,
    lunchStart: 13 * 60, lunchEnd: 14 * 60, lunchOn: false,
    days: DEFAULT_DAYS,
  };

  function parseDays(value) {
    if (typeof value !== 'string' || !/^[01]{7}$/.test(value)) return DEFAULT_DAYS.slice();
    return value.split('').map(c => c === '1');
  }

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
      if (saved) {
        return {
          start: parseStored(saved.start, DEFAULTS.start),
          end: parseStored(saved.end, DEFAULTS.end),
          lunchStart: parseStored(saved.lunchStart, DEFAULTS.lunchStart),
          lunchEnd: parseStored(saved.lunchEnd, DEFAULTS.lunchEnd),
          lunchOn: saved.lunchOn === true,
          days: parseDays(saved.days),
        };
      }
    } catch (e) { /* ignore malformed storage */ }
    return { ...DEFAULTS, days: DEFAULT_DAYS.slice() };
  }

  const schedule = loadSettings();

  function saveSettings() {
    const toStr = (mins) => pad2(Math.floor(mins / 60)) + ':' + pad2(mins % 60);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        start: toStr(schedule.start),
        end: toStr(schedule.end),
        lunchStart: toStr(schedule.lunchStart),
        lunchEnd: toStr(schedule.lunchEnd),
        lunchOn: schedule.lunchOn,
        days: schedule.days.map(d => (d ? '1' : '0')).join(''),
      }));
    } catch (e) { /* storage unavailable, continue without persistence */ }
  }

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
    for (const f of fields) {
      const mins = schedule[f.key];
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
    schedule[key] = ((mins % 1440) + 1440) % 1440;
    saveSettings();
    renderFields();
    adoptScheduleChange();
    tick();
  }

  function commitHour(f) {
    const mins = schedule[f.key];
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
    const h24 = Math.floor(schedule[f.key] / 60);
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
        setField(f.key, schedule[f.key] + step);
        input.select();
      });
    }

    for (const btn of f.meridiemBtns) {
      btn.addEventListener('click', () => {
        const mins = schedule[f.key];
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
    els.root.setAttribute('data-lunch', schedule.lunchOn ? 'on' : 'off');
    lunchEls.btn.setAttribute('aria-pressed', String(schedule.lunchOn));
    lunchEls.label.textContent = schedule.lunchOn ? 'Lunch break on' : 'Lunch break';
  }

  lunchEls.btn.addEventListener('click', () => {
    schedule.lunchOn = !schedule.lunchOn;
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

  // Real time-of-day sky: drives the light theme's background, independent
  // of your work schedule. This is what the sky actually looks like now.
  const daylightStops = [
    { t: 0 / 24,  top: '#0a0f2c', bottom: '#171d3f' },  // midnight
    { t: 5 / 24,  top: '#171d3f', bottom: '#3b3a5c' },  // pre-dawn
    { t: 6 / 24,  top: '#ff9472', bottom: '#ffd9a0' },  // sunrise
    { t: 8 / 24,  top: '#5ea7db', bottom: '#ffe3b3' },  // morning
    { t: 12 / 24, top: '#2f8ee0', bottom: '#bfe6ff' },  // noon
    { t: 16 / 24, top: '#3f97e0', bottom: '#cdeaff' },  // afternoon
    { t: 18 / 24, top: '#6a4f8f', bottom: '#ff7e5f' },  // sunset
    { t: 19 / 24, top: '#23214a', bottom: '#6b4a6f' },  // dusk
    { t: 21 / 24, top: '#0f1330', bottom: '#262a4f' },  // night
    { t: 24 / 24, top: '#0a0f2c', bottom: '#171d3f' },  // wraps to midnight
  ];

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
      const h = hourDecimal(now);
      const { top, bottom } = interpolate(daylightStops, h / 24);
      const ambient = windowOpacity(h, 6, 18, 1.25);
      return { top, bottom, stars: 1 - ambient, ambient };
    }
    return { top: workColors.top, bottom: workColors.bottom, stars: workColors.stars };
  }

  // ---- Sun and moon arc across the sky --------------------------------
  function positionCelestial(el, t, opacity) {
    el.style.left = (8 + t * 84) + '%';
    el.style.top = (80 - Math.sin(t * Math.PI) * 64) + '%';
    el.style.opacity = String(opacity);
  }

  function updateCelestial(now) {
    const h = hourDecimal(now);

    const sunT = clamp((h - 6) / 12, 0, 1);
    positionCelestial(els.sun, sunT, windowOpacity(h, 6, 18, 1));
    const sunColors = interpolate(sunStops, sunT);
    els.sun.style.setProperty('--sun-core', sunColors.core);
    els.sun.style.setProperty('--sun-ray', sunColors.ray);

    const shifted = ((h - 18) + 24) % 24;
    positionCelestial(els.moon, clamp(shifted / 12, 0, 1), windowOpacity(shifted, 0, 12, 1));
  }

  function updateClouds(ambient) {
    els.root.style.setProperty('--cloud-opacity', (0.35 + 0.55 * ambient).toFixed(2));
    els.root.style.setProperty('--cloud-brightness', (0.5 + 0.55 * ambient).toFixed(2));
    els.root.style.setProperty('--bird-ink', (0.25 + 0.45 * ambient).toFixed(2));
  }

  // ---- Birds and planes: spawned at random intervals, light theme only
  // Each symbol is already cropped to its figure, so the host <svg> only needs
  // that figure's proportions. Without this it falls back to a 300x150 box and
  // the sprite floats letterboxed inside it.
  const BIRD_SPRITES = [
    { id: '#art-bird-1', viewBox: '0 0 311 108' },
    { id: '#art-bird-2', viewBox: '0 0 377 126' },
    { id: '#art-bird-3', viewBox: '0 0 375 166' },
    { id: '#art-bird-4', viewBox: '0 0 343 99' },
    { id: '#art-bird-5', viewBox: '0 0 409 145' },
  ];
  const PLANE_VIEWBOX = '0 0 133 88';

  function isDaylightNow() {
    const h = hourDecimal(new Date());
    return h > 5.5 && h < 19.5;
  }

  function launch(el, seconds, drift) {
    el.style.animationDuration = seconds + 's';
    el.style.setProperty('--flyer-drift', drift + 'px');
    el.addEventListener('animationend', () => el.remove());
    els.skyTraffic.appendChild(el);
  }

  // Gulls travel in loose groups, so one spawn puts up a small skein.
  function spawnFlock() {
    const size = Math.random() < 0.45 ? 1 : Math.floor(rand(2, 5));
    const baseTop = rand(10, 44);
    const baseDur = rand(16, 26);

    for (let i = 0; i < size; i++) {
      const scale = rand(0.55, 1.15);
      const bird = document.createElement('div');
      bird.className = 'flyer bird';
      bird.style.top = clamp(baseTop + rand(-6, 6), 4, 52) + '%';
      bird.style.width = (46 * scale).toFixed(1) + 'px';
      bird.style.marginLeft = (i * rand(-70, -30)).toFixed(0) + 'px';

      const sprite = pick(BIRD_SPRITES);
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      svg.setAttribute('viewBox', sprite.viewBox);
      use.setAttribute('href', sprite.id);
      svg.appendChild(use);
      svg.style.animationDelay = (-Math.random() * 3.4).toFixed(2) + 's';
      bird.appendChild(svg);

      launch(bird, (baseDur / scale).toFixed(1), rand(-70, 20));
    }
  }

  function spawnPlane() {
    const plane = document.createElement('div');
    plane.className = 'flyer plane' + (isDaylightNow() ? '' : ' is-night');
    plane.style.top = rand(5, 24) + '%';
    plane.style.width = rand(74, 118).toFixed(0) + 'px';
    plane.innerHTML =
      '<div class="plane__contrail"></div>' +
      '<svg class="plane__art" viewBox="' + PLANE_VIEWBOX + '"><use href="#art-plane"/></svg>' +
      '<div class="plane__lights"><span class="red"></span><span class="green"></span></div>';
    launch(plane, rand(26, 40).toFixed(1), rand(-40, -10));
  }

  function scheduleBirds(delay) {
    if (theme !== 'light' || reduceMotion) return;
    birdTimeout = setTimeout(() => {
      if (theme === 'light' && isDaylightNow()) spawnFlock();
      scheduleBirds(rand(11000, 26000));
    }, delay);
  }
  function schedulePlanes(delay) {
    if (theme !== 'light' || reduceMotion) return;
    planeTimeout = setTimeout(() => {
      if (theme === 'light') spawnPlane();
      schedulePlanes(rand(35000, 80000));
    }, delay);
  }
  function stopTraffic() {
    clearTimeout(birdTimeout);
    clearTimeout(planeTimeout);
    birdTimeout = null;
    planeTimeout = null;
    els.skyTraffic.replaceChildren();
  }

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

  // The pair of instants bounding the shift that `now` belongs to.
  function dayWindow(now) {
    let start = minutesToday(schedule.start, now);
    let end = minutesToday(schedule.end, now);
    if (end <= start) end = addDays(end, 1); // overnight shift

    // An overnight shift that began yesterday is still running right now.
    const prevStart = addDays(start, -1);
    const prevEnd = addDays(end, -1);
    if (now < start && now >= prevStart && now < prevEnd) {
      start = prevStart;
      end = prevEnd;
    }
    return { start, end };
  }

  // Lunch as an absolute interval, anchored to the shift and clipped to it.
  // Returns null when lunch is off or falls entirely outside the workday.
  function lunchWindow(start, end) {
    if (!schedule.lunchOn) return null;

    let ls = minutesToday(schedule.lunchStart, start);
    let le = minutesToday(schedule.lunchEnd, start);
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
  function anyWorkDays() { return schedule.days.some(Boolean); }

  // A shift belongs to the day it starts on, so an overnight Friday shift
  // still counts as Friday once the clock has rolled past midnight.
  function isWorkDay(dayIndex) { return schedule.days[dayIndex] === true; }

  function nextWorkStart(now) {
    if (!anyWorkDays()) return null;
    for (let i = 0; i < 8; i++) {
      const candidate = minutesToday(schedule.start, addDays(now, i));
      if (candidate > now && isWorkDay(candidate.getDay())) return candidate;
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
    const nameFor = (index, opts) => new Date(1970, 0, 4 + index).toLocaleDateString(undefined, opts);

    for (let i = 0; i < 7; i++) {
      const index = (first + i) % 7;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'weekday';
      btn.dataset.day = String(index);
      btn.innerHTML = '<span aria-hidden="true">' + nameFor(index, { weekday: 'narrow' }) + '</span>'
        + '<span class="sr-only">' + nameFor(index, { weekday: 'long' }) + '</span>';
      weekdaysEl.appendChild(btn);
      dayButtons.push(btn);
    }
  })();

  function renderWeekdays() {
    for (const btn of dayButtons) {
      btn.setAttribute('aria-pressed', String(isWorkDay(Number(btn.dataset.day))));
    }
  }

  weekdaysEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.weekday');
    if (!btn) return;
    const index = Number(btn.dataset.day);
    schedule.days[index] = !schedule.days[index];
    saveSettings();
    renderWeekdays();
    adoptScheduleChange();
    tick();
  });

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

    const { start, end } = dayWindow(now);
    const lunch = lunchWindow(start, end);

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

    // Progress bar and arc
    els.progressFill.style.width = (p * 100).toFixed(2) + '%';
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

    let summary = `${formatMinutes(schedule.start)} to ${formatMinutes(schedule.end)}`;
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

  renderWeekdays();
  renderLunchToggle();
  renderRemind();
  renderChime();
  setFormat(timeFormat);
  setTheme(theme);
  showTidbit(false);
  let tidbitsOn = true;
  try { tidbitsOn = localStorage.getItem(TIDBIT_KEY) !== 'off'; } catch (e) { /* default to on */ }
  setTidbitsVisible(tidbitsOn);
  tick();
  setInterval(tick, 1000);
})();
