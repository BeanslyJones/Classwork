// WEATHER — random numbers that stay identical on every machine.
//   mulberry32(seed)  stateful stream. ONLY the global agent owns one, so the
//                     order agents run in can never change the weather.
//   hash32(...)       stateless counter hash: the same inputs give the same
//                     number anywhere, so any shard can compute the same detail
//                     for the same place without asking anyone.
//   noise3(...)       smooth value noise in [-1, 1] built on hash32.
// Integer maths (Math.imul) and + - * / only: bit-identical across engines.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.Wx = root.Wx || {}).rng = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function fmix(h) {
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
    h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
    return h ^ (h >>> 16);
  }
  // Hash of (seed, a, b, c) -> uint32.
  function hash32(seed, a, b, c) {
    let h = fmix((seed | 0) ^ Math.imul(a | 0, 0x27d4eb2d));
    h = fmix(h ^ Math.imul(b | 0, 0x165667b1));
    h = fmix(h ^ Math.imul(c | 0, 0x9e3779b1));
    return h >>> 0;
  }
  // Lattice value in [-1, 1).
  function lat(seed, x, y, t) { return hash32(seed, x, y, t) / 2147483648 - 1; }
  const fade = f => f * f * (3 - 2 * f);

  // Smooth 3D value noise (x, y in lattice units; t in lattice units of time).
  // Always within [-1, 1]: a convex blend of lattice values.
  function noise3(seed, x, y, t) {
    const ix = Math.floor(x), iy = Math.floor(y), it = Math.floor(t);
    const fx = fade(x - ix), fy = fade(y - iy), ft = fade(t - it);
    const a0 = lat(seed, ix, iy, it), b0 = lat(seed, ix + 1, iy, it);
    const c0 = lat(seed, ix, iy + 1, it), d0 = lat(seed, ix + 1, iy + 1, it);
    const a1 = lat(seed, ix, iy, it + 1), b1 = lat(seed, ix + 1, iy, it + 1);
    const c1 = lat(seed, ix, iy + 1, it + 1), d1 = lat(seed, ix + 1, iy + 1, it + 1);
    const p0 = (a0 + (b0 - a0) * fx) + ((c0 + (d0 - c0) * fx) - (a0 + (b0 - a0) * fx)) * fy;
    const p1 = (a1 + (b1 - a1) * fx) + ((c1 + (d1 - c1) * fx) - (a1 + (b1 - a1) * fx)) * fy;
    return p0 + (p1 - p0) * ft;
  }

  return { mulberry32: mulberry32, hash32: hash32, noise3: noise3 };
});
