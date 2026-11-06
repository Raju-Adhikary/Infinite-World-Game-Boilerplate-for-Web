/**
 * Sky System
 * Sun mesh, moon mesh, stars, clouds and the day-night cycle that drives
 * every scene light (directional sun/moon light, hemisphere, ambient) plus
 * the sky and fog colors.
 *
 * Time of day: this.time in [0, 1)
 *   0.0 midnight | 0.25 sunrise | 0.5 noon | 0.75 sunset
 */
import * as THREE from 'three';
import { CFG } from '../config/config.js';

const SUN_DIST = 260;   // render distance of the sun/moon billboards
const LIGHT_DIST = 90;  // directional light distance (shadow frustum follows)

// Palette: day and night anchor colors, blended by sun elevation
const PAL = {
  daySky: new THREE.Color('#8aacb8'),
  nightSky: new THREE.Color('#0b1022'),
  duskSky: new THREE.Color('#d9824a'),
  sunLight: new THREE.Color('#fff4e0'),
  duskLight: new THREE.Color('#ff9a4a'),
  moonLight: new THREE.Color('#8fa3d8'),
  dayHemiSky: new THREE.Color('#90a8c0'),
  nightHemiSky: new THREE.Color('#22304e'),
  dayHemiGround: new THREE.Color('#404020'),
  nightHemiGround: new THREE.Color('#14161c'),
  dayAmbient: new THREE.Color('#8090a0'),
  nightAmbient: new THREE.Color('#3a4763'),
  dayCloud: new THREE.Color('#ffffff'),
  nightCloud: new THREE.Color('#4a5470'),
};

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class SkySystem {
  constructor(scene, lights = {}) {
    this.scene = scene;
    this.sunLight = lights.sun || null;
    this.hemiLight = lights.hemi || null;
    this.ambientLight = lights.ambient || null;

    this.time = CFG.world.dayStart ?? 0.3;
    this.dayLength = CFG.world.dayLength ?? 240;

    this.sunDir = new THREE.Vector3(0.6, 0.8, 0.4).normalize();
    this.moonDir = new THREE.Vector3().copy(this.sunDir).negate();
    // Tilted celestial pole for the star dome (independent of the sun/moon
    // path, which circles the Z axis)
    this._starAxis = new THREE.Vector3(0.42, 1, 0.24).normalize();

    this._skyColor = new THREE.Color();
    this._cloudColor = new THREE.Color();
    this._lightColor = new THREE.Color();

    if (this.sunLight) scene.add(this.sunLight.target);

    this._createSun();
    this._createMoon();
    this._createStars();
    this._createClouds();
  }

  get clockString() {
    const h24 = this.time * 24;
    const h = Math.floor(h24);
    const m = Math.floor((h24 - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  /**
   * The blended sky color of the CURRENT frame. The water system snapshots it
   * when the camera surfaces so the background snaps back seamlessly.
   */
  get skyColor() {
    return this._skyColor;
  }

  _createSun() {
    const sunMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(CFG.world.sunColor),
      fog: false,
    });
    this.sunMesh = new THREE.Mesh(new THREE.SphereGeometry(11, 24, 24), sunMat);
    this.sunMesh.castShadow = false;
    this.sunMesh.receiveShadow = false;

    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(14.5, 24, 24),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(CFG.world.sunColor),
        transparent: true,
        opacity: 0.22,
        side: THREE.BackSide,
        fog: false,
        depthWrite: false,
      })
    );
    this.sunMesh.add(halo);
    this.scene.add(this.sunMesh);
  }

  _createMoon() {
    this.moonMesh = new THREE.Mesh(
      new THREE.SphereGeometry(8, 24, 24),
      new THREE.MeshBasicMaterial({ color: 0xd8e0f0, fog: false })
    );
    this.moonMesh.castShadow = false;
    this.moonMesh.receiveShadow = false;

    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(10.5, 24, 24),
      new THREE.MeshBasicMaterial({
        color: 0xaebde0,
        transparent: true,
        opacity: 0.16,
        side: THREE.BackSide,
        fog: false,
        depthWrite: false,
      })
    );
    this.moonMesh.add(halo);
    this.scene.add(this.moonMesh);
  }

  _createStars() {
    const N = 700;
    const pos = new Float32Array(N * 3);
    const v = new THREE.Vector3();
    // Full sphere: the dome rotates on its own tilted axis (see update), so
    // stars spend part of the night below the horizon and rise again - a
    // hemisphere-only shell would show holes when rotated off-axis
    for (let i = 0; i < N; i++) {
      v.randomDirection();
      v.normalize().multiplyScalar(320);
      pos[i * 3] = v.x;
      pos[i * 3 + 1] = v.y;
      pos[i * 3 + 2] = v.z;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    this.starMat = new THREE.PointsMaterial({
      color: 0xcdd7ff,
      size: 1.8,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      fog: false,
      depthWrite: false,
    });

    this.starGroup = new THREE.Group();
    this.starGroup.add(new THREE.Points(geo, this.starMat));
    this.starGroup.visible = false;
    this.scene.add(this.starGroup);
  }

  _createClouds() {
    this.cloudGroup = new THREE.Group();
    this.clouds = [];
    this._cloudMats = [];

    const cloudCount = 15;
    for (let i = 0; i < cloudCount; i++) {
      const cloud = this._createCloudPuff();

      const angle = (i / cloudCount) * Math.PI * 2;
      const distance = 100 + Math.random() * 50;
      // Cloud deck sits at 88-114m so the tallest mountain ranges (capped
      // around 85m) climb right into it instead of standing under a ceiling
      // that hangs lower than the summits
      cloud.position.set(
        Math.cos(angle) * distance,
        88 + Math.random() * 26,
        Math.sin(angle) * distance
      );
      this.cloudGroup.add(cloud);
      this.clouds.push({ mesh: cloud, speed: 0.5 + Math.random() * 1.5, angle, distance });
    }

    this.scene.add(this.cloudGroup);
  }

  _createCloudPuff() {
    const cloudGroup = new THREE.Group();
    const puffCount = 3 + Math.floor(Math.random() * 3);
    const scale = 3 + Math.random() * 4;

    for (let i = 0; i < puffCount; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xcccccc,
        emissiveIntensity: 0.3,
        roughness: 0.8,
        metalness: 0.0,
      });
      this._cloudMats.push(mat);

      const puff = new THREE.Mesh(new THREE.SphereGeometry(scale, 12, 12), mat);
      puff.castShadow = false;
      puff.receiveShadow = false;
      puff.position.x = (i - puffCount / 2) * scale * 0.7;
      puff.position.y = (Math.random() - 0.5) * scale * 0.3;
      puff.scale.y = 0.6;
      cloudGroup.add(puff);
    }

    return cloudGroup;
  }

  update(playerPos, dt = 0) {
    if (dt > 0) this.time = (this.time + dt / this.dayLength) % 1;

    // Celestial sphere rotation: sunrise in the east (+X), noon overhead,
    // sunset in the west (-X), moon on the opposite side
    const ang = (this.time - 0.25) * Math.PI * 2;
    this.sunDir.set(Math.cos(ang), Math.sin(ang), 0.32).normalize();
    this.moonDir.copy(this.sunDir).negate();

    const sunEl = this.sunDir.y;
    // Wide ramp so dusk and dawn stay readable for longer
    const day = smooth(-0.12, 0.2, sunEl);
    const dusk = Math.max(0, 1 - Math.abs(sunEl - 0.04) / 0.22);

    // --- sky and fog color ---
    const sky = this._skyColor.copy(PAL.nightSky).lerp(PAL.daySky, day);
    if (dusk > 0) sky.lerp(PAL.duskSky, dusk * 0.55);
    if (this.scene.background && this.scene.background.isColor) this.scene.background.copy(sky);
    if (this.scene.fog) this.scene.fog.color.copy(sky);

    // --- directional light: sun by day, moon by night ---
    if (this.sunLight) {
      const L = this.sunLight;
      const sunUp = smooth(-0.1, 0.05, sunEl);
      const moonUp = smooth(-0.1, 0.05, -sunEl);
      const sunI = (0.2 + 1.2 * smooth(0.0, 0.35, sunEl)) * sunUp;
      const moonI = (0.2 + 0.3 * smooth(0.0, 0.35, -sunEl)) * moonUp;

      if (sunI >= moonI) {
        L.position.copy(playerPos).addScaledVector(this.sunDir, LIGHT_DIST);
        const warm = 1 - smooth(0.08, 0.4, sunEl); // orange near the horizon
        L.color.copy(PAL.sunLight).lerp(PAL.duskLight, warm);
        L.intensity = sunI;
        this.sunMesh.material.color.copy(L.color);
      } else {
        L.position.copy(playerPos).addScaledVector(this.moonDir, LIGHT_DIST);
        L.color.copy(PAL.moonLight);
        L.intensity = moonI;
      }
      L.target.position.copy(playerPos);
      L.target.updateMatrixWorld();
    }

    // --- hemisphere and ambient falloff ---
    if (this.hemiLight) {
      this.hemiLight.color.copy(PAL.nightHemiSky).lerp(PAL.dayHemiSky, day);
      this.hemiLight.groundColor.copy(PAL.nightHemiGround).lerp(PAL.dayHemiGround, day);
      this.hemiLight.intensity = 0.22 + (0.4 - 0.22) * day;
    }
    if (this.ambientLight) {
      this.ambientLight.color.copy(PAL.nightAmbient).lerp(PAL.dayAmbient, day);
      this.ambientLight.intensity = 0.3 + (0.5 - 0.3) * day;
    }

    // --- sun / moon billboards ---
    this.sunMesh.position.copy(playerPos).addScaledVector(this.sunDir, SUN_DIST);
    this.moonMesh.position.copy(playerPos).addScaledVector(this.moonDir, SUN_DIST);
    this.sunMesh.visible = sunEl > -0.25;
    this.moonMesh.visible = this.moonDir.y > -0.25;

    // --- stars rotate on their own tilted celestial axis, fading in at dusk.
    // They previously spun with rotation.z = ang - the exact angle AND axis
    // of the sun/moon path - so the whole night sky stayed glued to the moon
    // and visibly "moved with the moon". A different axis gives the stars
    // independent motion across the night sky.
    const night = 1 - day;
    this.starGroup.position.copy(playerPos);
    this.starGroup.setRotationFromAxisAngle(this._starAxis, ang * 0.75);
    this.starMat.opacity = night * 0.9;
    this.starGroup.visible = night > 0.05;

    // --- clouds: slow drift and day-night tinting ---
    const now = performance.now() * 0.001;
    for (const cloud of this.clouds) {
      const a = cloud.angle + now * 0.01 * cloud.speed;
      cloud.mesh.position.x = playerPos.x + Math.cos(a) * cloud.distance;
      cloud.mesh.position.z = playerPos.z + Math.sin(a) * cloud.distance;
    }
    const cloudCol = this._cloudColor.copy(PAL.nightCloud).lerp(PAL.dayCloud, day);
    const emissive = 0.05 + 0.25 * day;
    for (const m of this._cloudMats) {
      m.color.copy(cloudCol);
      m.emissiveIntensity = emissive;
    }
  }

  dispose() {
    // Clean up geometries/materials AND remove everything from the scene,
    // otherwise disposed meshes keep rendering with re-uploaded resources.
    for (const mesh of [this.sunMesh, this.moonMesh]) {
      if (!mesh) continue;
      this.scene.remove(mesh);
      mesh.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    }
    this.sunMesh = null;
    this.moonMesh = null;

    if (this.starGroup) {
      this.scene.remove(this.starGroup);
      this.starGroup.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
      this.starGroup = null;
    }

    this.scene.remove(this.cloudGroup);
    for (const cloud of this.clouds) {
      cloud.mesh.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    }
    this.clouds = [];
  }
}
