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
const { Sim, TUNABLES } = require('./sim.js');
const { createBus } = require('./bus.js');

const PORT = parseInt(process.env.PORT || '8080', 10);
const SNAP_HZ = 30;
const ROOT = __dirname;
const STATIC = { '/combat.html': 'text/html; charset=utf-8', '/sim.js': 'text/javascript; charset=utf-8', '/sfx.js': 'text/javascript; charset=utf-8' };
// Events screens need for effects and sound (everything else stays server-side).
const FORWARD = new Set(['detonation', 'weakDown', 'fired', 'crystallizing', 'dodge', 'locked', 'built', 'salvage', 'victory', 'refocus']);
const MODES = ['skirmish', 'carrier'];
const FLY = new Set(['grab', 'aim', 'release', 'dodge', 'refocus', 'order']);

// ---------------------------------------------------------------- SIM service
function startSimService(bus, opts) {
  let seed = (Math.random() * 0xFFFFFFFF) >>> 0;
  let overrides = {};
  let mode = 'skirmish';
  let sim = null;
  let speed = 0.5, paused = false;
  const humans = [false, false];
  let pendingEvents = [];
  const interest = opts.interestRadius > 0 ? opts.interestRadius : 0;

  function newSim() {
    sim = new Sim(seed, overrides, null, { mode: mode });
    sim.human = humans.slice();
    pendingEvents = [];
  }
  newSim();
  const settings = () => ({ speed: speed, paused: paused, seed: seed, overrides: overrides, mode: mode });
  const publishSettings = () => bus.publish('sim.settings', settings());

  // Seats: the gateway tells us which sides a person is flying.
  bus.subscribe('seat.*', (msg, subject) => {
    const team = +subject.split('.')[1];
    humans[team] = !!msg.human;
    sim.setHuman(team, !!msg.human);
  });
  // Flying and building: one subject per seat.
  bus.subscribe('cmd.*', (cmd, subject) => {
    const team = +subject.split('.')[1];
    if (!(team === 0 || team === 1) || !cmd || typeof cmd.type !== 'string') return;
    if (FLY.has(cmd.type)) {
      sim.command({ type: cmd.type, unit: Number.isInteger(cmd.unit) ? cmd.unit : undefined, angle: +cmd.angle, team: team });
    } else if (cmd.type === 'build' && typeof cmd.cls === 'string') {
      sim.command({ type: 'build', cls: cmd.cls, team: team });
    }
  });
  // Shared settings any player may change.
  bus.subscribe('ctl', cmd => {
    if (!cmd || typeof cmd.type !== 'string') return;
    switch (cmd.type) {
      case 'speed':
        if (+cmd.value >= 0.1 && +cmd.value <= 2) speed = +cmd.value;
        return publishSettings();
      case 'pause':
        paused = !!cmd.value;
        return publishSettings();
      case 'restart':
        if (cmd.newSeed) seed = (Math.random() * 0xFFFFFFFF) >>> 0;
        if (MODES.indexOf(cmd.mode) >= 0) mode = cmd.mode;
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
      sim.step();
      for (const e of sim.events) if (FORWARD.has(e.type)) pendingEvents.push(e.type === 'fired' ? { type: 'fired', unit: e.unit } : e);
      acc -= stepLen; n++;
    }
    if (interest) {
      for (const team of [0, 1]) bus.publish('state.player.' + team, sim.snapshot(pendingEvents, { team: team, radius: interest }));
    }
    bus.publish('state.full', sim.snapshot(pendingEvents)); // spectators (and everyone when not filtering)
    pendingEvents = [];
  }, 1000 / SNAP_HZ);

  publishSettings();
  return { get sim() { return sim; }, settings: settings, stop() { clearInterval(timer); } };
}

// ------------------------------------------------------------ GATEWAY service
function startGateway(bus, opts) {
  const clients = new Map(); // id -> { res, seat }
  const seats = [null, null]; // client id flying each team
  let settings = {};
  const filtered = opts.interestRadius > 0;

  function send(res, type, data) { res.write('event: ' + type + '\ndata: ' + JSON.stringify(data) + '\n\n'); }
  function broadcast(type, data) { for (const c of clients.values()) send(c.res, type, data); }
  function lobby() { return Object.assign({ seats: seats.map(s => s !== null), players: clients.size }, settings); }
  function hello(c, id) { send(c.res, 'hello', Object.assign({ id: id, seat: c.seat }, lobby())); }

  bus.subscribe('sim.settings', s => { settings = s; broadcast('lobby', lobby()); });
  bus.subscribe('sim.restarted', () => { for (const [id, c] of clients) hello(c, id); });
  bus.subscribe('state.full', snap => {
    const json = JSON.stringify(snap);
    for (const c of clients.values()) if (!filtered || c.seat < 0) c.res.write('event: snap\ndata: ' + json + '\n\n');
  });
  bus.subscribe('state.player.*', (snap, subject) => {
    const team = +subject.split('.')[2], json = JSON.stringify(snap);
    for (const c of clients.values()) if (c.seat === team) c.res.write('event: snap\ndata: ' + json + '\n\n');
  });

  function takeSeat(id) {
    for (let t = 0; t < 2; t++) if (seats[t] === null) { seats[t] = id; bus.publish('seat.' + t, { human: true }); return t; }
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
      fs.readFile(path.join(ROOT, url.pathname), (err, buf) => {
        if (err) { res.writeHead(500); res.end(); return; }
        res.writeHead(200, { 'Content-Type': STATIC[url.pathname], 'Cache-Control': 'no-store' });
        res.end(buf);
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(': connected\n\n');
      const id = crypto.randomBytes(8).toString('hex');
      const c = { res: res, seat: -1 };
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
  const ping = setInterval(() => { for (const c of clients.values()) c.res.write(': ping\n\n'); }, 15000);
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
