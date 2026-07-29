// Headless verification for prototype 09 (command layer). Run: node test.js
'use strict';
const { Sim, PLAYER, ENEMY, mulberry32 } = require('./sim.js');

let failures = 0;
function assert(cond, label) {
  if (cond) console.log('  PASS  ' + label);
  else { failures++; console.error('  FAIL  ' + label); }
}
const SEED = 909;
const TICK_RATE = 30;

// --- 1. Determinism with orders in flight. ----------------------------------
{
  console.log('\n[determinism]');
  const script = s => {
    if (s.tick === 30) s.command({ type: 'order', group: 0, kind: 'rally', x: -300, y: -200 });
    if (s.tick === 60) s.command({ type: 'order', group: 1, kind: 'attack', x: 200, y: 0 });
  };
  const a = new Sim(SEED), b = new Sim(SEED);
  for (let t = 0; t < 5000; t++) { script(a); a.step(); script(b); b.step(); }
  assert(a.stateHash() === b.stateHash(), 'same seed + same orders -> identical hash after 5000 ticks');
}

// --- 2. Rally moves the group — and only that group. ------------------------
{
  console.log('\n[rally]');
  const s = new Sim(SEED, { hazardCount: 0, momentumDrain: 0, driftNoise: 0, orderTtlSec: 60 });
  const P = { x: -350, y: -250 };
  s.command({ type: 'order', group: 0, kind: 'rally', x: P.x, y: P.y });
  for (let t = 0; t < 400; t++) s.step();
  const g0 = s.units.filter(u => u.team === PLAYER && u.group === 0);
  const g1 = s.units.filter(u => u.team === PLAYER && u.group === 1);
  const near = u => Math.hypot(u.x - P.x, u.y - P.y);
  assert(g0.every(u => near(u) < 160), 'group 0 loiters at the rally point (' + g0.map(u => near(u).toFixed(0)).join(',') + ')');
  assert(g1.every(u => near(u) > 200), 'other groups ignored the order');
  assert(g0.every(u => u.momentum === 1), 'hired pilots freeze the juggle clock while the order lives');
}

// --- 3. Orders expire and hand the group back to the juggle. ----------------
{
  console.log('\n[expiry]');
  const s = new Sim(SEED, { hazardCount: 0, orderTtlSec: 3 });
  s.command({ type: 'order', group: 0, kind: 'rally', x: 0, y: 0 });
  let expired = false;
  for (let t = 0; t < 5 * TICK_RATE; t++) {
    s.step();
    for (const e of s.events) if (e.type === 'order-expired' && e.group === 0) expired = true;
  }
  assert(expired, 'order expires on TTL');
  const g0 = s.units.filter(u => u.team === PLAYER && u.group === 0 && u.state === 'alive');
  assert(g0.length > 0 && g0.every(u => u.momentum < 1), 'after expiry the group drains again — attention debt resumes');
}

// --- 4. GATE proxy: commanding is another way to juggle, not a fire-and-forget. --
function battle(seed, mode, ticks) {
  const sim = new Sim(seed);
  const rng = mulberry32(seed ^ 0xC0DE);
  let shipSeconds = 0;
  for (let t = 0; t < ticks; t++) {
    if (mode !== 'neglect' && t % Math.round(3 * TICK_RATE) === 0) {
      // Commander bot: focus fire — every group onto the foe nearest our centroid.
      let cx = 0, cy = 0, n = 0;
      for (const u of sim.units) if (u.team === PLAYER && u.state === 'alive') { cx += u.x; cy += u.y; n++; }
      if (n) { cx /= n; cy /= n; }
      let foe = null, fd = Infinity;
      for (const v of sim.units) {
        if (v.team !== ENEMY || v.state !== 'alive') continue;
        const d = Math.hypot(v.x - cx, v.y - cy);
        if (d < fd) { fd = d; foe = v; }
      }
      for (let g = 0; g < sim.orders.length; g++) {
        if (foe) sim.command({ type: 'order', group: g, kind: 'attack', x: foe.x, y: foe.y });
        else sim.command({ type: 'order', group: g, kind: 'rally', x: cx, y: cy });
      }
    }
    if (mode === 'command+juggle' && t % Math.round(2 * TICK_RATE) === 0) {
      // Also grab the single worst un-ordered ship and fling it home.
      let worst = null;
      for (const u of sim.units) {
        if (u.team !== PLAYER || u.state !== 'alive') continue;
        if (u.group >= 0 && sim.orders[u.group]) continue;
        if (!worst || u.momentum < worst.momentum) worst = u;
      }
      if (worst) {
        sim.command({ type: 'grab', unit: worst.id });
        sim.command({ type: 'aim', angle: Math.atan2(-worst.y, -worst.x) + (rng() - 0.5) * 0.6 });
        sim.command({ type: 'release' });
      }
    }
    sim.step();
    shipSeconds += sim.aliveCount(PLAYER) / TICK_RATE;
  }
  return { alive: sim.aliveCount(PLAYER), foes: sim.aliveCount(ENEMY), shipSeconds: shipSeconds };
}
{
  console.log('\n[GATE: commanding still a juggle]  (6v6, 90s)');
  const neglect = battle(SEED, 'neglect', 2700);
  const orders = battle(SEED, 'command-only', 2700);
  const both = battle(SEED, 'command+juggle', 2700);
  console.log('    neglect:        alive ' + neglect.alive + '/6, foes ' + neglect.foes + ', ship-sec ' + neglect.shipSeconds.toFixed(0));
  console.log('    orders only:    alive ' + orders.alive + '/6, foes ' + orders.foes + ', ship-sec ' + orders.shipSeconds.toFixed(0));
  console.log('    orders+juggle:  alive ' + both.alive + '/6, foes ' + both.foes + ', ship-sec ' + both.shipSeconds.toFixed(0));
  assert(orders.shipSeconds > neglect.shipSeconds * 1.3, 'commanding alone visibly beats neglect');
  assert(both.shipSeconds >= orders.shipSeconds * 0.95, 'hands-on juggling composes with orders (no regression)');
  assert(orders.alive < 6 || orders.foes > 0, 'orders alone are not a win button — attention still finite');
}

// --- 5. Soak. ---------------------------------------------------------------
{
  console.log('\n[soak]');
  const a = new Sim(SEED), b = new Sim(SEED);
  for (let t = 0; t < 50000; t++) {
    if (t % 200 === 0) { a.command({ type: 'order', group: t % 3, kind: 'rally', x: 0, y: 0 }); b.command({ type: 'order', group: t % 3, kind: 'rally', x: 0, y: 0 }); }
    a.step(); b.step();
  }
  assert(a.stateHash() === b.stateHash(), '50k-tick ordered soak: hashes identical');
}

console.log('\n' + (failures === 0 ? 'ALL TESTS PASSED' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
