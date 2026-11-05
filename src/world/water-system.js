/**
 * Water System
 * One large translucent surface that follows the player and fills every
 * terrain basin below CFG.world.waterLevel. Also drives underwater fog while
 * the camera is submerged.
 *
 * Waves are depth-aware: the chop fades to flat in shallow water, so small
 * ponds and lake shores stay calm. Without this, the fixed-amplitude waves
 * crested over tiny pond banks and dipped below them again, which read as
 * the ground releasing and absorbing water in blinks.
 */
import * as THREE from 'three';
import { CFG } from '../config/config.js';

// 720m across (radius 360 > fogFar 280) so in open ocean the plane edge is
// always beyond full fog and the horizon reads as endless water
const PLANE_SIZE = 720;
// 120 segments over 720m = 6m cells - fine enough for pond-scale shore fades
const SEGMENTS = 120;
// Terrain depths are refreshed a few hundred vertices per frame in a
// round-robin pass instead of all at once (~9.4k height samples per frame
// would cost several milliseconds). Terrain never changes, so each vertex
// only needs an occasional resample as the plane glides along.
const DEPTH_REFRESH_PER_FRAME = 128;
// Water shallower than this (in meters) calms linearly to perfectly flat.
const WAVE_FADE_DEPTH = 1.5;

function _shoreFade(depth) {
  let f = depth / WAVE_FADE_DEPTH;
  if (f < 0) f = 0;
  else if (f > 1) f = 1;
  return f * f * (3 - 2 * f); // smoothstep: clean, flicker-free waterline
}

export class WaterSystem {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    this.level = CFG.world.waterLevel;

    const geo = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE, SEGMENTS, SEGMENTS);
    geo.rotateX(-Math.PI / 2);
    // Remember each vertex's local XZ so the wave phase can be computed from
    // world coordinates: the pattern stays anchored to the world instead of
    // sliding when the plane re-centers on the player.
    this._base = geo.getAttribute('position').array.slice();

    // Depth of the terrain below the water line at every vertex, used to
    // calm the waves near shores and in small ponds. Seeded fully so the
    // surface is correct on the very first frame.
    const count = geo.getAttribute('position').count;
    this._depth = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this._depth[i] = this.level - terrain.get(this._base[i * 3], this._base[i * 3 + 2]);
    }
    this._depthCursor = 0;

    this.material = new THREE.MeshLambertMaterial({
      color: 0x3a7ca8,
      transparent: true,
      opacity: 0.66,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.y = this.level;
    this.mesh.receiveShadow = false;
    scene.add(this.mesh);

    this._t = 0;
    this._wasUnderwater = false;
    this._underwaterColor = new THREE.Color(0x184a5e);
  }

  update(playerPos, dt, camera, sky) {
    this.mesh.position.x = playerPos.x;
    this.mesh.position.z = playerPos.z;

    this._t += dt;
    const pos = this.mesh.geometry.getAttribute('position');
    const base = this._base;
    const ox = this.mesh.position.x;
    const oz = this.mesh.position.z;
    const count = pos.count;

    // Refresh a slice of the depth field (world-anchored; terrain is static)
    for (let k = 0; k < DEPTH_REFRESH_PER_FRAME; k++) {
      const i = this._depthCursor;
      this._depth[i] = this.level - this.terrain.get(base[i * 3] + ox, base[i * 3 + 2] + oz);
      this._depthCursor = (this._depthCursor + 1) % count;
    }

    // Gentle two-axis chop, phased in world space (see _base above), faded
    // out in shallow water so ponds and shores stay calm
    for (let i = 0; i < count; i++) {
      const wx = base[i * 3] + ox;
      const wz = base[i * 3 + 2] + oz;
      const fade = _shoreFade(this._depth[i]);
      pos.setY(i,
        fade * (
          Math.sin(wx * 0.35 + this._t * 1.4) * 0.05 +
          Math.cos(wz * 0.30 + this._t * 1.1) * 0.05
        )
      );
    }
    pos.needsUpdate = true;

    // Underwater fog. sky.update() rewrites fog color every frame from its
    // palette, so while submerged we override AFTER it; on surfacing we only
    // restore near/far once and let the sky reclaim the colors.
    const fog = this.scene.fog;
    if (!fog) return;
    const underwater = camera.position.y < this.level;
    if (underwater) {
      fog.color.copy(this._underwaterColor);
      fog.near = 1;
      fog.far = 26;
      if (this.scene.background && this.scene.background.isColor) {
        this.scene.background.copy(this._underwaterColor);
      }
    } else if (this._wasUnderwater) {
      fog.near = CFG.world.fogNear;
      fog.far = CFG.world.fogFar;
      if (sky && this.scene.background && this.scene.background.isColor) {
        this.scene.background.copy(sky.skyColor);
      }
    }
    this._wasUnderwater = underwater;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
