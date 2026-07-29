// RADIANT WARFRONT — prototype 08 (core skeleton): the weather director.
// What the brief pins down, built and verifiable headless:
//   - four immiscible gases, planet always fully partitioned
//   - self-cohesion per gas is STRUCTURAL (without it: soup by ~tick 1200);
//     Bloom's cohesion deliberately weak
//   - deterministic seeded sim: same seed = same sky, everywhere
//   - a director, not a renderer: output is FRONTS as parameter sets
//   - vector-native: gas parcels (moving weighted points), no grid state
//
// ⚠ SKELETON, not v12. The four-layer funnel (planet → hemisphere vectors →
// window primitives → client upscale) and the TEN NAMED PAIR-EVENTS need the
// real v12 spec — the PAIR_EVENTS table below is a placeholder hook, mapping
// NOT invented here. Domain is a torus standing in for the sphere.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WeatherSim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TUNABLES = {
    tickRate:       { value: 10,   min: 1,   max: 60,   tooltip: 'Weather ticks per second. The sky moves slower than the battle.' },
    worldSize:      { value: 1000, min: 200, max: 5000, tooltip: 'Torus edge length (sphere stand-in for the skeleton).' },
    parcelsPerGas:  { value: 12,   min: 3,   max: 40,   tooltip: 'Vector parcels per gas. The whole planet sim is 4x this many points.' },
    cohesion:       { value: 14,   min: 0,   max: 80,   tooltip: 'Pull toward same-gas neighbors. STRUCTURAL: at 0 the sky is soup by ~tick 1200.' },
    bloomCohesionMult:{ value: 0.35,min: 0.05,max: 1,   tooltip: 'Bloom\'s cohesion fraction — deliberately the weak gas.' },
    cohesionRange:  { value: 320,  min: 50,  max: 2000, tooltip: 'Neighbor radius for cohesion.' },
    sameGasSpace:   { value: 55,   min: 0,   max: 200,  tooltip: 'Short-range same-gas separation — keeps a gas a REGION, not a dot.' },
    spaceRange:     { value: 120,  min: 20,  max: 500,  tooltip: 'Radius of the same-gas separation push.' },
    windShear:      { value: 3,    min: 1,   max: 8,    tooltip: 'Spatial cycles of the flow field across the world. Higher = more shear tearing at blobs.' },
    repulsion:      { value: 26,   min: 0,   max: 120,  tooltip: 'Push away from other-gas parcels. Immiscibility.' },
    repulsionRange: { value: 150,  min: 20,  max: 1000, tooltip: 'Range of the immiscible push.' },
    windStrength:   { value: 25,   min: 0,   max: 60,   tooltip: 'Seeded global flow field strength. Zones drift; players never mutate this.' },
    windTurn:       { value: 0.05, min: 0,   max: 1,    tooltip: 'How fast the flow field itself evolves (rad/sec-ish).' },
    damp:           { value: 0.8,  min: 0,   max: 5,    tooltip: 'Parcel velocity damping.' },
    frontRes:       { value: 40,   min: 12,  max: 96,   tooltip: 'Sampling resolution for front extraction (director output only — clients upscale).' },
  };

  const GASES = ['cinder', 'bloom', 'brine', 'halo'];

  // PLACEHOLDER — the ten named pair-events from the design. Conditions are
  // TODO pending the v12 spec; detection below reports raw (pair, length,
  // intensity, drift) and this table is where names will bind to conditions.
  const PAIR_EVENTS = [
    { name: 'The Forge', pair: null, condition: 'TODO (v12 spec)' },
    { name: 'Sinkmaw', pair: null, condition: 'TODO (v12 spec)' },
    { name: 'Overbloom', pair: null, condition: 'TODO (v12 spec)' },
    { name: 'Flashover', pair: null, condition: 'TODO (v12 spec)' },
    { name: 'Quench Fracture', pair: null, condition: 'TODO (v12 spec)' },
    { name: 'Wildfire Front', pair: null, condition: 'TODO (v12 spec)' },
    { name: 'Detonation', pair: null, condition: 'TODO (v12 spec)' },
    { name: 'Frost Lattice', pair: null, condition: 'TODO (v12 spec)' },
    { name: 'Squall', pair: null, condition: 'TODO (v12 spec)' },
    { name: 'Pollen Storm', pair: null, condition: 'TODO (v12 spec)' },
  ];

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function Sim(seed, overrides) {
    this.seed = seed >>> 0;
    this.T = {};
    for (const k in TUNABLES) this.T[k] = TUNABLES[k].value;
    if (overrides) for (const k in overrides) {
      if (!(k in this.T)) throw new Error('unknown tunable: ' + k);
      this.T[k] = overrides[k];
    }
    this.rng = mulberry32(this.seed);
    this.tick = 0;
    this.dt = 1 / this.T.tickRate;
    const S = this.T.worldSize;
    // Parcels: each gas seeded in its own loose quadrant blob so the sky starts
    // structured, then the forces own it from there.
    this.parcels = [];
    for (let g = 0; g < 4; g++) {
      const cx = (g % 2) * S / 2 + S / 4, cy = Math.floor(g / 2) * S / 2 + S / 4;
      for (let i = 0; i < this.T.parcelsPerGas; i++) {
        this.parcels.push({
          gas: g,
          x: (cx + (this.rng() - 0.5) * S * 0.4 + S) % S,
          y: (cy + (this.rng() - 0.5) * S * 0.4 + S) % S,
          vx: 0, vy: 0,
          strength: 0.7 + this.rng() * 0.6,
        });
      }
    }
    this.windPhase = this.rng() * 6.283;
  }

  // Torus-shortest delta.
  Sim.prototype._d = function (a, b) {
    const S = this.T.worldSize;
    let d = b - a;
    if (d > S / 2) d -= S;
    if (d < -S / 2) d += S;
    return d;
  };

  // Ownership: strongest strength/(dist^2+eps) wins. Every point always has an
  // owner — the planet is fully partitioned by construction.
  Sim.prototype.gasAt = function (x, y) {
    let best = -1, bestW = -1;
    for (const p of this.parcels) {
      const dx = this._d(p.x, x), dy = this._d(p.y, y);
      const w = p.strength / (dx * dx + dy * dy + 400);
      if (w > bestW) { bestW = w; best = p.gas; }
    }
    return best;
  };

  Sim.prototype.step = function () {
    const T = this.T, dt = this.dt, S = T.worldSize;
    this.windPhase += T.windTurn * dt;
    for (const p of this.parcels) {
      let fx = 0, fy = 0;
      for (const q of this.parcels) {
        if (q === p) continue;
        const dx = this._d(p.x, q.x), dy = this._d(p.y, q.y);
        const d2 = dx * dx + dy * dy;
        const d = Math.sqrt(d2) + 1e-6;
        if (q.gas === p.gas) {
          if (d < T.spaceRange) {
            // Boids-style separation: a gas is a region, never a dot.
            const k = T.sameGasSpace * (1 - d / T.spaceRange);
            fx -= (dx / d) * k;
            fy -= (dy / d) * k;
          } else if (d < T.cohesionRange) {
            const k = T.cohesion * (p.gas === 1 ? T.bloomCohesionMult : 1); // gas 1 = bloom
            fx += (dx / d) * k * (d / T.cohesionRange);
            fy += (dy / d) * k * (d / T.cohesionRange);
          }
        } else if (d < T.repulsionRange) {
          const k = T.repulsion * (1 - d / T.repulsionRange);
          fx -= (dx / d) * k;
          fy -= (dy / d) * k;
        }
      }
      // Seeded global flow: a smooth rotating field, same for everyone.
      const wa = Math.sin(p.x / S * 6.283 * T.windShear + this.windPhase) +
                 Math.cos(p.y / S * 6.283 * T.windShear - this.windPhase * 0.7);
      fx += Math.cos(wa * 3.1) * T.windStrength;
      fy += Math.sin(wa * 3.1) * T.windStrength;

      p.vx += fx * dt; p.vy += fy * dt;
      p.vx -= p.vx * T.damp * dt; p.vy -= p.vy * T.damp * dt;
    }
    for (const p of this.parcels) {
      p.x = (p.x + p.vx * dt + S) % S;
      p.y = (p.y + p.vy * dt + S) % S;
    }
    this.tick++;
  };

  // Director output: fronts as parameter sets. Sample a coarse grid, find
  // cells whose right/down neighbor is a different gas, bucket by pair, and
  // reduce each pair to {pair, cells, cx, cy, intensity}. Clients upscale;
  // this sim never renders.
  Sim.prototype.fronts = function () {
    const T = this.T, S = T.worldSize, n = Math.floor(T.frontRes);
    const cell = S / n;
    const own = new Int8Array(n * n);
    for (let gy = 0; gy < n; gy++) for (let gx = 0; gx < n; gx++) {
      own[gy * n + gx] = this.gasAt(gx * cell + cell / 2, gy * cell + cell / 2);
    }
    const buckets = {};
    for (let gy = 0; gy < n; gy++) for (let gx = 0; gx < n; gx++) {
      const a = own[gy * n + gx];
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const b = own[((gy + dy) % n) * n + ((gx + dx) % n)];
        if (a === b) continue;
        const key = Math.min(a, b) + '-' + Math.max(a, b);
        if (!buckets[key]) buckets[key] = { pair: [GASES[Math.min(a, b)], GASES[Math.max(a, b)]], cells: 0, sx: 0, sy: 0 };
        const bk = buckets[key];
        bk.cells++;
        bk.sx += gx * cell; bk.sy += gy * cell;
      }
    }
    const out = [];
    for (const key in buckets) {
      const b = buckets[key];
      out.push({
        pair: b.pair,
        length: b.cells * cell,                 // rough front length
        cx: b.sx / b.cells, cy: b.sy / b.cells, // centroid (torus-naive; fine for params)
        intensity: b.cells / (n * n),           // how much of the sky is this seam
      });
    }
    out.sort((a, b) => b.length - a.length);
    return out;
  };

  // Structure metric for tests: connected clusters per gas on the sample grid
  // (wrap-aware 4-connectivity). Cohesion holds this low; soup sends it high.
  Sim.prototype.clusterCounts = function (res) {
    const S = this.T.worldSize, n = res || 40;
    const cell = S / n;
    const own = new Int8Array(n * n);
    for (let gy = 0; gy < n; gy++) for (let gx = 0; gx < n; gx++) {
      own[gy * n + gx] = this.gasAt(gx * cell + cell / 2, gy * cell + cell / 2);
    }
    const seen = new Uint8Array(n * n);
    const counts = [0, 0, 0, 0];
    const areas = [0, 0, 0, 0];
    for (let i = 0; i < n * n; i++) areas[own[i]]++;
    for (let start = 0; start < n * n; start++) {
      if (seen[start]) continue;
      const gas = own[start];
      counts[gas]++;
      const stack = [start];
      seen[start] = 1;
      while (stack.length) {
        const i = stack.pop();
        const gx = i % n, gy = (i / n) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const j = (((gy + dy + n) % n) * n) + ((gx + dx + n) % n);
          if (!seen[j] && own[j] === gas) { seen[j] = 1; stack.push(j); }
        }
      }
    }
    return { counts: counts, areaFrac: areas.map(a => a / (n * n)) };
  };

  Sim.prototype.stateHash = function () {
    let h = 0x811c9dc5;
    const mix = str => { for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } };
    mix('t' + this.tick);
    for (const p of this.parcels) mix(p.gas + ':' + p.x.toFixed(3) + ',' + p.y.toFixed(3) + ',' + p.vx.toFixed(4));
    return (h >>> 0).toString(16);
  };

  return { Sim: Sim, TUNABLES: TUNABLES, GASES: GASES, PAIR_EVENTS: PAIR_EVENTS, mulberry32: mulberry32 };
});
