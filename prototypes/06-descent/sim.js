// RADIANT WARFRONT — prototype 06: loadout → descent → landing, one sequence.
// Two pure models, no DOM:
//   Loadout — the dropship cross-section grid: module placement, adjacency,
//   power gating (BFS from reactors), tonnage.
//   Descent — the stay-on-target minigame: a seeded turbulence corridor; how
//   well you hold the guide sets landing scatter AND arrival fuel/hull.
// Fixed tick, seeded RNG, semantic commands only (steer -1..1).
//
// OPEN FORK (not decided here): descent energy-bank — whether descent
// performance also banks energy beyond stats/scatter. This sim outputs only
// scatter + fuel + hull; the bank would bolt onto DescentResult.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DescentSim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TUNABLES = {
    tickRate:        { value: 30,   min: 10,  max: 120, tooltip: 'Fixed sim ticks per second.' },
    descentSec:      { value: 24,   min: 8,   max: 90,  tooltip: 'Base descent duration with a light ship. Tonnage stretches it.' },
    descentPerTon:   { value: 0.10, min: 0,   max: 1,   tooltip: 'Extra descent seconds per ton — heavy ships fall longer and eat more turbulence.' },
    corridorHalf:    { value: 90,   min: 20,  max: 300, tooltip: 'Half-width of the safe corridor around the guide. Outside it, turbulence chews the hull.' },
    guideAmp:        { value: 150,  min: 0,   max: 500, tooltip: 'How far the guide swings. The planet is steering; you are following.' },
    guideSpeed:      { value: 0.45, min: 0.05,max: 2,   tooltip: 'How fast the guide wanders (composite seeded sines).' },
    turbAmp:         { value: 55,   min: 0,   max: 300, tooltip: 'Random lateral shove (units/s) from turbulence, scales into gusts.' },
    steerAccel:      { value: 260,  min: 20,  max: 1000, tooltip: 'Lateral acceleration at full stick. Tonnage divides it — mass is sluggish.' },
    steerPerTon:     { value: 0.008, min: 0,  max: 0.2, tooltip: 'Fractional thrust loss per ton. ~60 tons at 0.008 = half authority.' },
    damp:            { value: 1.6,  min: 0,   max: 8,   tooltip: 'Lateral velocity damping (air grip).' },
    fuelBurnBase:    { value: 0.9,  min: 0,   max: 5,   tooltip: 'Fuel/sec at zero stick. Existing costs.' },
    fuelBurnSteer:   { value: 2.4,  min: 0,   max: 10,  tooltip: 'Extra fuel/sec at full stick. Fighting the planet costs.' },
    fuelMax:         { value: 100,  min: 10,  max: 500, tooltip: 'Arrival fuel pool this descent draws from.' },
    hullChip:        { value: 7,    min: 0,   max: 40,  tooltip: 'Hull/sec lost while outside the corridor.' },
    scatterBase:     { value: 40,   min: 0,   max: 300, tooltip: 'Landing scatter radius at PERFECT tracking. Never zero — the planet always gets a vote.' },
    scatterPerErr:   { value: 2.2,  min: 0,   max: 10,  tooltip: 'Extra scatter radius per unit of average tracking error.' },
    prewarmAtFrac:   { value: 0.5,  min: 0.1, max: 1,   tooltip: 'Descent fraction at which ground-gen prewarm would kick off (event only here; never block the main thread).' },
  };

  // The 13 module types. PLACEHOLDER TAXONOMY — names/stats are scaffolding to
  // exercise adjacency + power gating + tonnage; expect the real table to
  // replace this wholesale. power: +supply / -demand. adjacency: rule key.
  const MODULES = {
    hull:      { mass: 1.0, power: 0,  tip: 'Structural cell. Everything must chain back to hull.' },
    reactor:   { mass: 3.0, power: 6,  tip: 'Power source. Feeds connected powered modules.' },
    conduit:   { mass: 0.4, power: 0,  tip: 'Carries power along its chain. Massless-ish.' },
    thruster:  { mass: 2.0, power: -2, tip: 'Descent authority. Must sit on the ship edge.', edge: true },
    fueltank:  { mass: 1.5, power: 0,  tip: 'Raises arrival fuel pool.' },
    cargobay:  { mass: 2.5, power: -1, tip: 'Tonnage for minerals. The whole point, and the whole problem.' },
    hangar:    { mass: 4.0, power: -2, tip: 'Carries one ground ship per bay.' },
    shieldgen: { mass: 2.0, power: -3, tip: 'Arrival hull bonus.' },
    radvault:  { mass: 1.8, power: -1, tip: 'Rad-hardened storage: protects cargo crossing hostile color.' },
    medbay:    { mass: 1.6, power: -2, tip: 'Crew recovery between drops.' },
    sensor:    { mass: 0.8, power: -1, tip: 'Widens the visible descent corridor.', edge: true },
    battery:   { mass: 1.2, power: 2,  tip: 'Stored power: counts as supply, no chain required to charge it pre-drop.' },
    winch:     { mass: 1.4, power: -2, tip: 'Salvage winch: harvest speed bonus on the ground.' },
  };

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------------- Loadout: the cross-section grid ----------------
  const GRID_W = 9, GRID_H = 7;

  function Loadout() {
    this.w = GRID_W; this.h = GRID_H;
    this.cells = new Array(GRID_W * GRID_H).fill(null); // module key or null
  }
  Loadout.prototype.idx = function (x, y) { return y * this.w + x; };
  Loadout.prototype.get = function (x, y) {
    return (x < 0 || y < 0 || x >= this.w || y >= this.h) ? undefined : this.cells[this.idx(x, y)];
  };
  Loadout.prototype.set = function (x, y, key) {
    if (key !== null && !MODULES[key]) throw new Error('unknown module: ' + key);
    this.cells[this.idx(x, y)] = key;
  };

  // Validation, evaluated whole-ship:
  //  - structure: every module must be 4-connected to a hull cell chain
  //  - edge rule: thruster/sensor must touch the grid boundary or an empty cell
  //  - power: BFS from reactors/batteries along occupied cells; a powered
  //    module is ACTIVE only if reached AND total supply covers total demand
  //    of reached modules (power gating).
  Loadout.prototype.evaluate = function () {
    const w = this.w, h = this.h;
    const placed = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = this.get(x, y);
      if (k) placed.push({ x: x, y: y, key: k });
    }
    const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    // Structure: flood from every hull cell across occupied neighbors.
    const structOk = new Set();
    const queue = [];
    for (const p of placed) if (p.key === 'hull') { queue.push(p); structOk.add(p.x + ',' + p.y); }
    while (queue.length) {
      const p = queue.pop();
      for (const d of N4) {
        const nx = p.x + d[0], ny = p.y + d[1];
        const k = this.get(nx, ny);
        if (k && !structOk.has(nx + ',' + ny)) { structOk.add(nx + ',' + ny); queue.push({ x: nx, y: ny }); }
      }
    }

    // Power reach: flood from supplies across occupied neighbors.
    const powerReach = new Set();
    for (const p of placed) if (MODULES[p.key].power > 0) { queue.push(p); powerReach.add(p.x + ',' + p.y); }
    while (queue.length) {
      const p = queue.pop();
      for (const d of N4) {
        const nx = p.x + d[0], ny = p.y + d[1];
        const k = this.get(nx, ny);
        if (k && !powerReach.has(nx + ',' + ny)) { powerReach.add(nx + ',' + ny); queue.push({ x: nx, y: ny }); }
      }
    }

    let supply = 0, demand = 0, tonnage = 0;
    const report = [];
    for (const p of placed) {
      const m = MODULES[p.key];
      tonnage += m.mass;
      const onEdge = p.x === 0 || p.y === 0 || p.x === w - 1 || p.y === h - 1 ||
        !this.get(p.x + 1, p.y) || !this.get(p.x - 1, p.y) || !this.get(p.x, p.y + 1) || !this.get(p.x, p.y - 1);
      const problems = [];
      if (!structOk.has(p.x + ',' + p.y)) problems.push('unstructured');
      if (m.edge && !onEdge) problems.push('needs-edge');
      if (m.power < 0 && !powerReach.has(p.x + ',' + p.y)) problems.push('unpowered');
      if (m.power > 0) supply += m.power;
      if (m.power < 0 && problems.length === 0) demand += -m.power;
      report.push({ x: p.x, y: p.y, key: p.key, problems: problems });
    }
    const powered = supply >= demand;
    let thrusters = 0, tanks = 0, shields = 0, bays = 0, cargo = 0;
    for (const r of report) {
      const active = r.problems.length === 0 && (MODULES[r.key].power >= 0 || powered);
      r.active = active;
      if (!active) continue;
      if (r.key === 'thruster') thrusters++;
      if (r.key === 'fueltank') tanks++;
      if (r.key === 'shieldgen') shields++;
      if (r.key === 'hangar') bays++;
      if (r.key === 'cargobay') cargo++;
    }
    return {
      report: report, tonnage: tonnage, supply: supply, demand: demand, powered: powered,
      thrusters: thrusters, fuelBonus: tanks * 20, hullBonus: shields * 15,
      shipBays: bays, cargoBays: cargo,
      launchable: powered && thrusters > 0 && report.every(r => r.problems.indexOf('unstructured') < 0),
    };
  };

  // A sane default ship for tests and first boot.
  function defaultLoadout() {
    const L = new Loadout();
    const rows = [
      '....h....',
      '..hhrhh..',
      '.thcrcht.',
      '.thfrfht.',
      '..hghgh..',
      '..hhhhh..',
      '....h....',
    ];
    const map = { h: 'hull', r: 'reactor', c: 'conduit', t: 'thruster', f: 'fueltank', g: 'cargobay' };
    for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[y].length; x++) {
      if (rows[y][x] !== '.') L.set(x, y, map[rows[y][x]]);
    }
    return L;
  }

  // ---------------- Descent: stay on target ----------------
  // command({type:'steer', v}) with v in [-1, 1]. That's the whole wire format.
  function Descent(seed, loadoutEval, overrides) {
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
    this.eval = loadoutEval;
    this.duration = this.T.descentSec + loadoutEval.tonnage * this.T.descentPerTon;
    this.authority = Math.max(0.15, 1 - loadoutEval.tonnage * this.T.steerPerTon) *
                     Math.min(1, loadoutEval.thrusters / 4);
    // Guide path: three seeded sines — smooth, deterministic, non-repeating-ish.
    this.ph = [this.rng() * 6.28, this.rng() * 6.28, this.rng() * 6.28];
    this.fr = [1, 2.3 + this.rng(), 4.1 + this.rng()];
    this.x = 0; this.vx = 0;
    this.steer = 0;
    this.t = 0;
    this.errSum = 0; this.errN = 0;
    this.fuel = this.T.fuelMax + loadoutEval.fuelBonus;
    this.fuelStart = this.fuel;
    this.hull = 100 + loadoutEval.hullBonus;
    this.hullStart = this.hull;
    this.done = false;
    this.prewarmed = false;
    this.events = [];
    this.pending = [];
  }

  Descent.prototype.guideAt = function (t) {
    const T = this.T;
    const s = t * T.guideSpeed;
    return T.guideAmp * (0.55 * Math.sin(s * this.fr[0] + this.ph[0]) +
                         0.3 * Math.sin(s * this.fr[1] + this.ph[1]) +
                         0.15 * Math.sin(s * this.fr[2] + this.ph[2]));
  };

  Descent.prototype.command = function (cmd) { this.pending.push(cmd); };

  Descent.prototype.step = function () {
    if (this.done) return;
    const T = this.T, dt = this.dt;
    this.events.length = 0;
    for (const cmd of this.pending) {
      if (cmd.type === 'steer') this.steer = Math.max(-1, Math.min(1, cmd.v));
    }
    this.pending.length = 0;

    // Turbulence: seeded gusts, worse the farther off-guide you already are.
    const gust = (this.rng() * 2 - 1) * T.turbAmp;
    this.vx += (this.steer * T.steerAccel * this.authority + gust) * dt;
    this.vx -= this.vx * T.damp * dt;
    this.x += this.vx * dt;

    const guide = this.guideAt(this.t);
    const err = Math.abs(this.x - guide);
    this.errSum += err; this.errN++;

    this.fuel = Math.max(0, this.fuel - (T.fuelBurnBase + Math.abs(this.steer) * T.fuelBurnSteer) * dt);
    if (err > T.corridorHalf) this.hull = Math.max(0, this.hull - T.hullChip * dt);

    this.t += dt;
    if (!this.prewarmed && this.t / this.duration >= T.prewarmAtFrac) {
      this.prewarmed = true;
      this.events.push({ type: 'prewarm-ground', tick: this.tick }); // hook: start ground gen NOW, off-thread
    }
    if (this.t >= this.duration || this.hull <= 0) {
      this.done = true;
      const avgErr = this.errSum / Math.max(1, this.errN);
      const scatter = T.scatterBase + avgErr * T.scatterPerErr;
      // The actual landing offset: seeded, scaled by earned scatter.
      const ang = this.rng() * 6.28318530718, mag = this.rng() * scatter;
      this.result = {
        crashed: this.hull <= 0,
        avgErr: avgErr,
        scatter: scatter,
        offsetX: Math.cos(ang) * mag, offsetY: Math.sin(ang) * mag,
        fuelFrac: this.fuel / this.fuelStart,
        hullFrac: this.hull / this.hullStart,
      };
      this.events.push({ type: this.result.crashed ? 'crashed' : 'landed', result: this.result, tick: this.tick });
    }
    this.tick++;
  };

  Descent.prototype.stateHash = function () {
    let h = 0x811c9dc5;
    const mix = str => { for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } };
    mix(this.tick + ':' + this.x.toFixed(4) + ',' + this.vx.toFixed(4) + ',' + this.fuel.toFixed(4) + ',' + this.hull.toFixed(4));
    return (h >>> 0).toString(16);
  };

  return { Loadout: Loadout, Descent: Descent, MODULES: MODULES, TUNABLES: TUNABLES,
           defaultLoadout: defaultLoadout, mulberry32: mulberry32, GRID_W: GRID_W, GRID_H: GRID_H };
});
