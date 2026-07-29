// Headless verification for prototype 05 (dropship / battery vessel / harvest /
// extraction). Run: node test.js
'use strict';
const { Sim, CLASSES, PLAYER, ENEMY } = require('./sim.js');

let failures = 0;
function assert(cond, label) {
  if (cond) console.log('  PASS  ' + label);
  else { failures++; console.error('  FAIL  ' + label); }
}

const SEED = 5150;
const TICK_RATE = 30;
const QUIET = { driftNoise: 0, momentumDrain: 0 }; // combat ships behave; focus on economy

function collect(sim, ticks, types) {
  const got = [];
  for (let t = 0; t < ticks; t++) {
    sim.step();
    for (const e of sim.events) if (!types || types.includes(e.type)) got.push(e);
  }
  return got;
}

// --- 1. Determinism with the full economy running. --------------------------
{
  console.log('\n[determinism]');
  const a = new Sim(SEED), b = new Sim(SEED), c = new Sim(SEED + 1);
  for (let t = 0; t < 5000; t++) { a.step(); b.step(); c.step(); }
  assert(a.stateHash() === b.stateHash(), 'same seed -> identical hash after 5000 ticks');
  assert(a.stateHash() !== c.stateHash(), 'different seed -> different timeline');
}

// --- 2. The harvester mines and deposits, autonomously. ---------------------
{
  console.log('\n[harvest loop]');
  const s = new Sim(SEED, Object.assign({}, QUIET), [
    { cls: 'dropship', team: PLAYER }, { cls: 'harvester', team: PLAYER },
  ]);
  const ev = collect(s, 5400, ['harvested', 'deposited']); // 3 minutes, zero commands
  const drop = s.units[0];
  const mined = ev.filter(e => e.type === 'harvested').length;
  const deposited = ev.filter(e => e.type === 'deposited').length;
  console.log('    ' + mined + ' crystals cracked, ' + deposited + ' deposits, hold ' + drop.cargoMass.toFixed(2) + ' mass');
  assert(mined > 0, 'harvester cracks crystals with zero input');
  assert(deposited > 0 && drop.cargoMass > 0, 'cargo actually reaches the dropship hold');
  assert(s.units[1].state === 'alive', 'harvester survives its own crystal work (avoidance exemption is safe)');
}

// --- 3. Battery vessel: siphon, share, conservation. ------------------------
{
  console.log('\n[battery vessel]');
  const s = new Sim(SEED, Object.assign({ hazardCount: 0 }, QUIET), [
    { cls: 'battery', team: PLAYER }, { cls: 'fighter', team: ENEMY },
  ]);
  const [bat, foe] = s.units;
  // Pin the vessel inside the enemy's shield: keep teleporting it alongside
  // (the enemy flies; the vessel "sits inside" by matching position each tick).
  let siphoned = 0;
  const foeStart = foe.energy;
  for (let t = 0; t < 90; t++) {
    bat.x = foe.x + 30; bat.y = foe.y; // inside batDrainRadius 70
    s.step();
  }
  siphoned = bat.store;
  assert(siphoned > 0, 'sitting inside an enemy shield siphons energy into the store (' + siphoned.toFixed(1) + ')');
  assert(Math.abs((foeStart - foe.energy) - siphoned) < 1.5,
    'conservation: enemy losses ~= store gains (drains ships, creates nothing)');
  const cap = s.T.batCapacityMax * s.T.batCapacityStart;
  assert(siphoned <= cap + 1e-9, 'store respects the 20%-of-max starting capacity (' + cap + ')');

  // Share: hurt friendly nearby drinks from the store.
  const s2 = new Sim(SEED, Object.assign({ hazardCount: 0 }, QUIET), [
    { cls: 'battery', team: PLAYER }, { cls: 'fighter', team: PLAYER },
  ]);
  const [bat2, friend] = s2.units;
  bat2.store = 40; friend.energy = 30;
  let shared = false;
  for (let t = 0; t < 60; t++) {
    bat2.x = friend.x + 40; bat2.y = friend.y; // inside batShareRadius
    s2.step();
    if (friend.energy > 30 && bat2.store < 40) shared = true;
  }
  assert(shared, 'store flows to hurt friendlies in share range');
}

// --- 4. Detonation: damage scales with charge, leaves rich salvage. ---------
{
  console.log('\n[detonation]');
  function boom(charge) {
    const s = new Sim(SEED, Object.assign({ hazardCount: 0 }, QUIET), [
      { cls: 'battery', team: PLAYER }, { cls: 'heavy', team: ENEMY },
    ]);
    const [bat, foe] = s.units;
    bat.store = charge;
    foe.x = bat.x + 60; foe.y = bat.y; // inside detonate radius
    s.command({ type: 'grab', unit: 0 });
    s.step();
    s.command({ type: 'detonate' });
    s.step();
    return { foeEnergy: s.units[1].energy, batState: s.units[0].state, sim: s };
  }
  const small = boom(20), big = boom(60);
  assert(big.foeEnergy < small.foeEnergy, 'damage scales with stored charge (' +
    (CLASSES.heavy.energyMax - small.foeEnergy).toFixed(1) + ' vs ' + (CLASSES.heavy.energyMax - big.foeEnergy).toFixed(1) + ')');
  assert(big.batState !== 'alive', 'the vessel dies in the blast');
  let rich = false;
  const s3 = big.sim;
  for (let t = 0; t < 60; t++) s3.step();
  for (const h of s3.hazards) if (h.salvage && h.rich === 2) rich = true;
  assert(rich, 'detonated vessel crystallizes into rich (5x) salvage');
}

// --- 5. The mission clock: idle too long and everything strands. ------------
{
  console.log('\n[mission clock]');
  const s = new Sim(SEED, Object.assign({ hazardCount: 0 }, QUIET), [
    { cls: 'dropship', team: PLAYER }, { cls: 'fighter', team: PLAYER },
  ]);
  const drop = s.units[0], escort = s.units[1];
  escort.energy = 40; // hurt: the dropship will heal it out of the clock
  let healed = false, strandTick = -1;
  for (let t = 0; t < TICK_RATE * 800 && strandTick < 0; t++) {
    s.step();
    if (escort.energy > 40) healed = true;
    for (const e of s.events) if (e.type === 'stranded') strandTick = s.tick;
  }
  assert(healed, 'dropship resupplies hurt friendlies out of its battery');
  assert(strandTick > 0, 'battery eventually empties -> stranded -> crystallizes (~' + (strandTick / TICK_RATE).toFixed(0) + 's)');
}

// --- 6. GATE: extraction is a gamble, not a win button. ---------------------
{
  console.log('\n[GATE: extraction gamble]');
  // (a) Heavier is strictly slower to climb.
  function climbTicks(cargo) {
    const s = new Sim(SEED, Object.assign({ hazardCount: 0 }, QUIET), [{ cls: 'dropship', team: PLAYER }]);
    s.units[0].cargoMass = cargo;
    s.command({ type: 'launch' });
    for (let t = 0; t < 20000; t++) {
      s.step();
      for (const e of s.events) if (e.type === 'extracted') return t;
    }
    return -1;
  }
  const light = climbTicks(0), mid = climbTicks(8), heavy = climbTicks(20);
  console.log('    climb ticks: empty ' + light + ' · 8 mass ' + mid + ' · 20 mass ' + heavy);
  assert(light > 0 && mid > light && heavy > mid, 'heavier hold -> strictly longer climb');

  // (b) Shootable mid-climb: a heavy hold under fire dies before orbit.
  function contested(cargo) {
    const s = new Sim(SEED, Object.assign({ hazardCount: 0 }, QUIET), [
      { cls: 'dropship', team: PLAYER },
      { cls: 'fighter', team: ENEMY }, { cls: 'fighter', team: ENEMY }, { cls: 'bomber', team: ENEMY },
    ]);
    s.units[0].cargoMass = cargo;
    s.command({ type: 'launch' });
    for (let t = 0; t < 20000; t++) {
      s.step();
      for (const e of s.events) {
        if (e.type === 'extracted') return 'extracted';
        if (e.type === 'crystallizing' && e.unit === 0) return 'shot down';
      }
    }
    return 'timeout';
  }
  const lightRun = contested(0), heavyRun = contested(30);
  console.log('    under fire: empty hold -> ' + lightRun + ' · 30 mass -> ' + heavyRun);
  assert(lightRun === 'extracted', 'light and early: you get out under fire');
  assert(heavyRun === 'shot down', 'greedy and heavy: shot down mid-climb — the gamble is real');

  // (c) Launching without reserve strands you in the air.
  const s = new Sim(SEED, Object.assign({ hazardCount: 0 }, QUIET), [{ cls: 'dropship', team: PLAYER }]);
  s.units[0].cargoMass = 10;
  s.units[0].battery = 60; // climb needs ~19s * 14/s = 266 — nowhere near enough
  s.command({ type: 'launch' });
  let outcome = 'timeout';
  for (let t = 0; t < 4000 && outcome === 'timeout'; t++) {
    s.step();
    for (const e of s.events) {
      if (e.type === 'extracted') outcome = 'extracted';
      if (e.type === 'stranded') outcome = 'stranded mid-climb';
    }
  }
  assert(outcome === 'stranded mid-climb', 'launching under-reserved strands you (' + outcome + ')');
}

// --- 7. Soak. ---------------------------------------------------------------
{
  console.log('\n[soak]');
  const a = new Sim(SEED), b = new Sim(SEED);
  for (let t = 0; t < 50000; t++) { a.step(); b.step(); }
  assert(a.stateHash() === b.stateHash(), '50k-tick full-economy soak: hashes identical');
  assert(a.poolStats.dropped === 0, 'projectile pool holds');
}

console.log('\n' + (failures === 0 ? 'ALL TESTS PASSED' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
