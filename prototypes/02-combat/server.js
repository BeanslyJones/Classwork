// AMANN ASSAULT — LAN multiplayer server.
// Run on any computer on your Wi-Fi:   node server.js   (optional: PORT=8080)
// Then open the printed address on each phone/computer. No npm install needed.
//
// Two services that only talk over a message bus (bus.js, NATS-style subjects),
// so they can later run as separate processes/machines on real NATS:
//   GATEWAY  — HTTP + Server-Sent Events, seats, spectators. Turns browser POSTs
//              into  cmd.<seat>  (flying/building) and  ctl  (speed, restart…)
//              and forwards  state.*  /  lobby  /  hello.<client>  to browsers.
//   SIM      — owns the one true Sim, steps it at the fixed tick rate, applies
//              cmd.*, publishes  state.full  (or  state.player.<seat>  with
//              interest filtering: INTEREST_RADIUS=900 node server.js).
// Clients never step a sim, so different browsers' maths can't drift apart.
//
// Seats: first to join flies blue (team 0), second flies red (team 1), the rest
// spectate. An empty seat is flown by the AI, so one person can still play.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { Sim, TUNABLES, SONGS } = require('./sim.js');
const { createBus } = require('../shared/bus.js');
const Wx = require('../shared/wx/agents.js');

const PORT = parseInt(process.env.PORT || '8080', 10);
const SNAP_HZ = parseInt(process.env.SNAP_HZ || '30', 10); // battle snapshots per second to each screen
const ROOT = __dirname;
const JS = 'text/javascript; charset=utf-8';
const STATIC = {
  '/combat.html': ['combat.html', 'text/html; charset=utf-8'], '/sim.js': ['sim.js', JS], '/sfx.js': ['sfx.js', JS],
  '/shared/bus.js': ['../shared/bus.js', JS], '/shared/wx/rng.js': ['../shared/wx/rng.js', JS],
  '/shared/wx/field.js': ['../shared/wx/field.js', JS], '/shared/wx/global.js': ['../shared/wx/global.js', JS],
  '/shared/wx/agents.js': ['../shared/wx/agents.js', JS], '/shared/wx/render.js': ['../shared/wx/render.js', JS],
};
const WX_LEAD = 2;     // keyframes the weather runs ahead; screens never get further ahead than this
const WX_PER_TICK = 3; // battle ticks per weather tick (30 Hz battle, 10 Hz weather)
// Events screens need for effects and sound (everything else stays server-side).
const FORWARD = new Set(['detonation', 'weakDown', 'fired', 'crystallizing', 'dodge', 'locked', 'built', 'salvage', 'victory', 'refocus', 'note', 'lane', 'launch', 'deployed']);
const MODES = ['skirmish', 'carrier', 'beat', 'stress', 'fleet'];
const FLY = new Set(['grab', 'aim', 'release', 'dodge', 'refocus', 'order', 'lane', 'launchHold', 'launchRelease', 'nextShip']);
const MAX_SEATS = Math.max(2, Math.min(8, parseInt(process.env.SEATS || '8', 10))); // players; seat & 1 = team (even blue, odd red)

// ---------------------------------------------------------------- SIM service
function startSimService(bus, opts) {
  let seed = (Math.random() * 0xFFFFFFFF) >>> 0;
  let overrides = {};
  let mode = 'skirmish';
  let song = 'assault';
  let count = 150; // stress test: ships per side
  let sim = null;
  let speed = 0.5, paused = false;
  const seated = new Array(8).fill(false); // which player seats are taken
  const humans = [false, false];
  const fleets = {}; // Fleet Battle drafts, by seat
  let pendingEvents = [];
  const interest = opts.interestRadius > 0 ? opts.interestRadius : 0;

  // Weather: the global agent + its log run on this bus; the sim service is a
  // weather client that samples every ship's zone each loop (no effects yet).
  let wx = null;
  const wxOut = new Float64Array(12), zoneCount = [0, 0, 0, 0];
  function newWeather() {
    if (wx) { wx.log.stop(); wx.client.stop(); }
    const sky = Wx.skyForArena(sim.T.arenaRadius);
    const log = Wx.startKeyframeLog(bus);
    // Ship zones only need a coarse grid (cells ~16 units; local detail is +-24 anyway): 4x cheaper to bake.
    const client = Wx.createWeatherClient(bus, { res: 16 });
    const agent = Wx.startGlobalAgent(bus, { seed: (seed ^ 0x5EED5EED) >>> 0, overrides: sky, kfEvery: 5, lead: WX_LEAD });
    agent.advanceTo(0); // publish the first keyframes now, so a screen asking straight away finds them
    wx = { log: log, client: client, agent: agent, half: sky.worldSize / 2 };
  }
  function newSim() {
    sim = new Sim(seed, overrides, null, { mode: mode, song: song, count: count,
                                           fleets: Object.keys(fleets).filter(k => seated[k]).map(k => Object.assign({}, fleets[k], { ctl: +k })) });
    sim.human = humans.slice();
    pendingEvents = [];
    newWeather();
  }
  newSim();
  const settings = () => ({ speed: speed, paused: paused, seed: seed, overrides: overrides, mode: mode, song: song, count: count,
                            drafted: Object.keys(fleets).filter(k => seated[k]).map(Number) });
  const publishSettings = () => bus.publish('sim.settings', settings());

  // Seats: the gateway tells us which sides a person is flying.
  bus.subscribe('seat.*', (msg, subject) => {
    const seat = +subject.split('.')[1], team = seat & 1;
    seated[seat] = !!msg.human;
    humans[team] = seated.some((on, k) => on && (k & 1) === team);
    sim.setHuman(team, humans[team]);
  });
  // Flying and building: one subject per seat.
  bus.subscribe('cmd.*', (cmd, subject) => {
    const seat = +subject.split('.')[1], team = seat & 1;
    if (!(seat >= 0 && seat < 8) || !cmd || typeof cmd.type !== 'string') return;
    if (FLY.has(cmd.type)) {
      sim.command({ type: cmd.type, unit: Number.isInteger(cmd.unit) ? cmd.unit : undefined, angle: +cmd.angle,
                    lane: typeof cmd.lane === 'string' ? cmd.lane : undefined, index: Number.isInteger(cmd.index) ? cmd.index : undefined,
                    team: team, ctl: seat });
    } else if (cmd.type === 'build' && typeof cmd.cls === 'string') {
      sim.command({ type: 'build', cls: cmd.cls, team: team });
    }
  });
  // Shared settings any player may change.
  bus.subscribe('ctl', cmd => {
    if (!cmd || typeof cmd.type !== 'string') return;
    switch (cmd.type) {
      case 'fleet': // a player's Fleet Battle draft (the gateway adds the seat)
        if (Number.isInteger(cmd.seat) && cmd.seat >= 0 && cmd.seat < 8 && cmd.fleet && typeof cmd.fleet === 'object') fleets[cmd.seat] = cmd.fleet;
        return publishSettings();
      case 'speed':
        if (+cmd.value >= 0.1 && +cmd.value <= 2) speed = +cmd.value;
        return publishSettings();
      case 'pause':
        paused = !!cmd.value;
        return publishSettings();
      case 'restart':
        if (cmd.newSeed) seed = (Math.random() * 0xFFFFFFFF) >>> 0;
        if (MODES.indexOf(cmd.mode) >= 0) mode = cmd.mode;
        if (typeof cmd.song === 'string' && SONGS[cmd.song]) song = cmd.song;
        if (Number.isInteger(cmd.count) && cmd.count >= 10 && cmd.count <= 1000) count = cmd.count;
        newSim();
        publishSettings();
        return bus.publish('sim.restarted', settings());
      case 'tune': {
        if (!(cmd.key in TUNABLES)) return;
        const t = TUNABLES[cmd.key], v = +cmd.value;
        if (!(v >= t.min && v <= t.max)) return;
        overrides[cmd.key] = v;
        sim.T[cmd.key] = v; // structural ones (hazards, arena) apply on next restart
        return publishSettings();
      }
    }
  });

  // Performance, reported to every screen twice a second.
  const perf = { stepMs: 0, stepMax: 0, ticks: 0, wxMs: 0, snapMs: 0, loops: 0, behind: 0 };
  const ms = t0 => Number(process.hrtime.bigint() - t0) / 1e6;
  const perfTimer = setInterval(() => {
    const L = Math.max(1, perf.loops), T = Math.max(1, perf.ticks);
    bus.publish('sim.perf', {
      ships: sim.units.length, alive: sim.units.filter(u => u.state === 'alive').length,
      stepMs: +(perf.stepMs / T).toFixed(2), stepMax: +perf.stepMax.toFixed(1), budgetMs: +(1000 / sim.T.tickRate).toFixed(1),
      ticksPerSec: perf.ticks * 2, wxMs: +(perf.wxMs / L).toFixed(2), snapMs: +(perf.snapMs / L).toFixed(2),
      snapHz: SNAP_HZ, behind: perf.behind, zones: zoneCount.slice(),
      wxKf: wx.agent.published, wxLog: wx.log.log.size, mem: Math.round(process.memoryUsage().heapUsed / 1048576),
    });
    perf.stepMs = perf.stepMax = perf.ticks = perf.wxMs = perf.snapMs = perf.loops = perf.behind = 0;
  }, 500);

  // Fixed-tick loop, scaled by the shared game speed. State goes out every loop.
  let acc = 0, last = process.hrtime.bigint();
  const timer = setInterval(() => {
    const now = process.hrtime.bigint();
    const dt = Math.min(0.25, Number(now - last) / 1e9);
    last = now;
    if (!paused) acc += dt * speed;
    const stepLen = 1 / sim.T.tickRate;
    let n = 0;
    while (acc >= stepLen && n < 8) {
      const t0 = process.hrtime.bigint();
      sim.step();
      const st = ms(t0);
      perf.stepMs += st; perf.stepMax = Math.max(perf.stepMax, st); perf.ticks++;
      for (const e of sim.events) if (FORWARD.has(e.type)) pendingEvents.push(e.type === 'fired' ? { type: 'fired', unit: e.unit } : e);
      acc -= stepLen; n++;
    }
    if (acc >= stepLen) { perf.behind++; acc = Math.min(acc, stepLen * 8); } // the sim couldn't keep up this loop
    // Weather: bring the sky up to now, then sample every ship's zone.
    const t1 = process.hrtime.bigint();
    const wt = sim.tick / WX_PER_TICK;
    wx.agent.advanceTo(wt);
    if (wx.client.setTime(wt)) {
      zoneCount[0] = zoneCount[1] = zoneCount[2] = zoneCount[3] = 0;
      for (const u of sim.units) {
        if (u.state !== 'alive') continue;
        wx.client.sampleLocal(u.x + wx.half, u.y + wx.half, wxOut);
        u.zone = wxOut[0]; zoneCount[wxOut[0]]++;
      }
    }
    perf.wxMs += ms(t1);
    const t2 = process.hrtime.bigint();
    if (interest) {
      for (const team of [0, 1]) bus.publish('state.player.' + team, sim.snapshot(pendingEvents, { team: team, radius: interest }));
    }
    const full = sim.snapshot(pendingEvents);
    bus.publish('state.full', full); // spectators (and everyone when not filtering)
    perf.snapMs += ms(t2); perf.loops++;
    pendingEvents = [];
  }, 1000 / SNAP_HZ);

  publishSettings();
  return { get sim() { return sim; }, get weather() { return wx; }, settings: settings, stop() { clearInterval(timer); clearInterval(perfTimer); } };
}

// ------------------------------------------------------------ GATEWAY service
function startGateway(bus, opts) {
  const clients = new Map(); // id -> { res, seat }
  const seats = new Array(MAX_SEATS).fill(null); // client id in each player seat (seat & 1 = team)
  let settings = {};
  const filtered = opts.interestRadius > 0;

  let bytesOut = 0;
  function write(c, text) { c.res.write(text); c.bytes += text.length; bytesOut += text.length; }
  function send(c, type, data) { write(c, 'event: ' + type + '\ndata: ' + JSON.stringify(data) + '\n\n'); }
  function broadcast(type, data) { const text = 'event: ' + type + '\ndata: ' + JSON.stringify(data) + '\n\n'; for (const c of clients.values()) write(c, text); }
  function lobby() { return Object.assign({ seats: seats.map(s => s !== null), players: clients.size }, settings); }
  function hello(c, id) { send(c, 'hello', Object.assign({ id: id, seat: c.seat }, lobby())); }

  bus.subscribe('sim.settings', s => { settings = s; broadcast('lobby', lobby()); });
  bus.subscribe('sim.restarted', () => { for (const [id, c] of clients) hello(c, id); });
  // Weather keyframes go to screens only up to "now + lead": a screen must
  // never hold far-future weather (that would be a perfect forecast).
  let simTick = 0, wxHeld = [], snapBytes = 0;
  const wxCap = kf => Math.floor(simTick / WX_PER_TICK / kf.every) + WX_LEAD;
  function flushWx() {
    if (!wxHeld.length) return;
    const keep = [];
    for (const kf of wxHeld) { if (kf.kf <= wxCap(kf)) broadcast('wx', kf); else keep.push(kf); }
    wxHeld = keep;
  }
  bus.subscribe('wx.global.kf', kf => {
    if (kf.kf === 0) wxHeld = []; // a new sky (restart): drop anything held from the old one
    wxHeld.push(kf); flushWx();
  });
  bus.subscribe('sim.restarted', () => { simTick = 0; });

  bus.subscribe('state.full', snap => {
    simTick = snap.tick; flushWx();
    const text = 'event: snap\ndata: ' + JSON.stringify(snap) + '\n\n';
    snapBytes = text.length;
    for (const c of clients.values()) if (!filtered || c.seat < 0) write(c, text);
  });
  bus.subscribe('state.player.*', (snap, subject) => {
    const team = +subject.split('.')[2], text = 'event: snap\ndata: ' + JSON.stringify(snap) + '\n\n';
    for (const c of clients.values()) if (c.seat >= 0 && (c.seat & 1) === team) write(c, text);
  });
  // Performance: the sim's numbers plus what this gateway is sending.
  let perfAt = Date.now();
  bus.subscribe('sim.perf', p => {
    const now = Date.now(), secs = Math.max(0.1, (now - perfAt) / 1000);
    perfAt = now;
    let maxC = 0;
    for (const c of clients.values()) { maxC = Math.max(maxC, c.bytes / secs); c.bytes = 0; }
    broadcast('perf', Object.assign({ screens: clients.size, snapKB: +(snapBytes / 1024).toFixed(1), outKBs: Math.round(bytesOut / secs / 1024), perScreenKBs: Math.round(maxC / 1024) }, p));
    bytesOut = 0;
  });

  function takeSeat(id) {
    for (let t = 0; t < MAX_SEATS; t++) if (seats[t] === null) { seats[t] = id; bus.publish('seat.' + t, { human: true }); return t; }
    return -1;
  }
  function leave(id) {
    const c = clients.get(id);
    if (!c) return;
    clients.delete(id);
    if (c.seat >= 0 && seats[c.seat] === id) {
      seats[c.seat] = null;
      bus.publish('seat.' + c.seat, { human: false });
      // Hand the empty seat to a spectator if one is waiting.
      for (const [oid, oc] of clients) if (oc.seat < 0) {
        oc.seat = c.seat; seats[c.seat] = oid; bus.publish('seat.' + c.seat, { human: true }); hello(oc, oid); break;
      }
    }
    broadcast('lobby', lobby());
  }

  function route(c, cmd) {
    if (!cmd || typeof cmd.type !== 'string') return;
    if (FLY.has(cmd.type) || cmd.type === 'build') {
      if (c.seat < 0) return; // spectators can't fly or build
      bus.publish('cmd.' + c.seat, cmd);
    } else if (cmd.type === 'fleet') {
      if (c.seat < 0) return;
      bus.publish('ctl', { type: 'fleet', seat: c.seat, fleet: cmd.fleet });
    } else {
      bus.publish('ctl', cmd);
    }
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(302, { Location: '/combat.html?net=1' }); res.end(); return;
    }
    if (req.method === 'GET' && STATIC[url.pathname]) {
      const [file, type] = STATIC[url.pathname];
      fs.readFile(path.join(ROOT, file), (err, buf) => {
        if (err) { res.writeHead(500); res.end(); return; }
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
        res.end(buf);
      });
      return;
    }
    // A screen that missed a weather keyframe fetches it from the log (never past the cap).
    if (req.method === 'GET' && url.pathname === '/wx') {
      const n = parseInt(url.searchParams.get('kf'), 10);
      if (!(n >= 0)) { res.writeHead(400); res.end(); return; }
      bus.request('wx.kf.get', { kf: n }, 1000).then(kf => {
        if (!kf || kf.kf > wxCap(kf)) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(kf));
      }, () => { res.writeHead(504); res.end(); });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(': connected\n\n');
      const id = crypto.randomBytes(8).toString('hex');
      const c = { res: res, seat: -1, bytes: 0 };
      clients.set(id, c);
      c.seat = takeSeat(id);
      hello(c, id);
      broadcast('lobby', lobby());
      req.on('close', () => leave(id));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/cmd') {
      const c = clients.get(url.searchParams.get('id') || '');
      let body = '';
      req.on('data', d => { body += d; if (body.length > 4096) req.destroy(); });
      req.on('end', () => {
        if (!c) { res.writeHead(410); res.end(); return; }
        try { route(c, JSON.parse(body)); } catch (e) { /* ignore malformed */ }
        res.writeHead(204); res.end();
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  // Keep idle SSE connections alive through phones' sleepy Wi-Fi.
  const ping = setInterval(() => { for (const c of clients.values()) write(c, ': ping\n\n'); }, 15000);
  server.on('close', () => clearInterval(ping));
  return { server: server, seats: seats, clients: clients };
}

// Both services in one process, wired through an in-process bus.
function createServer(opts) {
  opts = Object.assign({ interestRadius: +(process.env.INTEREST_RADIUS || 0) }, opts || {});
  const bus = createBus();
  const simSvc = startSimService(bus, opts);
  const gw = startGateway(bus, opts);
  gw.server.on('close', () => simSvc.stop());
  return { server: gw.server, get sim() { return simSvc.sim; }, seats: gw.seats, clients: gw.clients, bus: bus };
}

if (require.main === module) {
  const { server } = createServer();
  server.listen(PORT, '0.0.0.0', () => {
    console.log('Amann Assault LAN server running. Open one of these on each device:');
    const nets = os.networkInterfaces();
    for (const name in nets) for (const n of nets[name]) {
      if (n.family === 'IPv4' && !n.internal) console.log('  http://' + n.address + ':' + PORT + '/');
    }
    console.log('  http://localhost:' + PORT + '/   (this computer)');
    console.log('First to join flies blue, second flies red; empty seats are flown by the AI.');
  });
}

module.exports = { createServer };
