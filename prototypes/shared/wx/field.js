// WEATHER — the field: what gas is where, at three levels of detail.
//
//   GLOBAL   exactWeights(kf, x, y)    the truth, straight from a keyframe's
//                                      parcels (what the world map shows).
//   REGIONAL bakeRegion(kf, rx, ry)    the interpolator: a keyframe baked into
//            sampleRegion(...)         a small grid per region, blended between
//                                      the two keyframes around "now".
//   LOCAL    warp(...) + regional      fine detail: the regional field read at
//                                      a point nudged by seeded noise, never
//                                      more than D away. So a seam you see up
//                                      close is always within D (+ one grid
//                                      cell) of where the map puts it.
//
// Pure functions, no state, no bus. Only + - * / sqrt floor and integer
// hashing — no sin/cos/exp/pow — so every machine gets bit-identical results.
// A test greps this file to keep it that way.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rng.js'));
  else (root.Wx = root.Wx || {}).field = factory(root.Wx.rng);
})(typeof self !== 'undefined' ? self : this, function (rng) {
  'use strict';

  const VERSION = 1;          // bump when any sampling maths changes; consumers reject other versions
  const KC = 400;             // kernel softening (units^2): influence = strength / (d^2 + KC)
  const STRIDE = 6;           // keyframe parcel layout: gas, x, y, vx, vy, strength
  const CH = 7;               // baked grid channels: w0..w3, pressure, vx, vy
  const SQRT1_2 = 0.7071067811865476;

  // Torus-shortest delta.
  function wrapD(d, S) { return d > S / 2 ? d - S : (d < -S / 2 ? d + S : d); }
  function wrap(v, S) { v %= S; return v < 0 ? v + S : v; }

  // Summed influence of every parcel, per gas. out = [w0, w1, w2, w3].
  function exactWeights(kf, x, y, out) {
    const p = kf.p, S = kf.size;
    out[0] = out[1] = out[2] = out[3] = 0;
    for (let i = 0; i < p.length; i += STRIDE) {
      const dx = wrapD(p[i + 1] - x, S), dy = wrapD(p[i + 2] - y, S);
      out[p[i]] += p[i + 5] / (dx * dx + dy * dy + KC);
    }
    return out;
  }
  function argmax4(w) {
    let g = 0;
    for (let k = 1; k < 4; k++) if (w[k] > w[g]) g = k;
    return g;
  }
  const _w = [0, 0, 0, 0];
  function exactGas(kf, x, y) { return argmax4(exactWeights(kf, x, y, _w)); }

  // Region layout: the world is regionsPerSide x regionsPerSide regions, each
  // baked at res x res cells plus a one-cell apron so bilinear reads never
  // need a neighbouring region.
  function layout(size, regionsPerSide, res) {
    const rs = size / regionsPerSide;
    return { size: size, regionsPerSide: regionsPerSide, res: res, regionSize: rs, cell: rs / res, n: res + 2 };
  }

  // Bake one region of one keyframe. Per cell: the four gas weights, the
  // "pressure" between the two strongest gases (how fast they are closing on
  // each other; negative = pulling apart), and their blended drift velocity.
  function bakeRegion(kf, rx, ry, L) {
    const n = L.n, cell = L.cell, S = L.size, p = kf.p;
    const out = new Float32Array(n * n * CH);
    const W = [0, 0, 0, 0], VX = [0, 0, 0, 0], VY = [0, 0, 0, 0], PX = [0, 0, 0, 0], PY = [0, 0, 0, 0];
    const ox = rx * L.regionSize, oy = ry * L.regionSize;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const cx = wrap(ox + (i - 0.5) * cell, S), cy = wrap(oy + (j - 0.5) * cell, S);
      for (let g = 0; g < 4; g++) W[g] = VX[g] = VY[g] = PX[g] = PY[g] = 0;
      for (let k = 0; k < p.length; k += STRIDE) {
        const dx = wrapD(p[k + 1] - cx, S), dy = wrapD(p[k + 2] - cy, S);
        const w = p[k + 5] / (dx * dx + dy * dy + KC), g = p[k];
        W[g] += w; VX[g] += w * p[k + 3]; VY[g] += w * p[k + 4]; PX[g] += w * dx; PY[g] += w * dy;
      }
      let a = 0, b = 1;
      if (W[b] > W[a]) { a = 1; b = 0; }
      for (let g = 2; g < 4; g++) {
        if (W[g] > W[a]) { b = a; a = g; } else if (W[g] > W[b]) b = g;
      }
      // Direction from A's mass toward B's mass; closing speed along it.
      const nx0 = PX[b] / W[b] - PX[a] / W[a], ny0 = PY[b] / W[b] - PY[a] / W[a];
      const len = Math.sqrt(nx0 * nx0 + ny0 * ny0);
      const vax = VX[a] / W[a], vay = VY[a] / W[a], vbx = VX[b] / W[b], vby = VY[b] / W[b];
      const pressure = len > 1e-6 ? ((vax - vbx) * nx0 + (vay - vby) * ny0) / len : 0;
      const o = (j * n + i) * CH;
      out[o] = W[0]; out[o + 1] = W[1]; out[o + 2] = W[2]; out[o + 3] = W[3];
      out[o + 4] = pressure;
      out[o + 5] = (W[a] * vax + W[b] * vbx) / (W[a] + W[b]);
      out[o + 6] = (W[a] * vay + W[b] * vby) / (W[a] + W[b]);
    }
    return out;
  }

  // Regional sample at a wrapped world point inside region (rx, ry), blended
  // between keyframe grids gA and gB by alpha in [0, 1].
  // out = [gas, gas2, margin 0..1 (0 = on the seam), total weight, pressure, vx, vy,
  //        (7: set by the caller), share of each gas 8..11]  — out needs 12 slots
  const _a = new Float64Array(CH);
  function sampleRegion(gA, gB, alpha, L, rx, ry, x, y, out) {
    const n = L.n;
    const fx = (x - rx * L.regionSize) / L.cell + 0.5, fy = (y - ry * L.regionSize) / L.cell + 0.5;
    const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const o00 = (iy * n + ix) * CH, o10 = o00 + CH, o01 = o00 + n * CH, o11 = o01 + CH;
    const k00 = (1 - tx) * (1 - ty), k10 = tx * (1 - ty), k01 = (1 - tx) * ty, k11 = tx * ty;
    for (let c = 0; c < CH; c++) {
      const va = gA[o00 + c] * k00 + gA[o10 + c] * k10 + gA[o01 + c] * k01 + gA[o11 + c] * k11;
      const vb = gB[o00 + c] * k00 + gB[o10 + c] * k10 + gB[o01 + c] * k01 + gB[o11 + c] * k11;
      _a[c] = va + (vb - va) * alpha;
    }
    let a = 0, b = 1;
    if (_a[b] > _a[a]) { a = 1; b = 0; }
    for (let g = 2; g < 4; g++) {
      if (_a[g] > _a[a]) { b = a; a = g; } else if (_a[g] > _a[b]) b = g;
    }
    const tot = _a[0] + _a[1] + _a[2] + _a[3];
    out[0] = a; out[1] = b;
    out[2] = (_a[a] - _a[b]) / (_a[a] + _a[b]);
    out[3] = tot; out[4] = _a[4]; out[5] = _a[5]; out[6] = _a[6];
    out[8] = _a[0] / tot; out[9] = _a[1] / tot; out[10] = _a[2] / tot; out[11] = _a[3] / tot;
    return out;
  }

  // Local detail: a displacement of at most D units (each axis <= D/sqrt2),
  // smooth in space (wavelength `scale`) and time (`period` world ticks).
  function warp(seed, x, y, t, D, scale, period, out) {
    const ux = x / scale, uy = y / scale, ut = t / period;
    const nx = 0.65 * rng.noise3(seed, ux, uy, ut) + 0.35 * rng.noise3(seed ^ 0x5bd1e995, ux * 2.3, uy * 2.3, ut * 1.7);
    const ny = 0.65 * rng.noise3(seed ^ 0x68e31da4, ux, uy, ut) + 0.35 * rng.noise3(seed ^ 0x1b873593, ux * 2.3, uy * 2.3, ut * 1.7);
    out[0] = nx * D * SQRT1_2; out[1] = ny * D * SQRT1_2;
    return out;
  }

  return {
    VERSION: VERSION, KC: KC, STRIDE: STRIDE, CH: CH,
    wrap: wrap, wrapD: wrapD, exactWeights: exactWeights, exactGas: exactGas, argmax4: argmax4,
    layout: layout, bakeRegion: bakeRegion, sampleRegion: sampleRegion, warp: warp,
  };
});
