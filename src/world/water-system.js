/**
 * Water System
 * One large translucent surface that follows the player and fills every
 * terrain basin below CFG.world.waterLevel. Also drives underwater fog while
 * the camera is submerged.
 *
 * Waves are depth-aware and SHADER-VISIBLE:
 * - the chop fades to flat in shallow water, so small ponds and lake shores
 *   stay calm (fixed-amplitude waves over tiny pond banks read as the ground
 *   releasing and absorbing water in blinks)
 * - open ocean runs bigger trains plus a long swell, so large water bodies
 *   visibly move
 * - the surface is MeshPhong with ANALYTICALLY animated normals: the wave
 *   slopes are derived per vertex and written into the normal attribute, so
 *   the lighting and sun glints ripple with the waves. The old surface only
 *   deformed vertices and never touched normals, which made the open ocean
 *   read as dead flat glass - there was no shoreline to silhouette against.
 */
import * as THREE from 'three';
import { CFG } from '../config/config.js';

// 720m across (radius 360 > fogFar 280) so in open ocean the plane edge is
// always beyond full fog and the horizon reads as endless water
const PLANE_SIZE = 720;
// 100 segments over 720m = 7.2m cells - fine enough for the ~20m chop and the
// shore fade band, while keeping the per-frame wave/normal loop affordable
const SEGMENTS = 100;
// Terrain depths are refreshed a few hundred vertices per frame in a
// round-robin pass instead of all at once (~10k height samples per frame
// would cost several milliseconds). Terrain never changes, so each vertex
// only needs an occasional resample as the plane glides along.
const DEPTH_REFRESH_PER_FRAME = 128;

// Directional wave trains: y = sum(a * sin(k . xz + w * t)). The surface
// slope (dy/dx, dy/dz) is derived analytically from the same terms, which
// animates the lighting without calling computeVertexNormals every frame.
const CHOP_A = { a: 0.14, kx: 0.30, kz: 0.11, w: 1.5 };  // ~20m diagonal chop
const CHOP_B = { a: 0.12, kx: -0.09, kz: 0.27, w: 1.1 }; // crossing chop
const SWELL = { a: 0.22, kx: 0.075, kz: 0.05, w: 0.8 };  // ~65m ocean rollers
const RIPPLE = { a: 0.05, kx: 0.38, kz: -0.32, w: 2.6 }; // normals only: glints

function _smooth01(x) {
  let t = x;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return t * t * (3 - 2 * t);
}

/**
 * Wave envelopes for a given water depth (terrain below the water line):
 * - shore: everything calms to flat at the waterline (anti-"breathing pond")
 * - swellF: the long rollers only develop in open water, so confined ponds
 *   never show waves longer than the pond itself
 * - deep: ocean-scale trains run bigger than sheltered lake water
 */
function _env(depth) {
  const shore = _smooth01(depth / 1.5);
  const swellF = _smooth01((depth - 2) / 6);
  const deep = 1 + 0.9 * _smooth01((depth - 3) / 9);
  return { shore, swellF, deep };
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
    // scale the waves near shores and in small ponds. Seeded fully so the
    // surface is correct on the very first frame.
    const count = geo.getAttribute('position').count;
    this._depth = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this._depth[i] = this.level - terrain.get(this._base[i * 3], this._base[i * 3 + 2]);
    }
    this._depthCursor = 0;

    // Phong + specular so the animated normals throw moving sun glints
    // across the surface (Lambert has no specular response at all)
    this.material = new THREE.MeshPhongMaterial({
      color: 0x3a7ca8,
      transparent: true,
      opacity: 0.66,
      side: THREE.DoubleSide,
      shininess: 72,
      specular: new THREE.Color(0x6fa8c9),
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.y = this.level;
    this.mesh.receiveShadow = false;
    scene.add(this.mesh);

    this._norm = geo.getAttribute('normal');
    this._t = 0;
    this._wasUnderwater = false;
    this._underwaterColor = new THREE.Color(0x184a5e);
  }

  /**
   * Wave height at a world position, same formula the surface mesh uses.
   * Lets splash/wake effects sit exactly on the moving surface instead of a
   * fixed plane that crests bury.
   */
  heightAt(wx, wz) {
    const depth = this.level - this.terrain.get(wx, wz);
    if (depth <= 0) return this.level;
    const e = _env(depth);
    const t = this._t;
    const chop = e.shore * e.deep;
    const swell = chop * e.swellF;
    return this.level
      + chop * (
        CHOP_A.a * Math.sin(wx * CHOP_A.kx + wz * CHOP_A.kz + t * CHOP_A.w)
        + CHOP_B.a * Math.sin(wx * CHOP_B.kx + wz * CHOP_B.kz + t * CHOP_B.w))
      + swell * SWELL.a * Math.sin(wx * SWELL.kx + wz * SWELL.kz + t * SWELL.w);
  }

  update(playerPos, dt, camera, sky) {
    this.mesh.position.x = playerPos.x;
    this.mesh.position.z = playerPos.z;

    this._t += dt;
    const pos = this.mesh.geometry.getAttribute('position');
    const norm = this._norm;
    const base = this._base;
    const ox = this.mesh.position.x;
    const oz = this.mesh.position.z;
    const count = pos.count;
    const t = this._t;

    // Refresh a slice of the depth field (world-anchored; terrain is static)
    for (let k = 0; k < DEPTH_REFRESH_PER_FRAME; k++) {
      const i = this._depthCursor;
      this._depth[i] = this.level - this.terrain.get(base[i * 3] + ox, base[i * 3 + 2] + oz);
      this._depthCursor = (this._depthCursor + 1) % count;
    }

    // Waves + analytic normals, phased in world space (see _base above) and
    // scaled by the local depth envelopes
    for (let i = 0; i < count; i++) {
      const wx = base[i * 3] + ox;
      const wz = base[i * 3 + 2] + oz;
      const e = _env(this._depth[i]);
      const chop = e.shore * e.deep;
      const swell = chop * e.swellF;

      const thA = wx * CHOP_A.kx + wz * CHOP_A.kz + t * CHOP_A.w;
      const thB = wx * CHOP_B.kx + wz * CHOP_B.kz + t * CHOP_B.w;
      const thS = wx * SWELL.kx + wz * SWELL.kz + t * SWELL.w;
      const thR = wx * RIPPLE.kx + wz * RIPPLE.kz + t * RIPPLE.w;

      pos.setY(i,
        chop * (CHOP_A.a * Math.sin(thA) + CHOP_B.a * Math.sin(thB))
        + swell * SWELL.a * Math.sin(thS));

      // Slope of the same field (chain rule), RIPPLE included in the normal
      // only: pure shimmer without geometry churn
      const dydx = chop * (CHOP_A.a * CHOP_A.kx * Math.cos(thA) + CHOP_B.a * CHOP_B.kx * Math.cos(thB))
        + swell * SWELL.a * SWELL.kx * Math.cos(thS)
        + e.shore * RIPPLE.a * RIPPLE.kx * Math.cos(thR);
      const dydz = chop * (CHOP_A.a * CHOP_A.kz * Math.cos(thA) + CHOP_B.a * CHOP_B.kz * Math.cos(thB))
        + swell * SWELL.a * SWELL.kz * Math.cos(thS)
        + e.shore * RIPPLE.a * RIPPLE.kz * Math.cos(thR);

      const inv = 1 / Math.sqrt(dydx * dydx + dydz * dydz + 1);
      norm.setXYZ(i, -dydx * inv, inv, -dydz * inv);
    }
    pos.needsUpdate = true;
    norm.needsUpdate = true;

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
