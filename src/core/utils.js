/**
 * Utility Functions
 */

export const _uid = () => Math.random().toString(36).slice(2, 10);
export const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const _lerp = (a, b, t) => a + (b - a) * t;
export const _key = (x, z) => `${x},${z}`;

/**
 * Deterministic hash of a world coordinate pair under a seed.
 *
 * Every coordinate-driven random decision (per-chunk prop and bot placement,
 * jitter, rotations) must derive its RNG stream from THIS hash instead of
 * Math.random(), so the same seed always produces the exact same world no
 * matter the machine, load order or session. Murmur-style integer finalizer:
 * spreads neighboring coordinates far apart, unlike plain xor of products.
 */
export function hashChunk(seed, cx, cz) {
  let h = (seed | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (cx | 0), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h ^ (cz | 0), 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Seeded Random Number Generator
 */
export class SeededRandom {
  constructor(s) {
    this.s = s % 2147483647;
    if (this.s <= 0) this.s += 2147483646;
  }

  next() {
    this.s = this.s * 16807 % 2147483647;
    return (this.s - 1) / 2147483646;
  }

  range(a, b) {
    return a + this.next() * (b - a);
  }
}
