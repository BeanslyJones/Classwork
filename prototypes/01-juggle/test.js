// Headless verification for prototype 01 (the juggle). Run: node test.js
// Exit 0 = all assertions hold. Also prints the tension sweep used to judge gate 1.
'use strict';
const { Sim, mulberry32 } = require('./sim.js');

let failures = 0;
function assert(cond, label) {
  if (cond) console.log('  PASS  ' + label);
  else { failures++; console.error('  FAIL  ' + label); }
}

const SEED = 1337;
const TICK_RATE = 30;

// --- 1. Determinism: same seed = same timeline, everywhere. -----------------
{
  console.log('\n[determinism]');
  const a = new Sim(SEED), b = new Sim(SEED), c = new Sim(SEED + 1);
  // Identical semantic command scripts on a and b.
  const script = function (sim, t) {
    if (t === 60) sim.command({ type: 'grab', unit: 2 });
    if (t === 75) sim.command({ type: 'aim', angle: 1.1 });
    if (t === 90) sim.command({ type: 'release' });
  };
  for (let t = 0; t < 5000; t++) { script(a, t); a.step(); script(b, t); b.step(); c.step(); }
  assert(a.stateHash() === b.stateHash(), 'same seed + same commands -> identical hash after 5000 ticks');
  assert(a.stateHash() !== c.stateHash(), 'different seed -> different timeline');
}

// --- 2. Neglect: no input means every ship stalls and crystallizes. ---------
{
  console.log('\n[neglect]');
  const sim = new Sim(SEED);
  let firstDeathTick = -1;
  for (let t = 0; t < 3600 && sim.aliveCount() > 0; t++) {
    sim.step();
    if (firstDeathTick < 0 && sim.aliveCount() < 4) firstDeathTick = sim.tick;
  }
  assert(sim.aliveCount() === 0, 'all 4 ships dead with zero input (within 120s)');
  // Early losses must come from the decay spiral (wobble + weakening dodge),
  // never from spawn-adjacent instant contact. 5s is the floor for that.
  assert(firstDeathTick > 5 * TICK_RATE && firstDeathTick < 60 * TICK_RATE,
    'first loss lands between 5s and 60s — decay spiral, not spawn kill (was ~' + (firstDeathTick / TICK_RATE).toFixed(1) + 's)');
  assert(sim.hazards.some(h => h.salvage), 'crystallized ships became salvage hazards');
}

// --- 3. Stall rescue: a grab inside the grace window saves the ship. --------
{
  console.log('\n[stall rescue]');
  const sim = new Sim(SEED);
  // Let ships drain to stall, then rescue unit 0 mid-grace.
  let rescued = false;
  for (let t = 0; t < 3600; t++) {
    const u = sim.units[0];
    if (!rescued && u.state === 'alive' && u.momentum <= 0 && u.stallTimer > 0.5) {
      sim.command({ type: 'grab', unit: 0 });
      sim.command({ type: 'aim', angle: Math.atan2(-u.y, -u.x) }); // fling back toward center
      sim.step();
      sim.command({ type: 'release' });
      sim.step();
      rescued = true;
      assert(u.momentum > 0.99 && u.state === 'alive' && u.stallTimer === 0,
        'grab+release during stall grace restores full momentum');
      break;
    }
    sim.step();
  }
  assert(rescued, 'a stall actually occurred to rescue (drain clock works)');
}

// --- 4. The juggle sustains: a bot that services ships keeps them alive. ----
// Bot: every `interval` seconds, grab the worst-off ship, aim through the safe
// inner disc, release. Bot has its OWN rng — the sim stream is never touched.
function runBot(seed, intervalSec, ticks) {
  const sim = new Sim(seed);
  const botRng = mulberry32(seed ^ 0xBEEF);
  const intervalTicks = Math.max(1, Math.round(intervalSec * TICK_RATE));
  let shipSeconds = 0;
  for (let t = 0; t < ticks; t++) {
    if (t % intervalTicks === 0 && sim.aliveCount() > 0) {
      let worst = null;
      for (const u of sim.units) {
        if (u.state !== 'alive') continue;
        if (!worst || u.momentum < worst.momentum) worst = u;
      }
      if (worst) {
        sim.command({ type: 'grab', unit: worst.id });
        // Aim at a jittered point near the center: through the crystal-free disc.
        const jx = (botRng() * 2 - 1) * 60, jy = (botRng() * 2 - 1) * 60;
        sim.command({ type: 'aim', angle: Math.atan2(jy - worst.y, jx - worst.x) });
        sim.command({ type: 'release' });
      }
    }
    sim.step();
    shipSeconds += sim.aliveCount() / TICK_RATE;
  }
  return { alive: sim.aliveCount(), shipSeconds: shipSeconds };
}

{
  console.log('\n[juggle sustains + tension sweep]  (4 ships, 5000 ticks = ~167s)');
  const sweep = [1.5, 3, 5, 8, Infinity];
  const results = sweep.map(iv => ({ interval: iv, r: runBot(SEED, iv === Infinity ? 1e9 : iv, 5000) }));
  for (const { interval, r } of results) {
    const label = interval === Infinity ? 'never ' : (interval + 's').padEnd(6);
    console.log('    service every ' + label + ' -> alive: ' + r.alive + '/4, ship-seconds: ' + r.shipSeconds.toFixed(0));
  }
  const fast = results[0].r, mid = results[2].r, never = results[4].r;
  assert(fast.alive === 4, 'attentive juggle (1.5s service) keeps all 4 alive for ~167s');
  assert(never.alive === 0, 'total neglect loses everything');
  assert(fast.shipSeconds > mid.shipSeconds && mid.shipSeconds > never.shipSeconds,
    'more attention -> strictly more ship-seconds (pressure gradient exists)');
}

// --- 5. Long soak: sim stays stable and deterministic over 100k ticks. ------
{
  console.log('\n[soak]');
  const a = new Sim(SEED), b = new Sim(SEED);
  for (let t = 0; t < 100000; t++) { a.step(); b.step(); }
  assert(a.stateHash() === b.stateHash(), '100k-tick soak: hashes still identical');
  assert(Number.isFinite(a.units[0].x) && Number.isFinite(a.units[0].heading), 'no NaN/Inf after soak');
}

console.log('\n' + (failures === 0 ? 'ALL TESTS PASSED' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
