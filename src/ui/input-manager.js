/**
 * Input Manager
 * Handles keyboard, mouse, and touch input
 */
import { _clamp } from '../core/utils.js';

export class InputManager {
  constructor() {
    this.keys = {};
    this.actions = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      jump: false,
      interact: false,
      sprint: false
    };
    this.lookDelta = { x: 0, y: 0 };
    this.pointerLocked = false;
    this.joyVec = { x: 0, y: 0 };
    this.isTouchDevice = false;

    this._joyActive = false;
    this._joyStart = null;
    this._joyId = null;
    this._lookId = null;
    this._lookPrev = null;

    this._onKey = e => {
      this.keys[e.code] = e.type === 'keydown';
      this._updateActions();
    };

    this._onPM = e => {
      if (e.type === 'pointerlockchange') {
        this.pointerLocked = !!document.pointerLockElement;
      }
    };

    this._onMM = e => {
      if (this.pointerLocked) {
        this.lookDelta.x += e.movementX;
        this.lookDelta.y += e.movementY;
      }
    };

    window.addEventListener('keydown', this._onKey);
    window.addEventListener('keyup', this._onKey);
    document.addEventListener('pointerlockchange', this._onPM);
    document.addEventListener('mousemove', this._onMM);
  }

  _updateActions() {
    this.actions.forward = !!(this.keys['KeyW'] || this.keys['ArrowUp']);
    this.actions.backward = !!(this.keys['KeyS'] || this.keys['ArrowDown']);
    this.actions.left = !!(this.keys['KeyA'] || this.keys['ArrowLeft']);
    this.actions.right = !!(this.keys['KeyD'] || this.keys['ArrowRight']);
    this.actions.jump = !!this.keys['Space'];
    this.actions.interact = !!this.keys['KeyE'];
    this.actions.sprint = !!(this.keys['ShiftLeft'] || this.keys['ShiftRight']);
  }

  initTouch() {
    this.isTouchDevice = true;

    const jz = document.getElementById('joystick-zone');
    const jt = document.getElementById('joystick-thumb');
    const jb = document.getElementById('btn-jump');

    jz.addEventListener('touchstart', e => {
      e.preventDefault();
      const t = e.changedTouches[0];
      this._joyId = t.identifier;
      this._joyActive = true;
      this._joyStart = { x: t.clientX, y: t.clientY };
      jt.style.background = 'rgba(232,160,32,0.8)';
    }, { passive: false });

    jz.addEventListener('touchmove', e => {
        e.preventDefault();
        if (!this._joyActive) return;

        const max = 100;

        for (const touch of e.changedTouches) {
            if (touch.identifier !== this._joyId) continue;

            let dx = touch.clientX - this._joyStart.x;
            let dy = touch.clientY - this._joyStart.y;

            const dist = Math.hypot(dx, dy);

            if (dist > max) {
                const scale = max / dist;
                dx *= scale;
                dy *= scale;
            }

            jt.style.transform = `translate(${-50 + dx}%, ${-50 + dy}%)`;

            this.joyVec.x = _clamp(dx / max, -1, 1);
            this.joyVec.y = _clamp(dy / max, -1, 1);
        }
    }, { passive: false });

    const endJoy = () => {
      this._joyActive = false;
      this.joyVec.x = 0;
      this.joyVec.y = 0;
      jt.style.transform = 'translate(-50%,-50%)';
      jt.style.background = 'rgba(232,160,32,0.5)';
    };

    jz.addEventListener('touchend', endJoy);
    jz.addEventListener('touchcancel', endJoy);

    jb.addEventListener('touchstart', e => {
      e.preventDefault();
      this.actions.jump = true;
    }, { passive: false });

    jb.addEventListener('touchend', () => this.actions.jump = false);
    jb.addEventListener('touchcancel', () => this.actions.jump = false);

    // Camera look via right-side touch
    document.addEventListener('touchstart', e => {
      for (const t of e.changedTouches) {
        if (t.clientX > window.innerWidth * 0.35 && t.clientX < window.innerWidth - 80) {
          this._lookId = t.identifier;
          this._lookPrev = { x: t.clientX, y: t.clientY };
        }
      }
    });

    document.addEventListener('touchmove', e => {
      if (this._lookId === null) return;

      for (const t of e.changedTouches) {
        if (t.identifier !== this._lookId) continue;
        if (this._lookPrev) {
          this.lookDelta.x += (t.clientX - this._lookPrev.x) * 0.8;
          this.lookDelta.y += (t.clientY - this._lookPrev.y) * 0.8;
        }
        this._lookPrev = { x: t.clientX, y: t.clientY };
      }
    }, { passive: false });

    document.addEventListener('touchend', e => {
      for (const t of e.changedTouches) {
        if (t.identifier === this._lookId) {
          this._lookId = null;
          this._lookPrev = null;
        }
      }
    });

    document.addEventListener('touchcancel', e => {
      for (const t of e.changedTouches) {
        if (t.identifier === this._lookId) {
          this._lookId = null;
          this._lookPrev = null;
        }
      }
    });
  }

  consumeLook() {
    const d = { x: this.lookDelta.x, y: this.lookDelta.y };
    this.lookDelta.x = 0;
    this.lookDelta.y = 0;
    return d;
  }

  getMove() {
    let x = 0, z = 0;

    if (this.actions.forward) z -= 1;
    if (this.actions.backward) z += 1;
    if (this.actions.left) x -= 1;
    if (this.actions.right) x += 1;

    if (this._joyActive) {
      x += this.joyVec.x;
      z += this.joyVec.y;
    }

    const len = Math.sqrt(x * x + z * z);
    if (len > 1) {
      x /= len;
      z /= len;
    }

    return { x, z };
  }

  reset() {
    this.keys = {};
    this.actions = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      jump: false,
      interact: false,
      sprint: false
    };
    this.lookDelta = { x: 0, y: 0 };
    this.joyVec = { x: 0, y: 0 };
  }
}
