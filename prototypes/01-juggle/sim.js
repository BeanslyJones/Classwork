// RADIANT WARFRONT — prototype 01: the juggle, alone.
// Pure simulation. No DOM, no rendering. Runs identically in browser and headless Node.
// Fixed tick, seeded RNG, semantic commands only. Same seed + same commands = same timeline.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JuggleSim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Every tunable lives here with range + tooltip — the Unity port maps these 1:1
  // onto serialized [Range] Inspector fields. No magic numbers below this table.
  const TUNABLES = {
    tickRate:        { value: 30,    min: 10,  max: 120,  tooltip: 'Fixed sim ticks per second. Rendering is decoupled from this.' },
    arenaRadius:     { value: 480,   min: 200, max: 2000, tooltip: 'Soft arena radius. No boundary death — units past it get steered back.' },
    edgeSteer:       { value: 2.2,   min: 0,   max: 10,   tooltip: 'Corrective turn (radians/sec) applied to units past the soft edge.' },
    maxSpeed:        { value: 150,   min: 20,  max: 600,  tooltip: 'Speed in units/sec at full momentum.' },
    minSpeed:        { value: 18,    min: 0,   max: 100,  tooltip: 'Speed floor while momentum > 0. Motion is survival.' },
    momentumDrain:   { value: 0.065, min: 0,   max: 0.5,  tooltip: 'Momentum lost per second while unpossessed. This is the juggle clock.' },
    driftNoise:      { value: 1.6,   min: 0,   max: 8,    tooltip: 'Max heading wobble (radians/sec) at zero momentum. Decayed ships wander worse.' },
    stallGraceSec:   { value: 2.5,   min: 0.5, max: 10,   tooltip: 'Seconds a stalled (momentum 0) unit can still be grabbed and saved before it crystallizes.' },
    crystallizeSec:  { value: 1.2,   min: 0.1, max: 5,    tooltip: 'Seconds from fatal contact/stall-out to fully crystallized salvage.' },
    hazardCount:     { value: 7,     min: 0,   max: 30,   tooltip: 'Seeded crystal formations. Placed outside the safe inner disc. Reset to apply.' },
    hazardBandInner: { value: 180,   min: 50,  max: 1000, tooltip: 'Inner radius of the hazard band. Inside this disc is crystal-free.' },
    hazardRadiusMin: { value: 22,    min: 5,   max: 100,  tooltip: 'Smallest crystal formation radius.' },
    hazardRadiusMax: { value: 46,    min: 5,   max: 160,  tooltip: 'Largest crystal formation radius.' },
    unitRadius:      { value: 10,    min: 4,   max: 30,   tooltip: 'Unit collision radius. Art scale stays decoupled from this.' },
    shipCount:       { value: 4,     min: 1,   max: 12,   tooltip: 'Ships in the juggle. Gate question: tense with 4? Reset to apply.' },
    spawnRadius:     { value: 110,   min: 20,  max: 400,  tooltip: 'Ships spawn evenly on this ring, heading tangent. Reset to apply.' },
    heldTurnRate:    { value: 6.0,   min: 1,   max: 20,   tooltip: 'Radians/sec the held unit turns toward the aim angle.' },
    avoidRange:      { value: 90,    min: 0,   max: 300,  tooltip: 'Distance (beyond a crystal’s radius) at which an unheld ship starts evading it.' },
    avoidSteer:      { value: 3.0,   min: 0,   max: 12,   tooltip: 'Max evasion turn (radians/sec) at full momentum. Scales DOWN with decay — neglected ships dodge badly.' },
  };

  // Deterministic PRNG (mulberry32). The sim owns exactly one stream; nothing else touches it.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const TAU = Math.PI * 2;
  function wrapAngle(a) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }
  function turnToward(current, target, maxStep) {
    const d = wrapAngle(target - current);
    return current + Math.max(-maxStep, Math.min(maxStep, d));
  }

  const ALIVE = 'alive', CRYSTALLIZING = 'crystallizing', CRYSTALLIZED = 'crystallized';

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
    this.heldUnit = -1;
    this.aimAngle = 0;
    this.pending = [];
    this.events = []; // semantic event log for the last step (tests + UI read this)

    // Seeded hazard field: crystal formations in the band between hazardBandInner
    // and the soft edge, kept clear of each other so the arena stays navigable.
    this.hazards = [];
    const inner = this.T.hazardBandInner, outer = this.T.arenaRadius - this.T.hazardRadiusMax;
    for (let i = 0; i < this.T.hazardCount; i++) {
      let placed = null;
      for (let attempt = 0; attempt < 40 && !placed; attempt++) {
        const ang = this.rng() * TAU;
        const r = this.T.hazardRadiusMin + this.rng() * (this.T.hazardRadiusMax - this.T.hazardRadiusMin);
        // The crystal's EDGE stays outside the safe disc, not just its center.
        const lo = inner + r;
        const dist = lo + this.rng() * Math.max(0, outer - lo);
        const c = { x: Math.cos(ang) * dist, y: Math.sin(ang) * dist, r: r, salvage: false };
        let ok = true;
        for (const h of this.hazards) {
          const dx = h.x - c.x, dy = h.y - c.y;
          if (Math.hypot(dx, dy) < h.r + c.r + this.T.unitRadius * 4) { ok = false; break; }
        }
        if (ok) placed = c;
      }
      if (placed) this.hazards.push(placed);
    }

    // Ships spawn evenly on the safe inner ring, heading tangent — already moving,
    // because everything is always moving.
    this.units = [];
    for (let i = 0; i < this.T.shipCount; i++) {
      const ang = (i / this.T.shipCount) * TAU;
      this.units.push({
        id: i,
        x: Math.cos(ang) * this.T.spawnRadius,
        y: Math.sin(ang) * this.T.spawnRadius,
        heading: ang + Math.PI / 2,
        momentum: 1,
        stallTimer: 0,
        crystallizeTimer: 0,
        state: ALIVE,
        held: false,
      });
    }
  }

  // Semantic commands only — this is exactly what would cross the wire.
  // grab: possess a unit (implicitly drops the current hold with no boost).
  // aim: set the held unit's target heading.
  // release: fling — heading locked in, momentum restored to full.
  Sim.prototype.command = function (cmd) { this.pending.push(cmd); };

  Sim.prototype._applyCommands = function () {
    for (const cmd of this.pending) {
      if (cmd.type === 'grab') {
        const u = this.units[cmd.unit];
        if (!u || u.state === CRYSTALLIZED || u.state === CRYSTALLIZING) continue;
        if (this.heldUnit >= 0) this.units[this.heldUnit].held = false;
        this.heldUnit = cmd.unit;
        u.held = true;
        this.aimAngle = u.heading;
        this.events.push({ type: 'grabbed', unit: cmd.unit, tick: this.tick });
      } else if (cmd.type === 'aim') {
        this.aimAngle = cmd.angle;
      } else if (cmd.type === 'release') {
        if (this.heldUnit < 0) continue;
        const u = this.units[this.heldUnit];
        u.held = false;
        u.heading = this.aimAngle;
        u.momentum = 1;
        u.stallTimer = 0;
        this.events.push({ type: 'released', unit: this.heldUnit, tick: this.tick });
        this.heldUnit = -1;
      }
    }
    this.pending.length = 0;
  };

  Sim.prototype._startCrystallize = function (u, cause) {
    if (u.state !== ALIVE) return;
    u.state = CRYSTALLIZING;
    u.crystallizeTimer = 0;
    if (u.held) { u.held = false; this.heldUnit = -1; }
    this.events.push({ type: 'crystallizing', unit: u.id, cause: cause, tick: this.tick });
  };

  Sim.prototype.step = function () {
    const T = this.T, dt = this.dt;
    this.events.length = 0;
    this._applyCommands();

    for (const u of this.units) {
      if (u.state === CRYSTALLIZED) continue;

      if (u.state === CRYSTALLIZING) {
        u.crystallizeTimer += dt;
        if (u.crystallizeTimer >= T.crystallizeSec) {
          u.state = CRYSTALLIZED;
          // Dead units fall, crystallize, become salvage — and a new obstacle.
          this.hazards.push({ x: u.x, y: u.y, r: T.unitRadius * 1.6, salvage: true });
          this.events.push({ type: 'crystallized', unit: u.id, tick: this.tick });
        }
        continue;
      }

      if (u.held) {
        // Holding freezes drain (attention is the resource) but the ship never stops moving.
        u.heading = turnToward(u.heading, this.aimAngle, T.heldTurnRate * dt);
      } else {
        u.momentum = Math.max(0, u.momentum - T.momentumDrain * dt);
        // Wobble scales with decay: a neglected ship visibly wanders toward trouble.
        u.heading += (this.rng() * 2 - 1) * T.driftNoise * (1 - u.momentum) * dt;
      }

      if (u.momentum <= 0 && !u.held) {
        u.stallTimer += dt;
        if (u.stallTimer >= T.stallGraceSec) this._startCrystallize(u, 'stalled');
        continue; // stalled: speed is zero, the clock is running
      }

      // Self-preservation scales with momentum: a healthy ship threads the crystal
      // field on its own; a decayed one wobbles and dodges badly. Held units get no
      // help — while possessed, the pilot owns the trajectory.
      if (!u.held && T.avoidSteer > 0) {
        let nearest = null, nearestGap = Infinity;
        for (const h of this.hazards) {
          const gap = Math.hypot(u.x - h.x, u.y - h.y) - h.r;
          if (gap < T.avoidRange && gap < nearestGap) { nearestGap = gap; nearest = h; }
        }
        if (nearest) {
          const away = Math.atan2(u.y - nearest.y, u.x - nearest.x);
          const urgency = 1 - Math.max(0, nearestGap) / T.avoidRange;
          u.heading = turnToward(u.heading, away, T.avoidSteer * u.momentum * urgency * dt);
        }
      }

      const speed = T.minSpeed + u.momentum * (T.maxSpeed - T.minSpeed);
      u.x += Math.cos(u.heading) * speed * dt;
      u.y += Math.sin(u.heading) * speed * dt;

      const distFromCenter = Math.hypot(u.x, u.y);
      if (distFromCenter > T.arenaRadius) {
        const toCenter = Math.atan2(-u.y, -u.x);
        u.heading = turnToward(u.heading, toCenter, T.edgeSteer * dt);
      }

      for (const h of this.hazards) {
        const dx = u.x - h.x, dy = u.y - h.y;
        if (Math.hypot(dx, dy) < h.r + T.unitRadius) { this._startCrystallize(u, 'contact'); break; }
      }
    }

    this.tick++;
  };

  Sim.prototype.aliveCount = function () {
    let n = 0;
    for (const u of this.units) if (u.state === ALIVE) n++;
    return n;
  };

  // FNV-1a over rounded state. Two sims agree on this iff they agree on the timeline.
  Sim.prototype.stateHash = function () {
    let h = 0x811c9dc5;
    const mix = function (str) {
      for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    };
    mix('t' + this.tick + 'h' + this.heldUnit);
    for (const u of this.units) {
      mix(u.id + ':' + u.state + ':' + u.x.toFixed(3) + ',' + u.y.toFixed(3) + ',' +
          u.heading.toFixed(4) + ',' + u.momentum.toFixed(4));
    }
    mix('hz' + this.hazards.length);
    return (h >>> 0).toString(16);
  };

  return { Sim: Sim, TUNABLES: TUNABLES, mulberry32: mulberry32 };
});
