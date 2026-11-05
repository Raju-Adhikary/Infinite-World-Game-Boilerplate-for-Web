/**
 * Chunk Manager
 * Handles procedural terrain generation and chunk loading/unloading
 */
import * as THREE from 'three';
import Rapier from '@dimforge/rapier3d-compat';
import { CFG } from '../config/config.js';
import { SeededRandom, _key, _clamp, hashChunk } from '../core/utils.js';
import { GROUP_TERRAIN, GROUP_PROP } from '../core/physics.js';
import { Noise } from '../core/noise.js';
import { createBotMesh } from '../entities/bot-mesh.js';
import { createProceduralAnimator, createSwayAnimator } from '../entities/procedural-animator.js';

// Shoreline palette blended in around the water line
const SAND = new THREE.Color(0xc2b280);
const MUD = new THREE.Color(0x565040);
// Mountain dressing above the rock/snow lines
const ROCK = new THREE.Color(0x6b6560);
const SNOW = new THREE.Color(0xe8ecf2);
const _tc = new THREE.Color();

export class ChunkManager {
  constructor(scene, physics, entities, glbCache, terrainH, biomeSys) {
    this.scene = scene;
    this.physics = physics;
    this.entities = entities;
    this.glb = glbCache;
    this.terrainH = terrainH;
    this.biome = biomeSys;
    this.chunks = new Map();
    this.cfg = CFG.world;
    this.noise = new Noise(this.cfg.seed + 777);
  }

  _chunkOrigin(cx, cz) {
    return { x: cx * this.cfg.chunkSize, z: cz * this.cfg.chunkSize };
  }

  _getDensity(densityCfg, biome) {
    if (typeof densityCfg === 'number') return densityCfg;
    if (!densityCfg || typeof densityCfg !== 'object') return 0;

    if (densityCfg[biome] !== undefined) return densityCfg[biome];
    if (densityCfg.default !== undefined) return densityCfg.default;

    return 0;
  }

  update(px, pz, loadR) {
    loadR = loadR || this.cfg.loadRadius;
    const ccx = Math.floor(px / this.cfg.chunkSize);
    const ccz = Math.floor(pz / this.cfg.chunkSize);

    // Find needed chunks
    const needed = [];
    for (let dx = -loadR; dx <= loadR; dx++) {
      for (let dz = -loadR; dz <= loadR; dz++) {
        if (dx * dx + dz * dz > loadR * loadR + 0.5) continue;
        const k = _key(ccx + dx, ccz + dz);
        if (!this.chunks.has(k)) {
          needed.push({ cx: ccx + dx, cz: ccz + dz, d: dx * dx + dz * dz });
        }
      }
    }

    needed.sort((a, b) => a.d - b.d);

    const budget = this.cfg.chunksPerFrame;
    for (let i = 0; i < Math.min(budget, needed.length); i++) {
      this._load(needed[i].cx, needed[i].cz);
    }

    // Unload far chunks (honor the configured radius, but never below the
    // loaded ring + 2, otherwise chunks pop out of view at high render distance)
    const ulR = Math.max(this.cfg.unloadRadius, loadR + 2);
    for (const [k, cd] of this.chunks) {
      const dx = cd.cx - ccx;
      const dz = cd.cz - ccz;
      if (dx * dx + dz * dz > ulR * ulR) {
        this._unload(k, cd);
      }
    }
  }

  async _load(cx, cz) {
    const k = _key(cx, cz);
    if (this.chunks.has(k)) return;

    const o = this._chunkOrigin(cx, cz);
    const cd = {
      cx,
      cz,
      group: new THREE.Group(),
      bodyIds: [],
      terrainBodyId: null,
      pending: 0,
      disposed: false
    };

    cd.group.position.set(o.x, 0, o.z);
    this.scene.add(cd.group);
    this.chunks.set(k, cd);

    // Generate terrain mesh
    this._genTerrain(cd, o);

    // Spawn objects
    this._spawnObjects(cd, o, cx, cz);

    // Spawn bots
    this._spawnBots(cd, o, cx, cz);
  }

  _genTerrain(cd, o) {
    const S = this.cfg.chunkSize;
    const seg = this.cfg.chunkSegments;

    const geo = new THREE.PlaneGeometry(S, S, seg, seg);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);

    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i);
      const lz = pos.getZ(i);
      const wx = lx + o.x;
      const wz = lz + o.z;
      const h = this.terrainH.get(wx, wz);
      pos.setY(i, h);

      const b = this.biome.get(wx, wz);
      const c = _tc.setHex(this.biome.getColor(b));

      // Sandy shores just above the water line, murky lakebeds below it
      if (h < CFG.world.waterLevel + 0.5) {
        c.lerp(SAND, _clamp((CFG.world.waterLevel + 0.5 - h) / 1.2, 0, 1) * 0.85);
        if (h < CFG.world.waterLevel - 0.3) {
          c.lerp(MUD, _clamp((CFG.world.waterLevel - 0.3 - h) / 2.5, 0, 1) * 0.7);
        }
      }

      // Mountain slopes turn to rock, the peaks carry snow caps
      if (h > CFG.world.rockLine) {
        c.lerp(ROCK, _clamp((h - CFG.world.rockLine) / 3, 0, 1) * 0.85);
      }
      if (h > CFG.world.snowLine) {
        c.lerp(SNOW, _clamp((h - CFG.world.snowLine) / 4, 0, 1));
      }

      // Slight variation
      const v = this.noise.n2(wx * 0.05, wz * 0.05) * 0.08;
      colors[i * 3] = _clamp(c.r + v, 0, 1);
      colors[i * 3 + 1] = _clamp(c.g + v, 0, 1);
      colors[i * 3 + 2] = _clamp(c.b + v, 0, 1);
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    cd.group.add(mesh);
    cd.terrainMesh = mesh;

    // Physics trimesh
    const wVerts = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      wVerts[i * 3] = pos.getX(i) + o.x;
      wVerts[i * 3 + 1] = pos.getY(i);
      wVerts[i * 3 + 2] = pos.getZ(i) + o.z;
    }

    const idx = geo.getIndex();
    const wIdx = new Uint32Array(idx.array);
    const colDesc = Rapier.ColliderDesc.trimesh(wVerts, wIdx)
      .setCollisionGroups(GROUP_TERRAIN);
    const bodyDesc = Rapier.RigidBodyDesc.fixed();
    const { body, id } = this.physics.createBody(bodyDesc, colDesc);

    cd.terrainBodyId = id;
  }

  _spawnObjects(cd, o, cx, cz) {
    const S = this.cfg.chunkSize;
    const cellSize = 8;
    const cells = Math.floor(S / cellSize);
    // RNG stream derived from (seed, chunkX, chunkZ) - the same chunk always
    // fills with the same props for a given world seed
    const rng = new SeededRandom(hashChunk(this.cfg.seed, cx, cz));
    const placed = [];

    for (let gx = 0; gx < cells; gx++) {
      for (let gz = 0; gz < cells; gz++) {
        const wx = o.x + gx * cellSize + cellSize / 2;
        const wz = o.z + gz * cellSize + cellSize / 2;
        const biome = this.biome.get(wx, wz);

        for (const [sName, sCfg] of Object.entries(CFG.spawns)) {
          if (!sCfg.biomes.includes(biome)) continue;
          const density = this._getDensity(sCfg.density, biome);
          if (rng.next() > density) continue;

          // Min distance check
          const ox = (rng.next() - 0.5) * cellSize * 0.7;
          const oz = (rng.next() - 0.5) * cellSize * 0.7;
          const px = wx + ox;
          const pz = wz + oz;

          let tooClose = false;
          for (const p of placed) {
            if ((p.x - px) ** 2 + (p.z - pz) ** 2 < sCfg.minDist * sCfg.minDist) {
              tooClose = true;
              break;
            }
          }
          if (tooClose) continue;

          // Grid height, not the analytic field: the visible terrain mesh only
          // samples the noise at its vertices, so using get() here let props
          // hover or sink on curved slopes.
          const py = this.terrainH.gridHeight(px, pz);
          // Keep flora, rocks and houses out of lakes and their beds
          if (py < CFG.world.waterLevel + 0.3) continue;

          placed.push({ x: px, z: pz });

          const scale = sCfg.scale[0] + rng.next() * (sCfg.scale[1] - sCfg.scale[0]);
          const rotY = rng.next() * Math.PI * 2;
          const url = CFG.glbModels[sName];
          const physicsBodyId = this._createSpawnPhysicsBody(sCfg, px, py, pz, scale);

          this.glb.load(sName, url).then(model => {
            // The load resolves asynchronously - the chunk may have been
            // unloaded in the meantime. Skip and release the already-created
            // physics body, otherwise it (and the entity) leaks forever.
            if (cd.disposed) {
              if (physicsBodyId) this.physics.removeBody(physicsBodyId);
              return;
            }
            const inst = model.scene.clone();
            // GLB clips when present, otherwise a gentle wind sway for flora
            const animation = this.glb.createAnimationController(model, inst, sCfg.animations || null)
              || (sCfg.sway ? createSwayAnimator(inst) : null);
            inst.scale.setScalar(scale);
            inst.position.set(px - o.x, py, pz - o.z);
            inst.rotation.y = rotY;
            inst.traverse(c => {
              if (c.isMesh) c.castShadow = CFG.settings.shadows;
              c.userData.cachedInstance = true;
            });
            cd.group.add(inst);

            const eid = this.entities.add({
              type: sName,
              position: new THREE.Vector3(px, py, pz),
              chunk: _key(cx, cz),
              mesh: inst,
              physicsBodyId,
              scale,
              biome,
              animation
            });
            if (animation) animation.playAction('idle');
            cd.bodyIds.push(eid);
          }).catch(() => {
            if (!cd.disposed && physicsBodyId) this.physics.removeBody(physicsBodyId);
          });
        }
      }
    }
  }

  _spawnBots(cd, o, cx, cz) {
    const S = this.cfg.chunkSize;
    const rng = new SeededRandom(hashChunk(this.cfg.seed, cx, cz) ^ 0x5bd1e995);

    for (const [bName, bCfg] of Object.entries(CFG.bots)) {
      const biome = this.biome.get(o.x + S / 2, o.z + S / 2);
      if (!bCfg.biomes.includes(biome)) continue;
      const density = this._getDensity(bCfg.density, biome);
      // density is the chance that ONE bot of this type spawns in this chunk.
      // The old formula multiplied it by chunkSize^2 (4096), which made every
      // profile value >= 0.0005 always pass - one bot of every type in every
      // single chunk.
      if (rng.next() > density) continue;

      const px = o.x + rng.range(4, S - 4);
      const pz = o.z + rng.range(4, S - 4);
      // Keep the world spawn area mob-free so the player never lands on a mob
      const sx = px - CFG.world.spawnX;
      const sz = pz - CFG.world.spawnZ;
      if (sx * sx + sz * sz < CFG.world.safeSpawnRadius * CFG.world.safeSpawnRadius) continue;
      // Grid height keeps bot feet on the rendered surface instead of the
      // analytic field the mesh only approximates.
      const py = this.terrainH.gridHeight(px, pz);
      // No mobs standing around at the bottom of a lake
      if (py < CFG.world.waterLevel + 0.3) continue;
      const url = CFG.glbModels[bName];

      const spawnBot = (model = null) => {
        if (cd.disposed) return; // chunk unloaded while the model was loading
        const mesh = model?.scene ? model.scene.clone() : createBotMesh(bCfg);
        // GLB clip mixer when a real model exists, procedural limb animation
        // (walk / idle / attack / flee) for the procedural fallback meshes
        let animator = model ? this.glb.createAnimationController(model, mesh, bCfg.animations || null) : null;
        if (!animator) animator = createProceduralAnimator(mesh);
        mesh.position.set(px - o.x, py, pz - o.z);
        mesh.rotation.y = rng.next() * Math.PI * 2;
        mesh.traverse(c => {
          if (c.isMesh) c.castShadow = CFG.settings.shadows;
          if (model?.scene) c.userData.cachedInstance = true;
        });
        cd.group.add(mesh);

        // Bot capsule is slimmer than before (r 0.4 -> 0.3) so the player
        // stops close to a mob instead of pushing against an invisible blob.
        const colDesc = Rapier.ColliderDesc.capsule(0.5, 0.3)
          .setTranslation(0, 0.95, 0)
          .setCollisionGroups(GROUP_PROP);
        const bodyDesc = Rapier.RigidBodyDesc.kinematicPositionBased();
        const { body, id: bid } = this.physics.createBody(bodyDesc, colDesc);
        body.setTranslation({ x: px, y: py, z: pz }, true);

        const eid = this.entities.add({
          type: bName,
          category: 'bot',
          position: new THREE.Vector3(px, py, pz),
          chunk: _key(cx, cz),
          mesh,
          bodyId: bid,
          physicsBodyId: bid,
          state: 'idle',
          stateTimer: rng.range(1, 4),
          action: 'idle',
          targetPos: null,
          speed: bCfg.speed,
          detect: bCfg.detect,
          flee: bCfg.flee,
          behavior: bCfg.behavior || (bCfg.flee > 0 ? 'flee' : bCfg.attackRange > 0 ? 'aggressive' : 'passive'),
          attackRange: bCfg.attackRange || 0,
          attackCooldown: bCfg.attackCooldown || 0,
          attackForce: bCfg.attackForce || 0,
          angryDuration: bCfg.angryDuration || 0,
          attackTimer: 0,
          angerTimer: 0,
          animation: animator,
          config: bCfg
        });
        if (animator) animator.playAction('idle');
        cd.bodyIds.push(eid);
      };

      if (url) {
        this.glb.load(bName, url).then(model => spawnBot(model)).catch(() => spawnBot());
      } else {
        spawnBot();
      }
    }
  }

  _createSpawnPhysicsBody(profile, px, py, pz, scale) {
    const collider = this._spawnColliderFor(profile, scale);
    if (!collider) return null;

    const bodyDesc = Rapier.RigidBodyDesc.fixed().setTranslation(px, py, pz);
    const { id } = this.physics.createBody(bodyDesc, collider);
    return id;
  }

  _spawnColliderFor(profile, scale) {
    const physics = profile?.physics;
    if (!physics) return null;

    const s = Math.max(0.1, scale || 1);
    const offset = physics.offset || [0, 0, 0];

    if (physics.type === 'cuboid') {
      const halfExtents = physics.halfExtents || [1, 1, 1];
      return Rapier.ColliderDesc.cuboid(
        halfExtents[0] * s,
        halfExtents[1] * s,
        halfExtents[2] * s
      ).setTranslation(offset[0] * s, offset[1] * s, offset[2] * s)
        .setCollisionGroups(GROUP_PROP);
    }

    if (physics.type === 'ball') {
      return Rapier.ColliderDesc.ball((physics.radius || 1) * s)
        .setTranslation(offset[0] * s, offset[1] * s, offset[2] * s)
        .setCollisionGroups(GROUP_PROP);
    }

    if (physics.type === 'capsule') {
      return Rapier.ColliderDesc.capsule((physics.halfHeight || 1) * s, (physics.radius || 0.25) * s)
        .setTranslation(offset[0] * s, offset[1] * s, offset[2] * s)
        .setCollisionGroups(GROUP_PROP);
    }

    return null;
  }

  _unload(k, cd) {
    cd.disposed = true;

    for (const eid of cd.bodyIds) {
      const e = this.entities.get(eid);
      if (!e) continue;
      if (e.physicsBodyId !== undefined && e.physicsBodyId !== null) {
        this.physics.removeBody(e.physicsBodyId);
      }
      this.entities.remove(eid);
    }

    if (cd.terrainBodyId) this.physics.removeBody(cd.terrainBodyId);
    this.scene.remove(cd.group);

    cd.group.traverse(c => {
      // Cached model instances (GLB scenes and procedural fallbacks) share
      // their geometry/material with the GLBCache and every other clone -
      // disposing them invalidates the cache and forces constant GPU re-uploads.
      if (c.userData && c.userData.cachedInstance) return;
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        if (Array.isArray(c.material)) {
          c.material.forEach(m => m.dispose());
        } else {
          c.material.dispose();
        }
      }
    });

    this.chunks.delete(k);
  }

  unloadAll() {
    for (const [k, cd] of [...this.chunks]) {
      this._unload(k, cd);
    }
  }

  chunkCount() {
    return this.chunks.size;
  }
}
