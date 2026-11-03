/**
 * Terrain Height Generator
 * Procedurally generates terrain heights using noise
 */
import { Noise } from '../core/noise.js';
import { CFG } from '../config/config.js';
import { _lerp } from '../core/utils.js';

export class TerrainHeight {
  constructor(seed) {
    this.n = new Noise(seed);
    this.cfg = CFG.world;
  }

  get(wx, wz) {
    return this.n.fbm(
      wx * this.cfg.heightFreq,
      wz * this.cfg.heightFreq,
      this.cfg.heightOctaves,
      2.0,
      0.48
    ) * this.cfg.heightScale;
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
