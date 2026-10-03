// RADIANT WARFRONT — 02 combat, LAN multiplayer server.
// Run on any computer on your Wi-Fi:   node server.js   (optional: PORT=8080)
// Then open the printed address on each phone/computer. No npm install needed.
//
// The server owns the one true Sim and steps it at the fixed tick rate. Clients
// send semantic commands (grab / aim / release / dodge / refocus) over HTTP POST
// and receive state snapshots over Server-Sent Events. Clients never step a sim,
// so different browsers' floating-point maths can't drift apart.
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

const PORT = parseInt(process.env.PORT || '8080', 10);
const SNAP_HZ = 30;
const ROOT = __dirname;
const STATIC = { '/combat.html': 'text/html; charset=utf-8', '/sim.js': 'text/javascript; charset=utf-8' };

function createServer() {
  let seed = (Math.random() * 0xFFFFFFFF) >>> 0;
  let overrides = {};
  let sim = null;
  let speed = 0.5, paused = false;
  const clients = new Map(); // id -> { res, seat }
  const seats = [null, null]; // client id flying each team
  let pendingEvents = [];

  function newSim() {
    sim = new Sim(seed, overrides);
    sim.human = [seats[0] !== null, seats[1] !== null];
    pendingEvents = [];
  }
  newSim();

  function send(res, type, data) { res.write('event: ' + type + '\ndata: ' + JSON.stringify(data) + '\n\n'); }
  function broadcast(type, data) { for (const c of clients.values()) send(c.res, type, data); }
  function lobby() {
    return { seats: seats.map(s => s !== null), players: clients.size, speed: speed, paused: paused, seed: seed, overrides: overrides };
  }
  function hello(c, id) { send(c.res, 'hello', Object.assign({ id: id, seat: c.seat }, lobby())); }

  function takeSeat(id) {
    for (let t = 0; t < 2; t++) if (seats[t] === null) { seats[t] = id; sim.setHuman(t, true); return t; }
    return -1;
  }
  function leave(id) {
    const c = clients.get(id);
    if (!c) return;
    clients.delete(id);
    if (c.seat >= 0 && seats[c.seat] === id) {
      seats[c.seat] = null;
      sim.setHuman(c.seat, false);
      // Hand the empty seat to a spectator if one is waiting.
      for (const [oid, oc] of clients) if (oc.seat < 0) { oc.seat = c.seat; seats[c.seat] = oid; sim.setHuman(c.seat, true); hello(oc, oid); break; }
    }
    broadcast('lobby', lobby());
  }

  function handleCommand(c, cmd) {
    if (!cmd || typeof cmd.type !== 'string') return;
    switch (cmd.type) {
      case 'grab': case 'aim': case 'release': case 'dodge': case 'refocus':
        if (c.seat < 0) return; // spectators can't fly
        sim.command({ type: cmd.type, unit: cmd.unit | 0, angle: +cmd.angle, team: c.seat });
        return;
      case 'speed':
        if (+cmd.value >= 0.1 && +cmd.value <= 2) speed = +cmd.value;
        broadcast('lobby', lobby());
        return;
      case 'pause':
        paused = !!cmd.value; broadcast('lobby', lobby());
        return;
      case 'restart':
        if (cmd.newSeed) seed = (Math.random() * 0xFFFFFFFF) >>> 0;
        newSim();
        for (const [id, oc] of clients) hello(oc, id);
        return;
      case 'tune':
        if (!(cmd.key in TUNABLES)) return;
        const t = TUNABLES[cmd.key], v = +cmd.value;
        if (!(v >= t.min && v <= t.max)) return;
        overrides[cmd.key] = v;
        sim.T[cmd.key] = v; // structural ones (hazards, arena) apply on next restart
        broadcast('lobby', lobby());
        return;
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
        try { handleCommand(c, JSON.parse(body)); } catch (e) { /* ignore malformed */ }
        res.writeHead(204); res.end();
      });
      return;
    }
    res.writeHead(404); res.end();
  });

  // Fixed-tick loop, scaled by the shared game speed. Snapshots go out every loop.
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
      for (const e of sim.events) if (e.type === 'detonation' || e.type === 'weakDown') pendingEvents.push(e);
      acc -= stepLen; n++;
    }
    if (clients.size) { broadcast('snap', sim.snapshot(pendingEvents)); pendingEvents = []; }
  }, 1000 / SNAP_HZ);
  // Keep idle SSE connections alive through phones' sleepy Wi-Fi.
  const ping = setInterval(() => { for (const c of clients.values()) c.res.write(': ping\n\n'); }, 15000);

  server.on('close', () => { clearInterval(timer); clearInterval(ping); });
  return { server: server, get sim() { return sim; }, seats: seats, clients: clients };
}

if (require.main === module) {
  const { server } = createServer();
  server.listen(PORT, '0.0.0.0', () => {
    console.log('Radiant Warfront LAN server running. Open one of these on each device:');
    const nets = os.networkInterfaces();
    for (const name in nets) for (const n of nets[name]) {
      if (n.family === 'IPv4' && !n.internal) console.log('  http://' + n.address + ':' + PORT + '/');
    }
    console.log('  http://localhost:' + PORT + '/   (this computer)');
    console.log('First to join flies blue, second flies red; empty seats are flown by the AI.');
  });
}

module.exports = { createServer };
