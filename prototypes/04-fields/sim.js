// RADIANT WARFRONT — prototype 04: two touching radiation fields, in isolation.
// The build-order gate for radiation says: prototype exactly this before wiring
// fields into combat. One test ship, two (or more) field emitters, the four rad
// types on their cyclic wheel, battery-weighted seams, same-color merging, and
// the current attrition rules (friendly field = zero loss unless acting).
// Pure sim. Fixed tick, seeded RNG, semantic commands only.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FieldSim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TUNABLES = {
    tickRate:           { value: 30,   min: 10,   max: 120, tooltip: 'Fixed sim ticks per second.' },
    shipSpeed:          { value: 130,  min: 20,   max: 400, tooltip: 'Cruise speed. Ships never stop; motion is survival.' },
    turnRate:           { value: 2.8,  min: 0.5,  max: 10,  tooltip: 'Rad/s the held ship turns toward the aim angle.' },
    energyMax:          { value: 100,  min: 20,   max: 400, tooltip: 'The one pool: health + ammo + boost.' },
    rechargeRate:       { value: 9,    min: 0,    max: 50,  tooltip: 'Energy/sec regained inside a friendly field while doing nothing but cruising.' },
    zoneDrainBase:      { value: 6,    min: 0,    max: 40,  tooltip: 'Baseline energy/sec lost in a non-friendly zone before matchup and protection.' },
    openDrain:          { value: 2,    min: 0,    max: 20,  tooltip: 'Energy/sec lost on open ground (no field at all).' },
    matchupSame:        { value: 0.25, min: 0,    max: 1,   tooltip: 'Drain multiplier when zone color matches your protection color.' },
    matchupStrong:      { value: 0.6,  min: 0,    max: 2,   tooltip: 'Multiplier when your protection color BEATS the zone color on the wheel.' },
    matchupNeutral:     { value: 1.0,  min: 0,    max: 3,   tooltip: 'Multiplier for the non-adjacent pair. The lean’s midpoint.' },
    matchupWeak:        { value: 1.6,  min: 0.5,  max: 5,   tooltip: 'Multiplier when the zone color beats your protection. Wrong zone = fast bleed — but a lean, not a wall.' },
    protClip:           { value: 0.75, min: 0,    max: 1,   tooltip: 'How much of the drain protection level can remove at 1.0. Never all of it.' },
    maneuverTurnThresh: { value: 1.2,  min: 0.1,  max: 6,   tooltip: 'Turning faster than this (rad/s) counts as maneuvering — one of the three loss conditions in a friendly field.' },
    maneuverCost:       { value: 4,    min: 0,    max: 30,  tooltip: 'Energy/sec while maneuvering inside a friendly field (zero-loss clause suspended).' },
    maneuverMult:       { value: 1.5,  min: 1,    max: 4,   tooltip: 'Drain multiplier for maneuvering in non-friendly zones.' },
    boostMult:          { value: 2.2,  min: 1,    max: 5,   tooltip: 'Speed multiplier while boosting. Boosting always counts as maneuvering.' },
    boostDurSec:        { value: 0.6,  min: 0.1,  max: 3,   tooltip: 'Boost burst length.' },
    fieldDriftSpeed:    { value: 0,    min: 0,    max: 40,  tooltip: 'Field drift (units/sec). Zones move with weather; players never mutate the global sim. 0 = pinned for study.' },
    crystallizeSec:     { value: 1.2,  min: 0.1,  max: 5,   tooltip: 'Seconds from burnout to crystallized salvage.' },
    arenaRadius:        { value: 620,  min: 200,  max: 2000, tooltip: 'Soft arena edge.' },
    edgeSteer:          { value: 2.2,  min: 0,    max: 10,  tooltip: 'Corrective turn (rad/s) past the soft edge.' },
  };

  // The wheel — a cycle, each color beats the next: cinder > bloom > brine > halo > cinder.
  // Opposite pairs (cinder/brine, bloom/halo) are neutral. A lean, not a wall.
  const RAD = ['cinder', 'bloom', 'brine', 'halo'];
  function beats(a, b) { return RAD[(RAD.indexOf(a) + 1) % 4] === b; }

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

  // fieldsSpec: [{x, y, r, color, battery, team}]. Default: the canonical study —
  // two touching fields, different colors, uneven batteries.
  function defaultFields() {
    return [
      { x: -180, y: 0, r: 300, color: 'cinder', battery: 100, team: 0 },
      { x: 220, y: 0, r: 300, color: 'brine', battery: 55, team: 1 },
    ];
  }

  function Sim(seed, overrides, fieldsSpec, shipSpec) {
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
    this.pending = [];
    this.events = [];

    this.fields = (fieldsSpec || defaultFields()).map(f => {
      const driftAng = this.rng() * TAU;
      return {
        x: f.x, y: f.y, r: f.r, color: f.color, battery: f.battery, team: f.team,
        driftAng: driftAng, driftTurn: (this.rng() - 0.5) * 0.1,
      };
    });

    const s = shipSpec || { team: 0, protColor: 'cinder', protLevel: 0.7 };
    this.ship = {
      x: s.x !== undefined ? s.x : -180, y: s.y !== undefined ? s.y : 0,
      heading: s.heading !== undefined ? s.heading : 0,
      team: s.team, protColor: s.protColor, protLevel: s.protLevel,
      energy: this.T.energyMax,
      held: false, boostTimer: 0,
      shooting: false, beingShot: false, // future combat hooks; settable via commands for tests
      maneuvering: false,
      state: 'alive', crystallizeTimer: 0,
      lastDrain: 0, lastZone: null, // observability for tests + HUD
    };
    this.aimAngle = this.ship.heading;
  }

  // Zone query: who owns this point, and is it friendly to `team`?
  // Influence = battery-weighted, falls off linearly to the field edge.
  // Same-color fields ADD influence (they merge, allegiance-blind); the
  // dominant COLOR owns the point, and the seam between different colors sits
  // where battery-weighted influences tie.
  Sim.prototype.zoneAt = function (x, y, team) {
    const byColor = {};
    for (const f of this.fields) {
      const d = Math.hypot(x - f.x, y - f.y);
      if (d >= f.r) continue;
      const infl = f.battery * (1 - d / f.r);
      if (!byColor[f.color]) byColor[f.color] = { influence: 0, teams: {} };
      byColor[f.color].influence += infl;
      byColor[f.color].teams[f.team] = true;
    }
    let color = null, influence = 0;
    for (const c in byColor) {
      if (byColor[c].influence > influence) { influence = byColor[c].influence; color = c; }
    }
    if (!color) return { color: null, influence: 0, friendly: false };
    // Friendly: the winning color's merged region includes a field your team
    // projects — the merge is allegiance-blind, so an enemy field of your color
    // that merged with yours shelters you across the whole region.
    const friendly = team !== undefined && !!byColor[color].teams[team];
    return { color: color, influence: influence, friendly: friendly };
  };

  Sim.prototype.matchupFactor = function (zoneColor, protColor) {
    const T = this.T;
    if (zoneColor === protColor) return T.matchupSame;
    if (beats(protColor, zoneColor)) return T.matchupStrong;
    if (beats(zoneColor, protColor)) return T.matchupWeak;
    return T.matchupNeutral;
  };

  Sim.prototype.command = function (cmd) { this.pending.push(cmd); };

  Sim.prototype._applyCommands = function () {
    const u = this.ship;
    for (const cmd of this.pending) {
      if (cmd.type === 'grab') { if (u.state === 'alive') { u.held = true; this.aimAngle = u.heading; } }
      else if (cmd.type === 'aim') this.aimAngle = cmd.angle;
      else if (cmd.type === 'release') u.held = false;
      else if (cmd.type === 'boost') { if (u.state === 'alive' && u.boostTimer <= 0) u.boostTimer = this.T.boostDurSec; }
      else if (cmd.type === 'setShooting') u.shooting = !!cmd.on;   // test/combat hook
      else if (cmd.type === 'setBeingShot') u.beingShot = !!cmd.on; // test/combat hook
    }
    this.pending.length = 0;
  };

  Sim.prototype.step = function () {
    const T = this.T, dt = this.dt, u = this.ship;
    this.events.length = 0;
    this._applyCommands();

    // Fields drift (weather will drive this later; here it's a seeded wander).
    if (T.fieldDriftSpeed > 0) {
      for (const f of this.fields) {
        f.driftAng += f.driftTurn * dt;
        f.x += Math.cos(f.driftAng) * T.fieldDriftSpeed * dt;
        f.y += Math.sin(f.driftAng) * T.fieldDriftSpeed * dt;
      }
    }

    if (u.state === 'crystallizing') {
      u.crystallizeTimer += dt;
      if (u.crystallizeTimer >= T.crystallizeSec) { u.state = 'crystallized'; this.events.push({ type: 'crystallized', tick: this.tick }); }
      this.tick++;
      return;
    }
    if (u.state !== 'alive') { this.tick++; return; }

    // --- Steering ---
    const before = u.heading;
    if (u.held) u.heading = turnToward(u.heading, this.aimAngle, T.turnRate * dt);
    if (Math.hypot(u.x, u.y) > T.arenaRadius) {
      u.heading = turnToward(u.heading, Math.atan2(-u.y, -u.x), T.edgeSteer * dt);
    }
    const turnSpeed = Math.abs(wrapAngle(u.heading - before)) / dt;

    if (u.boostTimer > 0) u.boostTimer -= dt;
    u.maneuvering = u.boostTimer > 0 || turnSpeed > T.maneuverTurnThresh;

    // --- Movement ---
    const speed = T.shipSpeed * (u.boostTimer > 0 ? T.boostMult : 1);
    u.x += Math.cos(u.heading) * speed * dt;
    u.y += Math.sin(u.heading) * speed * dt;

    // --- Attrition (current rules) ---
    const zone = this.zoneAt(u.x, u.y, u.team);
    u.lastZone = zone;
    let delta;
    if (zone.friendly) {
      // Inside a friendly rad field: zero loss unless shooting, being shot, or
      // maneuvering. Recharge only happens here, and only while truly idle.
      if (u.shooting || u.beingShot) delta = -T.zoneDrainBase * dt;       // combat costs even at home
      else if (u.maneuvering) delta = -T.maneuverCost * dt;
      else delta = T.rechargeRate * dt;
    } else if (zone.color) {
      const factor = this.matchupFactor(zone.color, u.protColor);
      const prot = 1 - u.protLevel * T.protClip;
      delta = -T.zoneDrainBase * factor * prot * (u.maneuvering ? T.maneuverMult : 1) * dt;
    } else {
      delta = -T.openDrain * dt * (u.maneuvering ? T.maneuverMult : 1);
    }
    u.lastDrain = -delta / dt; // positive = draining, for HUD/tests
    u.energy = Math.min(T.energyMax, u.energy + delta);
    if (u.energy <= 0) {
      u.energy = 0;
      u.state = 'crystallizing';
      u.crystallizeTimer = 0;
      this.events.push({ type: 'crystallizing', cause: 'burnout', tick: this.tick });
    }

    this.tick++;
  };

  // Seam finder for tests/HUD: walk the segment between two field centers and
  // return the point where zone ownership flips.
  Sim.prototype.seamBetween = function (fa, fb) {
    const A = this.fields[fa], B = this.fields[fb];
    let prev = this.zoneAt(A.x, A.y).color;
    for (let t = 0; t <= 1; t += 0.002) {
      const x = A.x + (B.x - A.x) * t, y = A.y + (B.y - A.y) * t;
      const c = this.zoneAt(x, y).color;
      if (c !== prev) return { x: x, y: y, t: t };
      prev = c;
    }
    return null;
  };

  Sim.prototype.stateHash = function () {
    let h = 0x811c9dc5;
    const mix = str => { for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } };
    const u = this.ship;
    mix('t' + this.tick + u.state + u.x.toFixed(3) + ',' + u.y.toFixed(3) + ',' + u.heading.toFixed(4) + ',' + u.energy.toFixed(4));
    for (const f of this.fields) mix(f.color + f.x.toFixed(3) + ',' + f.y.toFixed(3) + ',' + f.battery);
    return (h >>> 0).toString(16);
  };

  return { Sim: Sim, TUNABLES: TUNABLES, RAD: RAD, beats: beats, mulberry32: mulberry32 };
});
