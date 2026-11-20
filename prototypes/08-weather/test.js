// Headless verification for prototype 08 (weather skeleton). Run: node test.js
'use strict';
const { Sim, GASES } = require('../shared/wx/global.js');

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

// ============================================================================
// The weather on the bus: global -> regional -> local, keyframes and the log.
// ============================================================================
const fs = require('fs');
const path = require('path');
const { createBus } = require('../shared/bus.js');
const field = require('../shared/wx/field.js');
const { mulberry32 } = require('../shared/wx/rng.js');
const { startGlobalAgent, startKeyframeLog, createWeatherClient } = require('../shared/wx/agents.js');
const settle = () => new Promise(r => setImmediate(r));

(async () => {
  // --- 6. Keyframes: deterministic, small, published ahead. ----------------
  console.log('\n[keyframes on the bus]');
  const streams = [[], []];
  for (const k of [0, 1]) {
    const bus = createBus();
    bus.subscribe('wx.global.kf', kf => streams[k].push(JSON.stringify(kf)));
    const ag = startGlobalAgent(bus, { seed: SEED, kfEvery: 5, lead: 2 });
    ag.advanceTo(1000);
  }
  assert(streams[0].length === 1000 / 5 + 3 && streams[0].join() === streams[1].join(),
    'same seed -> identical keyframe stream (' + streams[0].length + ' keyframes)');
  const kfBytes = Math.max(...streams[0].map(s => s.length));
  assert(kfBytes < 2500, 'a keyframe is small: ' + kfBytes + ' bytes (whole sky)');
  {
    const bus = createBus(); let newest = -1;
    bus.subscribe('wx.global.kf', kf => { newest = kf.kf; });
    const ag = startGlobalAgent(bus, { seed: SEED, kfEvery: 5, lead: 2 });
    let ok = true;
    for (let t = 0; t <= 300; t += 7) { ag.advanceTo(t); if (newest < Math.floor(t / 5) + 2) ok = false; }
    assert(ok, 'the agent always runs 2 keyframes ahead of now, so the next one is already there');
  }

  // --- 7. Lossy, shuffled, duplicated delivery changes nothing. ------------
  console.log('\n[bus robustness]');
  const busA = createBus();
  const all = [];
  busA.subscribe('wx.global.kf', kf => all.push(kf));
  startKeyframeLog(busA);
  const perfect = createWeatherClient(busA);
  const agent = startGlobalAgent(busA, { seed: SEED, kfEvery: 5, lead: 2 });
  agent.advanceTo(600);

  const busB = createBus();
  startKeyframeLog(busB);
  const dropRng = mulberry32(7);
  const messy = createWeatherClient(busB, { drop: () => dropRng() < 0.4 });
  const order = all.slice(), shuf = mulberry32(9);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(shuf() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
  for (const kf of order) { busB.publish('wx.global.kf', kf); if (shuf() < 0.3) busB.publish('wx.global.kf', kf); }
  assert(messy.stats.dropped > 0, 'the messy client really lost ' + messy.stats.dropped + ' deliveries (and got the rest shuffled + duplicated)');

  const pts = mulberry32(11);
  let same = true, checked = 0, waited = 0;
  const o1 = new Float64Array(12), o2 = new Float64Array(12);
  for (let n = 0; n < 40; n++) {
    const t = pts() * 590;
    for (let tries = 0; tries < 5 && !(perfect.setTime(t) & messy.setTime(t)); tries++) { waited++; await settle(); }
    if (!messy.cur.ready || !perfect.cur.ready) { same = false; break; }
    for (let k = 0; k < 60; k++) {
      const x = pts() * 1000, y = pts() * 1000;
      perfect.sampleLocal(x, y, o1); messy.sampleLocal(x, y, o2);
      for (let c = 0; c < 12; c++) if (o1[c] !== o2[c]) same = false;
      checked++;
    }
  }
  assert(waited > 0 && messy.stats.fetched > 0, 'missing keyframes were fetched from the log (' + messy.stats.fetched + ' requests), never guessed');
  assert(same, 'after loss, shuffling and duplicates: ' + checked + ' local samples bit-identical to the perfect client');

  // --- 8. Local stays faithful to global. ----------------------------------
  console.log('\n[local matches global]');
  const c = perfect, L = c.layout, D = c.opts.D;
  const rr = mulberry32(13), out = new Float64Array(12), wv = [0, 0];
  let maxWarp = 0, mismatch = 0, explained = 0, n = 0, farFromSeamOk = true;
  const reach = D + 2 * L.cell;
  for (let k = 0; k < 40; k++) {
    c.setTime(rr() * 590);
    for (let j = 0; j < 250; j++) {
      const x = rr() * 1000, y = rr() * 1000;
      c.warpAt(x, y, wv);
      maxWarp = Math.max(maxWarp, Math.hypot(wv[0], wv[1]));
      const loc = c.sampleLocal(x, y, out)[0], glob = c.gasGlobal(x, y);
      n++;
      if (loc === glob) continue;
      mismatch++;
      // A mismatch is only allowed if the map has that gas within D + 2 cells.
      let found = false;
      for (let a = 0; a < 24 && !found; a++) for (const r of [reach * 0.33, reach * 0.66, reach]) {
        if (c.gasGlobal(x + r * Math.cos(a / 24 * 6.2832), y + r * Math.sin(a / 24 * 6.2832)) === loc) { found = true; break; }
      }
      if (found) explained++; else farFromSeamOk = false;
    }
  }
  console.log('    ' + n + ' points: local differs from the map at ' + (mismatch / n * 100).toFixed(2) + '% (all near a seam: ' + explained + '/' + mismatch + ')');
  assert(maxWarp <= D + 1e-9, 'local detail never moves a point more than D=' + D + ' (max ' + maxWarp.toFixed(1) + ')');
  assert(farFromSeamOk, 'every place local differs from the map is within D + 2 cells (' + reach.toFixed(0) + ' units) of that gas on the map');
  assert(mismatch / n < 0.08, 'local agrees with the map almost everywhere');

  // --- 9. Sampling maths is bit-identical everywhere. ----------------------
  console.log('\n[portable maths]');
  const banned = /Math\.(sin|cos|tan|exp|pow|log|atan|cbrt|hypot)/;
  for (const f of ['field.js', 'rng.js']) {
    const src = fs.readFileSync(path.join(__dirname, '../shared/wx', f), 'utf8').replace(/\/\/.*$/gm, '');
    assert(!banned.test(src), f + ' uses only + - * / sqrt floor and integer hashing');
  }

  // --- 10. Speed. ----------------------------------------------------------
  console.log('\n[performance]');
  const kfNow = perfect.keyframe(perfect.cur.a);
  let t0 = process.hrtime.bigint();
  for (let ry = 0; ry < 4; ry++) for (let rx = 0; rx < 4; rx++) field.bakeRegion(kfNow, rx, ry, L);
  const bakeMs = Number(process.hrtime.bigint() - t0) / 1e6;
  c.setTime(300.5);
  for (let k = 0; k < 20000; k++) c.sampleLocal(k * 7.3 % 1000, k * 3.1 % 1000, out); // warm the caches
  t0 = process.hrtime.bigint();
  for (let k = 0; k < 100000; k++) c.sampleLocal(k * 7.3 % 1000, k * 13.7 % 1000, out);
  const ns = Number(process.hrtime.bigint() - t0) / 100000;
  console.log('    bake all 16 regions of one keyframe: ' + bakeMs.toFixed(1) + ' ms · local sample: ' + ns.toFixed(0) + ' ns');
  assert(bakeMs < 50, 'baking a whole keyframe is cheap (once per keyframe, only regions in use)');
  assert(ns < 2000, 'a local sample is well under 2 microseconds (1000 ships every tick < 2 ms)');

  console.log('\n' + (failures === 0 ? 'ALL TESTS PASSED' : failures + ' FAILURE(S)'));
  process.exit(failures === 0 ? 0 : 1);
})();
