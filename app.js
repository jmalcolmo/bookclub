/* =====================================================================
   THE MARBLE RACE — app.js
   Book Club Edition. Single-file app, split from index.html + styles.css
   ===================================================================== */

'use strict';

/* ---------- TUNABLE CONSTANTS ---------- */
const CONFIG = {
  MARBLE_RADIUS: 36,
  MARBLE_DENSITY: 0.006,
  MARBLE_RESTITUTION: 0.3,
  MARBLE_FRICTION: 0.01,
  MARBLE_FRICTION_AIR: 0.005,
  GRAVITY_Y: 0.3,
  RACE_TIMEOUT_MS: 90_000,
  LEAD_POLL_MS: 500,
  AUDIO_FADE_MS: 800,
  CELEBRATION_MS: 10_000,
  ORB_FIRST_SPAWN_MS: 5000,
  ORB_RESPAWN_MIN_MS: 4000,
  ORB_RESPAWN_MAX_MS: 8000,
  ORB_MAX_CONCURRENT: 8,
  ORB_RADIUS: 20,
};

/* ---------- CROP CONSTANTS ---------- */
const CROP_SIZE = 240;
const CROP_CIRCLE_RADIUS = 110;

/* ---------- STORAGE KEYS ---------- */
const STORAGE_KEY = 'marbleRace_marbles';

/* ---------- UTILS ---------- */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function hashToColor(str) {
  const yarns = ['#b8a058', '#7a9068', '#a05838', '#587888', '#886878', '#607050', '#987860'];
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return yarns[Math.abs(h) % yarns.length];
}

function initialsOf(name) {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function extractVideoId(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) {
      return u.pathname.slice(1).split(/[/?]/)[0] || null;
    }
    if (u.hostname.includes('youtube.com')) {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2];
      if (u.pathname.startsWith('/embed/')) return u.pathname.split('/')[2];
    }
  } catch (_) { /* ignore */ }
  return null;
}

function showToast(msg, kind = 'warn', ttl = 4200) {
  const host = $('[data-toast-container]');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 300);
  }, ttl);
}

/* =====================================================================
   MARBLE STORE — localStorage CRUD
   ===================================================================== */
const MarbleStore = {
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (_) { return []; }
  },
  save(list) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  },
  add(m) {
    const list = this.load();
    list.push(m);
    this.save(list);
  },
  update(id, changes) {
    const list = this.load().map(m => m.id === id ? { ...m, ...changes } : m);
    this.save(list);
  },
  remove(id) {
    this.save(this.load().filter(m => m.id !== id));
  }
};

/* =====================================================================
   SCREEN MANAGER
   ===================================================================== */
const ScreenManager = {
  current: 'menu',
  show(name) {
    $$('[data-screen]').forEach(s => s.classList.toggle('active', s.dataset.screen === name));
    this.current = name;
    if (name === 'menu')    UI.renderMenuCount();
    if (name === 'marbles') UI.renderMarbleGrid();
    if (name === 'setup')   UI.renderSetup();
  }
};

/* =====================================================================
   AVATAR RENDERING — returns a CSS-ready data URL or base64
   ===================================================================== */
function drawInitialsAvatar(name, color, size = 120) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  // circle fill
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  // inner highlight
  const grad = ctx.createRadialGradient(size * 0.35, size * 0.35, size * 0.05, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  // initials
  ctx.fillStyle = '#f0ebdf';
  ctx.font = `500 ${size * 0.38}px DM Mono, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;
  ctx.fillText(initialsOf(name), size / 2, size / 2 + size * 0.02);
  return c.toDataURL('image/png');
}

function avatarSource(marble, size = 120) {
  if (marble.imageBase64) return marble.imageBase64;
  return drawInitialsAvatar(marble.name, marble.color || hashToColor(marble.name), size);
}

function raceAvatarSource(marble) {
  // Returns a 200px avatar (consistent size for race sprite scaling)
  if (marble.imageBase64) return marble.imageBase64;  // already 200x200
  return drawInitialsAvatar(marble.name, marble.color || hashToColor(marble.name), 200);
}

/* =====================================================================
   UI CONTROLLER — menu, marble grid, setup, editor modal
   ===================================================================== */
const UI = {
  setupState: { selectedIds: new Set(), selectedMap: null },
  editorState: { editingId: null, imageBase64: null },
  cropState: {
    rawSrc: null, x: 0, y: 0, scale: 1,
    coverScale: 1, minScale: 1,
    natW: 0, natH: 0,
    dragging: false, lastX: 0, lastY: 0,
  },

  init() {
    // nav
    $$('[data-nav]').forEach(el => el.addEventListener('click', e => {
      const target = e.currentTarget.dataset.nav;
      if (target) ScreenManager.show(target);
    }));
    // actions on main menu
    $('[data-action="toggle-help"]').addEventListener('click', () => {
      const h = $('[data-help]');
      h.hidden = !h.hidden;
    });
    // marble mgmt
    $('[data-action="new-marble"]').addEventListener('click', () => this.openEditor());
    $$('[data-action="close-editor"]').forEach(b => b.addEventListener('click', () => this.closeEditor()));
    $('[data-editor-form]').addEventListener('submit', e => this.submitEditor(e));
    $('[data-editor-form] input[name="avatar"]').addEventListener('change', e => this.handleAvatarUpload(e));
    $('[data-editor-form] input[name="youtube"]').addEventListener('input', e => this.validateYoutube(e));
    // marble grid delegation (attached once)
    $('[data-marbles-grid]').addEventListener('click', e => {
      const editBtn = e.target.closest('[data-edit]');
      const delBtn = e.target.closest('[data-delete]');
      if (editBtn) this.openEditor(editBtn.dataset.edit);
      else if (delBtn) this.deleteMarble(delBtn.dataset.delete);
    });
    // race setup
    $$('[data-map-cards] .map-card').forEach(card => {
      card.addEventListener('click', () => {
        $$('[data-map-cards] .map-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        this.setupState.selectedMap = card.dataset.map;
        this.updateStartBtn();
      });
    });
    $('[data-action="start-race"]').addEventListener('click', () => this.startRace());
    // race quit
    $('[data-action="quit-race"]').addEventListener('click', () => {
      if (confirm('Quit the race?')) {
        RaceController.stop();
        ScreenManager.show('menu');
      }
    });
    // mute
    $('[data-action="toggle-mute"]').addEventListener('click', () => AudioManager.toggleMute());
    // results
    $('[data-action="show-podium"]').addEventListener('click', () => ResultsController.skipToPodium());
    $('[data-action="race-again"]').addEventListener('click', () => RaceController.restart());
    this.initCropListeners();
  },

  renderMenuCount() {
    const n = MarbleStore.load().length;
    $('[data-marble-count]').textContent = `${n} ${n === 1 ? 'marble' : 'marbles'} in the jar`;
  },

  renderMarbleGrid() {
    const grid = $('[data-marbles-grid]');
    const empty = $('[data-empty-state]');
    const list = MarbleStore.load();
    grid.innerHTML = '';
    if (list.length === 0) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    list.forEach(m => {
      const card = document.createElement('div');
      card.className = 'marble-card';
      const avatarUrl = avatarSource(m, 120);
      card.innerHTML = `
        <div class="marble-avatar" style="background-image: url('${avatarUrl}'); background-color: ${m.color || hashToColor(m.name)};"></div>
        <h3 class="marble-card-name">${escapeHtml(m.name)} ${m.youtubeVideoId ? '<span class="music-note" title="has a theme song">🎵</span>' : ''}</h3>
        <div class="marble-card-actions">
          <button data-edit="${m.id}">edit</button>
          <button class="danger" data-delete="${m.id}">delete</button>
        </div>
      `;
      grid.appendChild(card);
    });
  },

  openEditor(id = null) {
    this.editorState = { editingId: id, imageBase64: null };
    const backdrop = $('[data-modal="marble-editor"]');
    const form = $('[data-editor-form]');
    form.reset();
    $('[data-avatar-preview]').innerHTML = '';
    $('[data-yt-help]').textContent = '';
    $('[data-yt-help]').className = 'field-help';
    $('[data-yt-time-fields]').hidden = true;
    if (id) {
      const m = MarbleStore.load().find(x => x.id === id);
      if (m) {
        form.name.value = m.name;
        form.youtube.value = m.youtubeUrl || '';
        form.yt_start.value = m.youtubeStartTime != null ? formatTime(m.youtubeStartTime) : '';
        form.yt_end.value   = m.youtubeEndTime   != null ? formatTime(m.youtubeEndTime)   : '';
        this.editorState.imageBase64 = m.imageBase64 || null;
        $('[data-avatar-preview]').innerHTML = `
          <div class="marble-avatar small" style="background-image:url('${avatarSource(m, 90)}'); background-color:${m.color || hashToColor(m.name)}"></div>
        `;
        $('[data-editor-title]').textContent = 'edit marble';
        if (m.youtubeVideoId) {
          $('[data-yt-help]').textContent = '✓ song saved';
          $('[data-yt-help]').className = 'field-help ok';
          $('[data-yt-time-fields]').hidden = false;
        }
      }
    } else {
      $('[data-editor-title]').textContent = 'new marble';
    }
    backdrop.hidden = false;
  },

  closeEditor() {
    $('[data-modal="marble-editor"]').hidden = true;
  },

  handleAvatarUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => this.openCrop(ev.target.result);
    reader.readAsDataURL(file);
  },

  validateYoutube(e) {
    const url = e.target.value.trim();
    const help = $('[data-yt-help]');
    const timeFields = $('[data-yt-time-fields]');
    if (!url) {
      help.textContent = '';
      help.className = 'field-help';
      timeFields.hidden = true;
      return;
    }
    const vid = extractVideoId(url);
    if (vid) {
      help.textContent = `✓ video id: ${vid}`;
      help.className = 'field-help ok';
      timeFields.hidden = false;
    } else {
      help.textContent = '✗ not a recognizable youtube link';
      help.className = 'field-help err';
      timeFields.hidden = true;
    }
  },

  submitEditor(e) {
    e.preventDefault();
    const form = e.target;
    const name = form.name.value.trim();
    if (!name) return;
    const ytUrl = form.youtube.value.trim();
    const ytId = ytUrl ? extractVideoId(ytUrl) : null;
    if (ytUrl && !ytId) {
      showToast('That YouTube link doesn\'t look right — check and try again.', 'error');
      return;
    }
    const ytStart = ytId ? parseTime(form.yt_start.value) : null;
    const ytEnd   = ytId ? parseTime(form.yt_end.value)   : null;
    if (ytEnd !== null && ytStart !== null && ytEnd <= ytStart) {
      showToast('End time must be after start time.', 'error');
      return;
    }
    const payload = {
      name,
      color: hashToColor(name),
      imageBase64: this.editorState.imageBase64 || null,
      youtubeUrl: ytUrl || null,
      youtubeVideoId: ytId,
      youtubeStartTime: ytStart,
      youtubeEndTime: ytEnd,
    };
    if (this.editorState.editingId) {
      MarbleStore.update(this.editorState.editingId, payload);
    } else {
      MarbleStore.add({ id: uid(), ...payload });
    }
    this.closeEditor();
    this.renderMarbleGrid();
  },

  deleteMarble(id) {
    const m = MarbleStore.load().find(x => x.id === id);
    if (!m) return;
    if (!confirm(`Remove ${m.name} from the jar?`)) return;
    MarbleStore.remove(id);
    this.renderMarbleGrid();
  },

  renderSetup() {
    const list = MarbleStore.load();
    const host = $('[data-setup-marbles]');
    host.innerHTML = '';
    if (list.length < 2) {
      host.innerHTML = `<p class="faint">you need at least 2 marbles to race. make more in the jar.</p>`;
    }
    list.forEach(m => {
      const row = document.createElement('label');
      row.className = 'setup-marble-row';
      const isSel = this.setupState.selectedIds.has(m.id);
      if (isSel) row.classList.add('selected');
      const avatarUrl = avatarSource(m, 56);
      row.innerHTML = `
        <input type="checkbox" ${isSel ? 'checked' : ''} />
        <div class="marble-avatar small" style="background-image:url('${avatarUrl}'); background-color:${m.color || hashToColor(m.name)}"></div>
        <span>${escapeHtml(m.name)}</span>
        ${m.youtubeVideoId ? '<span class="music-note">🎵</span>' : ''}
      `;
      const cb = row.querySelector('input');
      cb.addEventListener('change', () => {
        if (cb.checked) this.setupState.selectedIds.add(m.id);
        else this.setupState.selectedIds.delete(m.id);
        row.classList.toggle('selected', cb.checked);
        this.updateStartBtn();
      });
      host.appendChild(row);
    });
    // restore map visual selection
    $$('[data-map-cards] .map-card').forEach(c => {
      c.classList.toggle('selected', c.dataset.map === this.setupState.selectedMap);
    });
    this.updateStartBtn();
  },

  updateStartBtn() {
    const ok = this.setupState.selectedIds.size >= 2 && this.setupState.selectedMap;
    $('[data-action="start-race"]').disabled = !ok;
  },

  startRace() {
    const all = MarbleStore.load();
    const chosen = all.filter(m => this.setupState.selectedIds.has(m.id));
    let mapName = this.setupState.selectedMap;
    if (mapName === 'random') {
      const pool = ['gauntlet', 'alpine', 'pinball'];
      mapName = pool[Math.floor(Math.random() * pool.length)];
    }
    ScreenManager.show('race');
    RaceController.start(chosen, mapName);
  },

  /* ---- Crop UI ---- */

  openCrop(src) {
    const img = $('[data-crop-image]');
    img.onload = () => {
      const natW = img.naturalWidth;
      const natH = img.naturalHeight;
      const circleD = CROP_CIRCLE_RADIUS * 2;
      const coverScale = Math.max(circleD / natW, circleD / natH);
      Object.assign(this.cropState, {
        natW, natH, coverScale,
        scale: coverScale,
        minScale: coverScale,
        x: (CROP_SIZE - natW * coverScale) / 2,
        y: (CROP_SIZE - natH * coverScale) / 2,
      });
      this.updateCropImage();
      $('[data-zoom-slider]').value = 100;
    };
    img.src = src;
    $('[data-modal="marble-editor"]').hidden = true;
    $('[data-modal="image-cropper"]').hidden = false;
  },

  updateCropImage() {
    const img = $('[data-crop-image]');
    const { x, y, scale, natW, natH } = this.cropState;
    img.style.left   = `${x}px`;
    img.style.top    = `${y}px`;
    img.style.width  = `${natW * scale}px`;
    img.style.height = `${natH * scale}px`;
  },

  zoomCrop(factor, pivotX, pivotY) {
    const { x, y, scale, coverScale, minScale } = this.cropState;
    const newScale = Math.max(minScale, Math.min(coverScale * 3, scale * factor));
    const actual = newScale / scale;
    this.cropState.x = pivotX - (pivotX - x) * actual;
    this.cropState.y = pivotY - (pivotY - y) * actual;
    this.cropState.scale = newScale;
    $('[data-zoom-slider]').value = Math.round((newScale / coverScale) * 100);
    this.updateCropImage();
  },

  confirmCrop() {
    const { x, y, scale, natW, natH } = this.cropState;
    const OUTPUT = 200;
    const circleD = CROP_CIRCLE_RADIUS * 2;  // 220
    const ex = OUTPUT / circleD;             // export scale factor

    const c = document.createElement('canvas');
    c.width = c.height = OUTPUT;
    const ctx = c.getContext('2d');
    ctx.beginPath();
    ctx.arc(OUTPUT / 2, OUTPUT / 2, OUTPUT / 2, 0, Math.PI * 2);
    ctx.clip();

    // circle starts at (10,10) in crop space; map that to (0,0) in export space
    ctx.drawImage(
      $('[data-crop-image]'),
      (x - 10) * ex, (y - 10) * ex,
      natW * scale * ex, natH * scale * ex
    );

    const base64 = c.toDataURL('image/png');
    this.editorState.imageBase64 = base64;
    $('[data-avatar-preview]').innerHTML = `
      <div class="marble-avatar small" style="background-image:url('${base64}')"></div>
    `;
    $('[data-modal="image-cropper"]').hidden = true;
    $('[data-modal="marble-editor"]').hidden = false;
  },

  cancelCrop() {
    $('[data-modal="image-cropper"]').hidden = true;
    $('[data-modal="marble-editor"]').hidden = false;
    $('[data-editor-form] input[name="avatar"]').value = '';
  },

  initCropListeners() {
    const container = $('[data-crop-container]');

    container.addEventListener('mousedown', e => {
      this.cropState.dragging = true;
      this.cropState.lastX = e.clientX;
      this.cropState.lastY = e.clientY;
      e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
      if (!this.cropState.dragging) return;
      this.cropState.x += e.clientX - this.cropState.lastX;
      this.cropState.y += e.clientY - this.cropState.lastY;
      this.cropState.lastX = e.clientX;
      this.cropState.lastY = e.clientY;
      this.updateCropImage();
    });
    window.addEventListener('mouseup', () => { this.cropState.dragging = false; });

    container.addEventListener('touchstart', e => {
      this.cropState.dragging = true;
      this.cropState.lastX = e.touches[0].clientX;
      this.cropState.lastY = e.touches[0].clientY;
      e.preventDefault();
    }, { passive: false });
    window.addEventListener('touchmove', e => {
      if (!this.cropState.dragging) return;
      this.cropState.x += e.touches[0].clientX - this.cropState.lastX;
      this.cropState.y += e.touches[0].clientY - this.cropState.lastY;
      this.cropState.lastX = e.touches[0].clientX;
      this.cropState.lastY = e.touches[0].clientY;
      this.updateCropImage();
    }, { passive: false });
    window.addEventListener('touchend', () => { this.cropState.dragging = false; });

    container.addEventListener('wheel', e => {
      e.preventDefault();
      this.zoomCrop(e.deltaY < 0 ? 1.1 : 0.9, e.offsetX, e.offsetY);
    }, { passive: false });

    $('[data-action="zoom-in"]').addEventListener('click', () =>
      this.zoomCrop(1.15, CROP_SIZE / 2, CROP_SIZE / 2));
    $('[data-action="zoom-out"]').addEventListener('click', () =>
      this.zoomCrop(0.87, CROP_SIZE / 2, CROP_SIZE / 2));

    $('[data-zoom-slider]').addEventListener('input', e => {
      const { coverScale, scale } = this.cropState;
      const newScale = coverScale * (e.target.value / 100);
      this.zoomCrop(newScale / scale, CROP_SIZE / 2, CROP_SIZE / 2);
    });

    $('[data-action="confirm-crop"]').addEventListener('click', () => this.confirmCrop());
    $$('[data-action="cancel-crop"]').forEach(b => b.addEventListener('click', () => this.cancelCrop()));
  },
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function parseTime(s) {
  if (!s) return null;
  s = s.trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const parts = s.split(':').map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some(isNaN)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function formatTime(s) {
  if (s == null) return '';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

/* =====================================================================
   AUDIO MANAGER — YouTube IFrame Player, per-marble
   ===================================================================== */
const AudioManager = {
  ytReady: false,
  ytReadyQueue: [],
  players: {},        // marbleId -> { player, ready, failed, volume }
  marbleMeta: {},     // marbleId -> { startTime, endTime }
  currentId: null,
  muted: false,
  fadeIntervals: {},
  clipInterval: null,

  _onApiReady() {
    this.ytReady = true;
    this.ytReadyQueue.forEach(fn => fn());
    this.ytReadyQueue = [];
  },

  ensureReady(fn) {
    if (this.ytReady) fn();
    else this.ytReadyQueue.push(fn);
  },

  reset() {
    if (this.clipInterval) { clearInterval(this.clipInterval); this.clipInterval = null; }
    Object.values(this.players).forEach(p => {
      try { if (p.player && p.player.destroy) p.player.destroy(); } catch (_) {}
    });
    this.players = {};
    this.marbleMeta = {};
    this.currentId = null;
    Object.values(this.fadeIntervals).forEach(clearInterval);
    this.fadeIntervals = {};
    $('[data-yt-host]').innerHTML = '';
  },

  setupForRace(marbles) {
    this.reset();
    marbles.forEach(m => {
      this.marbleMeta[m.id] = {
        startTime: m.youtubeStartTime != null ? m.youtubeStartTime : 0,
        endTime:   m.youtubeEndTime   != null ? m.youtubeEndTime   : null,
      };
    });
    this.ensureReady(() => {
      marbles.forEach(m => {
        if (!m.youtubeVideoId) return;
        const host = $('[data-yt-host]');
        const div = document.createElement('div');
        div.id = `yt-${m.id}`;
        host.appendChild(div);
        const entry = { player: null, ready: false, failed: false, volume: 0 };
        this.players[m.id] = entry;
        entry.player = new YT.Player(div.id, {
          videoId: m.youtubeVideoId,
          width: 1,
          height: 1,
          playerVars: { autoplay: 0, controls: 0, disablekb: 1, fs: 0, modestbranding: 1 },
          events: {
            onReady: (e) => {
              entry.ready = true;
              e.target.setVolume(0);
            },
            onError: (e) => {
              entry.failed = true;
              showToast(`⚠️ ${m.name}'s song couldn't load — embedding may be disabled.`, 'warn');
            }
          }
        });
      });
    });
  },

  setLeader(marbleId) {
    if (this.currentId === marbleId) return;
    const prev = this.currentId;
    this.currentId = marbleId;

    if (this.clipInterval) { clearInterval(this.clipInterval); this.clipInterval = null; }

    if (prev && this.players[prev] && this.players[prev].ready && !this.players[prev].failed) {
      this._fade(prev, 0, () => {
        try { this.players[prev].player.pauseVideo(); } catch(_){}
      });
    }
    if (marbleId && this.players[marbleId] && this.players[marbleId].ready && !this.players[marbleId].failed) {
      try {
        const p = this.players[marbleId].player;
        const meta = this.marbleMeta[marbleId] || { startTime: 0, endTime: null };
        p.setVolume(0);
        if (!this.muted) {
          p.seekTo(meta.startTime, true);
          p.playVideo();
        }
        this._fade(marbleId, this.muted ? 0 : 100);
        if (meta.endTime !== null) {
          this.clipInterval = setInterval(() => {
            if (this.currentId !== marbleId) return;
            try {
              if (p.getCurrentTime() >= meta.endTime) p.seekTo(meta.startTime, true);
            } catch(_) {}
          }, 250);
        }
      } catch (_) {}
    }
  },

  _fade(id, targetVol, onDone) {
    const entry = this.players[id];
    if (!entry || !entry.ready || entry.failed) { onDone && onDone(); return; }
    if (this.fadeIntervals[id]) clearInterval(this.fadeIntervals[id]);
    const startVol = entry.volume;
    const startT = performance.now();
    const dur = CONFIG.AUDIO_FADE_MS;
    this.fadeIntervals[id] = setInterval(() => {
      const t = Math.min(1, (performance.now() - startT) / dur);
      const v = startVol + (targetVol - startVol) * t;
      entry.volume = v;
      try { entry.player.setVolume(v); } catch (_){}
      if (t >= 1) {
        clearInterval(this.fadeIntervals[id]);
        delete this.fadeIntervals[id];
        onDone && onDone();
      }
    }, 30);
  },

  toggleMute() {
    this.muted = !this.muted;
    $('[data-action="toggle-mute"]').textContent = this.muted ? '🔇' : '🔊';
    if (this.muted) {
      Object.values(this.players).forEach(e => { try { e.player && e.player.pauseVideo(); } catch(_){}; });
    } else if (this.currentId && this.players[this.currentId]) {
      try {
        this.players[this.currentId].player.playVideo();
        this.players[this.currentId].player.setVolume(100);
      } catch(_){}
    }
  },

  stopAll() {
    Object.values(this.players).forEach(entry => {
      if (!entry.ready || entry.failed) return;
      try { entry.player.pauseVideo(); entry.player.setVolume(0); } catch(_){}
      entry.volume = 0;
    });
    this.currentId = null;
  },

  playForCelebration(marbleId) {
    this.currentId = null;
    this.setLeader(marbleId);
  }
};

// YouTube API callback (global, required by Google)
window.onYouTubeIframeAPIReady = function () {
  AudioManager._onApiReady();
};

/* =====================================================================
   MAP BUILDERS — build static Matter bodies for each map
   ===================================================================== */
const MapBuilder = {
  build(name, Engine, Bodies, Composite, world) {
    switch (name) {
      case 'gauntlet': return this.buildGauntlet(Bodies, Composite, world);
      case 'alpine':   return this.buildAlpine(Bodies, Composite, world);
      case 'pinball':  return this.buildPinball(Bodies, Composite, world);
      default:         return this.buildGauntlet(Bodies, Composite, world);
    }
  },

  _wall(Bodies, x, y, w, h, angle = 0, color = '#483828') {
    return Bodies.rectangle(x, y, w, h, {
      isStatic: true,
      angle,
      label: 'wall',
      render: { fillStyle: color, strokeStyle: '#2a2520', lineWidth: 2 }
    });
  },

  _bumper(Bodies, x, y, r, restitution = 0.9, color = '#887068') {
    return Bodies.circle(x, y, r, {
      isStatic: true,
      restitution,
      label: 'bumper',
      render: { fillStyle: color, strokeStyle: '#2a2520', lineWidth: 2 }
    });
  },

  _finishSensor(Bodies, x, y, w) {
    return Bodies.rectangle(x, y, w, 14, {
      isStatic: true,
      isSensor: true,
      label: 'finish',
      render: { fillStyle: '#b8a058', strokeStyle: '#483828', lineWidth: 2 }
    });
  },

  /* --- Map 1: The Gauntlet --- */
  buildGauntlet(Bodies, Composite, world) {
    const W = 600, H = 2200;
    const bodies = [];
    // side walls
    bodies.push(this._wall(Bodies, 10, H/2, 20, H, 0, '#483828'));
    bodies.push(this._wall(Bodies, W-10, H/2, 20, H, 0, '#483828'));
    // top cap (prevents escape)
    bodies.push(this._wall(Bodies, W/2, -10, W, 20, 0, '#483828'));

    // zigzag platforms
    const startY = 250;
    const gap = 190;
    const platLen = 340;
    let left = true;
    for (let y = startY; y < H - 300; y += gap) {
      const angle = (left ? 1 : -1) * 0.38;
      const x = left ? (W * 0.34) : (W * 0.66);
      bodies.push(this._wall(Bodies, x, y, platLen, 16, angle, '#7a9068'));
      left = !left;
    }

    // pinch points — short stubs from each wall
    const pinches = [600, 1100, 1600];
    pinches.forEach((py, i) => {
      const fromLeft = i % 2 === 0;
      const x = fromLeft ? 90 : W - 90;
      bodies.push(this._wall(Bodies, x, py, 130, 20, 0, '#a05838'));
    });

    // funnel floor + finish
    bodies.push(this._wall(Bodies, W * 0.28, H - 120, 360, 18, 0.35, '#483828'));
    bodies.push(this._wall(Bodies, W * 0.72, H - 120, 360, 18, -0.35, '#483828'));
    const finish = this._finishSensor(Bodies, W/2, H - 20, 200);
    bodies.push(finish);

    Composite.add(world, bodies);
    return { width: W, height: H, finish, bodies };
  },

  /* --- Map 2: Alpine Drop --- */
  buildAlpine(Bodies, Composite, world) {
    const W = 800, H = 2000;
    const bodies = [];
    // walls (soft boundary)
    bodies.push(this._wall(Bodies, 10, H/2, 20, H, 0, '#587888'));
    bodies.push(this._wall(Bodies, W-10, H/2, 20, H, 0, '#587888'));
    bodies.push(this._wall(Bodies, W/2, -10, W, 20, 0, '#587888'));

    // mogul bumps — rows of small circles
    const rows = 9;
    for (let r = 0; r < rows; r++) {
      const y = 260 + r * 170;
      const count = 4 + (r % 2);
      const xStep = (W - 120) / count;
      const offset = (r % 2) * (xStep / 2);
      for (let i = 0; i < count; i++) {
        const x = 60 + i * xStep + offset;
        bodies.push(this._bumper(Bodies, x, y, 24, 0.5, '#7a9068'));
      }
    }

    // jump ramps
    bodies.push(this._wall(Bodies, W * 0.3, 800, 220, 18, -0.5, '#b8a058'));
    bodies.push(this._wall(Bodies, W * 0.7, 1300, 220, 18, 0.5, '#b8a058'));
    bodies.push(this._wall(Bodies, W * 0.5, 1700, 260, 18, -0.4, '#b8a058'));

    // funnel/finish
    bodies.push(this._wall(Bodies, W * 0.25, H - 120, 420, 18, 0.3, '#483828'));
    bodies.push(this._wall(Bodies, W * 0.75, H - 120, 420, 18, -0.3, '#483828'));
    const finish = this._finishSensor(Bodies, W/2, H - 20, 380);
    bodies.push(finish);

    Composite.add(world, bodies);
    return { width: W, height: H, finish, bodies };
  },

  /* --- Map 3: Pinball Alley --- */
  buildPinball(Bodies, Composite, world) {
    const W = 700, H = 2400;
    const bodies = [];
    bodies.push(this._wall(Bodies, 10, H/2, 20, H, 0, '#886878'));
    bodies.push(this._wall(Bodies, W-10, H/2, 20, H, 0, '#886878'));
    bodies.push(this._wall(Bodies, W/2, -10, W, 20, 0, '#886878'));

    // bumpers — irregular rows, alternating sizes
    const startY = 220;
    const endY = H - 360;
    for (let y = startY; y < endY; y += 130) {
      const count = 3 + Math.floor(Math.random() * 3);
      const usable = W - 100;
      const step = usable / count;
      for (let i = 0; i < count; i++) {
        const x = 50 + i * step + Math.random() * step * 0.3;
        const big = Math.random() > 0.55;
        const r = big ? 32 : 18;
        const color = big ? '#a05838' : '#587888';
        bodies.push(this._bumper(Bodies, x, y + (i % 2) * 30, r, 0.92, color));
      }
    }

    // 3 vertical dividers with gaps that stagger — marbles must switch lanes
    const dividerYs = [600, 1200, 1800];
    dividerYs.forEach((dy, idx) => {
      const gapX = 140 + (idx * 180) % (W - 280);
      // left segment
      const leftLen = gapX - 30;
      bodies.push(this._wall(Bodies, leftLen / 2 + 20, dy, leftLen, 14, 0, '#483828'));
      // right segment
      const rightStart = gapX + 110;
      const rightLen = W - rightStart - 20;
      if (rightLen > 0) bodies.push(this._wall(Bodies, rightStart + rightLen / 2, dy, rightLen, 14, 0, '#483828'));
    });

    // funnel/finish
    bodies.push(this._wall(Bodies, W * 0.25, H - 120, 360, 18, 0.4, '#483828'));
    bodies.push(this._wall(Bodies, W * 0.75, H - 120, 360, 18, -0.4, '#483828'));
    const finish = this._finishSensor(Bodies, W/2, H - 20, 240);
    bodies.push(finish);

    Composite.add(world, bodies);
    return { width: W, height: H, finish, bodies };
  },
};

/* =====================================================================
   POWER-UP MANAGER
   ===================================================================== */
const POWERUPS = {
  heavy:   { color: '#2d4470', label: 'HEAVY',   duration: 4000, kind: 'gravity',   multiplier: 3.0 },
  feather: { color: '#9cc097', label: 'FEATHER', duration: 5000, kind: 'gravity',   multiplier: 0.2 },
  bounce:  { color: '#c04430', label: 'HYPER',   duration: 6000, kind: 'bounce',    value: 0.98 },
  burst:   { color: '#e0b84c', label: 'BURST',   duration: 0,    kind: 'impulse' },
  freeze:  { color: '#404044', label: 'FREEZE',  duration: 3000, kind: 'freeze' },
  ghost:   { color: '#d88040', label: 'GHOST',   duration: 4000, kind: 'ghost' },
  magnet:  { color: '#7b4a78', label: 'MAGNET',  duration: 5000, kind: 'magnet' },
};

const PowerUpManager = {
  active: [],   // { body, kind }
  effects: {},  // marbleBodyId -> [{ kind, endsAt, color, label, data }]
  labels: [],   // floating DOM labels { el, x, y, born, life }
  spawnTimer: null,
  Matter: null,
  world: null,
  mapSize: null,

  reset() {
    this.active = [];
    this.effects = {};
    this.labels.forEach(l => l.el.remove());
    this.labels = [];
    if (this.spawnTimer) clearTimeout(this.spawnTimer);
    this.spawnTimer = null;
  },

  init(Matter, world, mapSize) {
    this.Matter = Matter;
    this.world = world;
    this.mapSize = mapSize;
    this.scheduleSpawn(CONFIG.ORB_FIRST_SPAWN_MS);
  },

  scheduleSpawn(delay) {
    this.spawnTimer = setTimeout(() => this.spawnOne(), delay);
  },

  spawnOne() {
    if (!RaceController.running) return;
    if (this.active.length >= CONFIG.ORB_MAX_CONCURRENT) {
      const d = CONFIG.ORB_RESPAWN_MIN_MS + Math.random() * (CONFIG.ORB_RESPAWN_MAX_MS - CONFIG.ORB_RESPAWN_MIN_MS);
      this.scheduleSpawn(d);
      return;
    }
    const kinds = Object.keys(POWERUPS);
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    const def = POWERUPS[kind];
    const x = 80 + Math.random() * (this.mapSize.width - 160);
    const y = 120 + Math.random() * (this.mapSize.height - 320);
    const { Bodies, Composite } = this.Matter;
    const body = Bodies.circle(x, y, CONFIG.ORB_RADIUS, {
      isStatic: true,
      isSensor: true,
      label: `orb_${kind}`,
      render: { fillStyle: def.color, strokeStyle: '#f0ebdf', lineWidth: 3 }
    });
    Composite.add(this.world, body);
    this.active.push({ body, kind });
    // schedule next
    const d = CONFIG.ORB_RESPAWN_MIN_MS + Math.random() * (CONFIG.ORB_RESPAWN_MAX_MS - CONFIG.ORB_RESPAWN_MIN_MS);
    this.scheduleSpawn(d);
  },

  consume(orbBody, marbleBody) {
    const idx = this.active.findIndex(a => a.body.id === orbBody.id);
    if (idx < 0) return;
    const { kind } = this.active[idx];
    const def = POWERUPS[kind];
    const { Composite } = this.Matter;
    Composite.remove(this.world, orbBody);
    this.active.splice(idx, 1);

    this.applyEffect(marbleBody, kind, def);

    this.addFloatingLabel(marbleBody.position.x, marbleBody.position.y - 30, def.label, def.color);
  },

  applyEffect(marbleBody, kind, def) {
    const id = marbleBody.id;
    if (!this.effects[id]) this.effects[id] = [];
    const now = performance.now();

    if (def.kind === 'impulse') {
      const { Body } = this.Matter;
      const vx = (Math.random() - 0.5) * 18;
      const vy = -6 - Math.random() * 8;
      Body.setVelocity(marbleBody, { x: marbleBody.velocity.x + vx, y: marbleBody.velocity.y + vy });
      return;
    }
    if (def.kind === 'bounce') {
      const original = marbleBody.restitution;
      marbleBody.restitution = def.value;
      this.effects[id].push({ kind, endsAt: now + def.duration, color: def.color, data: { originalRestitution: original } });
      return;
    }
    if (def.kind === 'freeze') {
      const { Body } = this.Matter;
      Body.setVelocity(marbleBody, { x: 0, y: 0 });
      const originalDamping = marbleBody.frictionAir;
      marbleBody.frictionAir = 0.3;
      this.effects[id].push({ kind, endsAt: now + def.duration, color: def.color, data: { originalDamping } });
      return;
    }
    if (def.kind === 'ghost') {
      marbleBody.collisionFilter.mask = 0x0000; // collide with nothing
      this.effects[id].push({ kind, endsAt: now + def.duration, color: def.color, data: {} });
      return;
    }
    // gravity, magnet — handled in beforeUpdate
    this.effects[id].push({ kind, endsAt: now + def.duration, color: def.color, data: {} });
  },

  onBeforeUpdate(marbleBodies) {
    const now = performance.now();
    const { Body } = this.Matter;

    Object.keys(this.effects).forEach(idStr => {
      const id = Number(idStr);
      const list = this.effects[id];
      const body = marbleBodies.find(b => b.id === id);
      if (!body) return;
      for (let i = list.length - 1; i >= 0; i--) {
        const eff = list[i];
        const def = POWERUPS[eff.kind];
        // apply per-frame behavior
        if (def.kind === 'gravity') {
          // apply extra force. default gravity accel = GRAVITY_Y * 0.001 per ms^2? Matter uses engine.gravity.y scaled by body mass.
          // easier: apply force = mass * (extraG - 1) * gravityScale
          const extra = (def.multiplier - 1);
          const force = { x: 0, y: body.mass * CONFIG.GRAVITY_Y * 0.001 * extra };
          Body.applyForce(body, body.position, force);
        }
        if (def.kind === 'magnet') {
          marbleBodies.forEach(other => {
            if (other.id === body.id) return;
            const dx = other.position.x - body.position.x;
            const dy = other.position.y - body.position.y;
            const distSq = dx*dx + dy*dy;
            const dist = Math.sqrt(distSq);
            if (dist > 0 && dist < 150) {
              const pull = 0.0008 * body.mass;
              Body.applyForce(other, other.position, { x: -dx/dist * pull, y: -dy/dist * pull });
            }
          });
        }

        // expire
        if (def.duration > 0 && now >= eff.endsAt) {
          // rollback
          if (def.kind === 'bounce') body.restitution = eff.data.originalRestitution;
          if (def.kind === 'freeze') body.frictionAir = eff.data.originalDamping;
          if (def.kind === 'ghost') body.collisionFilter.mask = 0xFFFFFFFF;
          list.splice(i, 1);
        }
      }
    });

    // update floating labels
    for (let i = this.labels.length - 1; i >= 0; i--) {
      const l = this.labels[i];
      const age = now - l.born;
      if (age > l.life) {
        l.el.remove();
        this.labels.splice(i, 1);
      } else {
        l.el.style.opacity = String(1 - age / l.life);
      }
    }
  },

  afterRender(ctx, marbleBodies, renderBounds) {
    // draw halos around marbles with active effects
    marbleBodies.forEach(body => {
      const list = this.effects[body.id];
      if (!list || list.length === 0) return;
      list.forEach((eff, i) => {
        ctx.save();
        ctx.strokeStyle = eff.color;
        ctx.lineWidth = 3;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.arc(body.position.x, body.position.y, CONFIG.MARBLE_RADIUS + 6 + i * 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      });
    });
    // pulse orbs
    const t = performance.now() / 300;
    this.active.forEach(({ body }) => {
      const pulse = 1 + Math.sin(t + body.position.x * 0.01) * 0.15;
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = body.render.fillStyle;
      ctx.beginPath();
      ctx.arc(body.position.x, body.position.y, CONFIG.ORB_RADIUS * (1.8 * pulse), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  },

  addFloatingLabel(x, y, text, color) {
    const wrap = $('[data-canvas-wrap]');
    if (!wrap) return;
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = `
      position: absolute;
      left: 0; top: 0;
      font-family: 'DM Mono', monospace;
      font-size: 12px;
      font-weight: 500;
      color: ${color};
      text-shadow: 1px 1px 0 rgba(240,235,223,0.9);
      pointer-events: none;
      transition: opacity 0.2s;
      z-index: 100;
    `;
    wrap.appendChild(el);
    this.labels.push({ el, x, y, born: performance.now(), life: 1500, worldX: x, worldY: y });
    // will be positioned in canvas frame via setLabelScreenPositions
  },

  setLabelScreenPositions(render) {
    const bounds = render.bounds;
    const canvas = render.canvas;
    const sx = canvas.width / (bounds.max.x - bounds.min.x);
    const sy = canvas.height / (bounds.max.y - bounds.min.y);
    this.labels.forEach(l => {
      const wx = l.x, wy = l.y;
      const px = (wx - bounds.min.x) * sx;
      const py = (wy - bounds.min.y) * sy - 20;
      l.el.style.transform = `translate(${px - 30}px, ${py}px)`;
    });
  }
};

/* =====================================================================
   RACE CONTROLLER — orchestrates Matter engine + lead tracking + finish
   ===================================================================== */
const RaceController = {
  Matter: null,
  engine: null,
  render: null,
  runner: null,
  world: null,
  marbles: [],       // [{ marble, body }]
  finishOrder: [],   // array of marble objects in finish order
  startedAt: 0,
  running: false,
  mapSize: null,
  mapName: null,
  currentRacers: null,
  leadPollHandle: null,
  timeoutHandle: null,
  timerHandle: null,

  start(marbles, mapName) {
    this.currentRacers = marbles;
    this.mapName = mapName;
    this.Matter = window.Matter;
    const M = this.Matter;

    // clean any prior
    this.stop(true);

    const wrap = $('[data-canvas-wrap]');
    wrap.innerHTML = '';

    this.engine = M.Engine.create();
    this.engine.gravity.y = CONFIG.GRAVITY_Y;
    this.world = this.engine.world;

    const mapData = MapBuilder.build(mapName, M.Engine, M.Bodies, M.Composite, this.world);
    this.mapSize = { width: mapData.width, height: mapData.height };

    // render — sized to fit wrap
    const wrapRect = wrap.getBoundingClientRect();
    const canvasH = Math.max(400, wrapRect.height - 20);
    const canvasW = Math.min(wrapRect.width - 20, mapData.width);
    this.render = M.Render.create({
      element: wrap,
      engine: this.engine,
      options: {
        width: canvasW,
        height: canvasH,
        wireframes: false,
        background: '#f5f0e4',
        hasBounds: true,
      }
    });
    // initial camera
    M.Render.lookAt(this.render, {
      min: { x: 0, y: 0 },
      max: { x: mapData.width, y: canvasH * (mapData.width / canvasW) }
    });

    // marbles
    this.marbles = marbles.map((m, idx) => {
      const slotWidth = CONFIG.MARBLE_RADIUS * 2 + 8;
      const totalWidth = marbles.length * slotWidth;
      const startX = Math.max(CONFIG.MARBLE_RADIUS + 30, (mapData.width - totalWidth) / 2);
      const spawnX = startX + idx * slotWidth + (Math.random() - 0.5) * 10;
      const spawnY = CONFIG.MARBLE_RADIUS + 20 + Math.random() * 20;
      const bodyOpts = {
        restitution: CONFIG.MARBLE_RESTITUTION,
        density: CONFIG.MARBLE_DENSITY,
        friction: CONFIG.MARBLE_FRICTION,
        frictionAir: CONFIG.MARBLE_FRICTION_AIR,
        label: `marble_${m.id}`,
        render: {}
      };
      const RACE_SPRITE_TEXTURE_SIZE = 200;
      const avatarUrl = raceAvatarSource(m);
      bodyOpts.render.sprite = {
        texture: avatarUrl,
        xScale: (CONFIG.MARBLE_RADIUS * 2) / RACE_SPRITE_TEXTURE_SIZE,
        yScale: (CONFIG.MARBLE_RADIUS * 2) / RACE_SPRITE_TEXTURE_SIZE,
      };
      const body = M.Bodies.circle(spawnX, spawnY, CONFIG.MARBLE_RADIUS, bodyOpts);
      M.Composite.add(this.world, body);
      return { marble: m, body, finished: false };
    });

    // set up powerups
    PowerUpManager.init(M, this.world, this.mapSize);

    // collision events — finish + orb pickup
    M.Events.on(this.engine, 'collisionStart', (evt) => {
      evt.pairs.forEach(pair => {
        const { bodyA, bodyB } = pair;
        const pairs = [[bodyA, bodyB], [bodyB, bodyA]];
        pairs.forEach(([a, b]) => {
          if (a.label === 'finish' && b.label.startsWith('marble_')) {
            this.handleFinish(b);
          }
          if (a.label.startsWith('orb_') && b.label.startsWith('marble_')) {
            PowerUpManager.consume(a, b);
          }
        });
      });
    });

    // before update — powerup effects
    M.Events.on(this.engine, 'beforeUpdate', () => {
      PowerUpManager.onBeforeUpdate(this.marbles.map(m => m.body));
      this.cameraFollow();
    });

    // after render — draw halos + label overlays
    M.Events.on(this.render, 'afterRender', () => {
      const ctx = this.render.context;
      PowerUpManager.afterRender(ctx, this.marbles.map(m => m.body), this.render.bounds);
      PowerUpManager.setLabelScreenPositions(this.render);
    });

    // start audio players
    AudioManager.setupForRace(marbles);

    // lead poll
    this.leadPollHandle = setInterval(() => this.pollLead(), CONFIG.LEAD_POLL_MS);

    // timer display
    this.startedAt = performance.now();
    $('[data-race-timer]').textContent = '0.0s';
    this.timerHandle = setInterval(() => {
      const t = (performance.now() - this.startedAt) / 1000;
      $('[data-race-timer]').textContent = `${t.toFixed(1)}s`;
    }, 100);

    // timeout
    this.timeoutHandle = setTimeout(() => this.forceFinish(), CONFIG.RACE_TIMEOUT_MS);

    // kick off
    M.Render.run(this.render);
    this.runner = M.Runner.create();
    M.Runner.run(this.runner, this.engine);
    this.running = true;
    this.finishOrder = [];

    // reset mute UI
    AudioManager.muted = false;
    $('[data-action="toggle-mute"]').textContent = '🔊';
    this.renderLeaderboard();
  },

  cameraFollow() {
    if (!this.render || !this.marbles.length) return;
    // follow leader (lowest marble that hasn't finished), keep vertical range ~canvas height
    const candidates = this.marbles.filter(m => !m.finished);
    if (!candidates.length) return;
    let leader = candidates[0];
    for (let i = 1; i < candidates.length; i++) {
      if (candidates[i].body.position.y > leader.body.position.y) leader = candidates[i];
    }
    const canvasW = this.render.options.width;
    const canvasH = this.render.options.height;
    const viewH = canvasH * (this.mapSize.width / canvasW);
    const minY = Math.max(0, leader.body.position.y - viewH * 0.4);
    const maxY = minY + viewH;
    Matter.Render.lookAt(this.render, {
      min: { x: 0, y: minY },
      max: { x: this.mapSize.width, y: maxY }
    });
  },

  pollLead() {
    if (!this.running) return;
    const candidates = this.marbles.filter(m => !m.finished);
    if (!candidates.length) return;
    let leader = candidates[0];
    for (let i = 1; i < candidates.length; i++) {
      if (candidates[i].body.position.y > leader.body.position.y) leader = candidates[i];
    }
    AudioManager.setLeader(leader.marble.id);
    $('[data-np-name]').textContent = leader.marble.name + (leader.marble.youtubeVideoId ? '' : ' (no song)');
    this.renderLeaderboard(leader.marble.id);
  },

  renderLeaderboard(leaderId) {
    const ol = $('[data-leaderboard]');
    // order: finished first (by finish rank), then racing by Y desc
    const finished = [...this.finishOrder].map((m, idx) => ({ m, pos: idx + 1, finished: true }));
    const finishedIds = new Set(finished.map(f => f.m.id));
    const racing = this.marbles
      .filter(mb => !finishedIds.has(mb.marble.id))
      .sort((a, b) => b.body.position.y - a.body.position.y)
      .map((mb, idx) => ({ m: mb.marble, pos: finished.length + idx + 1, finished: false }));
    const rows = [...finished, ...racing];
    ol.innerHTML = rows.map(r => {
      const avatarUrl = avatarSource(r.m, 32);
      const classes = ['leaderboard-row'];
      if (r.finished) classes.push('finished');
      else if (r.m.id === leaderId) classes.push('leader');
      return `
        <li class="${classes.join(' ')}">
          <span class="lb-pos">${r.pos}</span>
          <span class="lb-dot" style="background-image:url('${avatarUrl}'); background-color:${r.m.color || hashToColor(r.m.name)}"></span>
          <span class="lb-name">${escapeHtml(r.m.name)}</span>
        </li>
      `;
    }).join('');
  },

  handleFinish(marbleBody) {
    const entry = this.marbles.find(mb => mb.body.id === marbleBody.id);
    if (!entry || entry.finished) return;
    entry.finished = true;
    entry.finishTime = (performance.now() - this.startedAt) / 1000;
    this.finishOrder.push(entry.marble);
    // if all finished, end race
    if (this.finishOrder.length === this.marbles.length) {
      this.end();
    }
  },

  forceFinish() {
    // put remaining marbles in order of current Y
    const remaining = this.marbles
      .filter(m => !m.finished)
      .sort((a, b) => b.body.position.y - a.body.position.y);
    remaining.forEach(e => {
      e.finished = true;
      e.finishTime = (performance.now() - this.startedAt) / 1000;
      this.finishOrder.push(e.marble);
    });
    this.end();
  },

  end() {
    if (!this.running) return;
    this.running = false;
    clearInterval(this.leadPollHandle); this.leadPollHandle = null;
    clearInterval(this.timerHandle);    this.timerHandle = null;
    clearTimeout(this.timeoutHandle);   this.timeoutHandle = null;
    PowerUpManager.reset();
    // freeze engine
    if (this.runner) Matter.Runner.stop(this.runner);
    // hand off to results
    const finishTimes = {};
    this.marbles.forEach(m => { finishTimes[m.marble.id] = m.finishTime || 0; });
    ResultsController.show(this.finishOrder, finishTimes);
  },

  stop(quiet = false) {
    this.running = false;
    if (this.leadPollHandle) clearInterval(this.leadPollHandle);
    if (this.timerHandle) clearInterval(this.timerHandle);
    if (this.timeoutHandle) clearTimeout(this.timeoutHandle);
    this.leadPollHandle = this.timerHandle = this.timeoutHandle = null;
    PowerUpManager.reset();
    if (this.render) {
      try { Matter.Render.stop(this.render); } catch(_){}
      if (this.render.canvas) this.render.canvas.remove();
      this.render.textures = {};
      this.render = null;
    }
    if (this.runner) {
      try { Matter.Runner.stop(this.runner); } catch(_){}
      this.runner = null;
    }
    if (this.engine) {
      Matter.World.clear(this.engine.world, false);
      Matter.Engine.clear(this.engine);
      this.engine = null;
    }
    this.marbles = [];
    if (!quiet) AudioManager.stopAll();
    AudioManager.reset();
  },

  restart() {
    if (!this.currentRacers || !this.mapName) return;
    ScreenManager.show('race');
    // slight delay to let screen appear
    setTimeout(() => this.start(this.currentRacers, this.mapName), 60);
  }
};

/* =====================================================================
   RESULTS CONTROLLER — celebration + podium
   ===================================================================== */
const ResultsController = {
  countdownHandle: null,
  confettiHandle: null,
  sparkleHandle: null,
  celebrationDone: false,
  finishOrder: [],
  finishTimes: {},

  show(finishOrder, finishTimes) {
    this.finishOrder = finishOrder;
    this.finishTimes = finishTimes;
    this.celebrationDone = false;
    ScreenManager.show('results');
    $('[data-celebration]').hidden = false;
    $('[data-podium-phase]').hidden = true;

    const winner = finishOrder[0];
    if (!winner) { this.skipToPodium(); return; }

    // winner marble
    const wm = $('[data-winner-marble]');
    const avatarUrl = avatarSource(winner, 200);
    wm.style.backgroundImage = `url('${avatarUrl}')`;
    wm.style.backgroundColor = winner.color || hashToColor(winner.name);
    wm.textContent = '';
    $('[data-winner-name]').textContent = winner.name;

    // confetti burst + periodic
    if (window.confetti) {
      window.confetti({ particleCount: 160, spread: 90, startVelocity: 55, origin: { y: 0.6 }});
      this.confettiHandle = setInterval(() => {
        window.confetti({ particleCount: 40, angle: 60 + Math.random() * 60, spread: 70, origin: { x: Math.random(), y: Math.random() * 0.3 }});
      }, 800);
    }

    // sparkle canvas
    this.startSparkles();

    // play winner audio
    AudioManager.playForCelebration(winner.id);

    // countdown bar
    const fill = $('[data-countdown-fill]');
    const start = performance.now();
    this.countdownHandle = setInterval(() => {
      const t = (performance.now() - start) / CONFIG.CELEBRATION_MS;
      fill.style.width = `${Math.max(0, (1 - t) * 100)}%`;
      if (t >= 1) this.skipToPodium();
    }, 60);
  },

  startSparkles() {
    const canvas = $('[data-sparkle-canvas]');
    const ctx = canvas.getContext('2d');
    const resize = () => { canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight; };
    resize();
    window.addEventListener('resize', resize);
    const particles = [];
    const colors = ['#b8a058', '#7a9068', '#a05838', '#587888', '#886878'];
    const spawn = () => {
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 3;
      particles.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: 2 + Math.random() * 3,
      });
    };
    const tick = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (Math.random() < 0.5) spawn();
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx; p.y += p.vy;
        p.vx *= 0.98; p.vy *= 0.98;
        p.life -= 0.012;
        if (p.life <= 0) { particles.splice(i, 1); continue; }
        ctx.save();
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      this.sparkleHandle = requestAnimationFrame(tick);
    };
    tick();
  },

  skipToPodium() {
    if (this.celebrationDone) return;
    this.celebrationDone = true;
    if (this.countdownHandle) clearInterval(this.countdownHandle);
    if (this.confettiHandle) clearInterval(this.confettiHandle);
    if (this.sparkleHandle) cancelAnimationFrame(this.sparkleHandle);
    AudioManager.stopAll();
    $('[data-celebration]').hidden = true;
    $('[data-podium-phase]').hidden = false;
    this.renderPodium();
  },

  renderPodium() {
    const host = $('[data-podium]');
    const [first, second, third] = this.finishOrder;
    const spot = (m, medal, rank, rankLabel, cls) => {
      if (!m) return '<div class="podium-spot"></div>';
      const avatar = avatarSource(m, 90);
      const time = this.finishTimes[m.id] ? `${this.finishTimes[m.id].toFixed(1)}s` : '';
      return `
        <div class="podium-spot">
          <div class="marble-avatar" style="background-image:url('${avatar}'); background-color:${m.color || hashToColor(m.name)}"></div>
          <div class="podium-name">${escapeHtml(m.name)}</div>
          <div class="podium-block ${cls}">
            <span class="podium-medal">${medal}</span>
            <span class="podium-rank">${rankLabel}</span>
            <span class="podium-time">${time}</span>
          </div>
        </div>
      `;
    };
    host.innerHTML = `
      ${spot(second, '🥈', 2, '2nd', 'silver')}
      ${spot(first,  '🥇', 1, '1st', 'gold')}
      ${spot(third,  '🥉', 3, '3rd', 'bronze')}
    `;
    // full order
    const rest = this.finishOrder.slice(3);
    const fullHost = $('[data-full-order]');
    if (rest.length === 0) {
      fullHost.innerHTML = '';
    } else {
      fullHost.innerHTML = rest.map((m, i) => {
        const t = this.finishTimes[m.id] ? `${this.finishTimes[m.id].toFixed(1)}s` : '';
        return `<span class="full-order-row">${i + 4}. ${escapeHtml(m.name)} <span class="faint">${t}</span></span>`;
      }).join('');
    }
  }
};

/* =====================================================================
   BOOT
   ===================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  UI.init();
  ScreenManager.show('menu');
});
