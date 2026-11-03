/**
 * Water System
 * One large translucent surface that follows the player and fills every
 * terrain basin below CFG.world.waterLevel. Also drives underwater fog while
 * the camera is submerged.
 */
import * as THREE from 'three';
import { CFG } from '../config/config.js';

const PLANE_SIZE = 520;
const SEGMENTS = 48;

export class WaterSystem {
  constructor(scene) {
    this.scene = scene;
    this.level = CFG.world.waterLevel;

    const geo = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE, SEGMENTS, SEGMENTS);
    geo.rotateX(-Math.PI / 2);
    // Remember each vertex's local XZ so the wave phase can be computed from
    // world coordinates: the pattern stays anchored to the world instead of
    // sliding when the plane re-centers on the player.
    this._base = geo.getAttribute('position').array.slice();

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

    // Gentle two-axis chop, phased in world space (see _base above)
    this._t += dt;
    const pos = this.mesh.geometry.getAttribute('position');
    const base = this._base;
    const ox = this.mesh.position.x;
    const oz = this.mesh.position.z;
    for (let i = 0; i < pos.count; i++) {
      const wx = base[i * 3] + ox;
      const wz = base[i * 3 + 2] + oz;
      pos.setY(i,
        Math.sin(wx * 0.35 + this._t * 1.4) * 0.05 +
        Math.cos(wz * 0.30 + this._t * 1.1) * 0.05
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
