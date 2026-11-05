/**
 * UI Manager
 * Handles all UI screens and menus
 */
import { CFG } from '../config/config.js';

const CAMERA_MODES = ['first-person', 'third-person', 'shoulder'];

export class UIManager {
  constructor(input) {
    this.input = input;
    this.debugEl = document.getElementById('debug-panel');
    this.startEl = document.getElementById('start-screen');
    this.pauseEl = document.getElementById('pause-screen');
    this.settingsEl = document.getElementById('settings-screen');
    this.loadingEl = document.getElementById('loading-screen');
    this.mobileCtrl = document.getElementById('mobile-controls');
    this.crosshair = document.getElementById('crosshair');
    this.healthBar = document.getElementById('health-bar');
    this.healthFill = document.getElementById('health-fill');
    this.vignette = document.getElementById('damage-vignette');
    this.deathEl = document.getElementById('death-screen');
    this.prevSettings = null;
    this._vignetteTimer = null;

    // Show the active world seed on the menu footer - it fully determines
    // the generated world and can be shared via ?seed=
    const seedLabel = document.getElementById('seed-label');
    if (seedLabel) seedLabel.textContent = `seed ${CFG.world.seed}`;

    // Settings must load BEFORE the controls bind: binding a range input
    // fires its callback once with the DOM's uninitialized midpoint value,
    // which used to override every saved slider setting (render distance
    // booted as 4.5 instead of 3, FOV as 80, volumes and sensitivity off).
    this._loadSettings();
    this._bind();
  }

  _bind() {
    document.getElementById('btn-play').onclick = () => this._emit('play');
    document.getElementById('btn-start-settings').onclick = () => {
      this.startEl.classList.add('hidden');
      this.settingsEl.classList.remove('hidden');
      this.prevSettings = 'start';
    };

    document.getElementById('btn-resume').onclick = () => this._emit('resume');
    document.getElementById('btn-pause-settings').onclick = () => {
      this.pauseEl.classList.add('hidden');
      this.settingsEl.classList.remove('hidden');
      this.prevSettings = 'pause';
    };

    document.getElementById('btn-quit').onclick = () => this._emit('quit');
    document.getElementById('btn-settings-back').onclick = () => {
      this.settingsEl.classList.add('hidden');
      if (this.prevSettings === 'start') this.startEl.classList.remove('hidden');
      else if (this.prevSettings === 'pause') this.pauseEl.classList.remove('hidden');
      this._saveSettings();
    };

    // Settings controls
    const bind = (id, cb) => {
      const el = document.getElementById(id);
      el.addEventListener('input', () => cb(el));
      if (el.type === 'range') cb(el);
    };

    bind('s-render-dist', el => {
      CFG.settings.renderDist = +el.value;
      document.getElementById('v-render-dist').textContent = el.value;
    });

    bind('s-fov', el => {
      CFG.settings.fov = +el.value;
      document.getElementById('v-fov').textContent = el.value;
    });

    bind('s-master-vol', el => {
      CFG.settings.masterVol = +el.value;
      document.getElementById('v-master-vol').textContent = el.value;
    });

    bind('s-sfx-vol', el => {
      CFG.settings.sfxVol = +el.value;
      document.getElementById('v-sfx-vol').textContent = el.value;
    });

    bind('s-music-vol', el => {
      CFG.settings.musicVol = +el.value;
      document.getElementById('v-music-vol').textContent = el.value;
    });

    bind('s-sensitivity', el => {
      CFG.settings.sensitivity = +el.value;
      document.getElementById('v-sensitivity').textContent = el.value;
    });

    const cameraModeBtn = document.getElementById('s-camera-mode');
    const syncCameraMode = () => {
      document.getElementById('v-camera-mode').textContent = CFG.settings.cameraMode;
      cameraModeBtn.textContent = CFG.settings.cameraMode;
      cameraModeBtn.classList.toggle('on', CFG.settings.cameraMode !== 'first-person');
    };
    cameraModeBtn.onclick = () => {
      const idx = CAMERA_MODES.indexOf(CFG.settings.cameraMode);
      CFG.settings.cameraMode = CAMERA_MODES[(idx + 1) % CAMERA_MODES.length];
      syncCameraMode();
    };

    // Toggles
    const tog = (id, key) => {
      const el = document.getElementById(id);
      el.onclick = () => {
        CFG.settings[key] = !CFG.settings[key];
        el.classList.toggle('on', CFG.settings[key]);
      };
    };

    tog('s-shadows', 'shadows');
    tog('s-show-fps', 'showFps');
    tog('s-invert-y', 'invertY');

    // Keyboard shortcuts
    this._onKey = e => {
      if (e.code === 'Escape') this._emit('toggle-pause');
      if (e.code === 'F3') {
        e.preventDefault();
        this._emit('toggle-debug');
      }
    };

    window.addEventListener('keydown', this._onKey);
  }

  _emit(ev) {
    // Handlers are assigned camelCase (ontogglePause) but event names are
    // kebab-case ('toggle-pause') - the plain lookup found nothing, so the
    // Escape pause and F3 debug shortcuts silently did nothing.
    const prop = 'on' + ev.replace(/-(\w)/g, (_, c) => c.toUpperCase());
    this[prop]?.();
  }

  _loadSettings() {
    try {
      const s = localStorage.getItem('ge_settings');
      if (s) Object.assign(CFG.settings, JSON.parse(s));
    } catch (err) {
      console.warn('Failed to load settings:', err);
    }

    // Sync UI
    const set = (id, vId, val) => {
      const el = document.getElementById(id);
      if (el) {
        el.value = val;
        if (vId) document.getElementById(vId).textContent = val;
      }
    };

    set('s-render-dist', 'v-render-dist', CFG.settings.renderDist);
    set('s-fov', 'v-fov', CFG.settings.fov);
    set('s-master-vol', 'v-master-vol', CFG.settings.masterVol);
    set('s-sfx-vol', 'v-sfx-vol', CFG.settings.sfxVol);
    set('s-music-vol', 'v-music-vol', CFG.settings.musicVol);
    set('s-sensitivity', 'v-sensitivity', CFG.settings.sensitivity);

    if (CAMERA_MODES.includes(CFG.settings.cameraMode)) {
      document.getElementById('v-camera-mode').textContent = CFG.settings.cameraMode;
      document.getElementById('s-camera-mode').textContent = CFG.settings.cameraMode;
      document.getElementById('s-camera-mode').classList.toggle('on', CFG.settings.cameraMode !== 'first-person');
    } else {
      CFG.settings.cameraMode = 'third-person';
      document.getElementById('v-camera-mode').textContent = CFG.settings.cameraMode;
      document.getElementById('s-camera-mode').textContent = CFG.settings.cameraMode;
      document.getElementById('s-camera-mode').classList.add('on');
    }

    document.getElementById('s-shadows').classList.toggle('on', CFG.settings.shadows);
    document.getElementById('s-show-fps').classList.toggle('on', CFG.settings.showFps);
    document.getElementById('s-invert-y').classList.toggle('on', CFG.settings.invertY);
  }

  _saveSettings() {
    try {
      localStorage.setItem('ge_settings', JSON.stringify(CFG.settings));
    } catch (err) {
      console.warn('Failed to save settings:', err);
    }
  }

  destroy() {
    window.removeEventListener('keydown', this._onKey);
  }

  showLoading() { this.loadingEl.classList.remove('hidden'); }
  hideLoading() { this.loadingEl.classList.add('hidden'); }
  showStart() { this.startEl.classList.remove('hidden'); this.crosshair.classList.add('hidden'); this.hideHud(); }
  hideStart() { this.startEl.classList.add('hidden'); }
  showPause() {
    this.pauseEl.classList.remove('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
    this.crosshair.classList.add('hidden');
  }
  hidePause() {
    this.pauseEl.classList.add('hidden');
    this.crosshair.classList.remove('hidden');
    if (!this.input.isTouchDevice) {
      try {
        const p = document.getElementById('game-container')?.requestPointerLock();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (e) { /* pointer lock unavailable - not fatal */ }
    }
  }
  showMobileControls() { this.mobileCtrl.classList.remove('hidden'); }
  toggleDebug() { this.debugEl.classList.toggle('hidden'); }

  // --- HUD: health, damage feedback, death ---

  showHud() { this.healthBar?.classList.remove('hidden'); }

  hideHud() { this.healthBar?.classList.add('hidden'); }

  updateHealth(pct) {
    if (!this.healthFill) return;
    const p = Math.max(0, Math.min(1, pct));
    this.healthFill.style.width = (p * 100).toFixed(1) + '%';
    this.healthFill.classList.toggle('low', p < 0.3);
  }

  flashDamage() {
    if (!this.vignette) return;
    this.vignette.classList.add('hurt');
    clearTimeout(this._vignetteTimer);
    this._vignetteTimer = setTimeout(() => this.vignette.classList.remove('hurt'), 320);
  }

  showDeath() {
    this.deathEl?.classList.remove('hidden');
    this.crosshair.classList.add('hidden');
  }

  hideDeath() {
    this.deathEl?.classList.add('hidden');
    this.crosshair.classList.remove('hidden');
  }

  updateDebug(data) {
    if (!CFG.settings.showFps) {
      this.debugEl.classList.add('hidden');
      return;
    }

    this.debugEl.classList.remove('hidden');
    const c = data.fps > 50 ? 'dbg-ok' : data.fps > 30 ? 'dbg-val' : 'dbg-err';
    this.debugEl.innerHTML =
      `<span class="dbg-label">FPS</span> <span class="${c}">${data.fps}</span><br>` +
      `<span class="dbg-label">Entities</span> <span class="dbg-val">${data.entities}</span><br>` +
      `<span class="dbg-label">Chunks</span> <span class="dbg-val">${data.chunks}</span><br>` +
      `<span class="dbg-label">Physics</span> <span class="dbg-val">${data.physicsBodies}</span><br>` +
      `<span class="dbg-label">Pos</span> <span class="dbg-val">${data.pos.x.toFixed(1)}, ${data.pos.y.toFixed(1)}, ${data.pos.z.toFixed(1)}</span><br>` +
      `<span class="dbg-label">Vel</span> <span class="dbg-val">${data.vel.y.toFixed(1)} y</span><br>` +
      `<span class="dbg-label">Draws</span> <span class="dbg-val">${data.drawCalls}</span><br>` +
      `<span class="dbg-label">Tris</span> <span class="dbg-val">${(data.triangles / 1000).toFixed(1)}k</span><br>` +
      `<span class="dbg-label">Biome</span> <span class="dbg-val">${data.biome}</span><br>` +
      `<span class="dbg-label">Time</span> <span class="dbg-val">${data.time ?? '--:--'}</span><br>` +
      `<span class="dbg-label">Seed</span> <span class="dbg-val">${data.seed ?? '--'}</span><br>` +
      (data.entityTypes ? `<span class="dbg-label">Types</span> <span class="dbg-val">${Object.entries(data.entityTypes).map(([k, v]) => k + ':' + v).join(' ')}</span>` : '');
  }
}
