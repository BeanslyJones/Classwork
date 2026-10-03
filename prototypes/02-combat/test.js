// Headless verification for prototype 02 (combat). Run: node test.js
'use strict';
const { Sim, CLASSES, PLAYER, ENEMY, mulberry32 } = require('./sim.js');

let failures = 0;
function assert(cond, label) {
  if (cond) console.log('  PASS  ' + label);
  else { failures++; console.error('  FAIL  ' + label); }
}

const SEED = 4242;
const TICK_RATE = 30;

// Isolated duel arena: no crystals, no drift — pure combat-rule checks.
const DUEL = { hazardCount: 0, driftNoise: 0, momentumDrain: 0 };
function duel(roster, extra) {
  return new Sim(SEED, Object.assign({}, DUEL, extra || {}), roster);
}

// --- 1. Determinism with live combat. ---------------------------------------
{
  console.log('\n[determinism]');
  const a = new Sim(SEED), b = new Sim(SEED), c = new Sim(SEED + 1);
  for (let t = 0; t < 5000; t++) { a.step(); b.step(); c.step(); }
  assert(a.stateHash() === b.stateHash(), 'same seed -> identical hash after 5000 ticks of combat');
  assert(a.stateHash() !== c.stateHash(), 'different seed -> different timeline');
}

// --- 2. Cooldown only ticks with a valid target. ----------------------------
{
  console.log('\n[cooldown gating]');
  // One lone fighter: nothing to shoot at, cooldown must stay frozen.
  const s = duel([{ cls: 'fighter', team: PLAYER }]);
  const before = s.units[0].cooldown;
  for (let t = 0; t < 300; t++) s.step();
  assert(s.units[0].cooldown === before, 'no target in cone -> cooldown frozen for 10s');
  assert(s.poolStats.fired === 0, 'no target -> zero shots fired');
}

// --- 3. Targeting is enemy-only; friendly fire is a separate toggle. --------
{
  console.log('\n[enemy-only targeting + friendly fire toggle]');
  // Two allies alone: must never target or hurt each other.
  const s = duel([{ cls: 'fighter', team: PLAYER }, { cls: 'fighter', team: PLAYER }]);
  for (let t = 0; t < 600; t++) s.step();
  assert(s.units[0].targetId === -1 && s.units[1].targetId === -1, 'allies never acquire each other');
  assert(s.units[0].energy === CLASSES.fighter.energyMax && s.units[1].energy === CLASSES.fighter.energyMax,
    'allies take zero damage with FF off');

  // AoE clump rule, tested at the detonation itself: ally and foe hugging at
  // ground zero. Ships can't hold still (motion is survival), so the moving-
  // scene version of this is untestable — exercise _detonate directly.
  function splash(ff) {
    const s2 = duel(
      [{ cls: 'bomber', team: PLAYER }, { cls: 'fighter', team: PLAYER }, { cls: 'fighter', team: ENEMY }],
      { friendlyFire: ff });
    const [, ally, foe] = s2.units;
    ally.x = 0; ally.y = 30; foe.x = 0; foe.y = -30;
    s2._detonate({ active: true, x: 0, y: 0, damage: 18, aoe: 72, team: PLAYER, owner: 0 });
    return { ally: ally.energy, foe: foe.energy };
  }
  const off = splash(0), on = splash(1);
  assert(off.foe < CLASSES.fighter.energyMax, 'splash hits the enemy in the clump');
  assert(off.ally === CLASSES.fighter.energyMax, 'FF off: same splash never hurts the ally');
  assert(on.ally < CLASSES.fighter.energyMax, 'FF on: same splash hits the ally (toggle works)');
}

// --- 4. First-to-enter-cone priority + refocus. -----------------------------
{
  console.log('\n[first-in-cone priority]');
  const s = duel([
    { cls: 'aaa', team: PLAYER },      // wide 1.1-rad cone, easy to stage
    { cls: 'fighter', team: ENEMY },
    { cls: 'fighter', team: ENEMY },
  ]);
  const [aaa, e1, e2] = s.units;
  aaa.x = 0; aaa.y = 0; aaa.heading = 0; aaa.gunAngle = 0;
  // e1 inside the cone now; e2 far outside, walks in later.
  e1.x = 120; e1.y = 20; e2.x = 120; e2.y = 500;
  s.step();
  assert(aaa.targetId === e1.id, 'first entrant acquired');
  e2.x = 120; e2.y = -20; // now also in cone
  for (let t = 0; t < 30; t++) s.step();
  assert(aaa.targetId === e1.id, 'priority sticks with the FIRST entrant while it stays in cone');
  // Refocus drops the lock; with both in cone, the earlier re-entrant wins next tick.
  // Fixed guns: the cone rides the hull, so re-stage both foes ahead of the nose.
  const fwd = aaa.heading;
  e1.x = aaa.x + Math.cos(fwd) * 120; e1.y = aaa.y + Math.sin(fwd) * 120;
  e2.x = aaa.x + Math.cos(fwd + 0.3) * 120; e2.y = aaa.y + Math.sin(fwd + 0.3) * 120;
  s.command({ type: 'grab', unit: aaa.id });
  s.command({ type: 'refocus' });
  s.step();
  s.step();
  assert(aaa.targetId >= 0, 'refocus re-acquires from current cone entrants');
}

// --- 5. Spread scales with lock quality. ------------------------------------
{
  console.log('\n[lock-scaled spread]');
  const s = duel([{ cls: 'heavy', team: PLAYER }, { cls: 'heavy', team: ENEMY }]);
  const [a, b] = s.units;
  a.x = -150; a.y = 0; a.heading = 0; a.gunAngle = 0;
  b.x = 150; b.y = 0; b.heading = Math.PI; b.gunAngle = Math.PI;
  const spreads = [];
  // Fixed guns: the pilot keeps the nose on the target (held + aimed each tick).
  s.command({ type: 'grab', unit: a.id });
  for (let t = 0; t < 400; t++) {
    s.command({ type: 'aim', angle: Math.atan2(b.y - a.y, b.x - a.x) });
    s.step();
    for (const e of s.events) if (e.type === 'fired' && e.unit === a.id) spreads.push(e.spread);
  }
  assert(spreads.length >= 3, 'duel produced shots (' + spreads.length + ')');
  assert(spreads[0] > 0 && spreads[spreads.length - 1] < spreads[0] * 0.5,
    'spread tightens as lock builds (' + spreads[0].toFixed(3) + ' -> ' + spreads[spreads.length - 1].toFixed(3) + ')');
  assert(spreads[spreads.length - 1] === 0 || spreads[spreads.length - 1] < 0.01, 'full lock -> (near) zero spread');
}

// --- 5a. Arc-entry lock: entry quality frozen, improvement capped, buys aim + rate.
{
  console.log('\n[arc-entry lock]');
  // A held heavy facing +x; one foe parked dead centre of the arc, one at the edge.
  function entry(offsetFrac) {
    const s = duel([{ cls: 'fighter', team: PLAYER }, { cls: 'heavy', team: ENEMY }],
      { lockTimeFull: 1.0 });
    const [a, b] = s.units;
    s.command({ type: 'grab', unit: a.id });
    s.command({ type: 'aim', angle: 0 });
    a.x = 0; a.y = 0; a.heading = 0; a.gunAngle = 0;
    const ang = CLASSES.fighter.coneHalf * offsetFrac;
    b.x = Math.cos(ang) * 150; b.y = Math.sin(ang) * 150; b.heading = ang; // flying straight away inside the arc
    s.step();
    const start = a.lockQ, cap = a.lockCap;
    let peak = 0;
    for (let i = 0; i < 90; i++) {
      s.command({ type: 'aim', angle: 0 });
      // keep the target pinned at its entry bearing so it stays in the arc
      b.x = a.x + Math.cos(ang) * 150; b.y = a.y + Math.sin(ang) * 150;
      s.step();
      peak = Math.max(peak, a.lockQ);
    }
    return { entryQ: a.entryQ, start: start, cap: cap, peak: peak };
  }
  const centre = entry(0.0), edge = entry(0.92);
  assert(centre.entryQ > 0.95 && edge.entryQ < 0.15, 'entry quality frozen at entry: centre ' + centre.entryQ.toFixed(2) + ', edge ' + edge.entryQ.toFixed(2));
  assert(centre.start < centre.peak, 'lock improves while held in the arc (' + centre.start.toFixed(2) + ' -> ' + centre.peak.toFixed(2) + ')');
  assert(Math.abs(centre.peak - 1) < 1e-9, 'centre entry can reach full lock');
  assert(edge.peak <= edge.cap + 1e-9 && edge.peak < 0.45, 'edge entry is capped low (peak ' + edge.peak.toFixed(2) + ')');

  // Fire rate climbs with lock: shot intervals shrink as the lock builds.
  {
    const s = duel([{ cls: 'fighter', team: PLAYER }, { cls: 'heavy', team: ENEMY }], { autoFireFloor: 0 });
    const [a, b] = s.units;
    s.command({ type: 'grab', unit: a.id });
    a.x = 0; a.y = 0; a.heading = 0; a.gunAngle = 0; a.energy = 1e6;
    const ticks = [];
    for (let i = 0; i < 300; i++) {
      s.command({ type: 'aim', angle: 0 });
      b.x = a.x + 150; b.y = a.y; b.energy = 1e6;
      s.step();
      for (const e of s.events) if (e.type === 'fired' && e.unit === a.id) ticks.push(s.tick);
    }
    const first = ticks[1] - ticks[0], last = ticks[ticks.length - 1] - ticks[ticks.length - 2];
    assert(last < first, 'reload shortens as lock builds (' + first + ' -> ' + last + ' ticks between shots)');
  }

  // Leading: against a crossing target, a full lock aims ahead of it, zero lock aims at it.
  {
    function shotAngle(lockQ) {
      const s = duel([{ cls: 'capital', team: PLAYER }, { cls: 'fighter', team: ENEMY }], { lockSpreadMax: 0 });
      const [a, b] = s.units;
      a.x = 0; a.y = 0; a.heading = Math.PI / 2; a.gunAngle = 0;
      b.x = 200; b.y = 0; b.heading = Math.PI / 2; // crossing upward
      s.step(); // acquire
      a.lockCap = 1; a.lockQ = lockQ; a.cooldown = 0; a.gunAngle = 0;
      a.energy = CLASSES.capital.energyMax;
      for (let i = 0; i < 40; i++) {
        if (lockQ === 0) { a.lockQ = 0; a.lockCap = 0; }
        s.step();
        for (const e of s.events) if (e.type === 'fired' && e.unit === a.id) return a.gunAngle;
      }
      return null;
    }
    const zero = shotAngle(0), full = shotAngle(1);
    assert(zero !== null && full !== null && full > zero + 0.05, 'full lock leads the target (' + (zero || 0).toFixed(3) + ' vs ' + (full || 0).toFixed(3) + ' rad)');
  }
}

// --- 5d. Torpedo bomber: slow shots that wreck capitals. -----------------------
{
  console.log('\n[torpedo bomber]');
  assert(CLASSES.torpedo.projSpeed < Math.min(...Object.keys(CLASSES).filter(k => k !== 'torpedo').map(k => CLASSES[k].projSpeed)),
    'torpedo has the slowest shots in the fleet');
  function hit(targetCls) {
    const s = duel([{ cls: 'torpedo', team: PLAYER }, { cls: targetCls, team: ENEMY }]);
    const v = s.units[1];
    v.x = 0; v.y = 0; v.heading = 0;
    for (const w of v.weak) w.out = true; // keep weak points out of the comparison
    const e0 = v.energy;
    s._detonate({ active: true, x: 0, y: 0, damage: 22, aoe: 28, team: PLAYER, owner: 0, vsCap: CLASSES.torpedo.vsCapital });
    return e0 - v.energy;
  }
  const vsCap = hit('capital'), vsHeavy = hit('heavy');
  assert(vsCap >= vsHeavy * 2.9, 'torpedo does ~3x to capitals (' + vsCap.toFixed(1) + ' vs ' + vsHeavy.toFixed(1) + ' on a heavy)');
  // Enemy torpedo AI goes for the capital even when a small ship is closer.
  const s = duel([{ cls: 'fighter', team: PLAYER }, { cls: 'capital', team: PLAYER }, { cls: 'torpedo', team: ENEMY }]);
  const [f, cap, tb] = s.units;
  tb.x = 0; tb.y = 0; tb.heading = Math.PI / 2;
  f.x = 0; f.y = -150; cap.x = 0; cap.y = 400;
  for (let i = 0; i < 20; i++) s.step();
  assert(tb.heading > 0, 'enemy torpedo bomber turns toward the capital, not the nearer fighter');
}

// --- 5b. Only capitals have turrets. ----------------------------------------
{
  console.log('\n[turrets: capitals only]');
  const s = duel([{ cls: 'fighter', team: PLAYER }, { cls: 'capital', team: PLAYER },
                  { cls: 'fighter', team: ENEMY }]);
  const [f, cap, foe] = s.units;
  f.x = 0; f.y = 0; f.heading = 0; f.gunAngle = 0;
  cap.x = 0; cap.y = 200; cap.heading = 0; cap.gunAngle = 0;
  foe.x = 0; foe.y = 100; // abeam of both: off the fighter's nose, inside capital turret range
  let fighterGunOff = 0;
  for (let t = 0; t < 45; t++) {
    s.step();
    fighterGunOff = Math.max(fighterGunOff, Math.abs(f.gunAngle - f.heading));
  }
  assert(fighterGunOff === 0, 'fighter gun never leaves the hull heading (fixed forward guns)');
  assert(Math.abs(cap.gunAngle - cap.heading) > 0.3, 'capital turret swings off the hull toward a target');
  for (const k in CLASSES) {
    assert(CLASSES[k].turret === (k === 'capital'), k + (k === 'capital' ? ' has a turret' : ' has no turret'));
  }
}

// --- 5c. Capital weak points. -----------------------------------------------
{
  console.log('\n[capital weak points]');
  function blastAt(localX, localY) {
    const s = duel([{ cls: 'fighter', team: PLAYER }, { cls: 'capital', team: ENEMY }]);
    const cap = s.units[1];
    cap.x = 0; cap.y = 0; cap.heading = 0.7; // rotated hull: weak points must ride with it
    const ur = s.T.unitRadius * CLASSES.capital.size;
    const c = Math.cos(cap.heading), sn = Math.sin(cap.heading);
    const bx = (localX * c - localY * sn) * ur, by = (localX * sn + localY * c) * ur;
    const e0 = cap.energy;
    s._detonate({ active: true, x: bx, y: by, damage: 10, aoe: 20, team: PLAYER, owner: 0 });
    return { s: s, cap: cap, dmg: e0 - cap.energy };
  }
  const plain = blastAt(0.0, 0.0);   // mid-hull, clear of every weak point
  const engine = blastAt(-1.0, 0.0); // right on the engines
  assert(engine.dmg > plain.dmg * 2, 'weak-point hit does crit damage (' + engine.dmg.toFixed(1) + ' vs ' + plain.dmg.toFixed(1) + ')');
  assert(engine.cap.weak.find(w => w.type === 'engine').hp < engine.s.T.weakHp, 'hit wears the weak point down');

  // Knock each one out and check its consequence.
  const s = duel([{ cls: 'fighter', team: PLAYER }, { cls: 'capital', team: ENEMY }]);
  const cap = s.units[1];
  cap.x = 0; cap.y = 0;
  for (const w of cap.weak) { w.hp = 0; w.out = true; }
  const e0 = cap.energy;
  const x0 = cap.x, y0 = cap.y;
  s.step();
  assert(cap.energy < e0, 'breached vents bleed energy');
  const moved = Math.hypot(cap.x - x0, cap.y - y0);
  assert(Math.abs(moved - CLASSES.capital.speed * s.T.engineCripple / TICK_RATE) < 0.01, 'engines out -> crippled speed');
  const before = cap.gunAngle;
  const f = s.units[0]; f.x = cap.x + 100; f.y = cap.y + 100;
  for (let t = 0; t < 30; t++) s.step();
  assert(cap.gunAngle === before && s.poolStats.fired === 0, 'bridge out -> turret stops tracking and firing');
}

// --- 6. Dodge: straight line, big energy cost, turn lockout after. ----------
{
  console.log('\n[dodge]');
  const s = duel([{ cls: 'fighter', team: PLAYER }]);
  const u = s.units[0];
  const e0 = u.energy;
  s.command({ type: 'grab', unit: 0 });
  s.command({ type: 'aim', angle: 0 });
  s.step();
  s.command({ type: 'dodge' });
  s.step();
  assert(u.energy === e0 - s.T.dodgeCost, 'dodge costs exactly dodgeCost energy');
  // During the roll: heading must not change even if we aim elsewhere.
  s.command({ type: 'aim', angle: Math.PI / 2 });
  const h0 = u.heading;
  for (let t = 0; t < Math.floor(s.T.dodgeDurSec * TICK_RATE) - 2; t++) s.step();
  assert(u.heading === h0, 'roll is a dead-straight line (aim ignored mid-roll)');
  // After the roll: lockout — still can't turn.
  for (let t = 0; t < 3; t++) s.step();
  assert(u.lockoutTimer > 0, 'turn lockout engaged after the roll');
  const h1 = u.heading;
  s.step(); s.step();
  assert(u.heading === h1, 'aim still ignored during lockout (readable/interceptable)');
  // Lockout expires -> control returns.
  for (let t = 0; t < Math.ceil(s.T.dodgeLockoutSec * TICK_RATE); t++) s.step();
  assert(Math.abs(u.heading - h1) > 0.01, 'control returns after lockout');
}

// --- 7. GATE: neglect visibly costs. ----------------------------------------
// Same battle, two pilots: nobody home vs. a bot that juggles + flings ships
// away from the nearest threat. Neglect must lose harder and faster.
function battle(seed, useBot, ticks) {
  const sim = new Sim(seed);
  const botRng = mulberry32(seed ^ 0xF00D);
  let shipSeconds = 0;
  for (let t = 0; t < ticks; t++) {
    if (useBot && t % Math.round(1.5 * TICK_RATE) === 0 && sim.aliveCount(PLAYER) > 0) {
      let worst = null;
      for (const u of sim.units) {
        if (u.team !== PLAYER || u.state !== 'alive') continue;
        if (!worst || u.momentum < worst.momentum) worst = u;
      }
      if (worst) {
        sim.command({ type: 'grab', unit: worst.id });
        // Fling away from the nearest enemy, jittered.
        let foe = null, fd = Infinity;
        for (const v of sim.units) {
          if (v.team !== ENEMY || v.state !== 'alive') continue;
          const d = Math.hypot(v.x - worst.x, v.y - worst.y);
          if (d < fd) { fd = d; foe = v; }
        }
        const away = foe ? Math.atan2(worst.y - foe.y, worst.x - foe.x) : Math.atan2(-worst.y, -worst.x);
        sim.command({ type: 'aim', angle: away + (botRng() - 0.5) * 0.8 });
        sim.command({ type: 'release' });
      }
    }
    sim.step();
    shipSeconds += sim.aliveCount(PLAYER) / TICK_RATE;
  }
  return { alive: sim.aliveCount(PLAYER), foesLeft: sim.aliveCount(ENEMY), shipSeconds: shipSeconds, energy: sim.teamEnergy(PLAYER) };
}
{
  console.log('\n[GATE: neglect visibly costs]  (6v6 incl. capitals + torpedo bombers, 2700 ticks = 90s)');
  const neglect = battle(SEED, false, 2700);
  const juggled = battle(SEED, true, 2700);
  console.log('    neglected: alive ' + neglect.alive + '/6, foes left ' + neglect.foesLeft + ', ship-seconds ' + neglect.shipSeconds.toFixed(0));
  console.log('    juggled:   alive ' + juggled.alive + '/6, foes left ' + juggled.foesLeft + ', ship-seconds ' + juggled.shipSeconds.toFixed(0));
  assert(juggled.alive > neglect.alive, 'juggling keeps more ships alive than neglect');
  assert(juggled.shipSeconds > neglect.shipSeconds * 1.3, 'juggling buys >30% more ship-seconds');
  assert(neglect.alive === 0 || neglect.foesLeft > juggled.foesLeft, 'neglected team also loses the damage race');
}

// --- 8. Pool + soak. --------------------------------------------------------
{
  console.log('\n[pool + soak]');
  const a = new Sim(SEED), b = new Sim(SEED);
  for (let t = 0; t < 50000; t++) { a.step(); b.step(); }
  assert(a.stateHash() === b.stateHash(), '50k-tick combat soak: hashes identical');
  assert(a.poolStats.dropped === 0, 'projectile pool never exhausted (' + a.poolStats.fired + ' fired, 0 dropped)');
  let leaked = 0;
  for (const p of a.projectiles) if (p.active) leaked++;
  assert(leaked <= 8, 'no projectile leak after battle ends (' + leaked + ' in flight)');
}

console.log('\n' + (failures === 0 ? 'ALL TESTS PASSED' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
