// WEATHER — bus adapters. The ONLY weather file that knows the bus exists.
//
//   startGlobalAgent(bus)    steps the global sim and publishes a keyframe on
//                            wx.global.kf every `kfEvery` world ticks, running
//                            `lead` keyframes ahead of "now" so consumers
//                            always have the next one before they need it.
//   startKeyframeLog(bus)    durable record of every keyframe (in-process now,
//                            NATS JetStream later). Answers wx.kf.get requests,
//                            so a consumer that missed one can fetch it.
//   createWeatherClient(bus) what a battle shard, the descent or a browser
//                            uses: buffers keyframes by number (duplicates and
//                            out-of-order arrival don't matter), fetches gaps
//                            from the log, bakes regions on demand and samples
//                            the field at the global / regional / local level.
//
// Subjects:  wx.global.kf   {v, seed, tick, kf, every, size, p[]}   ~1.6 KB
//            wx.kf.get      request {kf} -> reply keyframe | null
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./global.js'), require('./field.js'));
  else (root.Wx = root.Wx || {}).agents = factory(root.Wx.global, root.Wx.field);
})(typeof self !== 'undefined' ? self : this, function (Global, field) {
  'use strict';

  function startGlobalAgent(bus, opts) {
    opts = opts || {};
    const K = opts.kfEvery || 5, lead = opts.lead === undefined ? 2 : opts.lead;
    const sim = new Global.Sim(opts.seed >>> 0, opts.overrides);
    let published = 0, bytes = 0;
    function emit() {
      const kf = sim.keyframe();
      kf.kf = sim.tick / K; kf.every = K;
      published++;
      if (opts.countBytes) bytes += JSON.stringify(kf).length;
      bus.publish('wx.global.kf', kf);
    }
    emit(); // keyframe 0
    return {
      sim: sim, kfEvery: K, lead: lead,
      // Bring the sky up to `worldTick` + lead keyframes.
      advanceTo(worldTick) {
        const target = Math.floor(worldTick) + lead * K;
        let guard = 0;
        while (sim.tick < target && guard++ < 100000) { sim.step(); if (sim.tick % K === 0) emit(); }
      },
      get published() { return published; },
      get bytes() { return bytes; },
    };
  }

  function startKeyframeLog(bus, opts) {
    const keep = (opts && opts.keep) || 0; // 0 = keep everything
    const log = new Map();
    const offA = bus.subscribe('wx.global.kf', kf => {
      if (!kf || log.has(kf.kf)) return;
      log.set(kf.kf, kf);
      if (keep && log.size > keep) log.delete(log.keys().next().value);
    });
    const offB = bus.subscribe('wx.kf.get', (msg, subject, replyTo) => {
      if (replyTo) bus.publish(replyTo, (msg && log.get(msg.kf)) || null);
    });
    return { log: log, stop() { offA(); offB(); } };
  }

  function createWeatherClient(bus, opts) {
    opts = Object.assign({ regionsPerSide: 4, res: 32, D: 24, warpScale: 70, warpPeriod: 60, keepBehind: 2 }, opts || {});
    const kfs = new Map(), grids = new Map(), pending = new Set();
    const stats = { received: 0, dropped: 0, fetched: 0, bakes: 0, bakeMs: 0 };
    let K = 0, L = null, detailSeed = 0;
    const cur = { a: -1, b: -1, alpha: 0, t: 0, ready: false };
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

    function accept(kf) {
      if (!kf || kf.v !== field.VERSION || kfs.has(kf.kf)) return;
      kfs.set(kf.kf, kf);
      stats.received++;
      if (!K) { K = kf.every; L = field.layout(kf.size, opts.regionsPerSide, opts.res); detailSeed = (kf.seed ^ 0x2545F491) >>> 0; }
    }
    const off = bus.subscribe('wx.global.kf', kf => {
      if (opts.drop && opts.drop(kf)) { stats.dropped++; return; }
      accept(kf);
    });
    function fetch(n) {
      if (pending.has(n) || n < 0) return;
      pending.add(n); stats.fetched++;
      bus.request('wx.kf.get', { kf: n }, 1500).then(kf => { pending.delete(n); accept(kf); }, () => pending.delete(n));
    }
    function grid(n, rx, ry) {
      const key = n + ':' + rx + ':' + ry;
      let g = grids.get(key);
      if (!g) {
        const t0 = now();
        g = field.bakeRegion(kfs.get(n), rx, ry, L);
        grids.set(key, g);
        stats.bakes++; stats.bakeMs += now() - t0;
      }
      return g;
    }
    // Fast path: the grids for the current pair of keyframes, by region index.
    let curA = [], curB = [];
    function regionOf(v) { const r = Math.floor(v / L.regionSize); return r >= opts.regionsPerSide ? opts.regionsPerSide - 1 : r; }

    const wv = [0, 0], wA = [0, 0, 0, 0], wB = [0, 0, 0, 0];
    const api = {
      opts: opts, stats: stats, cur: cur,
      get layout() { return L; },
      get kfEvery() { return K; },
      get buffered() { return kfs.size; },
      hasKeyframe(n) { return kfs.has(n); },
      keyframe(n) { return kfs.get(n); },
      // Point the client at world time `t` (in world ticks, may be fractional).
      // Returns false until both surrounding keyframes are here; never guesses.
      setTime(t) {
        if (!K) { cur.ready = false; return false; }
        const a = Math.floor(t / K), b = a + 1;
        if (!kfs.has(a)) fetch(a);
        if (!kfs.has(b)) fetch(b);
        if (!kfs.has(a) || !kfs.has(b)) { cur.ready = false; return false; }
        if (a !== cur.a) {
          for (const n of kfs.keys()) if (n < a - opts.keepBehind) kfs.delete(n);
          for (const key of grids.keys()) if (+key.split(':')[0] < a) grids.delete(key);
        }
        if (a !== cur.a || b !== cur.b) { curA = []; curB = []; }
        cur.a = a; cur.b = b; cur.alpha = (t - a * K) / K; cur.t = t; cur.ready = true;
        return true;
      },
      // REGIONAL: baked grids blended between the two keyframes.
      sampleRegional(x, y, out) {
        x = field.wrap(x, L.size); y = field.wrap(y, L.size);
        const rx = regionOf(x), ry = regionOf(y), ri = ry * opts.regionsPerSide + rx;
        const gA = curA[ri] || (curA[ri] = grid(cur.a, rx, ry)), gB = curB[ri] || (curB[ri] = grid(cur.b, rx, ry));
        return field.sampleRegion(gA, gB, cur.alpha, L, rx, ry, x, y, out);
      },
      // LOCAL: regional read at a point nudged by at most D. out[7] = nudge
      // along x in [-1, 1] (handy for texture).
      sampleLocal(x, y, out) {
        field.warp(detailSeed, x, y, cur.t, opts.D, opts.warpScale, opts.warpPeriod, wv);
        api.sampleRegional(x + wv[0], y + wv[1], out);
        out[7] = opts.D > 0 ? wv[0] / (opts.D * 0.7071067811865476) : 0;
        return out;
      },
      // GLOBAL: the exact field from the keyframes (what the map shows).
      gasGlobal(x, y) {
        field.exactWeights(kfs.get(cur.a), x, y, wA);
        field.exactWeights(kfs.get(cur.b), x, y, wB);
        for (let g = 0; g < 4; g++) wA[g] += (wB[g] - wA[g]) * cur.alpha;
        return field.argmax4(wA);
      },
      warpAt(x, y, out) { return field.warp(detailSeed, x, y, cur.t, opts.D, opts.warpScale, opts.warpPeriod, out); },
      // Parcels blended between the two keyframes (for debug drawing).
      parcels(cb) {
        const A = kfs.get(cur.a), B = kfs.get(cur.b), S = A.size, s = field.STRIDE;
        for (let i = 0; i < A.p.length; i += s) {
          cb(A.p[i], field.wrap(A.p[i + 1] + field.wrapD(B.p[i + 1] - A.p[i + 1], S) * cur.alpha, S),
             field.wrap(A.p[i + 2] + field.wrapD(B.p[i + 2] - A.p[i + 2], S) * cur.alpha, S));
        }
      },
      stop: off,
    };
    return api;
  }

  return { startGlobalAgent: startGlobalAgent, startKeyframeLog: startKeyframeLog, createWeatherClient: createWeatherClient };
});
