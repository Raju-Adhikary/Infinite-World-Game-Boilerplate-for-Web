/**
 * Procedural Animation System
 * Drives limb and pose animation for models that have no GLB animation clips.
 * Mesh factories attach a plain rig object to mesh.userData.rig:
 *   humanoid: { kind: 'humanoid', inner, head, armL, armR, legL, legR }
 *   quadruped: { kind: 'quadruped', inner, head, legFL, legFR, legBL, legBR, tail }
 * `inner` is a group holding the whole body so it can bob and lean without
 * fighting the terrain placement applied to the mesh root.
 * All rotations are damped so pose changes never pop.
 */
import { _clamp } from '../core/utils.js';

const ATTACK_DURATION = 0.35; // matches the bot attack state timer
const POSE_LERP = 12;         // pose damping rate (1/s)

function _ease(node, axis, target, dt, rate = POSE_LERP) {
  node.rotation[axis] += (target - node.rotation[axis]) * Math.min(1, rate * dt);
}

function _easeY(node, target, dt, rate = POSE_LERP) {
  node.position.y += (target - node.position.y) * Math.min(1, rate * dt);
}

export function createProceduralAnimator(root) {
  const rig = root?.userData?.rig;
  if (!rig) return null;

  const KNOWN_ACTIONS = new Set(['idle', 'walk', 'angry', 'attack', 'flee']);
  const anim = {
    phase: Math.random() * Math.PI * 2,
    t: Math.random() * 10,
    attackT: 0,
    state: 'idle',
  };

  return {
    get state() { return anim.state; },
    playAction(action) {
      if (!KNOWN_ACTIONS.has(action)) return false;
      if (action === 'attack') anim.attackT = ATTACK_DURATION;
      anim.state = action;
      return true;
    },
    update(dt, speed = 0, airborne = false, swim = false) {
      anim.t += dt;
      if (anim.attackT > 0) anim.attackT = Math.max(0, anim.attackT - dt);

      const moving = speed > 0.15;
      const speedFactor = _clamp(speed / 4, 0, 1.4);

      if (rig.kind === 'quadruped') {
        _updateQuadruped(anim, rig, dt, moving, speedFactor);
      } else {
        _updateHumanoid(anim, rig, dt, moving, speedFactor, airborne, swim);
      }
    },
  };
}

function _updateHumanoid(anim, rig, dt, moving, speedFactor, airborne, swim) {
  const { inner, head, armL, armR, legL, legR } = rig;

  // Attack lunge overrides locomotion
  if (anim.attackT > 0) {
    const p = 1 - anim.attackT / ATTACK_DURATION;
    const punch = Math.sin(p * Math.PI);
    _ease(armR, 'x', -punch * 2.1, dt, 20);
    _ease(armL, 'x', punch * 0.4 - 0.2, dt);
    _ease(inner, 'x', punch * 0.15, dt);
    _ease(legL, 'x', 0, dt);
    _ease(legR, 'x', 0, dt);
    _easeY(inner, 0, dt);
    return;
  }

  if (swim) {
    // Surface crawl: body pitched forward into the water, alternating arm
    // strokes and a flutter kick. Everything is damped, so leaving the water
    // blends straight back into the locomotion poses.
    anim.phase += dt * (2.4 + speedFactor * 3.2);
    const swing = Math.sin(anim.phase);
    _ease(inner, 'x', 1.28, dt, 5);
    _easeY(inner, 0, dt);
    _ease(armL, 'x', -1.5 + swing * 0.85, dt, 7);
    _ease(armR, 'x', -1.5 - swing * 0.85, dt, 7);
    _ease(legL, 'x', swing * 0.4, dt, 7);
    _ease(legR, 'x', -swing * 0.4, dt, 7);
    _ease(head, 'y', 0, dt);
    return;
  }

  if (airborne) {
    // Legs tucked, arms out while jumping or falling
    _ease(legL, 'x', -0.55, dt);
    _ease(legR, 'x', 0.3, dt);
    _ease(armL, 'x', -0.7, dt);
    _ease(armR, 'x', -0.7, dt);
    _ease(inner, 'x', 0.05, dt);
    _easeY(inner, 0, dt);
    return;
  }

  if (moving) {
    anim.phase += dt * (4 + speedFactor * 9);
    const amp = 0.45 + 0.4 * speedFactor;
    const swing = Math.sin(anim.phase) * amp;

    _ease(legL, 'x', swing, dt);
    _ease(legR, 'x', -swing, dt);

    let armLTarget = -swing * 0.8;
    let armRTarget = swing * 0.8;
    if (anim.state === 'flee') {
      // arms raised while sprinting away
      armLTarget = -0.6 + swing * 0.3;
      armRTarget = -0.6 - swing * 0.3;
    } else if (anim.state === 'angry') {
      // both arms reaching forward while charging
      armLTarget = -0.7;
      armRTarget = -0.7;
    }
    _ease(armL, 'x', armLTarget, dt);
    _ease(armR, 'x', armRTarget, dt);

    _ease(inner, 'x', 0.05 + 0.1 * speedFactor, dt); // run lean
    _easeY(inner, Math.abs(Math.cos(anim.phase)) * 0.05 * speedFactor, dt);
  } else {
    // idle: breathing, subtle arm sway and a slow look-around
    const sway = Math.sin(anim.t * 1.6) * 0.06;
    _ease(armL, 'x', sway, dt);
    _ease(armR, 'x', -sway, dt);
    _ease(legL, 'x', 0, dt);
    _ease(legR, 'x', 0, dt);
    _ease(inner, 'x', anim.state === 'angry' ? 0.18 : 0, dt);
    _easeY(inner, Math.sin(anim.t * 2.2) * 0.012, dt);
    _ease(head, 'y', Math.sin(anim.t * 0.5) * 0.2, dt);
    return;
  }

  _ease(head, 'y', 0, dt);
}

function _updateQuadruped(anim, rig, dt, moving, speedFactor) {
  const { inner, head } = rig;

  if (moving) {
    anim.phase += dt * (5 + speedFactor * 10);
    const amp = 0.5 + 0.4 * speedFactor;
    const swing = Math.sin(anim.phase) * amp;

    // Diagonal leg pairs, like a real trot
    _ease(rig.legFL, 'x', swing, dt);
    _ease(rig.legBR, 'x', swing, dt);
    _ease(rig.legFR, 'x', -swing, dt);
    _ease(rig.legBL, 'x', -swing, dt);

    _easeY(inner, Math.abs(Math.cos(anim.phase)) * 0.05 * speedFactor, dt);
    _ease(head, 'x', anim.state === 'flee' ? -0.2 : Math.sin(anim.phase * 2) * 0.07, dt);
  } else {
    for (const key of ['legFL', 'legFR', 'legBL', 'legBR']) {
      _ease(rig[key], 'x', 0, dt);
    }
    _easeY(inner, Math.sin(anim.t * 2) * 0.01, dt);
    _ease(head, 'y', Math.sin(anim.t * 0.4) * 0.35, dt);
    _ease(head, 'x', 0, dt);
  }

  if (rig.tail) {
    rig.tail.rotation.z = Math.sin(anim.t * (anim.state === 'flee' ? 14 : 6)) * 0.3;
  }
}

/**
 * Wind sway for small flora (flowers, bushes, mushrooms).
 * Rotates the instance root around its base; rotation.y is left untouched
 * so the random per-instance orientation survives.
 */
export function createSwayAnimator(root) {
  let t = Math.random() * 10;
  const phase = Math.random() * Math.PI * 2;

  return {
    state: 'idle',
    playAction() { return true; },
    update(dt) {
      t += dt;
      root.rotation.z = Math.sin(t * 1.3 + phase) * 0.045;
      root.rotation.x = Math.cos(t * 0.8 + phase) * 0.03;
    },
  };
}
