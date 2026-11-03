/**
 * Player Controller
 * Manages player movement, camera, and physics
 */
import * as THREE from 'three';
import Rapier from '@dimforge/rapier3d-compat';
import { CFG } from '../config/config.js';
import { _clamp } from '../core/utils.js';
import { GROUP_PROP, FILTER_TERRAIN_ONLY } from '../core/physics.js';
import { createProceduralAnimator } from '../entities/procedural-animator.js';

export class PlayerController {
  constructor(camera, physics, input, terrainH, scene) {
    this.camera = camera;
    this.physics = physics;
    this.input = input;
    this.terrainH = terrainH;
    this.scene = scene;

    this.yaw = 0;
    this.pitch = 0.12;
    this.grounded = false;
    this.bodyId = null;
    this.body = null;
    this.avatar = null;
    this.spawnPos = new THREE.Vector3(0, CFG.player.spawnY, 0);
  }

  _createAvatar() {
    const g = new THREE.Group();
    const inner = new THREE.Group();
    g.add(inner);

    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.38, 0.78, 4, 8),
      new THREE.MeshLambertMaterial({ color: 0x3d4f78 })
    );
    body.position.y = 0.92;
    body.castShadow = true;
    inner.add(body);

    const chest = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.36, 0.8, 8),
      new THREE.MeshLambertMaterial({ color: 0xd5b08a })
    );
    chest.position.y = 0.9;
    chest.castShadow = true;
    inner.add(chest);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 8, 6),
      new THREE.MeshLambertMaterial({ color: 0xe8c39c })
    );
    head.position.y = 1.78;
    head.castShadow = true;
    inner.add(head);

    // Face is on the local +Z side of the model
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 4, 4), eyeMat);
      eye.position.set(side * 0.07, 1.82, 0.24);
      inner.add(eye);
    }

    // Arms hang from shoulder pivots so the walk cycle can swing them
    const armL = new THREE.Group();
    const armR = new THREE.Group();
    const armMat = new THREE.MeshLambertMaterial({ color: 0xd5b08a });
    for (const [pivot, side] of [[armL, -1], [armR, 1]]) {
      pivot.position.set(side * 0.45, 1.32, 0);
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.42, 4, 6), armMat);
      arm.position.y = -0.3;
      arm.castShadow = true;
      pivot.add(arm);
      pivot.rotation.z = side * 0.12; // slight A-pose rest
      inner.add(pivot);
    }

    // Legs hang from hip pivots; pivots sit at hip height, meshes reach y=0
    const legL = new THREE.Group();
    const legR = new THREE.Group();
    const legMat = new THREE.MeshLambertMaterial({ color: 0x2f2f3f });
    for (const [pivot, side] of [[legL, -1], [legR, 1]]) {
      pivot.position.set(side * 0.16, 0.78, 0);
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.56, 4, 6), legMat);
      leg.position.y = -0.4;
      leg.castShadow = true;
      pivot.add(leg);
      inner.add(pivot);
    }

    g.visible = false;
    g.userData.rig = { kind: 'humanoid', inner, head, armL, armR, legL, legR, isPlayer: true };
    return g;
  }

  init() {
    const p = CFG.player;
    // Rapier capsule is capsule(halfHeight, radius); total height = 2*halfHeight + 2*radius.
    // The old call passed the arguments swapped, inflating the collider to a
    // 2.8m x 2m blob that wedged the player inside trees and blocks.
    const colDesc = Rapier.ColliderDesc.capsule((p.height - p.radius * 2) / 2, p.radius)
      .setTranslation(0, p.height / 2, 0)
      .setMass(1)
      .setCollisionGroups(GROUP_PROP);
    const bodyDesc = Rapier.RigidBodyDesc.dynamic()
      .setTranslation(this.spawnPos.x, this.spawnPos.y, this.spawnPos.z)
      .lockRotations();
    const { body, id } = this.physics.createBody(bodyDesc, colDesc);

    this.body = body;
    this.bodyId = id;

    this.avatar = this._createAvatar();
    this.scene.add(this.avatar);
    this.avatarAnim = createProceduralAnimator(this.avatar);
  }

  _cameraMode() {
    return CFG.settings.cameraMode || 'third-person';
  }

  _updateAvatar(bodyPos, yaw) {
    if (!this.avatar) return;

    const mode = this._cameraMode();
    const isFirstPerson = mode === 'first-person';
    this.avatar.visible = !isFirstPerson;

    if (isFirstPerson) return;

    this.avatar.position.copy(bodyPos);
    // The avatar model's face is on its local +Z side. Rotating by yaw alone
    // points +Z OPPOSITE to the camera forward direction (-sin yaw, -cos yaw),
    // so the character walked backwards staring at the camera. yaw + PI makes
    // the face point where the player is actually heading.
    this.avatar.rotation.y = yaw + Math.PI;
  }

  update(dt) {
    if (!this.body) return;

    const pos = this.physics.getBodyPos(this.body);
    const vel = this.body.linvel();

    // Camera look
    const look = this.input.consumeLook();
    const sens = CFG.settings.sensitivity * 0.001 * (CFG.settings.invertY ? -1 : 1);
    this.yaw -= look.x * sens;
    this.pitch = _clamp(this.pitch - look.y * sens, CFG.player.cameraMinPitch, CFG.player.cameraMaxPitch);

    // Movement
    const mv = this.input.getMove();
    const moveForward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const dir = new THREE.Vector3();
    dir.addScaledVector(moveForward, -mv.z);
    dir.addScaledVector(right, mv.x);

    if (dir.lengthSq() > 0) dir.normalize();

    const p = this.body.translation();

    // Wading and swimming: below the water line gravity is replaced by a
    // buoyant blend toward paddle-up (hold Space) or a slow sink, and
    // horizontal movement slows down. The player can wade across shallows
    // and dive to the lakebed.
    const submerged = p.y < CFG.world.waterLevel - 0.2;
    const spd = CFG.player.moveSpeed * (submerged ? 0.55 : 1);
    if (submerged) {
      const targetVy = this.input.actions.jump ? CFG.player.swimUp : -0.8;
      const vy = vel.y + (targetVy - vel.y) * Math.min(1, 3.5 * dt);
      this.body.setLinvel({ x: dir.x * spd, y: vy, z: dir.z * spd }, true);
    } else {
      this.body.setLinvel({ x: dir.x * spd, y: vel.y, z: dir.z * spd }, true);
    }

    // Ground check via raycast. The ray starts slightly above the feet and
    // physics.raycast uses solid=false, so the player's own capsule (which
    // contains the ray origin) is ignored - a solid raycast from inside the
    // body reported "grounded" every frame at toi=0. The downward-velocity
    // guard keeps the ascending phase of a jump from re-triggering it.
    const rayFrom = { x: p.x, y: p.y + 0.1, z: p.z };
    const rayTo = { x: p.x, y: p.y - 0.5, z: p.z };
    const hit = this.physics.raycast(rayFrom, rayTo);
    // Rapier 0.12 exposes the hit distance as `toi` (newer builds renamed it
    // to `timeOfImpact`) - reading only the new name made grounded forever
    // false, so jumping never worked.
    const hitDist = hit ? (hit.timeOfImpact ?? hit.toi) : null;
    this.grounded = hit !== null && hitDist < 0.45 && vel.y <= 0.1 && !submerged;

    // Jump (keep current horizontal velocity; the stale pre-movement value
    // captured above would cancel the speed the player just accelerated to)
    if (this.input.actions.jump && this.grounded) {
      this.body.setLinvel({ x: dir.x * spd, y: CFG.player.jumpForce, z: dir.z * spd }, true);
      this.grounded = false;
    }

    // Update camera
    const cp = CFG.player;

    // Frame the character around upper-chest/head height instead of the belly
    const lookTarget = new THREE.Vector3(p.x, p.y + cp.height * 0.75, p.z);
    this._updateAvatar(new THREE.Vector3(p.x, p.y, p.z), this.yaw);

    // Drive the walk / idle / jump poses from the real horizontal velocity
    this.avatarAnim?.update(dt, Math.hypot(vel.x, vel.z), !this.grounded);

    const eyePos = new THREE.Vector3(p.x, p.y + cp.height * 0.9, p.z);
    const forward = new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch)
    ).normalize();

    const mode = this._cameraMode();
    if (mode === 'first-person') {
      this.camera.position.copy(eyePos);
      this.camera.lookAt(eyePos.clone().add(forward));
    } else {
      const dist = mode === 'shoulder' ? Math.max(4, cp.cameraDist * 0.7) : cp.cameraDist;
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const offset = forward.clone().multiplyScalar(-dist).addScaledVector(new THREE.Vector3(0, 1, 0), cp.cameraHeight);

      if (mode === 'shoulder') {
        offset.addScaledVector(right, dist * 0.35);
      }

      const desired = lookTarget.clone().add(offset);

      // Pull the camera in when the TERRAIN blocks the line of sight
      // (props are excluded via collision groups - otherwise every tree
      // next to the player yanked the camera inside the avatar body).
      const toCam = desired.clone().sub(lookTarget);
      const camDist = toCam.length();
      if (camDist > 0.01) {
        toCam.divideScalar(camDist);
        const hit = this.physics.raycast(lookTarget, desired, FILTER_TERRAIN_ONLY);
        const toi = hit ? (hit.timeOfImpact ?? hit.toi) : null;
        if (toi !== null && toi < camDist) {
          desired.copy(lookTarget).addScaledVector(toCam, Math.max(1.2, toi - 0.25));
        }
      }

      // Never let the camera dip below the ground surface
      const groundY = this.terrainH.get(desired.x, desired.z) + 0.3;
      if (desired.y < groundY) desired.y = groundY;

      this.camera.position.copy(desired);
      this.camera.lookAt(lookTarget);
    }

    return lookTarget;
  }

  getPos() {
    if (!this.body) return this.spawnPos;
    const p = this.body.translation();
    return new THREE.Vector3(p.x, p.y, p.z);
  }

  getVel() {
    if (!this.body) return new THREE.Vector3();
    const v = this.body.linvel();
    return new THREE.Vector3(v.x, v.y, v.z);
  }

  destroy() {
    if (this.bodyId) this.physics.removeBody(this.bodyId);
    if (this.avatar) this.scene.remove(this.avatar);
  }
}
