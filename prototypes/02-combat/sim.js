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
    edgeSteer:       { value: 2.2,   min: 0,   max: 10,   tooltip: 'Corrective turn (rad/s) past the soft edge.' },
    minSpeed:        { value: 18,    min: 0,   max: 100,  tooltip: 'Speed floor while momentum > 0.' },
    momentumDrain:   { value: 0.055, min: 0,   max: 0.5,  tooltip: 'Momentum lost per second while unpossessed (player team only — the juggle clock).' },
    driftNoise:      { value: 1.4,   min: 0,   max: 8,    tooltip: 'Heading wobble (rad/s) at zero momentum.' },
    stallGraceSec:   { value: 2.5,   min: 0.5, max: 10,   tooltip: 'Seconds a stalled unit can still be saved.' },
    crystallizeSec:  { value: 1.2,   min: 0.1, max: 5,    tooltip: 'Seconds from fatal blow to crystallized salvage.' },
    hazardCount:     { value: 5,     min: 0,   max: 30,   tooltip: 'Seeded crystal formations. Projectiles detonate on them (cover). Reset to apply.' },
    hazardBandInner: { value: 220,   min: 50,  max: 1000, tooltip: 'Crystal-free inner disc radius.' },
    hazardRadiusMin: { value: 24,    min: 5,   max: 100,  tooltip: 'Smallest crystal radius.' },
    hazardRadiusMax: { value: 48,    min: 5,   max: 160,  tooltip: 'Largest crystal radius.' },
    unitRadius:      { value: 10,    min: 4,   max: 30,   tooltip: 'Unit collision radius (art scale decoupled).' },
    avoidRange:      { value: 90,    min: 0,   max: 300,  tooltip: 'Crystal evasion range for unheld ships.' },
    avoidSteer:      { value: 3.0,   min: 0,   max: 12,   tooltip: 'Max evasion turn (rad/s), scaled by momentum.' },
    heldTurnRate:    { value: 6.0,   min: 1,   max: 20,   tooltip: 'Rad/s the held unit turns toward the aim angle.' },
    lockTimeFull:    { value: 1.6,   min: 0.2, max: 6,    tooltip: 'Seconds a target must stay in cone for zero spread.' },
    lockSpreadMax:   { value: 0.35,  min: 0,   max: 1.5,  tooltip: 'Aim error (radians) at zero lock. Spread scales down with lock quality.' },
    coneGraceSec:    { value: 0.5,   min: 0,   max: 3,    tooltip: 'Seconds a target may slip out of cone before the lock is dropped.' },
    autoFireFloor:   { value: 0.15,  min: 0,   max: 0.9,  tooltip: 'Ships hold fire below this energy fraction — shooting spends the same pool that keeps them alive.' },
    dodgeCost:       { value: 18,    min: 0,   max: 100,  tooltip: 'Flat energy cost of a barrel roll. Big on purpose.' },
    dodgeSpeedMult:  { value: 2.6,   min: 1,   max: 6,    tooltip: 'Speed multiplier during the roll. Straight line only.' },
    dodgeDurSec:     { value: 0.45,  min: 0.1, max: 2,    tooltip: 'Roll duration.' },
    dodgeLockoutSec: { value: 0.8,   min: 0,   max: 3,    tooltip: 'Turn lockout after the roll — readable and interceptable.' },
    projTtlSec:      { value: 2.2,   min: 0.5, max: 6,    tooltip: 'Projectile lifetime; flak detonates at end of life.' },
    friendlyFire:    { value: 0,     min: 0,   max: 1,    tooltip: 'Separate toggle, off by default. AoE never hurts allies unless this is 1.' },
    gateReducedDist: { value: 700,   min: 100, max: 4000, tooltip: 'Farther than this from any foe -> Reduced tier (combat every 2nd tick).' },
    gateDormantDist: { value: 1400,  min: 200, max: 8000, tooltip: 'Farther than this -> Dormant tier (every 4th tick, no target acquisition).' },
  };

  // Shared class table — the SAME rows drive player ships and opposition.
  // Unity port: one ScriptableObject per row; numbers become [Range] fields there.
  const CLASSES = {
    fighter:     { speed: 150, turnRate: 2.6, energyMax: 100, gunTurn: 4.0,
                   coneHalf: 0.35, coneRange: 230, cooldown: 0.50, shotCost: 2.0, damage: 6,  aoe: 26, projSpeed: 330 },
    bomber:      { speed: 100, turnRate: 1.6, energyMax: 170, gunTurn: 2.2,
                   coneHalf: 0.50, coneRange: 270, cooldown: 1.60, shotCost: 6.0, damage: 18, aoe: 72, projSpeed: 180 },
    heavy:       { speed: 112, turnRate: 1.1, energyMax: 210, gunTurn: 2.8,
                   coneHalf: 0.16, coneRange: 320, cooldown: 0.80, shotCost: 4.0, damage: 14, aoe: 18, projSpeed: 430 },
    interceptor: { speed: 215, turnRate: 3.6, energyMax: 60,  gunTurn: 5.0,
                   coneHalf: 0.40, coneRange: 180, cooldown: 0.35, shotCost: 1.5, damage: 4,  aoe: 16, projSpeed: 370 },
    aaa:         { speed: 70,  turnRate: 1.0, energyMax: 150, gunTurn: 6.5,
                   coneHalf: 1.10, coneRange: 210, cooldown: 0.30, shotCost: 1.2, damage: 3,  aoe: 36, projSpeed: 260 },
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

  // roster: array of {cls, team}. Default: mirror 4v4.
  function defaultRoster() {
    return [
      { cls: 'fighter', team: PLAYER }, { cls: 'bomber', team: PLAYER },
      { cls: 'heavy', team: PLAYER }, { cls: 'interceptor', team: PLAYER },
      { cls: 'fighter', team: ENEMY }, { cls: 'bomber', team: ENEMY },
      { cls: 'heavy', team: ENEMY }, { cls: 'interceptor', team: ENEMY },
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
    this.heldUnit = -1;
    this.aimAngle = 0;
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
        energy: cls.energyMax,
        targetId: -1, lockTime: 0, outOfConeTime: 0, cooldown: cls.cooldown,
        enteredConeTick: new Array(list.length).fill(-1),
        dodgeTimer: 0, lockoutTimer: 0,
        beingShotTimer: 0, // set when damaged; drives the "being shot" attrition condition later
        tier: 0, // 0 Active, 1 Reduced, 2 Dormant — update gating
        state: ALIVE, held: false,
      });
    }

    // Projectile pool. Fixed-capacity free list; nothing allocates per shot.
    const CAP = 256;
    this.projectiles = new Array(CAP);
    for (let i = 0; i < CAP; i++) {
      this.projectiles[i] = { active: false, x: 0, y: 0, vx: 0, vy: 0, ttl: 0, owner: -1, team: -1, damage: 0, aoe: 0 };
    }
    this.poolStats = { fired: 0, dropped: 0 };
  }

  Sim.prototype.command = function (cmd) { this.pending.push(cmd); };

  Sim.prototype._applyCommands = function () {
    for (const cmd of this.pending) {
      if (cmd.type === 'grab') {
        const u = this.units[cmd.unit];
        // One grabbable unit at a time, own team only — targeting stays enemy-only,
        // possession stays friendly-only.
        if (!u || u.team !== PLAYER || u.state !== ALIVE) continue;
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
      } else if (cmd.type === 'dodge') {
        const u = this.heldUnit >= 0 ? this.units[this.heldUnit] : null;
        if (!u || u.state !== ALIVE || u.dodgeTimer > 0 || u.lockoutTimer > 0) continue;
        if (u.energy <= this.T.dodgeCost) continue; // can't roll yourself to death
        u.energy -= this.T.dodgeCost;
        u.dodgeTimer = this.T.dodgeDurSec;
        u.heading = this.aimAngle; // roll direction locked at trigger
        this.events.push({ type: 'dodge', unit: u.id, tick: this.tick });
      } else if (cmd.type === 'refocus') {
        // Drop the current lock so the first NEW cone entrant takes priority.
        const u = this.heldUnit >= 0 ? this.units[this.heldUnit] : null;
        if (!u) continue;
        u.targetId = -1; u.lockTime = 0; u.outOfConeTime = 0;
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
    if (u.held) { u.held = false; this.heldUnit = -1; }
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

  Sim.prototype._fireProjectile = function (u, angle) {
    const cls = CLASSES[u.cls];
    let p = null;
    for (const q of this.projectiles) if (!q.active) { p = q; break; }
    if (!p) { this.poolStats.dropped++; return; } // pool exhausted: drop, never allocate
    p.active = true;
    p.x = u.x; p.y = u.y;
    p.vx = Math.cos(angle) * cls.projSpeed; p.vy = Math.sin(angle) * cls.projSpeed;
    p.ttl = this.T.projTtlSec;
    p.owner = u.id; p.team = u.team;
    p.damage = cls.damage; p.aoe = cls.aoe;
    this.poolStats.fired++;
  };

  Sim.prototype._detonate = function (p) {
    p.active = false;
    this.events.push({ type: 'detonation', x: p.x, y: p.y, aoe: p.aoe, tick: this.tick });
    for (const u of this.units) {
      if (u.state !== ALIVE) continue;
      if (u.team === p.team && !this.T.friendlyFire) continue; // FF is a separate toggle, off
      const d = Math.hypot(u.x - p.x, u.y - p.y);
      if (d < p.aoe + this.T.unitRadius) {
        const falloff = 1 - Math.max(0, d - this.T.unitRadius) / p.aoe;
        this._damage(u, p.damage * falloff, 'shot');
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
          this.hazards.push({ x: u.x, y: u.y, r: T.unitRadius * 1.6, salvage: true });
          this.events.push({ type: 'crystallized', unit: u.id, tick: this.tick });
        }
        continue;
      }

      const cls = CLASSES[u.cls];
      if (u.beingShotTimer > 0) u.beingShotTimer -= dt;
      if (u.lockoutTimer > 0) u.lockoutTimer -= dt;

      // --- Steering ---
      if (u.dodgeTimer > 0) {
        // Barrel roll: dead straight, no steering of any kind.
        u.dodgeTimer -= dt;
        if (u.dodgeTimer <= 0) u.lockoutTimer = T.dodgeLockoutSec;
      } else if (u.held) {
        if (u.lockoutTimer <= 0) u.heading = turnToward(u.heading, this.aimAngle, T.heldTurnRate * dt);
      } else if (u.team === PLAYER) {
        // Unpossessed player ship: the juggle clock runs.
        u.momentum = Math.max(0, u.momentum - T.momentumDrain * dt);
        u.heading += (this.rng() * 2 - 1) * T.driftNoise * (1 - u.momentum) * dt;
      } else {
        // Opposition AI: same class table, seeks nearest player ship to gun range.
        if (u.tier < 2) {
          let tgt = null, tgtD = Infinity;
          for (const v of this.units) {
            if (v.team === u.team || v.state !== ALIVE) continue;
            const d = Math.hypot(v.x - u.x, v.y - u.y);
            if (d < tgtD) { tgtD = d; tgt = v; }
          }
          if (tgt && (u.tier === 0 || (this.tick & 1) === 0)) {
            const want = tgtD > cls.coneRange * 0.7
              ? Math.atan2(tgt.y - u.y, tgt.x - u.x)
              : Math.atan2(tgt.y - u.y, tgt.x - u.x) + Math.PI / 2; // orbit at range
            u.heading = turnToward(u.heading, want, cls.turnRate * dt * (u.tier === 1 ? 2 : 1));
          }
        }
      }

      // Crystal evasion for everything unheld and not mid-roll.
      if (!u.held && u.dodgeTimer <= 0 && T.avoidSteer > 0) {
        let nearest = null, nearestGap = Infinity;
        for (const h of this.hazards) {
          const gap = Math.hypot(u.x - h.x, u.y - h.y) - h.r;
          if (gap < T.avoidRange && gap < nearestGap) { nearestGap = gap; nearest = h; }
        }
        if (nearest) {
          const away = Math.atan2(u.y - nearest.y, u.x - nearest.x);
          const urgency = 1 - Math.max(0, nearestGap) / T.avoidRange;
          const str = u.team === PLAYER ? u.momentum : 1;
          u.heading = turnToward(u.heading, away, T.avoidSteer * str * urgency * dt);
        }
      }

      // --- Stall (player team only — opposition doesn't juggle) ---
      if (u.team === PLAYER && u.momentum <= 0 && !u.held && u.dodgeTimer <= 0) {
        u.stallTimer += dt;
        if (u.stallTimer >= T.stallGraceSec) this._kill(u, 'stalled');
        continue;
      }

      // --- Movement ---
      let speed = u.team === PLAYER
        ? T.minSpeed + u.momentum * (cls.speed - T.minSpeed)
        : cls.speed;
      if (u.dodgeTimer > 0) speed = cls.speed * T.dodgeSpeedMult;
      u.x += Math.cos(u.heading) * speed * dt;
      u.y += Math.sin(u.heading) * speed * dt;

      const distFromCenter = Math.hypot(u.x, u.y);
      if (distFromCenter > T.arenaRadius && u.dodgeTimer <= 0) {
        u.heading = turnToward(u.heading, Math.atan2(-u.y, -u.x), T.edgeSteer * dt);
      }

      for (const h of this.hazards) {
        if (Math.hypot(u.x - h.x, u.y - h.y) < h.r + T.unitRadius) { this._kill(u, 'contact'); break; }
      }
      if (u.state !== ALIVE) continue;

      // --- Gunnery. Reduced tier: every 2nd tick. Dormant: no acquisition at all. ---
      if (u.tier === 2 || (u.tier === 1 && (this.tick & 1) === 1)) continue;

      // Track cone entry ticks for first-to-enter priority.
      for (const v of this.units) {
        if (v.team === u.team || v.state !== ALIVE) { u.enteredConeTick[v ? v.id : 0] = -1; continue; }
        const inCone = this._inCone(u, v);
        if (inCone && u.enteredConeTick[v.id] < 0) u.enteredConeTick[v.id] = this.tick;
        if (!inCone) u.enteredConeTick[v.id] = -1;
      }

      // Validate / acquire target. First to enter the cone wins and keeps priority.
      let target = u.targetId >= 0 ? this.units[u.targetId] : null;
      if (target && (target.state !== ALIVE)) { target = null; u.targetId = -1; u.lockTime = 0; }
      if (target) {
        if (this._inCone(u, target)) { u.outOfConeTime = 0; }
        else {
          u.outOfConeTime += dt;
          if (u.outOfConeTime > T.coneGraceSec) { target = null; u.targetId = -1; u.lockTime = 0; u.outOfConeTime = 0; }
        }
      }
      if (!target) {
        let bestTick = Infinity, best = -1;
        for (const v of this.units) {
          if (v.team === u.team || v.state !== ALIVE) continue;
          const et = u.enteredConeTick[v.id];
          if (et >= 0 && et < bestTick) { bestTick = et; best = v.id; }
        }
        if (best >= 0) { u.targetId = best; u.lockTime = 0; u.outOfConeTime = 0; target = this.units[best]; }
      }

      // Gun rotates independently of the hull: toward target, else settles on heading.
      const gunGoal = target ? Math.atan2(target.y - u.y, target.x - u.x) : u.heading;
      u.gunAngle = turnToward(u.gunAngle, gunGoal, cls.gunTurn * dt);

      if (target && this._inCone(u, target)) {
        u.lockTime += dt;
        // Cooldown only ticks with a valid target in the cone.
        u.cooldown -= dt;
        if (u.cooldown <= 0 && u.energy > cls.energyMax * T.autoFireFloor + cls.shotCost) {
          const lockQ = Math.min(1, u.lockTime / T.lockTimeFull);
          const spread = T.lockSpreadMax * (1 - lockQ);
          const angle = u.gunAngle + (this.rng() * 2 - 1) * spread;
          this._fireProjectile(u, angle);
          u.energy -= cls.shotCost; // shooting spends the pool that is also your health
          u.cooldown = cls.cooldown;
          this.events.push({ type: 'fired', unit: u.id, target: u.targetId, spread: spread, tick: this.tick });
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
          if (Math.hypot(u.x - p.x, u.y - p.y) < this.T.unitRadius + 4) { boom = true; break; }
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

  Sim.prototype.stateHash = function () {
    let h = 0x811c9dc5;
    const mix = str => { for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } };
    mix('t' + this.tick + 'h' + this.heldUnit);
    for (const u of this.units) {
      mix(u.id + ':' + u.state + ':' + u.x.toFixed(3) + ',' + u.y.toFixed(3) + ',' + u.heading.toFixed(4) +
          ',' + u.gunAngle.toFixed(4) + ',' + u.momentum.toFixed(4) + ',' + u.energy.toFixed(3) + ',' + u.targetId);
    }
    let live = 0;
    for (const p of this.projectiles) if (p.active) { live++; mix(p.x.toFixed(2) + ',' + p.y.toFixed(2)); }
    mix('pr' + live + 'hz' + this.hazards.length);
    return (h >>> 0).toString(16);
  };

  return { Sim: Sim, TUNABLES: TUNABLES, CLASSES: CLASSES, mulberry32: mulberry32, PLAYER: PLAYER, ENEMY: ENEMY };
});
