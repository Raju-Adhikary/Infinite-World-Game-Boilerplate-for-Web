/**
 * Physics World
 * Wrapper around Rapier physics engine
 */
import * as THREE from 'three';
import Rapier from '@dimforge/rapier3d-compat';
import { _uid } from './utils.js';

// Interaction groups (rapier format: membership << 16 | filter).
// Bit 0 = terrain, bit 1 = props and characters. Both still collide with
// everything as before; the groups exist so the camera ray can query the
// terrain alone (FILTER_TERRAIN_ONLY) without props popping the camera in,
// and mob steering rays can query props alone (RAY_PROP_ONLY) without every
// slope registering as a wall.
export const GROUP_TERRAIN = 0x0001ffff;
export const GROUP_PROP = 0x0002ffff;
export const FILTER_TERRAIN_ONLY = 0x00010001;
export const RAY_PROP_ONLY = 0x00020002;

export class PhysicsWorld {
  constructor() {
    this.world = null;
    this.bodies = new Map();
  }

  async init() {
    await Rapier.init();
    this.world = new Rapier.World({ x: 0, y: -9.81, z: 0 });
  }

  step(dt) {
    if (!this.world) return;
    // Rapier's default timestep is fixed at 1/60 regardless of framerate, which
    // makes the whole simulation run faster than real time above 60 FPS and
    // slower below it. Sub-step so each integration stays <= 1/60 while the
    // total advanced time matches the real frame delta.
    const clamped = Math.min(Math.max(dt, 0.0001), 0.05);
    const substeps = Math.max(1, Math.ceil(clamped / (1 / 60)));
    const h = clamped / substeps;
    this.world.timestep = h;
    for (let i = 0; i < substeps; i++) {
      this.world.step();
    }
  }

  createBody(desc, colDesc = null) {
    const b = this.world.createRigidBody(desc);
    let c = null;
    if (colDesc) {
      c = this.world.createCollider(colDesc, b);
    }
    const id = _uid();
    this.bodies.set(id, { body: b, collider: c });
    return { body: b, collider: c, id };
  }

  removeBody(id) {
    const d = this.bodies.get(id);
    if (!d) return;
    if (d.collider) this.world.removeCollider(d.collider);
    this.world.removeRigidBody(d.body);
    this.bodies.delete(id);
  }

  raycast(from, to, filterGroups = undefined) {
    if (!this.world) return null;

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist <= 0) return null;

    const dir = { x: dx / dist, y: dy / dist, z: dz / dist };
    // solid=false: colliders that contain the ray origin are ignored. This
    // lets a ground-check ray start inside the player's own capsule without
    // hitting it at toi=0 (terrain trimeshes are hollow, so a ray starting
    // BELOW the feet would miss the ground entirely).
    return this.world.castRay(new Rapier.Ray(from, dir), dist, false, undefined, filterGroups);
  }

  /**
   * Like raycast(), but also returns the surface normal at the hit point:
   * { toi, nx, ny, nz } or null. The ground check needs the normal to tell
   * walkable slopes from wall faces (Rapier 0.12's plain castRay hit carries
   * no normal, so this goes through castRayAndGetNormal).
   */
  raycastWithNormal(from, to, filterGroups = undefined) {
    if (!this.world) return null;

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist <= 0) return null;

    const dir = { x: dx / dist, y: dy / dist, z: dz / dist };
    const hit = this.world.castRayAndGetNormal(new Rapier.Ray(from, dir), dist, false, undefined, filterGroups);
    if (!hit) return null;
    return { toi: hit.toi, nx: hit.normal.x, ny: hit.normal.y, nz: hit.normal.z };
  }

  getBodyPos(b) {
    const p = b.translation();
    return new THREE.Vector3(p.x, p.y, p.z);
  }

  bodyCount() {
    return this.bodies.size;
  }
}
