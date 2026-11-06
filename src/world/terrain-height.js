/**
 * Terrain Height Generator
 * Procedurally generates terrain heights using noise
 *
 * The field has three layers:
 * - a low-frequency CONTINENTAL mask that decides land vs ocean, giving the
 *   world large connected sea basins with smooth beaches between them
 * - the classic FBM height field, boosted quadratically in the upper range
 *   so highlands rise into real mountains instead of gentle hills
 * - a regional MOUNTAIN mask on its own noise stream: inside range cores the
 *   highlands are multiplied up to (1 + mountainBoost), and a soft
 *   saturation curve caps the tallest spires near capKnee + capSpan, so the
 *   world gets dramatic 70-85m ice-capped ranges while plains stay gentle
 */
import { Noise } from '../core/noise.js';
import { CFG } from '../config/config.js';
import { _lerp, _clamp } from '../core/utils.js';

export class TerrainHeight {
  constructor(seed) {
    this.n = new Noise(seed);
    // Independent stream for the continental mask so land/ocean layout can be
    // tuned without disturbing the hill shapes
    this.cont = new Noise(seed + 4242);
    // Independent stream for the mountain-range mask (deterministic per seed,
    // like every other stream)
    this.mtn = new Noise(seed + 911);
    this.cfg = CFG.world;
  }

  get(wx, wz) {
    const c = this.cfg;

    // Large-scale continents: below oceanLevel the region sinks into an
    // ocean basin, above it the land rises. Features are ~800m across.
    const cont = this.cont.fbm(
      wx * c.continentFreq,
      wz * c.continentFreq,
      3, 2.0, 0.5
    );

    // Coast falloff: 0 inland .. 1 open ocean, smooth across the beach zone
    const t = _clamp((cont - c.oceanLevel) / c.coastWidth, 0, 1);
    const ocean = 1 - t * t * (3 - 2 * t);

    // Rolling hills with a quadratic highland boost for taller mountains
    const base = this.n.fbm(
      wx * c.heightFreq,
      wz * c.heightFreq,
      c.heightOctaves,
      2.0,
      0.48
    );
    let landH = base * c.heightScale * (0.55 + 1.35 * base);

    // Regional mountain ranges: a slow second noise decides WHERE the
    // highlands are amplified. The smoothstep band keeps most of the world
    // untouched, so plains and hills keep their old character while range
    // cores climb toward the cloud deck.
    const m = this.mtn.fbm(wx * c.mountainFreq, wz * c.mountainFreq, 3, 2.0, 0.5);
    let mt = _clamp((m - c.mountainLo) / (c.mountainHi - c.mountainLo), 0, 1);
    mt = mt * mt * (3 - 2 * mt);
    landH *= 1 + c.mountainBoost * mt;

    // Soft saturation cap: exponentially flattening approach to
    // capKnee + capSpan (~86m). Hard caps would mesa-off the peaks into
    // flat plateaus; this keeps every summit pointed.
    if (landH > c.mountainCapKnee) {
      const over = landH - c.mountainCapKnee;
      landH = c.mountainCapKnee + c.mountainCapSpan * (1 - Math.exp(-over / c.mountainCapSpan));
    }

    // Sea floor: sinks with distance from the coast, well below the surface,
    // with a few meters of FBM relief so the ocean bed is not a dead flat
    // plane when diving (seaH stays under the water line: at t=1 the floor
    // tops out at waterLevel - 4 +- 2).
    const seaH = c.waterLevel - 4 - 20 * (1 - t) + (base - 0.5) * 4;

    return _lerp(landH, seaH, ocean);
  }

  /**
   * Height of the RENDERED terrain surface at a world position.
   *
   * `get()` is the analytic height field, but the visible terrain is a mesh
   * that only samples it at the chunk grid vertices and interpolates linearly
   * in between. On curved slopes the two drift apart, which made trees hover
   * and mobs sink into hillsides. Chunk origins are multiples of chunkSize and
   * vertices sit at multiples of chunkSize/chunkSegments, so the whole mesh
   * lives on one global lattice; bilinearly interpolating the four surrounding
   * lattice heights reproduces the visible surface (triangulation vs bilinear
   * differs by well under a centimeter here).
   */
  gridHeight(wx, wz) {
    const step = this.cfg.chunkSize / this.cfg.chunkSegments;
    const gx = Math.floor(wx / step);
    const gz = Math.floor(wz / step);
    const fx = wx / step - gx;
    const fz = wz / step - gz;

    const h00 = this.get(gx * step, gz * step);
    const h10 = this.get((gx + 1) * step, gz * step);
    const h01 = this.get(gx * step, (gz + 1) * step);
    const h11 = this.get((gx + 1) * step, (gz + 1) * step);

    return _lerp(_lerp(h00, h10, fx), _lerp(h01, h11, fx), fz);
  }
}
