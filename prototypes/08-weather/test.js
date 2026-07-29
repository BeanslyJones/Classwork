// Headless verification for prototype 08 (weather skeleton). Run: node test.js
'use strict';
const { Sim, GASES } = require('./sim.js');

let failures = 0;
function assert(cond, label) {
  if (cond) console.log('  PASS  ' + label);
  else { failures++; console.error('  FAIL  ' + label); }
}
const SEED = 88;

// --- 1. Determinism. --------------------------------------------------------
{
  console.log('\n[determinism]');
  const a = new Sim(SEED), b = new Sim(SEED), c = new Sim(SEED + 1);
  for (let t = 0; t < 5000; t++) { a.step(); b.step(); c.step(); }
  assert(a.stateHash() === b.stateHash(), 'same seed -> identical sky after 5000 ticks');
  assert(a.stateHash() !== c.stateHash(), 'different seed -> different sky');
  const fa = a.fronts(), fb = b.fronts();
  assert(JSON.stringify(fa) === JSON.stringify(fb), 'identical seed -> identical front parameter sets');
}

// --- 2. Full partition, no extinctions. -------------------------------------
{
  console.log('\n[partition]');
  const s = new Sim(SEED);
  for (let t = 0; t < 5000; t++) s.step();
  const m = s.clusterCounts(40);
  const fracs = m.areaFrac.map(f => (f * 100).toFixed(1) + '%').join(' / ');
  console.log('    area at tick 5000 (cinder/bloom/brine/halo): ' + fracs);
  assert(m.areaFrac.every(f => f > 0.02), 'planet fully partitioned, every gas holds >2% (no extinction)');
}

// --- 3. Cohesion is structural: soup without it, structure with it. ---------
{
  console.log('\n[cohesion is structural]');
  const coherent = new Sim(SEED);
  const soup = new Sim(SEED, { cohesion: 0 });
  for (let t = 0; t < 1200; t++) { coherent.step(); soup.step(); }
  const mc = coherent.clusterCounts(40), ms = soup.clusterCounts(40);
  const sum = c => c.counts.reduce((a, b) => a + b, 0);
  console.log('    clusters at tick 1200: cohesion ON ' + mc.counts.join('/') + ' (total ' + sum(mc) + ')' +
    ' · OFF ' + ms.counts.join('/') + ' (total ' + sum(ms) + ')');
  assert(sum(mc) <= 16, 'with cohesion: gases hold together (<= 4 clusters avg per gas)');
  assert(sum(ms) > sum(mc) * 1.5, 'without cohesion: soup by tick ~1200 (fragmentation explodes)');
  // Long-run structure holds.
  for (let t = 0; t < 3800; t++) coherent.step();
  const ml = coherent.clusterCounts(40);
  assert(sum(ml) <= 20, 'structure survives to tick 5000 (' + sum(ml) + ' clusters total)');
}

// --- 4. Bloom is the deliberately weak gas. ---------------------------------
{
  console.log('\n[bloom weakness]');
  // Parcel dispersion from the gas centroid, averaged over seeds — one sky
  // can flatter anyone.
  function disp(s) {
    const per = [];
    for (let g = 0; g < 4; g++) {
      const ps = s.parcels.filter(p => p.gas === g);
      const cx = ps.reduce((a, p) => a + p.x, 0) / ps.length, cy = ps.reduce((a, p) => a + p.y, 0) / ps.length;
      per.push(ps.reduce((a, p) => a + Math.hypot(p.x - cx, p.y - cy), 0) / ps.length);
    }
    return per;
  }
  let bloomD = 0, otherD = 0;
  for (let k = 0; k < 5; k++) {
    const s = new Sim(SEED + k * 101);
    for (let t = 0; t < 2500; t++) s.step();
    const d = disp(s);
    bloomD += d[1]; otherD += (d[0] + d[2] + d[3]) / 3;
  }
  console.log('    avg dispersion over 5 seeds: bloom ' + (bloomD / 5).toFixed(0) + ' vs others ' + (otherD / 5).toFixed(0));
  assert(bloomD > otherD * 1.2, 'bloom smears visibly more than the average other gas (weak cohesion shows)');
}

// --- 5. Fronts: the director output survives thousands of ticks. ------------
{
  console.log('\n[fronts]');
  const s = new Sim(SEED);
  let alwaysPresent = true;
  for (let t = 0; t < 5000; t++) {
    s.step();
    if (t % 500 === 0 && s.fronts().length === 0) alwaysPresent = false;
  }
  const fr = s.fronts();
  console.log('    tick 5000: ' + fr.length + ' active pair-fronts, longest ' +
    fr[0].pair.join('/') + ' at ' + fr[0].length.toFixed(0) + ' units');
  assert(alwaysPresent && fr.length > 0, 'fronts exist at every sampled tick out to 5000');
  assert(fr.every(f => f.pair.length === 2 && GASES.includes(f.pair[0]) && GASES.includes(f.pair[1])),
    'every front is a well-formed gas-pair parameter set');
  assert(fr.every(f => Number.isFinite(f.cx) && Number.isFinite(f.length) && f.intensity > 0),
    'front parameters are sane (director emits numbers, not pictures)');
}

console.log('\n' + (failures === 0 ? 'ALL TESTS PASSED' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
