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
import { VillageSystem } from './village-system.js';
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
  constructor(scene, physics, entities, glbCache, terrainH, biomeSys, spawnPoint = null) {
    this.scene = scene;
    this.physics = physics;
    this.entities = entities;
    this.glb = glbCache;
    this.terrainH = terrainH;
    this.biome = biomeSys;
    this.spawnPoint = spawnPoint;
    this.chunks = new Map();
    this.cfg = CFG.world;
    this.noise = new Noise(this.cfg.seed + 777);
    // Deterministic village sites + house slots + residents (see the module
    // doc) - houses no longer scatter per-cell across the wilderness
    this.villages = new VillageSystem(this.cfg.seed, terrainH, biomeSys);
  }

  // Shared stone material for house plinths (one material for every plinth
  // in the world - geometries stay per-instance and get disposed on unload)
  static _plinthMat = null;

  _plinthMaterial() {
    if (!ChunkManager._plinthMat) {
      ChunkManager._plinthMat = new THREE.MeshLambertMaterial({ color: 0x99948a });
    }
    return ChunkManager._plinthMat;
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

    // Spawn village houses + residents (slots inside this chunk's bounds)
    this._spawnVillageContent(cd, o, cx, cz);

    // Spawn bots
    this._spawnBots(cd, o, cx, cz);
  }

  _genTerrain(cd, o) {
    const S = this.cfg.chunkSize;
    // The shared-lattice math below needs the vertex grid symmetric around the
    // chunk center (vertices on multiples of step relative to the origin), so
    // an odd segment count is bumped to the next even number.
    const seg = this.cfg.chunkSegments + (this.cfg.chunkSegments % 2);
    const step = S / seg;
    const HALF = seg / 2; // PlaneGeometry local vertices run from -S/2 to +S/2
    const HS = seg + 3;   // centered height lattice incl. a 1-vertex halo ring

    // Height lattice with a halo. Chunk origins are multiples of chunkSize and
    // vertices sit on multiples of step, so this lattice is GLOBAL: every
    // neighboring chunk samples the exact same heights along the shared edge.
    const heights = new Float32Array(HS * HS);
    for (let j = 0; j < HS; j++) {
      const wz = o.z + (j - HALF - 1) * step;
      for (let i = 0; i < HS; i++) {
        heights[j * HS + i] = this.terrainH.get(o.x + (i - HALF - 1) * step, wz);
      }
    }

    const geo = new THREE.PlaneGeometry(S, S, seg, seg);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    const colors = new Float32Array(pos.count * 3);

    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i);
      const lz = pos.getZ(i);
      const wx = lx + o.x;
      const wz = lz + o.z;

      const col = Math.round(lx / step) + HALF + 1;
      const row = Math.round(lz / step) + HALF + 1;
      const h = heights[row * HS + col];
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

      // Heightfield normal via central differences of the SHARED lattice.
      // The old computeVertexNormals() averaged only a chunk's OWN triangles,
      // so the two sides of a chunk border carried different normals - a
      // lighting stripe along every border that grazing dusk sunlight made
      // glow or shadow abruptly while moving. Both chunks now derive the
      // same numbers from the same lattice: seamless.
      const hL = heights[row * HS + col - 1];
      const hR = heights[row * HS + col + 1];
      const hD = heights[(row - 1) * HS + col];
      const hU = heights[(row + 1) * HS + col];
      const nx = hL - hR;
      const nz = hD - hU;
      const inv = 1 / Math.sqrt(nx * nx + 4 * step * step + nz * nz);
      nor.setXYZ(i, nx * inv, 2 * step * inv, nz * inv);
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

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
          // Village-only profiles (houses) spawn from VillageSystem slots, not
          // from this per-cell scatter
          if (sCfg.village) continue;
          if (!sCfg.biomes.includes(biome)) continue;

          const density = this._getDensity(sCfg.density, biome);
          if (rng.next() > density) continue;

          // Min distance check
          const ox = (rng.next() - 0.5) * cellSize * 0.7;
          const oz = (rng.next() - 0.5) * cellSize * 0.7;
          const px = wx + ox;
          const pz = wz + oz;

          // Villages keep their ground clear: no trees, rocks or bushes inside
          // the settlement (flowers stay - a kept lawn still blooms). Checked
          // on the jittered position so a border cell's tree cannot lean into
          // a house pad.
          if (sName !== 'flower'
            && this.villages.inVillageGround(px, pz)) continue;

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
          // Keep flora, rocks out of lakes and their beds
          if (py < CFG.world.waterLevel + 0.3) continue;

          const scale = sCfg.scale[0] + rng.next() * (sCfg.scale[1] - sCfg.scale[0]);
          const rotY = rng.next() * Math.PI * 2;

          // Slope-aware placement for profiles that declare a `placement`
          // block: reject unbuildable pads and seat on a stone plinth.
          let seatY = py;
          let plinth = null;
          if (sCfg.placement) {
            const seat = this._seatProfile(sCfg, px, pz, scale);
            if (!seat.ok) continue;
            seatY = seat.seatY;
            plinth = seat.plinth;
          }

          placed.push({ x: px, z: pz });

          this._spawnProfileInstance(cd, o, cx, cz, sName, sCfg,
            px, seatY, pz, scale, rotY, plinth);
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

      this._createBot(cd, o, cx, cz, bName, bCfg, px, pz, rng);
    }
  }

  /**
   * One bot instance: mesh + animator + kinematic physics body + entity.
   * Shared by the per-chunk random spawns and the village residents so both
   * get identical capsule, animation and cleanup behavior.
   */
  _createBot(cd, o, cx, cz, bName, bCfg, px, pz, rng) {
    // Grid height keeps bot feet on the rendered surface instead of the
    // analytic field the mesh only approximates.
    const py = this.terrainH.gridHeight(px, pz);
    // No mobs standing around at the bottom of a lake
    if (py < CFG.world.waterLevel + 0.3) return;
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
        // Close-range hearing: foliage and hills constantly break the eye-ray
        // in jungle/swamp, which let zombies stand beside the player without
        // ever aggroing (see bot-ai.js)
        hearing: bCfg.hearing || 0,
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

  /**
   * Villages: houses from the shared VillageSystem slots plus the residents.
   * Sites and slots are pure functions of (seed, lattice cell), so the chunk
   * that happens to own a slot spawns it exactly once - no duplication at
   * chunk borders, no cross-chunk coordination.
   */
  _spawnVillageContent(cd, o, cx, cz) {
    const S = this.cfg.chunkSize;
    const sites = this.villages.sitesInRect(o.x, o.z, o.x + S, o.z + S);
    if (!sites.length) return;

    const sCfg = CFG.spawns.house;
    if (!sCfg) return;

    for (const site of sites) {
      for (const slot of this.villages.slotsOf(site)) {
        if (slot.x < o.x || slot.x >= o.x + S || slot.z < o.z || slot.z >= o.z + S) continue;
        // Re-validate against the terrain: the slot checks run on the same
        // pad math, so this rejects only when spawn rules changed mid-session
        const seat = this._seatProfile(sCfg, slot.x, slot.z, slot.scale);
        if (!seat.ok) continue;
        this._spawnProfileInstance(cd, o, cx, cz, 'house', sCfg,
          slot.x, seat.seatY, slot.z, slot.scale, slot.rotY, seat.plinth);
      }

      // Residents spawn in whatever chunk owns their exact position (they
      // jitter up to ~9m around the center, so a border village's residents
      // can legally belong to the neighboring chunk)
      for (const b of site.bots) {
        if (b.x < o.x || b.x >= o.x + S || b.z < o.z || b.z >= o.z + S) continue;
        const bCfg = CFG.bots[b.type];
        if (!bCfg) continue;
        // Same mob-free spawn pad rule as the random spawns
        const sx = b.x - CFG.world.spawnX;
        const sz = b.z - CFG.world.spawnZ;
        if (sx * sx + sz * sz < CFG.world.safeSpawnRadius * CFG.world.safeSpawnRadius) continue;
        const rng = new SeededRandom(hashChunk(this.cfg.seed ^ 0x0dd1ce5, Math.round(b.x * 10), Math.round(b.z * 10)));
        this._createBot(cd, o, cx, cz, b.type, bCfg, b.x, b.z, rng);
      }
    }
  }

  /**
   * Shared pad evaluation for profiles with a `placement` block (houses):
   * rejects unbuildable sites (corner underwater, drop steeper than the
   * profile accepts, above the green belt, on the spawn pad) and seats
   * buildable ones on their highest corner with a stone plinth filling the
   * gap - used by BOTH the wild-prop scatter and the village house slots.
   */
  _seatProfile(sCfg, px, pz, scale) {
    const pl = sCfg.placement;
    // Grid height, not the analytic field - the mesh only samples vertices
    const py = this.terrainH.gridHeight(px, pz);
    if (py < CFG.world.waterLevel + 0.3) return { ok: false };

    // Bounding square of the rotated footprint, plus settling margin
    const fp = Math.hypot(pl.footprint[0], pl.footprint[1]) * scale + 0.35;
    let hMin = py, hMax = py;
    let wet = false;
    for (let c = 0; c < 4; c++) {
      const h = this.terrainH.gridHeight(
        px + (c & 1 ? fp : -fp),
        pz + (c & 2 ? fp : -fp)
      );
      if (h < hMin) hMin = h;
      if (h > hMax) hMax = h;
      if (h < CFG.world.waterLevel + 0.3) wet = true;
    }
    if (wet || hMax - hMin > pl.maxDrop
      || (pl.maxAltitude && py > pl.maxAltitude)
      || (pl.spawnClear && this.spawnPoint
        && (px - this.spawnPoint.x) ** 2 + (pz - this.spawnPoint.z) ** 2 < pl.spawnClear * pl.spawnClear)) {
      return { ok: false };
    }
    // Seat on the HIGHEST corner; a stone plinth fills the gap under the
    // rest - reads as a terraced foundation instead of a half-buried hut
    const seatY = hMax + 0.02;
    let plinth = null;
    if (seatY - py > pl.plinthFrom) {
      plinth = {
        halfX: pl.plinthFootprint[0] * scale + 0.15,
        halfZ: pl.plinthFootprint[1] * scale + 0.15,
        top: seatY,
        bottom: hMin - 0.75,
      };
    }
    return { ok: true, seatY, plinth };
  }

  /**
   * One spawn-profile instance: physics bodies + plinth body + async GLB
   * (or fallback) mesh + entity registration. Shared by the per-cell scatter
   * and the village house slots.
   */
  _spawnProfileInstance(cd, o, cx, cz, sName, sCfg, px, seatY, pz, scale, rotY, plinth) {
    const url = CFG.glbModels[sName];
    const physicsBodyIds = [];
    const mainBodyId = this._createSpawnPhysicsBody(sCfg, px, seatY, pz, scale, rotY);
    if (mainBodyId) physicsBodyIds.push(mainBodyId);
    if (plinth) physicsBodyIds.push(this._createPlinthBody(plinth, px, seatY, pz, rotY));
    const dropBodies = () => {
      for (const id of physicsBodyIds) this.physics.removeBody(id);
    };

    this.glb.load(sName, url).then(model => {
      // The load resolves asynchronously - the chunk may have been
      // unloaded in the meantime. Skip and release the already-created
      // physics bodies, otherwise they (and the entity) leak forever.
      if (cd.disposed) {
        dropBodies();
        return;
      }
      if (plinth) {
        const ph = plinth.top - plinth.bottom;
        const stone = new THREE.Mesh(
          new THREE.BoxGeometry(plinth.halfX * 2, ph, plinth.halfZ * 2),
          this._plinthMaterial()
        );
        stone.position.set(px - o.x, plinth.bottom + ph / 2, pz - o.z);
        stone.rotation.y = rotY;
        stone.castShadow = stone.receiveShadow = CFG.settings.shadows;
        cd.group.add(stone);
      }
      const inst = model.scene.clone();
      // GLB clips when present, otherwise a gentle wind sway for flora
      const animation = this.glb.createAnimationController(model, inst, sCfg.animations || null)
        || (sCfg.sway ? createSwayAnimator(inst) : null);
      inst.scale.setScalar(scale);
      inst.position.set(px - o.x, seatY, pz - o.z);
      inst.rotation.y = rotY;
      inst.traverse(c => {
        if (c.isMesh) c.castShadow = CFG.settings.shadows;
        c.userData.cachedInstance = true;
      });
      cd.group.add(inst);

      const eid = this.entities.add({
        type: sName,
        position: new THREE.Vector3(px, seatY, pz),
        chunk: _key(cx, cz),
        mesh: inst,
        physicsBodyId: mainBodyId,
        physicsBodyIds,
        scale,
        biome: this.biome.get(px, pz),
        animation
      });
      if (animation) animation.playAction('idle');
      cd.bodyIds.push(eid);
    }).catch(() => {
      if (!cd.disposed) dropBodies();
    });
  }

  _createSpawnPhysicsBody(profile, px, py, pz, scale, rotY = 0) {
    const collider = this._spawnColliderFor(profile, scale);
    if (!collider) return null;

    const bodyDesc = Rapier.RigidBodyDesc.fixed().setTranslation(px, py, pz);
    // Match the visual yaw so cuboid colliders (houses) align with the
    // rotated model instead of presenting an axis-aligned wall to the player
    if (rotY) bodyDesc.setRotation({ x: 0, y: Math.sin(rotY / 2), z: 0, w: Math.cos(rotY / 2) });
    const { id } = this.physics.createBody(bodyDesc, collider);
    return id;
  }

  /**
   * Solid stone foundation under a slope-seated house: a cuboid from below
   * ground up to the seat height, so the plinth is walkable terrain rather
   * than painted-on rock the player phases through.
   */
  _createPlinthBody(plinth, px, py, pz, rotY = 0) {
    const ph = plinth.top - plinth.bottom;
    const colDesc = Rapier.ColliderDesc.cuboid(plinth.halfX, ph / 2, plinth.halfZ)
      .setTranslation(0, (plinth.bottom + ph / 2) - py, 0)
      .setCollisionGroups(GROUP_PROP);
    const bodyDesc = Rapier.RigidBodyDesc.fixed()
      .setTranslation(px, py, pz)
      .setRotation({ x: 0, y: Math.sin(rotY / 2), z: 0, w: Math.cos(rotY / 2) });
    const { id } = this.physics.createBody(bodyDesc, colDesc);
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
      if (e.physicsBodyIds) {
        for (const id of e.physicsBodyIds) this.physics.removeBody(id);
      } else if (e.physicsBodyId !== undefined && e.physicsBodyId !== null) {
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
