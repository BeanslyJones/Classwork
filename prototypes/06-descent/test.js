// Headless verification for prototype 06 (loadout -> descent -> landing).
'use strict';
const { Loadout, Descent, MODULES, defaultLoadout } = require('./sim.js');

let failures = 0;
function assert(cond, label) {
  if (cond) console.log('  PASS  ' + label);
  else { failures++; console.error('  FAIL  ' + label); }
}
const SEED = 606;

// --- 1. Loadout: structure, edge rule, power gating, tonnage. ---------------
{
  console.log('\n[loadout rules]');
  const L = defaultLoadout();
  const ev = L.evaluate();
  assert(ev.launchable, 'default ship is launchable');
  assert(Math.abs(ev.tonnage - ev.report.reduce((a, r) => a + MODULES[r.key].mass, 0)) < 1e-9, 'tonnage = sum of module masses');

  // Floating module: not connected to hull chain -> unstructured.
  const L2 = defaultLoadout();
  L2.set(0, 0, 'cargobay');
  const ev2 = L2.evaluate();
  const floater = ev2.report.find(r => r.x === 0 && r.y === 0);
  assert(floater.problems.includes('unstructured') && !floater.active, 'floating module is dead weight, not active');
  assert(!ev2.launchable, 'an unstructured cell blocks launch');

  // Thruster buried mid-hull violates the edge rule.
  const L3 = defaultLoadout();
  L3.set(4, 3, 'thruster'); // dead center, fully surrounded
  const ev3 = L3.evaluate();
  const buried = ev3.report.find(r => r.x === 4 && r.y === 3);
  assert(buried.problems.includes('needs-edge'), 'buried thruster flagged needs-edge');

  // Power gating: strip the reactors -> demand modules go inactive.
  const L4 = defaultLoadout();
  for (let y = 0; y < L4.h; y++) for (let x = 0; x < L4.w; x++) {
    if (L4.get(x, y) === 'reactor') L4.set(x, y, 'hull');
  }
  const ev4 = L4.evaluate();
  assert(ev4.report.filter(r => MODULES[r.key].power < 0).every(r => !r.active),
    'no reactors -> every power-hungry module inactive');
  assert(!ev4.launchable, 'unpowered ship cannot launch');
}

// --- 2. Descent determinism. ------------------------------------------------
{
  console.log('\n[determinism]');
  const ev = defaultLoadout().evaluate();
  function run(seed, gain) {
    const d = new Descent(seed, ev);
    while (!d.done) {
      const guide = d.guideAt(d.t);
      d.command({ type: 'steer', v: Math.max(-1, Math.min(1, (guide - d.x) * gain)) });
      d.step();
    }
    return d;
  }
  const a = run(SEED, 0.02), b = run(SEED, 0.02), c = run(SEED + 1, 0.02);
  assert(a.stateHash() === b.stateHash(), 'same seed + same commands -> identical descent');
  assert(a.result.offsetX === b.result.offsetX, 'same performance + same seed -> same landing offset');
  assert(a.stateHash() !== c.stateHash(), 'different seed -> different corridor');
  assert(a.done && a.result && !a.result.crashed, 'descent terminates in a landing');
  const pre = run(SEED, 0.02);
  assert(pre.prewarmed, 'ground prewarm event fired mid-descent');
}

// --- 3. GATE: descent skill visibly tightens scatter. -----------------------
{
  console.log('\n[GATE: skill -> scatter]');
  const ev = defaultLoadout().evaluate();
  // Skill = proportional tracking gain (+ a hard cap modeling reaction limits).
  function pilot(gain, cap) {
    const d = new Descent(SEED, ev);
    while (!d.done) {
      const want = Math.max(-cap, Math.min(cap, (d.guideAt(d.t) - d.x) * gain));
      d.command({ type: 'steer', v: want });
      d.step();
    }
    return d.result;
  }
  const ace = pilot(0.05, 1.0);       // sharp, full authority
  const okay = pilot(0.012, 0.6);     // sluggish
  const drunk = pilot(0.002, 0.25);   // barely steering
  console.log('    ace:   err ' + ace.avgErr.toFixed(1) + ' scatter ' + ace.scatter.toFixed(0) +
    ' fuel ' + (ace.fuelFrac * 100).toFixed(0) + '% hull ' + (ace.hullFrac * 100).toFixed(0) + '%');
  console.log('    okay:  err ' + okay.avgErr.toFixed(1) + ' scatter ' + okay.scatter.toFixed(0) +
    ' fuel ' + (okay.fuelFrac * 100).toFixed(0) + '% hull ' + (okay.hullFrac * 100).toFixed(0) + '%');
  console.log('    drunk: err ' + drunk.avgErr.toFixed(1) + ' scatter ' + drunk.scatter.toFixed(0) +
    ' fuel ' + (drunk.fuelFrac * 100).toFixed(0) + '% hull ' + (drunk.hullFrac * 100).toFixed(0) + '%');
  assert(ace.scatter < okay.scatter && okay.scatter < drunk.scatter, 'scatter shrinks monotonically with skill');
  assert(ace.scatter < drunk.scatter * 0.75, 'the tightening is VISIBLE (>25% between ace and drunk)');
  assert(ace.scatter >= new Descent(SEED, ev).T.scatterBase, 'perfect play never zeroes scatter — the planet gets a vote');
  assert(ace.hullFrac >= okay.hullFrac && okay.hullFrac >= drunk.hullFrac, 'hull arrives healthier with skill');
  assert(drunk.hullFrac < 1, 'sloppy descent chews the hull (corridor is real)');
}

// --- 4. Tonnage costs: heavier = longer fall, less authority. ---------------
{
  console.log('\n[tonnage]');
  const light = defaultLoadout().evaluate();
  const L = defaultLoadout();
  // Bolt cargo onto every empty structured edge we can find (greed build).
  for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
    if (!L.get(x, y) && (L.get(x + 1, y) || L.get(x - 1, y) || L.get(x, y + 1) || L.get(x, y - 1))) L.set(x, y, 'cargobay');
  }
  const heavy = L.evaluate();
  assert(heavy.tonnage > light.tonnage + 10, 'greed build is much heavier (' + light.tonnage.toFixed(1) + ' -> ' + heavy.tonnage.toFixed(1) + ')');
  const dl = new Descent(SEED, light), dh = new Descent(SEED, heavy);
  assert(dh.duration > dl.duration, 'heavier -> longer descent (' + dl.duration.toFixed(1) + 's -> ' + dh.duration.toFixed(1) + 's)');
  assert(dh.authority < dl.authority, 'heavier -> less steering authority');
}

console.log('\n' + (failures === 0 ? 'ALL TESTS PASSED' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
