/**
 * Water Surface Effects
 * Fake water impact feedback - no mesh-level waves are touched:
 * - expanding ripple rings drawn by a fragment shader on a flat quad that
 *   hovers just above the surface (radial ring pattern, fades as it expands)
 * - a burst of droplet points tossed up with fake gravity and faded out
 *
 * Triggers: the player hitting the surface while falling (big splash) and
 * leaping back out of it (smaller splash).
 */
import * as THREE from 'three';
import { CFG } from '../config/config.js';

const RIPPLE_LIFE = 1.6;   // seconds a ripple ring lives
const DROP_LIFE = 0.7;     // seconds splash droplets live

const VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Three concentric rings expanding outward with staggered offsets, plus a
// bright center blob that vanishes quickly. All radial math in the fragment
// shader - the geometry stays a flat, undeformed quad.
const FRAG = /* glsl */`
  varying vec2 vUv;
  uniform float uT;      // 0..1 ripple progress
  uniform float uPower;  // impact strength 0..1
  uniform vec3 uColor;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float a = 0.0;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float ring = uT * (0.9 - fi * 0.22) - fi * 0.14;
      float d = abs(r - ring);
      float w = 0.04 + 0.06 * uT;
      a += smoothstep(w, 0.0, d) * (1.0 - uT) * (1.0 - fi * 0.26);
    }
    a += smoothstep(0.22 + 0.35 * uT, 0.0, r) * max(0.0, 1.0 - uT * 2.4) * 0.8;
    a *= uPower;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

export class WaterEffects {
  constructor(scene) {
    this.scene = scene;
    this._ripples = [];
    this._bursts = [];
    this._geo = new THREE.PlaneGeometry(1, 1);
    this._geo.rotateX(-Math.PI / 2);
    this._dropGeo = null;
  }

  /**
   * Spawn a splash at a world XZ position on the water surface.
   * power 0..1 scales ring size, brightness and droplet count.
   */
  splash(x, z, power = 1) {
    power = Math.max(0.15, Math.min(1, power));

    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uT: { value: 0 },
        uPower: { value: power },
        uColor: { value: new THREE.Color(0xdaf2ff) },
      },
    });
    const mesh = new THREE.Mesh(this._geo, mat);
    const size = 3 + 9 * power;
    mesh.scale.setScalar(size);
    mesh.position.set(x, CFG.world.waterLevel + 0.12, z);
    mesh.renderOrder = 5;
    this.scene.add(mesh);
    this._ripples.push({ mesh, t: 0 });

    this._spawnDrops(x, z, power);
  }

  _spawnDrops(x, z, power) {
    const n = Math.round(10 + 26 * power);
    const pos = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (0.8 + Math.random() * 1.6) * (0.5 + power);
      pos[i * 3] = x + Math.cos(a) * 0.25;
      pos[i * 3 + 1] = CFG.world.waterLevel + 0.1;
      pos[i * 3 + 2] = z + Math.sin(a) * 0.25;
      vel[i * 3] = Math.cos(a) * sp;
      vel[i * 3 + 1] = 2.2 + Math.random() * 2.6 * (0.5 + power);
      vel[i * 3 + 2] = Math.sin(a) * sp;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xe8f7ff,
      size: 0.14,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    points.renderOrder = 5;
    this.scene.add(points);
    this._bursts.push({ points, vel, t: 0 });
  }

  update(dt) {
    // Ripples: expand via the shader uniform, scale up slightly, then recycle
    for (let i = this._ripples.length - 1; i >= 0; i--) {
      const r = this._ripples[i];
      r.t += dt / RIPPLE_LIFE;
      if (r.t >= 1) {
        this.scene.remove(r.mesh);
        r.mesh.material.dispose();
        this._ripples.splice(i, 1);
        continue;
      }
      r.mesh.material.uniforms.uT.value = r.t;
      const s = (3 + 9 * r.mesh.material.uniforms.uPower.value) * (1 + r.t * 0.55);
      r.mesh.scale.setScalar(s);
    }

    // Droplets: fake gravity ballistics, fade and drop the whole burst
    for (let i = this._bursts.length - 1; i >= 0; i--) {
      const b = this._bursts[i];
      b.t += dt;
      if (b.t >= DROP_LIFE) {
        this.scene.remove(b.points);
        b.points.geometry.dispose();
        b.points.material.dispose();
        this._bursts.splice(i, 1);
        continue;
      }
      const pos = b.points.geometry.getAttribute('position');
      for (let j = 0; j < pos.count; j++) {
        pos.setX(j, pos.getX(j) + b.vel[j * 3] * dt);
        pos.setY(j, pos.getY(j) + b.vel[j * 3 + 1] * dt);
        pos.setZ(j, pos.getZ(j) + b.vel[j * 3 + 2] * dt);
        b.vel[j * 3 + 1] -= 9.8 * dt;
      }
      pos.needsUpdate = true;
      b.points.material.opacity = 0.95 * (1 - b.t / DROP_LIFE);
    }
  }

  dispose() {
    for (const r of this._ripples) {
      this.scene.remove(r.mesh);
      r.mesh.material.dispose();
    }
    for (const b of this._bursts) {
      this.scene.remove(b.points);
      b.points.geometry.dispose();
      b.points.material.dispose();
    }
    this._ripples = [];
    this._bursts = [];
    this._geo.dispose();
  }
}
