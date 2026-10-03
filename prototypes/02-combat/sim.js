// RADIANT WARFRONT — prototype 02: combat on top of the juggle.
// Extends 01's momentum/crystallize core with the shared class table, firing
// cones, target-gated cooldowns, AoE projectiles, lock-scaled spread, dodge,
// and one energy pool per ship (= health + ammo + boost).
// Pure sim. No DOM. Fixed tick, one seeded RNG stream, semantic commands only.
// Update gating (Active/Reduced/Dormant) and projectile pooling are first-class
// here — step 3's hardening lives in this sim and is benchmarked from 03/.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CombatSim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TUNABLES = {
    tickRate:        { value: 30,    min: 10,  max: 120,  tooltip: 'Fixed sim ticks per second.' },
    arenaRadius:     { value: 560,   min: 200, max: 2000, tooltip: 'Soft arena radius. No boundary death.' },
    aiReactSec:      { value: 6,   min: 0,   max: 5,    tooltip: 'AI reaction time: each AI ship re-picks its heading this often and turns toward that in between — it juggles like a player instead of steering every ship every tick.' },
    edgeSteer:       { value: 2.2,   min: 0,   max: 10,   tooltip: 'Corrective turn (rad/s) past the soft edge.' },
    minSpeed:        { value: 50,    min: 0,   max: 100,  tooltip: 'Speed floor while momentum > 0.' },
    momentumDrain:   { value: 0.0275, min: 0,   max: 0.5,  tooltip: 'Momentum lost per second while unpossessed (player team only — the juggle clock).' },
    driftNoise:      { value: 1.4,   min: 0,   max: 8,    tooltip: 'Heading wobble (rad/s) at zero momentum.' },
    stallGraceSec:   { value: 2.5,   min: 0.5, max: 10,   tooltip: 'Seconds a stalled unit can still be saved.' },
    crystallizeSec:  { value: 1.2,   min: 0.1, max: 5,    tooltip: 'Seconds from fatal blow to crystallized salvage.' },
    hazardCount:     { value: 0,     min: 0,   max: 30,   tooltip: 'Seeded crystal formations (off for now). Projectiles detonate on them (cover). Reset to apply.' },
    wreckCrystals:   { value: 0,     min: 0,   max: 1,    tooltip: '1 = dead ships leave a crystal wreck that kills on contact and blocks shots (off for now).' },
    hazardBandInner: { value: 220,   min: 50,  max: 1000, tooltip: 'Crystal-free inner disc radius.' },
    hazardRadiusMin: { value: 24,    min: 5,   max: 100,  tooltip: 'Smallest crystal radius.' },
    hazardRadiusMax: { value: 48,    min: 5,   max: 160,  tooltip: 'Largest crystal radius.' },
    unitRadius:      { value: 10,    min: 4,   max: 30,   tooltip: 'Unit collision radius (art scale decoupled).' },
    avoidRange:      { value: 90,    min: 0,   max: 300,  tooltip: 'Crystal look-ahead for unheld ships, added on top of the ship\'s own turn radius (wide turners look further ahead).' },
    avoidSteer:      { value: 1.0,   min: 0,   max: 1,    tooltip: 'Share of the hull\'s turn rate unheld ships spend evading crystals (scaled by momentum on human sides).' },
    turnRadiusScale: { value: 1.0,   min: 0.3, max: 3,    tooltip: 'Multiplies every class turnRadius. Bigger = wider, lazier turns for the whole fleet.' },
    lockTimeFull:    { value: 1.6,   min: 0.2, max: 6,    tooltip: 'Seconds held in the arc to climb from the starting lock to its ceiling.' },
    lockSpreadMax:   { value: 0.35,  min: 0,   max: 1.5,  tooltip: 'Aim error (radians) at zero lock. Spread scales down with lock quality.' },
    lockEntryFloor:  { value: 0.35,  min: 0,   max: 1,    tooltip: 'Lock ceiling for a target that entered at the very edge of the arc. Dead-centre entry = 1.' },
    lockStartFrac:   { value: 0.3,   min: 0,   max: 1,    tooltip: 'Lock starts at this fraction of its ceiling, then climbs over lockTimeFull.' },
    turretEntryArc:  { value: 1.57,  min: 0.2, max: 3.14, tooltip: 'Turrets: how far off the barrel (radians) counts as a worst-case entry.' },
    leadMax:         { value: 1.0,   min: 0,   max: 1.5,  tooltip: 'Target leading at full lock (1 = aims exactly where the target will be).' },
    fireRateBonus:   { value: 0.6,   min: 0,   max: 2,    tooltip: 'Extra fire rate at full lock (0.6 = reloads 60% faster).' },
    coneGraceSec:    { value: 0.5,   min: 0,   max: 3,    tooltip: 'Seconds a target may slip out of cone before the lock is dropped.' },
    autoFireFloor:   { value: 0.15,  min: 0,   max: 0.9,  tooltip: 'Ships hold fire below this energy fraction — shooting spends the same pool that keeps them alive.' },
    dodgeCost:       { value: 18,    min: 0,   max: 100,  tooltip: 'Flat energy cost of a barrel roll. Big on purpose.' },
    dodgeSpeedMult:  { value: 2.6,   min: 1,   max: 6,    tooltip: 'Speed multiplier during the roll. Straight line only.' },
    dodgeDurSec:     { value: 0.45,  min: 0.1, max: 2,    tooltip: 'Roll duration.' },
    dodgeLockoutSec: { value: 0.8,   min: 0,   max: 3,    tooltip: 'Turn lockout after the roll — readable and interceptable.' },
    projTtlSec:      { value: 2.2,   min: 0.5, max: 6,    tooltip: 'Projectile lifetime; flak detonates at end of life.' },
    weakCritMult:    { value: 2.5,   min: 1,   max: 6,    tooltip: 'Damage multiplier when a blast lands on a capital weak point.' },
    weakHp:          { value: 120,    min: 5,   max: 300,  tooltip: 'Damage a weak point absorbs before it is knocked out.' },
    ventLeak:        { value: 3,     min: 0,   max: 20,   tooltip: 'Energy/sec a capital bleeds per breached reactor vent.' },
    engineCripple:   { value: 0.5,   min: 0.1, max: 1,    tooltip: 'Speed and turn multiplier once a capital loses its engines.' },
    friendlyFire:    { value: 0,     min: 0,   max: 1,    tooltip: 'Separate toggle, off by default. AoE never hurts allies unless this is 1.' },
    gateReducedDist: { value: 700,   min: 100, max: 4000, tooltip: 'Farther than this from any foe -> Reduced tier (combat every 2nd tick).' },
    gateDormantDist: { value: 1400,  min: 200, max: 8000, tooltip: 'Farther than this -> Dormant tier (every 4th tick, no target acquisition).' },
  };

  // Shared class table — the SAME rows drive player ships and opposition.
  // Tuned for time-to-kill (one attacker, sustained fire, centre entry):
  // ~3s on small ships (interceptor ~2s .. heavy ~3.5s), ~10s on a capital
  // (torpedo bomber ~5s). Re-measure with the TTK test if you change a row.
  // Unity port: one ScriptableObject per row; numbers become [Range] fields there.
  // turnRadius: world units. Ships can never turn tighter than this — angular
  // rate = current speed / turnRadius — so bigger, slower hulls swing wider.
  // turret: only capital ships carry a rotating turret. Everything else has
  // fixed forward guns — the cone points where the hull points, so to shoot
  // something you have to fly at it. gunTurn is only read when turret is true.
  // size: collision radius multiplier on unitRadius.
  const CLASSES = {
    fighter:     { speed: 150, turnRadius: 110, energyMax: 100, turret: false, gunTurn: 0, size: 1,
                   coneHalf: 0.65, coneRange: 230, cooldown: 0.50, shotCost: 2.0, damage: 16,  aoe: 26, projSpeed: 330 },
    bomber:      { speed: 100, turnRadius: 150, energyMax: 116, turret: false, gunTurn: 0, size: 1,
                   coneHalf: 0.80, coneRange: 270, cooldown: 1.60, shotCost: 6.0, damage: 57.5, aoe: 72, projSpeed: 180 },
    heavy:       { speed: 112, turnRadius: 160, energyMax: 125, turret: false, gunTurn: 0, size: 1,
                   coneHalf: 0.45, coneRange: 320, cooldown: 0.80, shotCost: 4.0, damage: 41.5, aoe: 18, projSpeed: 430 },
    interceptor: { speed: 215, turnRadius: 90, energyMax: 58,  turret: false, gunTurn: 0, size: 1,
                   coneHalf: 0.70, coneRange: 180, cooldown: 0.35, shotCost: 1.5, damage: 10.5,  aoe: 16, projSpeed: 370 },
    aaa:         { speed: 70,  turnRadius: 120, energyMax: 105, turret: false, gunTurn: 0, size: 1,
                   coneHalf: 1.40, coneRange: 210, cooldown: 0.30, shotCost: 1.2, damage: 9.2,  aoe: 36, projSpeed: 260 },
    // Torpedo bomber: capital killer. Slow, heavy shots that small ships can
    // sidestep but a lumbering capital can't. vsCapital multiplies damage on
    // capitals; projTtl lets the slow torpedo actually reach its range.
    torpedo:     { speed: 90,  turnRadius: 150, energyMax: 116, turret: false, gunTurn: 0, size: 1,
                   coneHalf: 0.55, coneRange: 300, cooldown: 2.40, shotCost: 7.0, damage: 66, aoe: 28, projSpeed: 105,
                   vsCapital: 2.9, projTtl: 3.4 },
    // Capital: slow, huge pool, the only turret in the fleet. Stats are placeholders.
    // weakPoints: spots on the hull in hull-local units of the ship's radius
    // (+x = nose). A blast landing on one does weakCritMult damage and wears
    // it down; knocked out, it costs the ship something:
    //   bridge -> turret fire control offline   engine -> speed/turn crippled
    //   vent   -> hull bleeds energy (ventLeak)
    // Different capital types are just different rows with different layouts.
    capital:     { speed: 45,  turnRadius: 200, energyMax: 625, turret: true,  gunTurn: 1.8, size: 2.2,
                   coneHalf: 0.22, coneRange: 340, cooldown: 0.90, shotCost: 4.0, damage: 44, aoe: 30, projSpeed: 300,
                   weakPoints: [
                     { type: 'bridge', x: 1.05,  y: 0,     r: 0.4 },
                     { type: 'engine', x: -1.0,  y: 0,     r: 0.45 },
                     { type: 'vent',   x: -0.1,  y: 0.75,  r: 0.35 },
                     { type: 'vent',   x: -0.1,  y: -0.75, r: 0.35 },
                   ] },
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

  const TAU = Math.PI * 2;
  function wrapAngle(a) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }
  function turnToward(current, target, maxStep) {
    const d = wrapAngle(target - current);
    return current + Math.max(-maxStep, Math.min(maxStep, d));
  }

  const ALIVE = 'alive', CRYSTALLIZING = 'crystallizing', CRYSTALLIZED = 'crystallized';
  const PLAYER = 0, ENEMY = 1;

  // roster: array of {cls, team}. Default: mirror 6v6 — five fixed-gun ships
  // (incl. a torpedo bomber) plus one turreted capital per side.
  function defaultRoster() {
    return [
      { cls: 'fighter', team: PLAYER }, { cls: 'bomber', team: PLAYER },
      { cls: 'heavy', team: PLAYER }, { cls: 'interceptor', team: PLAYER },
      { cls: 'capital', team: PLAYER }, { cls: 'torpedo', team: PLAYER },
      { cls: 'fighter', team: ENEMY }, { cls: 'bomber', team: ENEMY },
      { cls: 'heavy', team: ENEMY }, { cls: 'interceptor', team: ENEMY },
      { cls: 'capital', team: ENEMY }, { cls: 'torpedo', team: ENEMY },
    ];
  }

  function Sim(seed, overrides, roster) {
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
    // Per-team control. human[team]: that side is flown by a person (juggle
    // rules: momentum drain, stall) rather than the opposition AI. Single
    // player = blue human, red AI; LAN multiplayer flips red to human.
    this.held = [-1, -1];
    this.aim = [0, 0];
    this.human = [true, false];
    this.pending = [];
    this.events = [];

    this.hazards = [];
    const inner = this.T.hazardBandInner, outer = this.T.arenaRadius - this.T.hazardRadiusMax;
    for (let i = 0; i < this.T.hazardCount; i++) {
      let placed = null;
      for (let attempt = 0; attempt < 40 && !placed; attempt++) {
        const ang = this.rng() * TAU;
        const r = this.T.hazardRadiusMin + this.rng() * (this.T.hazardRadiusMax - this.T.hazardRadiusMin);
        const lo = inner + r;
        const dist = lo + this.rng() * Math.max(0, outer - lo);
        const c = { x: Math.cos(ang) * dist, y: Math.sin(ang) * dist, r: r, salvage: false };
        let ok = true;
        for (const h of this.hazards) {
          if (Math.hypot(h.x - c.x, h.y - c.y) < h.r + c.r + this.T.unitRadius * 4) { ok = false; break; }
        }
        if (ok) placed = c;
      }
      if (placed) this.hazards.push(placed);
    }

    // Teams spawn on opposite sides of the safe disc, already moving.
    const list = roster || defaultRoster();
    this.units = [];
    let pIdx = 0, eIdx = 0;
    const perTeam = [list.filter(r => r.team === PLAYER).length, list.filter(r => r.team === ENEMY).length];
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      const slot = r.team === PLAYER ? pIdx++ : eIdx++;
      const n = perTeam[r.team];
      const baseAng = r.team === PLAYER ? Math.PI : 0; // player west, enemy east
      const ang = baseAng + ((slot - (n - 1) / 2) * 0.35);
      const cls = CLASSES[r.cls];
      if (!cls) throw new Error('unknown class: ' + r.cls);
      this.units.push({
        id: i, cls: r.cls, team: r.team,
        x: Math.cos(ang) * 150, y: Math.sin(ang) * 150,
        heading: baseAng + Math.PI, // face across the arena
        gunAngle: baseAng + Math.PI,
        momentum: 1, stallTimer: 0, crystallizeTimer: 0,
        goal: null, // heading a released ship is still turning toward (no snap turns)
        energy: cls.energyMax,
        targetId: -1, outOfConeTime: 0, cooldown: cls.cooldown,
        // Arc-entry lock: entryQ = how centred the target was when it entered
        // the arc (1 = dead centre, 0 = edge), frozen at entry. lockCap is the
        // ceiling that entry allows; lockQ climbs toward it while held in the arc.
        entryQ: 0, lockCap: 0, lockQ: 0,
        vx: 0, vy: 0,
        enteredConeTick: new Array(list.length).fill(-1),
        dodgeTimer: 0, lockoutTimer: 0,
        beingShotTimer: 0, // set when damaged; drives the "being shot" attrition condition later
        tier: 0, // 0 Active, 1 Reduced, 2 Dormant — update gating
        state: ALIVE, held: false,
        weak: (cls.weakPoints || []).map(w => ({ type: w.type, x: w.x, y: w.y, r: w.r, hp: this.T.weakHp, out: false })),
      });
    }

    // Projectile pool. Fixed-capacity free list; nothing allocates per shot.
    const CAP = 256;
    this.projectiles = new Array(CAP);
    for (let i = 0; i < CAP; i++) {
      this.projectiles[i] = { active: false, x: 0, y: 0, vx: 0, vy: 0, ttl: 0, owner: -1, team: -1, damage: 0, aoe: 0, vsCap: 1 };
    }
    this.poolStats = { fired: 0, dropped: 0 };
  }

  // Back-compat for single-player callers: heldUnit / aimAngle = blue's.
  Object.defineProperty(Sim.prototype, 'heldUnit', {
    get: function () { return this.held[0]; }, set: function (v) { this.held[0] = v; } });
  Object.defineProperty(Sim.prototype, 'aimAngle', {
    get: function () { return this.aim[0]; }, set: function (v) { this.aim[0] = v; } });

  // Hand a side to a person (true) or back to the AI (false).
  Sim.prototype.setHuman = function (team, on) {
    if (this.human[team] === !!on) return;
    this.human[team] = !!on;
    if (this.held[team] >= 0) { this.units[this.held[team]].held = false; this.held[team] = -1; }
    for (const u of this.units) if (u.team === team && u.state === ALIVE) { u.momentum = 1; u.stallTimer = 0; }
    this.events.push({ type: 'control', team: team, human: !!on, tick: this.tick });
  };

  // Commands carry an optional team (default 0 = blue). A side can only touch
  // its own ships, and only while a person is flying it.
  Sim.prototype.command = function (cmd) { this.pending.push(cmd); };

  Sim.prototype._applyCommands = function () {
    for (const cmd of this.pending) {
      const team = cmd.team | 0;
      if (team !== 0 && team !== 1) continue;
      if (!this.human[team]) continue;
      if (cmd.type === 'grab') {
        const u = this.units[cmd.unit];
        // One grabbable unit at a time per side, own ships only — targeting stays
        // enemy-only, possession stays friendly-only.
        if (!u || u.team !== team || u.state !== ALIVE) continue;
        if (this.held[team] >= 0) this.units[this.held[team]].held = false;
        this.held[team] = cmd.unit;
        u.held = true;
        this.aim[team] = u.heading;
        this.events.push({ type: 'grabbed', unit: cmd.unit, team: team, tick: this.tick });
      } else if (cmd.type === 'aim') {
        if (typeof cmd.angle === 'number' && isFinite(cmd.angle)) this.aim[team] = cmd.angle;
      } else if (cmd.type === 'release') {
        if (this.held[team] < 0) continue;
        const u = this.units[this.held[team]];
        u.held = false;
        u.goal = this.aim[team]; // keeps turning toward it at its own rate after release
        u.momentum = 1;
        u.stallTimer = 0;
        this.events.push({ type: 'released', unit: this.held[team], team: team, tick: this.tick });
        this.held[team] = -1;
      } else if (cmd.type === 'dodge') {
        const u = this.held[team] >= 0 ? this.units[this.held[team]] : null;
        if (!u || u.state !== ALIVE || u.dodgeTimer > 0 || u.lockoutTimer > 0) continue;
        if (u.energy <= this.T.dodgeCost) continue; // can't roll yourself to death
        u.energy -= this.T.dodgeCost;
        u.dodgeTimer = this.T.dodgeDurSec;
        u.goal = null; // rolls straight along its current heading — no snap
        this.events.push({ type: 'dodge', unit: u.id, tick: this.tick });
      } else if (cmd.type === 'refocus') {
        // Drop the current lock so the first NEW cone entrant takes priority.
        const u = this.held[team] >= 0 ? this.units[this.held[team]] : null;
        if (!u) continue;
        u.targetId = -1; u.lockQ = 0; u.lockCap = 0; u.entryQ = 0; u.outOfConeTime = 0;
        u.enteredConeTick.fill(-1);
        this.events.push({ type: 'refocus', unit: u.id, tick: this.tick });
      }
    }
    this.pending.length = 0;
  };

  Sim.prototype._kill = function (u, cause) {
    if (u.state !== ALIVE) return;
    u.state = CRYSTALLIZING;
    u.crystallizeTimer = 0;
    if (u.held) { u.held = false; this.held[u.team] = -1; }
    this.events.push({ type: 'crystallizing', unit: u.id, cause: cause, tick: this.tick });
  };

  Sim.prototype._damage = function (u, amount, cause) {
    if (u.state !== ALIVE) return;
    u.energy -= amount;
    u.beingShotTimer = 1.0;
    if (u.energy <= 0) { u.energy = 0; this._kill(u, cause); }
  };

  Sim.prototype._inCone = function (u, v) {
    const dx = v.x - u.x, dy = v.y - u.y;
    const cls = CLASSES[u.cls];
    if (dx * dx + dy * dy > cls.coneRange * cls.coneRange) return false;
    return Math.abs(wrapAngle(Math.atan2(dy, dx) - u.gunAngle)) <= cls.coneHalf;
  };

  // Acquisition zone. Fixed guns can only acquire what is in the forward cone.
  // A turret acquires anything in range, at any bearing, then slews onto it.
  Sim.prototype._canAcquire = function (u, v) {
    if (!CLASSES[u.cls].turret) return this._inCone(u, v);
    const cls = CLASSES[u.cls];
    const dx = v.x - u.x, dy = v.y - u.y;
    return dx * dx + dy * dy <= cls.coneRange * cls.coneRange;
  };

  Sim.prototype._fireProjectile = function (u, angle) {
    const cls = CLASSES[u.cls];
    let p = null;
    for (const q of this.projectiles) if (!q.active) { p = q; break; }
    if (!p) { this.poolStats.dropped++; return; } // pool exhausted: drop, never allocate
    p.active = true;
    p.x = u.x; p.y = u.y;
    p.vx = Math.cos(angle) * cls.projSpeed; p.vy = Math.sin(angle) * cls.projSpeed;
    p.owner = u.id; p.team = u.team;
    p.damage = cls.damage; p.aoe = cls.aoe;
    p.ttl = cls.projTtl || this.T.projTtlSec;
    p.vsCap = cls.vsCapital || 1;
    this.poolStats.fired++;
  };

  Sim.prototype._weakFlag = function (u, type) {
    for (const w of u.weak) if (w.out && w.type === type) return true;
    return false;
  };

  // Which intact weak point (if any) a blast at (bx, by) lands on.
  Sim.prototype._weakHit = function (u, bx, by) {
    if (!u.weak.length) return null;
    const ur = this.T.unitRadius * CLASSES[u.cls].size;
    const c = Math.cos(-u.heading), s = Math.sin(-u.heading);
    const dx = bx - u.x, dy = by - u.y;
    const lx = (dx * c - dy * s) / ur, ly = (dx * s + dy * c) / ur; // hull-local, radius units
    let best = null, bestD = Infinity;
    for (const w of u.weak) {
      if (w.out) continue;
      const d = Math.hypot(lx - w.x, ly - w.y);
      if (d < w.r + 6 / ur && d < bestD) { bestD = d; best = w; }
    }
    return best;
  };

  Sim.prototype._detonate = function (p) {
    p.active = false;
    this.events.push({ type: 'detonation', x: p.x, y: p.y, aoe: p.aoe, tick: this.tick });
    for (const u of this.units) {
      if (u.state !== ALIVE) continue;
      if (u.team === p.team && !this.T.friendlyFire) continue; // FF is a separate toggle, off
      const ur = this.T.unitRadius * CLASSES[u.cls].size;
      const d = Math.hypot(u.x - p.x, u.y - p.y);
      if (d < p.aoe + ur) {
        const falloff = 1 - Math.max(0, d - ur) / p.aoe;
        let dmg = p.damage * falloff;
        if (CLASSES[u.cls].turret && p.vsCap) dmg *= p.vsCap; // anti-capital ordnance
        const w = this._weakHit(u, p.x, p.y);
        if (w) {
          dmg *= this.T.weakCritMult;
          w.hp -= dmg;
          this.events.push({ type: 'weakHit', unit: u.id, weak: w.type, tick: this.tick });
          if (w.hp <= 0) {
            w.hp = 0; w.out = true;
            this.events.push({ type: 'weakDown', unit: u.id, weak: w.type, x: p.x, y: p.y, tick: this.tick });
          }
        }
        this._damage(u, dmg, 'shot');
      }
    }
  };

  Sim.prototype.step = function () {
    const T = this.T, dt = this.dt;
    this.events.length = 0;
    this._applyCommands();

    // --- Update gating: tier by distance to nearest living foe. Deterministic. ---
    for (const u of this.units) {
      if (u.state !== ALIVE) continue;
      let nearestFoe = Infinity;
      for (const v of this.units) {
        if (v.team === u.team || v.state !== ALIVE) continue;
        const d = Math.hypot(v.x - u.x, v.y - u.y);
        if (d < nearestFoe) nearestFoe = d;
      }
      u.tier = nearestFoe > T.gateDormantDist ? 2 : (nearestFoe > T.gateReducedDist ? 1 : 0);
      if (u.held) u.tier = 0; // the possessed ship is always full-rate
    }

    for (const u of this.units) {
      if (u.state === CRYSTALLIZED) continue;
      if (u.state === CRYSTALLIZING) {
        u.crystallizeTimer += dt;
        if (u.crystallizeTimer >= T.crystallizeSec) {
          u.state = CRYSTALLIZED;
          if (T.wreckCrystals) this.hazards.push({ x: u.x, y: u.y, r: T.unitRadius * 1.6, salvage: true });
          this.events.push({ type: 'crystallized', unit: u.id, tick: this.tick });
        }
        continue;
      }

      const cls = CLASSES[u.cls];
      if (u.beingShotTimer > 0) u.beingShotTimer -= dt;
      if (u.lockoutTimer > 0) u.lockoutTimer -= dt;

      // Knocked-out weak points keep costing the capital.
      let cripple = 1;
      if (u.weak.length) {
        let vents = 0;
        for (const w of u.weak) if (w.out && w.type === 'vent') vents++;
        if (vents) { this._damage(u, vents * T.ventLeak * dt, 'breach'); if (u.state !== ALIVE) continue; }
        if (this._weakFlag(u, 'engine')) cripple = T.engineCripple;
      }

      // --- Steering. Every source of turning is capped by the hull's turn rate:
      // current speed / turnRadius. No ship ever snaps to a new heading. ---
      const curSpeed = (this.human[u.team] ? T.minSpeed + u.momentum * (cls.speed - T.minSpeed) : cls.speed) * cripple;
      const maxTurn = curSpeed / (cls.turnRadius * T.turnRadiusScale) * (u.tier === 1 ? 2 : 1); // rad/s (Reduced tier steps half as often)
      const heading0 = u.heading;
      if (u.dodgeTimer > 0) {
        // Barrel roll: dead straight, no steering of any kind.
        u.dodgeTimer -= dt;
        if (u.dodgeTimer <= 0) u.lockoutTimer = T.dodgeLockoutSec;
      } else if (u.held) {
        if (u.lockoutTimer <= 0) u.heading = turnToward(u.heading, this.aim[u.team], maxTurn * dt);
      } else if (this.human[u.team]) {
        // Unpossessed ship on a human-flown side: the juggle clock runs.
        u.momentum = Math.max(0, u.momentum - T.momentumDrain * dt);
        if (u.goal !== null && u.lockoutTimer <= 0) {
          u.heading = turnToward(u.heading, u.goal, maxTurn * dt);
          if (Math.abs(wrapAngle(u.goal - u.heading)) < 1e-3) u.goal = null;
        }
        u.heading += (this.rng() * 2 - 1) * T.driftNoise * (1 - u.momentum) * dt;
      } else {
        // Opposition AI: same class table, seeks nearest player ship to gun range.
        // It decides a heading only every aiReactSec (staggered per ship) and
        // turns toward that stale goal in between.
        const reactTicks = Math.max(1, Math.round(T.aiReactSec * T.tickRate));
        const decide = (this.tick + u.id * 7) % reactTicks === 0 || u.goal === null;
        if (u.goal !== null) u.heading = turnToward(u.heading, u.goal, maxTurn * dt);
        if (u.tier < 2 && decide) {
          let tgt = null, tgtD = Infinity;
          const huntCapitals = !!cls.vsCapital;
          for (const v of this.units) {
            if (v.team === u.team || v.state !== ALIVE) continue;
            // Anti-capital ships treat capitals as much closer than they are.
            const d = Math.hypot(v.x - u.x, v.y - u.y) * (huntCapitals && CLASSES[v.cls].turret ? 0.25 : 1);
            if (d < tgtD) { tgtD = d; tgt = v; }
          }
          if (tgt) tgtD = Math.hypot(tgt.x - u.x, tgt.y - u.y);
          if (tgt) {
            const toTgt = Math.atan2(tgt.y - u.y, tgt.x - u.x);
            let want;
            if (cls.turret) {
              // Turret ship: close to range, then orbit and let the turret work.
              want = tgtD > cls.coneRange * 0.7 ? toTgt : toTgt + Math.PI / 2;
            } else {
              // Fixed guns: strafing runs. Nose on target; peel off when too
              // close, swing back around for the next pass.
              want = tgtD > cls.coneRange * 0.35 ? toTgt : toTgt + Math.PI * 0.6;
            }
            u.goal = want;
          }
        }
      }

      // Crystal evasion for everything unheld and not mid-roll. Only crystals
      // ahead matter, and a ship that turns wide has to start turning early:
      // look-ahead = avoidRange + its turn radius. It veers to whichever side
      // the crystal isn't on, using its own hull turn rate.
      if (!u.held && u.dodgeTimer <= 0 && T.avoidSteer > 0) {
        const look = T.avoidRange + cls.turnRadius * T.turnRadiusScale;
        let nearest = null, nearestGap = Infinity, nearestRel = 0;
        for (const h of this.hazards) {
          const dx = h.x - u.x, dy = h.y - u.y;
          const rel = wrapAngle(Math.atan2(dy, dx) - u.heading);
          if (Math.abs(rel) > Math.PI / 2) continue; // behind us
          const gap = Math.hypot(dx, dy) - h.r - T.unitRadius * cls.size;
          if (gap < look && gap < nearestGap) { nearestGap = gap; nearest = h; nearestRel = rel; }
        }
        if (nearest) {
          const away = u.heading - (nearestRel >= 0 ? 1 : -1) * Math.PI / 2;
          const urgency = Math.min(1, 1.5 * (1 - Math.max(0, nearestGap) / look));
          const str = this.human[u.team] ? u.momentum : 1;
          // Close call: evasion overrides whatever the pilot/AI was turning toward.
          const from = urgency > 0.6 ? heading0 : u.heading;
          u.heading = turnToward(from, away, maxTurn * T.avoidSteer * str * urgency * dt);
        }
      }

      // Hull limit: whatever asked for the turn (pilot, AI, evasion, drift), the
      // ship can't swing faster than its turn radius allows.
      if (u.dodgeTimer <= 0) {
        const d = wrapAngle(u.heading - heading0), lim = maxTurn * dt;
        if (Math.abs(d) > lim) u.heading = heading0 + Math.sign(d) * lim;
      }

      // --- Stall (human-flown sides only — the AI opposition does not juggle) ---
      if (this.human[u.team] && u.momentum <= 0 && !u.held && u.dodgeTimer <= 0) {
        u.vx = 0; u.vy = 0;
        u.stallTimer += dt;
        if (u.stallTimer >= T.stallGraceSec) this._kill(u, 'stalled');
        continue;
      }

      // --- Movement ---
      let speed = this.human[u.team]
        ? T.minSpeed + u.momentum * (cls.speed - T.minSpeed)
        : cls.speed;
      if (u.dodgeTimer > 0) speed = cls.speed * T.dodgeSpeedMult;
      speed *= cripple;
      u.vx = Math.cos(u.heading) * speed; u.vy = Math.sin(u.heading) * speed;
      u.x += u.vx * dt;
      u.y += u.vy * dt;

      const distFromCenter = Math.hypot(u.x, u.y);
      if (distFromCenter > T.arenaRadius && u.dodgeTimer <= 0) {
        u.heading = turnToward(u.heading, Math.atan2(-u.y, -u.x), Math.min(T.edgeSteer, maxTurn) * dt);
      }

      for (const h of this.hazards) {
        if (Math.hypot(u.x - h.x, u.y - h.y) < h.r + T.unitRadius * cls.size) { this._kill(u, 'contact'); break; }
      }
      if (u.state !== ALIVE) continue;

      if (!cls.turret) u.gunAngle = u.heading; // fixed guns ride the hull

      // --- Gunnery. Reduced tier: every 2nd tick. Dormant: no acquisition at all. ---
      if (u.tier === 2 || (u.tier === 1 && (this.tick & 1) === 1)) continue;

      // Track cone entry ticks for first-to-enter priority.
      for (const v of this.units) {
        if (v.team === u.team || v.state !== ALIVE) { u.enteredConeTick[v ? v.id : 0] = -1; continue; }
        const inZone = this._canAcquire(u, v);
        if (inZone && u.enteredConeTick[v.id] < 0) u.enteredConeTick[v.id] = this.tick;
        if (!inZone) u.enteredConeTick[v.id] = -1;
      }

      // Validate / acquire target. First to enter the cone wins and keeps priority.
      let target = u.targetId >= 0 ? this.units[u.targetId] : null;
      if (target && (target.state !== ALIVE)) { target = null; u.targetId = -1; u.lockQ = 0; }
      if (target) {
        if (this._canAcquire(u, target)) { u.outOfConeTime = 0; }
        else {
          u.outOfConeTime += dt;
          if (u.outOfConeTime > T.coneGraceSec) { target = null; u.targetId = -1; u.lockQ = 0; u.outOfConeTime = 0; }
        }
      }
      if (!target) {
        let bestTick = Infinity, best = -1;
        for (const v of this.units) {
          if (v.team === u.team || v.state !== ALIVE) continue;
          const et = u.enteredConeTick[v.id];
          if (et >= 0 && et < bestTick) { bestTick = et; best = v.id; }
        }
        if (best >= 0) {
          target = this.units[best];
          u.targetId = best; u.outOfConeTime = 0;
          // Freeze entry quality: how far off the arc centre (or turret barrel) it came in.
          const off = Math.abs(wrapAngle(Math.atan2(target.y - u.y, target.x - u.x) - u.gunAngle));
          const worst = cls.turret ? T.turretEntryArc : cls.coneHalf;
          u.entryQ = 1 - Math.min(1, off / worst);
          u.lockCap = T.lockEntryFloor + (1 - T.lockEntryFloor) * u.entryQ;
          u.lockQ = u.lockCap * T.lockStartFrac;
          this.events.push({ type: 'locked', unit: u.id, target: best, entryQ: u.entryQ, tick: this.tick });
        }
      }

      // Where to aim: straight at the target at zero lock, fully led at full lock.
      let aimAngle = u.heading;
      if (target) {
        const dist = Math.hypot(target.x - u.x, target.y - u.y);
        const lead = (dist / cls.projSpeed) * u.lockQ * T.leadMax;
        aimAngle = Math.atan2(target.y + target.vy * lead - u.y, target.x + target.vx * lead - u.x);
      }

      // Turret (capitals only) rotates independently of the hull: toward target,
      // else settles on heading. Fixed guns always point where the hull points.
      if (cls.turret && this._weakFlag(u, 'bridge')) continue; // fire control gone: turret is dead weight
      if (cls.turret) {
        const gunGoal = target ? aimAngle : u.heading;
        u.gunAngle = turnToward(u.gunAngle, gunGoal, cls.gunTurn * dt);
      } else {
        u.gunAngle = u.heading;
      }

      if (target && this._inCone(u, target)) {
        // Lock climbs toward the ceiling its entry earned — never past it.
        u.lockQ = Math.min(u.lockCap, u.lockQ + u.lockCap * (1 - T.lockStartFrac) * dt / T.lockTimeFull);
        // Cooldown only ticks with a valid target in the cone; a better lock reloads faster.
        u.cooldown -= dt * (1 + T.fireRateBonus * u.lockQ);
        if (u.cooldown <= 0 && u.energy > cls.energyMax * T.autoFireFloor + cls.shotCost) {
          const spread = T.lockSpreadMax * (1 - u.lockQ);
          // Fixed guns can only nudge the shot within their arc; turrets fire down the barrel.
          let base = cls.turret ? u.gunAngle
            : u.gunAngle + Math.max(-cls.coneHalf, Math.min(cls.coneHalf, wrapAngle(aimAngle - u.gunAngle)));
          const angle = base + (this.rng() * 2 - 1) * spread;
          this._fireProjectile(u, angle);
          u.energy -= cls.shotCost; // shooting spends the pool that is also your health
          u.cooldown = cls.cooldown;
          this.events.push({ type: 'fired', unit: u.id, target: u.targetId, spread: spread, lockQ: u.lockQ, tick: this.tick });
        }
      }
    }

    // --- Projectiles: move, contact-detonate on foes and crystals, flak at end of life. ---
    for (const p of this.projectiles) {
      if (!p.active) continue;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.ttl -= dt;
      let boom = p.ttl <= 0;
      if (!boom) {
        for (const u of this.units) {
          if (u.state !== ALIVE || u.id === p.owner) continue;
          if (u.team === p.team && !this.T.friendlyFire) continue;
          if (Math.hypot(u.x - p.x, u.y - p.y) < this.T.unitRadius * CLASSES[u.cls].size + 4) { boom = true; break; }
        }
      }
      if (!boom) {
        for (const h of this.hazards) {
          if (Math.hypot(h.x - p.x, h.y - p.y) < h.r) { boom = true; break; } // crystals are cover
        }
      }
      if (boom) this._detonate(p);
    }

    this.tick++;
  };

  Sim.prototype.aliveCount = function (team) {
    let n = 0;
    for (const u of this.units) if (u.state === ALIVE && (team === undefined || u.team === team)) n++;
    return n;
  };

  Sim.prototype.teamEnergy = function (team) {
    let e = 0;
    for (const u of this.units) if (u.state === ALIVE && u.team === team) e += u.energy;
    return e;
  };

  // --- Network snapshot (LAN multiplayer). The server owns the one true sim and
  // ships this to clients ~30x/s; clients copy it into a local Sim that they only
  // render (never step), so different browsers' float maths can't drift apart.
  const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;
  const STATE_CODE = { alive: 0, crystallizing: 1, crystallized: 2 };
  const CODE_STATE = ['alive', 'crystallizing', 'crystallized'];
  Sim.prototype.snapshot = function (events) {
    const units = this.units.map(u => [
      r2(u.x), r2(u.y), r3(u.heading), r3(u.gunAngle), r3(u.momentum), r2(u.energy),
      STATE_CODE[u.state], u.held ? 1 : 0, u.targetId, r3(u.lockQ), r3(u.lockCap), r3(u.entryQ),
      r3(u.crystallizeTimer), u.weak.map(w => w.out ? -1 : r2(w.hp)),
      u.goal === null ? null : r3(u.goal),
    ]);
    const proj = [];
    for (const p of this.projectiles) if (p.active) proj.push([r2(p.x), r2(p.y), r2(p.vx), r2(p.vy), p.vsCap > 1 ? 1 : 0]);
    return {
      tick: this.tick, held: this.held.slice(), aim: this.aim.map(r3), human: this.human.slice(),
      units: units, proj: proj,
      hazards: this.hazards.map(h => [r2(h.x), r2(h.y), r2(h.r), h.salvage ? 1 : 0]),
      events: events || [],
    };
  };
  Sim.prototype.applySnapshot = function (snap) {
    this.tick = snap.tick; this.held = snap.held; this.aim = snap.aim; this.human = snap.human;
    snap.units.forEach((a, i) => {
      const u = this.units[i];
      if (!u) return;
      u.x = a[0]; u.y = a[1]; u.heading = a[2]; u.gunAngle = a[3]; u.momentum = a[4]; u.energy = a[5];
      u.state = CODE_STATE[a[6]]; u.held = !!a[7]; u.targetId = a[8]; u.lockQ = a[9]; u.lockCap = a[10];
      u.entryQ = a[11]; u.crystallizeTimer = a[12]; u.goal = a[14] === undefined ? null : a[14];
      a[13].forEach((hp, k) => { if (u.weak[k]) { u.weak[k].out = hp < 0; u.weak[k].hp = Math.max(0, hp); } });
    });
    let k = 0;
    for (const p of this.projectiles) {
      const a = snap.proj[k];
      if (a) { p.active = true; p.x = a[0]; p.y = a[1]; p.vx = a[2]; p.vy = a[3]; p.vsCap = a[4] ? 2 : 1; k++; }
      else p.active = false;
    }
    this.hazards = snap.hazards.map(h => ({ x: h[0], y: h[1], r: h[2], salvage: !!h[3] }));
    this.events = snap.events;
  };

  Sim.prototype.stateHash = function () {
    let h = 0x811c9dc5;
    const mix = str => { for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } };
    mix('t' + this.tick + 'h' + this.held.join(',') + 'm' + this.human.join(','));
    for (const u of this.units) {
      mix(u.id + ':' + u.state + ':' + u.x.toFixed(3) + ',' + u.y.toFixed(3) + ',' + u.heading.toFixed(4) +
          ',' + u.gunAngle.toFixed(4) + ',' + u.momentum.toFixed(4) + ',' + u.energy.toFixed(3) + ',' + u.targetId + ',' + u.lockQ.toFixed(4));
      for (const w of u.weak) mix(w.type + w.hp.toFixed(2));
      if (u.goal !== null) mix('g' + u.goal.toFixed(4));
    }
    let live = 0;
    for (const p of this.projectiles) if (p.active) { live++; mix(p.x.toFixed(2) + ',' + p.y.toFixed(2)); }
    mix('pr' + live + 'hz' + this.hazards.length);
    return (h >>> 0).toString(16);
  };

  return { Sim: Sim, TUNABLES: TUNABLES, CLASSES: CLASSES, mulberry32: mulberry32, PLAYER: PLAYER, ENEMY: ENEMY };
});
