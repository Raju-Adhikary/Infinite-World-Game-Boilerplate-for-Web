/**
 * Village System
 * Deterministic hamlet placement shared by every chunk.
 *
 * Houses used to be seeded per 8m cell with a flat 1.5% chance, which
 * sprinkled lone huts evenly across the whole world - no settlement ever
 * formed and nothing about a hut's position read as "built by people".
 * Villages instead live on a coarse lattice:
 *
 * - every 160m lattice cell holds AT MOST one village site (jittered inside
 *   the cell so neighbors keep a hard 40% gap), kept only when the terrain
 *   passes the checks below
 * - each site lays 4-8 house slots out on two rings around an open center,
 *   every house yawed to face the square like a real hamlet
 * - residents (villagers + a guard) are attached to the site too
 *
 * Sites, slots and residents are PURE functions of (seed, lattice cell), so
 * any chunk can ask "which villages touch me?" and get an identical answer
 * no matter the load order or session: houses never duplicate across chunk
 * borders and spacing is guaranteed without cross-chunk coordination.
 *
 * The village ground is kept clear - trees, rocks and bushes are skipped
 * inside the settlement radius (ChunkManager consults inVillageGround), so a
 * village reads as a cleared, grassy settlement instead of huts fighting
 * through the forest.
 */
import { CFG } from '../config/config.js';
import { hashChunk, SeededRandom } from '../core/utils.js';

const SPACING = 160;        // meters between village lattice cells
const JITTER = 0.3;         // center drift, fraction of SPACING (hard 40% gap)
const MAX_ALTITUDE = 26;    // villages stay in the green belt, under the rock line
const RING_INNER = [11, 15];// house ring radii around the open center square
const RING_OUTER = [19, 25];
const GOLDEN = 2.399963;    // golden-angle stepping - slots never clump
const MIN_SLOT_DIST = 7.5;  // min center-to-center distance between two houses
const MIN_SLOTS = 4;        // fewer houses than this and the site stays empty
const SLOT_RETRIES = 6;     // placement attempts per slot before giving up
const CLEAR_PAD = 7;        // cleared ground beyond the village radius - wild
                            // trees keep clear of the outermost house wall
// Half-diagonal of the biggest house pad (hypot(2.8, 2.3) * 1.1 scale) plus a
// settling margin - the pad corners every slot must prove buildable
const PAD_MARGIN = 3.9;

export class VillageSystem {
  constructor(seed, terrainH, biome) {
    this.seed = seed;
    this.terrainH = terrainH;
    this.biome = biome;
    this._sites = new Map();  // "i,k" -> site object or null (validated once)
  }

  /**
   * Validated village site for a lattice cell, or null when the terrain says
   * no. A site IS a village: the cell is kept only when its ground passes the
   * checks AND at least MIN_SLOTS house slots can be placed around the
   * square - no ghost settlements. Cached - terrain sampling is the
   * expensive part.
   */
  siteAt(i, k) {
    const id = i + ',' + k;
    if (this._sites.has(id)) return this._sites.get(id);

    const rng = new SeededRandom(hashChunk(this.seed ^ 0x761a2d05, i, k));
    const x = (i + 0.5) * SPACING + (rng.next() - 0.5) * 2 * JITTER * SPACING;
    const z = (k + 0.5) * SPACING + (rng.next() - 0.5) * 2 * JITTER * SPACING;
    const radius = 26 + rng.next() * 9; // 26-35m of village ground

    let site = null;
    if (this._groundOk(x, z, radius)) {
      const slots = this._buildSlots(i, k, x, z);
      if (slots.length >= MIN_SLOTS) {
        site = {
          id, cellI: i, cellK: k,
          x, z, radius,
          slots,
          bots: this._residents(i, k, x, z),
        };
      }
    }
    this._sites.set(id, site);
    return site;
  }

  /** All sites whose cleared ground may reach into the given world rect. */
  sitesInRect(x0, z0, x1, z1) {
    // 40 covers the largest radius (35) + CLEAR_PAD + a house pad half
    const pad = 40;
    const i0 = Math.floor((x0 - pad) / SPACING);
    const i1 = Math.floor((x1 + pad) / SPACING);
    const k0 = Math.floor((z0 - pad) / SPACING);
    const k1 = Math.floor((z1 + pad) / SPACING);
    const out = [];
    for (let i = i0; i <= i1; i++) {
      for (let k = k0; k <= k1; k++) {
        const s = this.siteAt(i, k);
        if (s) out.push(s);
      }
    }
    return out;
  }

  /** True when the point sits on kept-clear village ground. */
  inVillageGround(x, z) {
    const ci = Math.floor(x / SPACING);
    const ck = Math.floor(z / SPACING);
    for (let di = -1; di <= 1; di++) {
      for (let dk = -1; dk <= 1; dk++) {
        const s = this.siteAt(ci + di, ck + dk);
        if (!s) continue;
        const dx = x - s.x;
        const dz = z - s.z;
        if (dx * dx + dz * dz <= (s.radius + CLEAR_PAD) ** 2) return true;
      }
    }
    return false;
  }

  /** House slots decided during site validation (site.slots). */
  slotsOf(site) {
    return site.slots;
  }

  /**
   * 4-8 house pads on two golden-angle rings, every pad validated against
   * the terrain (dry, gently sloped, off the spawn pad) and against the
   * already-accepted slots. A failed spot is retried with a fresh angle and
   * radius - rolling ground routinely rejects a strict-ring spot, and a
   * village that gives up after one try ends up with 0-2 houses. Retries
   * widen the search first within the ring, then across the whole village
   * ground. Yaws face the village center.
   */
  _buildSlots(i, k, cx, cz) {
    const rng = new SeededRandom(hashChunk(this.seed ^ 0x1b3c9d4f, i, k));
    const count = 4 + Math.floor(rng.next() * 5); // 4-8 houses
    const slots = [];

    for (let j = 0; j < count; j++) {
      const inner = j < Math.ceil(count * 0.6);
      const r0 = inner ? RING_INNER[0] : RING_OUTER[0];
      const r1 = inner ? RING_INNER[1] : RING_OUTER[1];

      for (let t = 0; t < SLOT_RETRIES; t++) {
        // First tries stay on the slot's own ring with a small angle jitter;
        // later tries search the full village ground before giving up
        const wide = t >= 2;
        const lo = wide ? RING_INNER[0] : r0;
        const hi = wide ? RING_OUTER[1] : r1;
        const r = lo + rng.next() * (hi - lo);
        const jit = wide ? 0.8 : 0.35;
        const a = j * GOLDEN + rng.range(-jit, jit);
        const x = cx + Math.cos(a) * r;
        const z = cz + Math.sin(a) * r;

        if (!this._padOk(x, z)) continue;

        let crowded = false;
        for (const s of slots) {
          const dx = s.x - x;
          const dz = s.z - z;
          if (dx * dx + dz * dz < MIN_SLOT_DIST * MIN_SLOT_DIST) {
            crowded = true;
            break;
          }
        }
        if (crowded) continue;

        // Keep the world spawn pad building-free (mirrors placement.spawnClear)
        const sx = x - CFG.world.spawnX;
        const sz = z - CFG.world.spawnZ;
        if (sx * sx + sz * sz < 100) continue;

        slots.push({
          x, z,
          rotY: Math.atan2(cx - x, cz - z) + rng.range(-0.25, 0.25),
          scale: 0.9 + rng.next() * 0.2,
        });
        break;
      }
    }

    return slots;
  }

  /**
   * Village ground check: plains/forest belt, comfortably above the water
   * line and below the rock line, and one landform rather than a cliff face
   * running through the square.
   */
  _groundOk(x, z, radius) {
    const w = CFG.world;
    const b = this.biome.get(x, z);
    if (b !== 'plains' && b !== 'forest') return false;

    const hc = this.terrainH.gridHeight(x, z);
    if (hc < w.waterLevel + 1.5 || hc > MAX_ALTITUDE) return false;

    let hMin = hc;
    let hMax = hc;
    for (let n = 0; n < 8; n++) {
      const a = (n / 8) * Math.PI * 2;
      const h = this.terrainH.gridHeight(x + Math.cos(a) * radius, z + Math.sin(a) * radius);
      if (h < w.waterLevel + 0.8) return false;
      if (h < hMin) hMin = h;
      if (h > hMax) hMax = h;
    }
    return hMax - hMin <= 8;
  }

  /** Buildable, dry, gently sloped pad for one house (mirrors placement.maxDrop). */
  _padOk(x, z) {
    const w = CFG.world;
    let hMin = Infinity;
    let hMax = -Infinity;
    for (let c = 0; c < 4; c++) {
      const h = this.terrainH.gridHeight(
        x + (c & 1 ? PAD_MARGIN : -PAD_MARGIN),
        z + (c & 2 ? PAD_MARGIN : -PAD_MARGIN)
      );
      if (h < w.waterLevel + 0.3) return false;
      if (h < hMin) hMin = h;
      if (h > hMax) hMax = h;
    }
    return hMax - hMin <= 2.0;
  }

  /** Villagers around the square plus (usually) one guard. */
  _residents(i, k, x, z) {
    const rng = new SeededRandom(hashChunk(this.seed ^ 0x5f3c7e11, i, k));
    const bots = [];

    const villagers = 2 + Math.floor(rng.next() * 3); // 2-4 residents
    for (let j = 0; j < villagers; j++) {
      const a = j * GOLDEN + rng.range(-0.4, 0.4);
      // The open square: inner house pads reach ~7m from the center, so
      // residents stay inside 6m and never spawn inside a wall
      const r = 3 + rng.next() * 3;
      const bx = x + Math.cos(a) * r;
      const bz = z + Math.sin(a) * r;
      if (this.terrainH.gridHeight(bx, bz) > CFG.world.waterLevel + 0.3) {
        bots.push({ type: 'villager', x: bx, z: bz });
      }
    }

    if (rng.next() < 0.7) {
      const bx = x + rng.range(-6, 6);
      const bz = z + rng.range(-6, 6);
      if (this.terrainH.gridHeight(bx, bz) > CFG.world.waterLevel + 0.3) {
        bots.push({ type: 'guard', x: bx, z: bz });
      }
    }

    return bots;
  }
}
