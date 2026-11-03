/**
 * Bot AI System
 * Handles AI behavior for bots (villagers, guards, animals, monsters)
 */
import * as THREE from 'three';
import { _clamp } from '../core/utils.js';
import { RAY_PROP_ONLY } from '../core/physics.js';
import { CFG } from '../config/config.js';

// Scratch vectors shared by the bot loop - allocating two Vector3 per bot per
// frame churned the GC on entity-heavy scenes.
const _bPos = new THREE.Vector3();
const _mPos = new THREE.Vector3();

export function updateBots(entities, physics, terrainH, playerPos, player, dt) {
  // `player` is the PlayerController - the bot attack needs its body for the
  // knockback impulse and its damage() for real hurt.
  const bots = entities.all().filter(bot => bot && bot.category === 'bot');

  for (const bot of bots) {
    if (!bot.mesh || bot.bodyId === undefined) continue;

    bot.stateTimer -= dt;
    bot.attackTimer = Math.max(0, (bot.attackTimer || 0) - dt);
    bot.angerTimer = Math.max(0, (bot.angerTimer || 0) - dt);
    bot.currentSpeed = 0;

    const bPos = bot.mesh.getWorldPosition(_bPos);

    const behavior = bot.behavior || (bot.flee > 0 ? 'flee' : bot.attackRange > 0 ? 'aggressive' : 'passive');
    const attackRange = bot.attackRange || 0;
    const attackReady = bot.attackTimer <= 0;

    const dx = playerPos.x - bPos.x;
    const dz = playerPos.z - bPos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const dirX = dist > 0.1 ? dx / dist : 0;
    const dirZ = dist > 0.1 ? dz / dist : 0;
    let nextAction = 'idle';

    switch (bot.state) {
      case 'idle':
        if (bot.flee > 0 && dist < bot.flee) {
          bot.state = 'flee';
          break;
        }
        if (behavior === 'aggressive' && dist < bot.detect && _hasLos(physics, bPos, playerPos)) {
          bot.state = 'angry';
          bot.angerTimer = Math.max(bot.angerTimer, bot.angryDuration || 3);
          break;
        }
        if (bot.flee === 0 && behavior !== 'aggressive' && dist < bot.detect && _hasLos(physics, bPos, playerPos)) {
          bot.state = 'follow';
          break;
        }
        if (bot.stateTimer <= 0) {
          bot.state = 'wander';
          const d = 5 + Math.random() * 10;
          const pick = () => {
            const a = Math.random() * Math.PI * 2;
            return { x: bPos.x + Math.cos(a) * d, z: bPos.z + Math.sin(a) * d };
          };
          let t = pick();
          // Mobs cannot swim - re-roll a couple of times before committing to
          // a target that sits at the bottom of a lake.
          for (let tries = 0; tries < 2 && terrainH.gridHeight(t.x, t.z) < CFG.world.waterLevel + 0.3; tries++) {
            t = pick();
          }
          bot.targetPos = new THREE.Vector3(t.x, 0, t.z);
          bot.stateTimer = 4 + Math.random() * 5;
        }
        nextAction = 'idle';
        break;

      case 'wander':
        if (bot.flee > 0 && dist < bot.flee) {
          bot.state = 'flee';
          break;
        }
        if (behavior === 'aggressive' && dist < bot.detect && _hasLos(physics, bPos, playerPos)) {
          bot.state = 'angry';
          bot.angerTimer = Math.max(bot.angerTimer, bot.angryDuration || 3);
          break;
        }
        // 2D arrival test: wander targets are stored with y = 0 while bots
        // walk on terrain at y = height, so the old 3D distanceTo() could
        // never drop under the threshold and wander only ended via timeout.
        if (bot.targetPos) {
          const adx = bot.targetPos.x - bPos.x;
          const adz = bot.targetPos.z - bPos.z;
          if (adx * adx + adz * adz < 2.25 || bot.stateTimer <= 0) {
            bot.state = 'idle';
            bot.stateTimer = 2 + Math.random() * 3;
            break;
          }
        } else if (bot.stateTimer <= 0) {
          bot.state = 'idle';
          bot.stateTimer = 2 + Math.random() * 3;
          break;
        }
        _moveBot(bot, bot.targetPos, bot.speed, dt, terrainH, physics);
        nextAction = 'walk';
        break;

      case 'follow':
        if (dist > bot.detect * 1.5) {
          bot.state = 'idle';
          bot.stateTimer = 1;
          break;
        }
        _moveBot(bot, playerPos, bot.speed, dt, terrainH, physics);
        nextAction = 'walk';
        break;

      case 'angry':
        if (bot.flee > 0 && dist < bot.flee) {
          bot.state = 'flee';
          break;
        }
        if (dist > bot.detect * 1.7 && bot.angerTimer <= 0) {
          bot.state = 'idle';
          bot.stateTimer = 1.2;
          break;
        }
        if (attackRange > 0 && dist <= attackRange && attackReady) {
          bot.state = 'attack';
          bot.stateTimer = 0.35;
          bot.attackTimer = bot.attackCooldown || 1.2;
          _attackPlayer(bot, playerPos, player, bPos);
          nextAction = 'attack';
          break;
        }
        _moveBot(bot, playerPos, bot.speed * 1.08, dt, terrainH, physics);
        nextAction = 'angry';
        break;

      case 'attack':
        nextAction = 'attack';
        if (bot.stateTimer <= 0) {
          bot.state = dist <= bot.detect * 1.7 ? 'angry' : 'idle';
          bot.stateTimer = 0.6;
        }
        break;

      case 'flee':
        if (dist > bot.flee * 3.5) {
          bot.state = 'idle';
          bot.stateTimer = 2;
          break;
        }
        const away = new THREE.Vector3(-dirX, 0, -dirZ)
          .normalize()
          .multiplyScalar(20)
          .add(bPos);
        _moveBot(bot, away, bot.speed * 1.3, dt, terrainH, physics);
        nextAction = 'flee';
        break;
    }

    // Face movement direction with a smooth turn instead of an instant snap
    let targetHeading = null;
    if (bot.state === 'follow' || bot.state === 'angry' || bot.state === 'attack') {
      targetHeading = Math.atan2(dirX, dirZ);
    } else if (bot.state === 'flee') {
      targetHeading = Math.atan2(dirX, dirZ) + Math.PI;
    } else if (bot.state === 'wander' && bot.targetPos) {
      const tdx = bot.targetPos.x - bPos.x;
      const tdz = bot.targetPos.z - bPos.z;
      targetHeading = Math.atan2(tdx, tdz);
    }

    if (targetHeading !== null) {
      if (bot.heading === undefined) bot.heading = targetHeading;
      let diff = targetHeading - bot.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      const maxTurn = 6 * dt; // rad per second
      bot.heading += _clamp(diff, -maxTurn, maxTurn);
      bot.heading = Math.atan2(Math.sin(bot.heading), Math.cos(bot.heading));
      bot.mesh.rotation.y = bot.heading;
    }

    bot.action = nextAction;

    if (bot.animation) {
      if (bot.animation.state !== bot.action) {
        const played = bot.animation.playAction(bot.action);
        if (!played && bot.animation.state !== 'idle') {
          bot.animation.playAction('idle');
        }
      }
      // Procedural animators scale the gait by the speed they are given;
      // GLB mixers just ignore the extra argument.
      if (typeof bot.animation.update === 'function') {
        bot.animation.update(dt, bot.currentSpeed || 0);
      }
    }
  }
}

function _attackPlayer(bot, playerPos, player, bPos) {
  const body = player?.body;
  if (!body || typeof body.applyImpulse !== 'function') return;

  const dx = playerPos.x - bPos.x;
  const dz = playerPos.z - bPos.z;
  const dist = Math.max(0.001, Math.sqrt(dx * dx + dz * dz));
  const nx = dx / dist;
  const nz = dz / dist;
  const force = bot.attackForce || 8;

  body.applyImpulse({ x: nx * force, y: 1.5, z: nz * force }, true);

  // Damage on top of the knockback; the player controller gates it behind
  // its invulnerability window and fires the UI hooks.
  player.damage?.(bot.config?.damage || 6);
}

function _moveBot(bot, target, speed, dt, terrainH, physics) {
  const bPos = bot.mesh.getWorldPosition(_mPos);

  const dx = target.x - bPos.x;
  const dz = target.z - bPos.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist < 0.3) return;

  const nx = dx / dist;
  const nz = dz / dist;
  const step = speed * dt;

  // Steer around props. Kinematic bodies follow their scripted path no matter
  // what, so without this check mobs ghosted straight through trees, rocks
  // and houses. The ray is capped short of the destination so the player's
  // own capsule (same collision group as props) never reads as a wall while
  // a mob closes in for the attack.
  let mx = nx;
  let mz = nz;
  const rayLen = Math.min(1.4, dist - 0.9);
  if (rayLen > 0.3 && _blocked(physics, bPos, nx, nz, rayLen)) {
    let clear = false;
    for (const deg of [40, -40, 80, -80]) {
      const a = deg * Math.PI / 180;
      const cx = nx * Math.cos(a) - nz * Math.sin(a);
      const cz = nx * Math.sin(a) + nz * Math.cos(a);
      if (!_blocked(physics, bPos, cx, cz, rayLen)) {
        mx = cx;
        mz = cz;
        clear = true;
        break;
      }
    }
    // Boxed in on every side - hold position this frame instead of
    // clipping through the obstacle.
    if (!clear) return;
  }

  const newX = bPos.x + mx * step;
  const newZ = bPos.z + mz * step;
  // Follow the rendered terrain surface (see TerrainHeight.gridHeight) so mobs
  // do not float above or clip into slopes while walking.
  const newY = terrainH.gridHeight(newX, newZ);

  bot.mesh.position.set(
    newX - bot.mesh.parent.position.x,
    newY,
    newZ - bot.mesh.parent.position.z
  );

  const body = physics.bodies.get(bot.bodyId);
  if (body) body.body.setNextKinematicTranslation({ x: newX, y: newY, z: newZ });

  bot.position.set(newX, newY, newZ);
  bot.currentSpeed = speed; // remembered for the procedural walk animation
}

function _blocked(physics, origin, dx, dz, len) {
  const from = { x: origin.x, y: origin.y + 0.7, z: origin.z };
  const to = { x: origin.x + dx * len, y: origin.y + 0.7, z: origin.z + dz * len };
  return physics.raycast(from, to, RAY_PROP_ONLY) !== null;
}

/**
 * True when nothing stands between the bot's eyes and the player's chest.
 * The ray stops 0.8 short of the chest so the player capsule never counts as
 * an obstruction, and starts inside the bot's own capsule which raycast()
 * already ignores (solid = false).
 */
function _hasLos(physics, bPos, playerPos) {
  const fx = bPos.x;
  const fy = bPos.y + 1.4;
  const fz = bPos.z;
  const dx = playerPos.x - fx;
  const dy = playerPos.y + 0.9 - fy;
  const dz = playerPos.z - fz;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist <= 1.2) return true;

  const t = (dist - 0.8) / dist;
  const to = { x: fx + dx * t, y: fy + dy * t, z: fz + dz * t };
  return physics.raycast({ x: fx, y: fy, z: fz }, to) === null;
}
