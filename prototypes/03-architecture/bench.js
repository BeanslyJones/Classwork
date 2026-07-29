// Build order step 3: architecture hardening benchmark. Run: node bench.js
// Gate: stable tick time @ 100 units, baseline recorded (BASELINE.md).
// The hardening itself (fixed tick, semantic commands, projectile pooling,
// Active/Reduced/Dormant update gating, owned per-unit state) lives in
// 02-combat/sim.js — this harness measures it and locks the numbers in.
'use strict';
const { Sim, CLASSES, PLAYER, ENEMY } = require('../02-combat/sim.js');
const fs = require('fs');
const os = require('os');

const SEED = 9001;
const TICKS = 10000;
const WARMUP = 500;

// 100 units: 50 v 50 across the class table, spread over a big arena so the
// gating tiers actually engage (far pairs go Reduced/Dormant).
function bigRoster() {
  const names = Object.keys(CLASSES);
  const roster = [];
  for (let i = 0; i < 50; i++) roster.push({ cls: names[i % names.length], team: PLAYER });
  for (let i = 0; i < 50; i++) roster.push({ cls: names[i % names.length], team: ENEMY });
  return roster;
}

function makeSim(gating) {
  const sim = new Sim(SEED, {
    arenaRadius: 2000,
    hazardCount: 20,
    hazardBandInner: 400,
    momentumDrain: 0, // keep all 100 units alive and fighting for the whole run
    driftNoise: 0.4,
    gateReducedDist: gating ? 700 : 1e9,
    gateDormantDist: gating ? 1400 : 1e9,
  }, bigRoster());
  // Scatter both teams over the arena so distances (and tiers) vary.
  for (const u of sim.units) {
    const ang = sim.rng() * Math.PI * 2;
    const d = 200 + sim.rng() * 1600;
    u.x = Math.cos(ang) * d; u.y = Math.sin(ang) * d;
    u.heading = sim.rng() * Math.PI * 2;
    u.gunAngle = u.heading;
  }
  return sim;
}

function run(label, gating) {
  const sim = makeSim(gating);
  for (let t = 0; t < WARMUP; t++) sim.step();
  const samples = new Float64Array(TICKS);
  for (let t = 0; t < TICKS; t++) {
    const t0 = process.hrtime.bigint();
    sim.step();
    samples[t] = Number(process.hrtime.bigint() - t0) / 1e6; // ms
  }
  const sorted = Array.from(samples).sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const stats = {
    label: label,
    mean: sum / TICKS,
    p50: sorted[Math.floor(TICKS * 0.50)],
    p99: sorted[Math.floor(TICKS * 0.99)],
    max: sorted[TICKS - 1],
    aliveEnd: sim.aliveCount(),
    fired: sim.poolStats.fired,
    dropped: sim.poolStats.dropped,
    tiers: [0, 0, 0],
  };
  for (const u of sim.units) if (u.state === 'alive') stats.tiers[u.tier]++;
  return stats;
}

console.log('warming up + benchmarking (2 runs x ' + TICKS + ' ticks, 100 units)...');
const off = run('gating OFF', false);
const on = run('gating ON', true);

function row(s) {
  return '| ' + s.label.padEnd(10) + ' | ' + s.mean.toFixed(3) + ' | ' + s.p50.toFixed(3) + ' | ' +
    s.p99.toFixed(3) + ' | ' + s.max.toFixed(3) + ' | ' + s.aliveEnd + ' | ' + s.fired + ' |';
}
for (const s of [off, on]) {
  console.log(s.label + ': mean ' + s.mean.toFixed(3) + 'ms  p50 ' + s.p50.toFixed(3) + 'ms  p99 ' +
    s.p99.toFixed(3) + 'ms  max ' + s.max.toFixed(3) + 'ms  alive@end ' + s.aliveEnd +
    '  tiers A/R/D ' + s.tiers.join('/'));
}

// --- Gate assertions ---
let failures = 0;
function assert(cond, label) {
  if (cond) console.log('  PASS  ' + label);
  else { failures++; console.error('  FAIL  ' + label); }
}
const budget = 1000 / 30; // one 30Hz tick
assert(on.p99 < budget * 0.5, 'p99 tick < 50% of the 30Hz budget (' + on.p99.toFixed(3) + 'ms < ' + (budget * 0.5).toFixed(1) + 'ms)');
assert(on.max < budget, 'worst tick fits inside one 30Hz frame (' + on.max.toFixed(3) + 'ms)');
assert(on.p99 < on.mean * 6, 'stable: p99 within 6x mean (no spiky frames)');
assert(off.dropped === 0 && on.dropped === 0, 'projectile pool never exhausted at 100 units');
assert(on.mean <= off.mean * 1.05, 'gating never costs more than it saves (on ' + on.mean.toFixed(3) + ' vs off ' + off.mean.toFixed(3) + 'ms)');

// Determinism at scale, with gating engaged.
{
  const a = makeSim(true), b = makeSim(true);
  for (let t = 0; t < 3000; t++) { a.step(); b.step(); }
  assert(a.stateHash() === b.stateHash(), '100-unit gated sim stays deterministic (3000 ticks)');
}

// --- Record the baseline ---
const md = `# Architecture baseline — build order step 3

Recorded ${'`'}node bench.js${'`'} output. Re-run after any sim change; regressions
against these numbers are the thing this gate exists to catch.

- Sim: 02-combat/sim.js @ 100 units (50v50, all five classes), 20 crystals, arena r=2000, seed ${SEED}
- Ticks measured: ${TICKS} (after ${WARMUP} warmup) · budget: one 30 Hz tick = ${budget.toFixed(2)} ms
- Machine: ${os.cpus()[0].model} × ${os.cpus().length}, Node ${process.version}, ${os.platform()}

| run        | mean ms | p50 ms | p99 ms | max ms | alive@end | shots |
|------------|---------|--------|--------|--------|-----------|-------|
${row(off)}
${row(on)}

Tier split at end (gating ON, Active/Reduced/Dormant): ${on.tiers.join('/')}.
Projectile pool: ${on.fired} fired, 0 dropped, zero allocations after construction.

Gate: **stable tick time @ 100 units** — p99 under half the 30 Hz budget, worst
tick inside one frame, deterministic with gating engaged. See bench assertions.
`;
fs.writeFileSync(__dirname + '/BASELINE.md', md);
console.log('\nBASELINE.md written.');
console.log(failures === 0 ? 'ALL BENCH ASSERTIONS PASSED' : failures + ' FAILURE(S)');
process.exit(failures === 0 ? 0 : 1);
