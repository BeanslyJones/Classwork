// Headless verification for prototype 04 (two touching rad fields). Run: node test.js
'use strict';
const { Sim, RAD, beats } = require('./sim.js');

let failures = 0;
function assert(cond, label) {
  if (cond) console.log('  PASS  ' + label);
  else { failures++; console.error('  FAIL  ' + label); }
}

const SEED = 777;
const TICK_RATE = 30;

// --- 1. The wheel is a cycle. -----------------------------------------------
{
  console.log('\n[wheel]');
  assert(beats('cinder', 'bloom') && beats('bloom', 'brine') && beats('brine', 'halo') && beats('halo', 'cinder'),
    'cinder > bloom > brine > halo > cinder');
  assert(!beats('cinder', 'brine') && !beats('bloom', 'halo'), 'opposite pairs are neutral');
}

// --- 2. Determinism (with drifting fields). ---------------------------------
{
  console.log('\n[determinism]');
  const a = new Sim(SEED, { fieldDriftSpeed: 12 }), b = new Sim(SEED, { fieldDriftSpeed: 12 });
  const c = new Sim(SEED + 1, { fieldDriftSpeed: 12 });
  for (let t = 0; t < 5000; t++) { a.step(); b.step(); c.step(); }
  assert(a.stateHash() === b.stateHash(), 'same seed -> identical hash after 5000 ticks with drift');
  assert(a.stateHash() !== c.stateHash(), 'different seed -> different timeline');
}

// --- 3. Same-color fields merge, allegiance-blind. --------------------------
{
  console.log('\n[same-color merge]');
  const s = new Sim(SEED, {}, [
    { x: -150, y: 0, r: 260, color: 'halo', battery: 60, team: 0 },
    { x: 150, y: 0, r: 260, color: 'halo', battery: 60, team: 1 }, // ENEMY field, same color
  ]);
  const mid = s.zoneAt(0, 0, 0);
  assert(mid.color === 'halo', 'overlap region is one merged halo zone');
  const single = 60 * (1 - 150 / 260);
  assert(Math.abs(mid.influence - 2 * single) < 1e-9, 'influences ADD in the merged region');
  assert(s.zoneAt(0, 0, 0).friendly && s.zoneAt(0, 0, 1).friendly,
    'merged region is friendly to BOTH teams (allegiance-blind)');
  // Deep inside the enemy half: still friendly to team 0, because team 0
  // projects the same color into the merged region... but only where team 0's
  // field actually reaches. Outside its radius, no shelter.
  assert(s.zoneAt(100, 0, 0).friendly, 'shelter extends into the enemy half while own field still reaches (reach = -150+260 = x<110)');
  assert(!s.zoneAt(320, 0, 0).friendly, 'no shelter beyond own field\'s reach, even under the same color');
}

// --- 4. Different colors clash at a battery-weighted seam. ------------------
{
  console.log('\n[battery-weighted seam]');
  function seamT(batteryA, batteryB) {
    const s = new Sim(SEED, {}, [
      { x: -180, y: 0, r: 300, color: 'cinder', battery: batteryA, team: 0 },
      { x: 220, y: 0, r: 300, color: 'brine', battery: batteryB, team: 1 },
    ]);
    const seam = s.seamBetween(0, 1);
    return seam ? seam.t : null;
  }
  const even = seamT(80, 80), strongA = seamT(120, 50), weakA = seamT(50, 120);
  assert(even !== null && Math.abs(even - 0.5) < 0.08, 'equal batteries -> seam near the midpoint (t=' + even.toFixed(3) + ')');
  assert(strongA > even, 'stronger A battery pushes the seam toward B (t=' + strongA.toFixed(3) + ')');
  assert(weakA < even, 'weaker A battery pulls the seam toward A (t=' + weakA.toFixed(3) + ')');
  // Monotonic: draining one battery moves the seam continuously, no jumps.
  let prev = -1, monotonic = true;
  for (let bat = 120; bat >= 40; bat -= 10) {
    const t = seamT(bat, 80);
    if (prev >= 0 && t > prev + 1e-9) monotonic = false;
    prev = t;
  }
  assert(monotonic, 'draining A\'s battery walks the seam steadily toward A');
}

// --- 5. Friendly field: zero loss unless shooting / being shot / maneuvering. --
{
  console.log('\n[friendly-field attrition rules]');
  // Cruise straight through own field: energy must never drop, and must recover.
  const s = new Sim(SEED, {}, undefined, { team: 0, protColor: 'cinder', protLevel: 0.7, x: -300, y: 0, heading: 0.3 });
  s.ship.energy = 60;
  let dropped = false, peak = 60;
  for (let t = 0; t < 60; t++) { // 2s inside the friendly cinder field
    const e0 = s.ship.energy;
    s.step();
    if (s.ship.energy < e0 - 1e-9) dropped = true;
    peak = Math.max(peak, s.ship.energy);
  }
  assert(!dropped, 'cruising in a friendly field never loses energy');
  assert(peak > 60, 'recharge happens (only) here (' + peak.toFixed(1) + ' from 60)');

  // Being shot suspends the zero-loss clause.
  const s2 = new Sim(SEED, {}, undefined, { team: 0, protColor: 'cinder', protLevel: 0.7, x: -300, y: 0, heading: 0.3 });
  s2.command({ type: 'setBeingShot', on: true });
  const e0 = s2.ship.energy;
  for (let t = 0; t < 30; t++) s2.step();
  assert(s2.ship.energy < e0, 'being shot drains even inside the friendly field');

  // Hard maneuvering suspends it too.
  const s3 = new Sim(SEED, {}, undefined, { team: 0, protColor: 'cinder', protLevel: 0.7, x: -300, y: 0, heading: 0 });
  s3.ship.energy = 60;
  s3.command({ type: 'grab', unit: 0 });
  let lost = 0;
  for (let t = 0; t < 90; t++) {
    s3.command({ type: 'aim', angle: (t % 20 < 10) ? 2.5 : -2.5 }); // slalom
    const b = s3.ship.energy;
    s3.step();
    if (s3.ship.energy < b) lost += b - s3.ship.energy;
  }
  assert(lost > 0, 'hard turning counts as maneuvering and costs energy at home (' + lost.toFixed(1) + ' lost)');
}

// --- 6. Outside: drain ordered by the wheel. --------------------------------
{
  console.log('\n[matchup lean]');
  // Park the ship (conceptually) in an enemy bloom zone with each protection
  // color and compare per-second drain readings.
  function drainWith(protColor) {
    const s = new Sim(SEED, {}, [
      { x: 0, y: 0, r: 400, color: 'bloom', battery: 100, team: 1 }, // hostile bloom, huge
    ], { team: 0, protColor: protColor, protLevel: 0.7, x: -100, y: 0, heading: 0 });
    s.step();
    return s.ship.lastDrain;
  }
  const same = drainWith('bloom');     // attuned
  const strong = drainWith('cinder');  // cinder beats bloom
  const neutral = drainWith('halo');   // opposite pair
  const weak = drainWith('brine');     // bloom beats brine
  console.log('    drain/s in hostile bloom: same ' + same.toFixed(2) + ' < strong ' + strong.toFixed(2) +
    ' < neutral ' + neutral.toFixed(2) + ' < weak ' + weak.toFixed(2));
  assert(same < strong && strong < neutral && neutral < weak, 'wheel orders the bleed: attuned < strong < neutral < weak');
}

// --- 7. GATE: a wrong-color zone is a lean, not a wall. ---------------------
{
  console.log('\n[GATE: lean, not wall]');
  // Worst matchup: brine protection crossing a hostile bloom field (bloom beats
  // brine), straight through the center — 800 units of the worst color.
  function crossing() {
    return new Sim(SEED, {}, [
      { x: 0, y: 0, r: 400, color: 'bloom', battery: 100, team: 1 },
    ], { team: 0, protColor: 'brine', protLevel: 0.7, x: -420, y: 0, heading: 0 });
  }
  const s = crossing();
  let out = -1;
  for (let t = 0; t < 3000 && s.ship.state === 'alive'; t++) {
    s.step();
    if (out < 0 && s.ship.x > 420) { out = t; break; }
  }
  const after = s.ship.energy / s.T.energyMax;
  assert(out > 0 && s.ship.state === 'alive', 'worst-case straight crossing survives');
  assert(after > 0.25, 'crossing lands with >25% energy in hand (' + (after * 100).toFixed(0) + '%) — a cost, not a death sentence');

  // But LIVING in the wrong zone kills: circle inside it indefinitely.
  const s2 = crossing();
  s2.command({ type: 'grab' });
  let died = -1;
  for (let t = 0; t < 9000; t++) {
    const u = s2.ship;
    s2.command({ type: 'aim', angle: Math.atan2(u.y, u.x) + Math.PI / 2 + 0.35 }); // orbit the center, inside
    s2.step();
    if (u.state !== 'alive') { died = t; break; }
  }
  assert(died > 0, 'lingering in the wrong zone eventually crystallizes you (at ~' + (died / TICK_RATE).toFixed(0) + 's)');
  assert(died > out * 2, 'death comes from lingering, not from touching the zone');
}

// --- 8. Soak with drift. ----------------------------------------------------
{
  console.log('\n[soak]');
  const a = new Sim(SEED, { fieldDriftSpeed: 8 }), b = new Sim(SEED, { fieldDriftSpeed: 8 });
  for (let t = 0; t < 100000; t++) { a.step(); b.step(); }
  assert(a.stateHash() === b.stateHash(), '100k-tick drift soak: hashes identical');
  assert(Number.isFinite(a.fields[0].x) && Number.isFinite(a.ship.x), 'no NaN/Inf after soak');
}

console.log('\n' + (failures === 0 ? 'ALL TESTS PASSED' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
