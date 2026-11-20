// Headless check of the LAN server. Run: node server.test.js
'use strict';
const http = require('http');
const { createServer } = require('./server.js');
const { createBus, matches } = require('../shared/bus.js');

let failures = 0;
function assert(cond, label) {
  if (cond) console.log('  PASS  ' + label);
  else { failures++; console.error('  FAIL  ' + label); }
}
const wait = ms => new Promise(r => setTimeout(r, ms));

// Minimal SSE client: collects events by type.
function connect(port) {
  return new Promise((resolve, reject) => {
    const c = { hello: null, lastSnap: null, lobby: null, req: null, wx: [], perf: null };
    c.req = http.get({ host: '127.0.0.1', port: port, path: '/events' }, res => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          let type = 'message', data = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('event: ')) type = line.slice(7);
            else if (line.startsWith('data: ')) data += line.slice(6);
          }
          if (!data) continue;
          const obj = JSON.parse(data);
          if (type === 'hello') { c.hello = obj; resolve(c); }
          if (type === 'snap') c.lastSnap = obj;
          if (type === 'lobby') c.lobby = obj;
          if (type === 'wx') c.wx.push(obj);
          if (type === 'perf') c.perf = obj;
        }
      });
    });
    c.req.on('error', reject);
  });
}
function post(port, id, cmd) {
  return new Promise(resolve => {
    const req = http.request({ host: '127.0.0.1', port: port, path: '/cmd?id=' + id, method: 'POST' }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.end(JSON.stringify(cmd));
  });
}
function get(port, path) {
  return new Promise(resolve => http.get({ host: '127.0.0.1', port: port, path: path }, res => {
    let body = ''; res.on('data', d => body += d); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: body }));
  }));
}

(async () => {
  const srv = createServer();
  await new Promise(r => srv.server.listen(0, '127.0.0.1', r));
  const port = srv.server.address().port;
  console.log('\n[LAN server]');

  const root = await get(port, '/');
  assert(root.status === 302 && root.headers.location === '/combat.html?net=1', 'root redirects to the game in network mode');
  const page = await get(port, '/combat.html');
  assert(page.status === 200 && page.body.includes('EventSource'), 'serves the game page');
  assert((await get(port, '/server.js')).status === 404, 'does not serve arbitrary files');

  const a = await connect(port);
  assert(a.hello.seat === 0, 'first to join flies blue');
  await wait(100);
  assert(srv.sim.human[0] === true && srv.sim.human[1] === false, 'red stays AI with one player');
  const b = await connect(port);
  assert(b.hello.seat === 1, 'second to join flies red');
  await wait(100);
  assert(srv.sim.human[1] === true, 'red handed to the second player');
  const c = await connect(port);
  assert(c.hello.seat === -1, 'third player spectates');

  // Each side grabs one of its own ships; red also tries to grab a blue ship.
  const blueShip = srv.sim.units.find(u => u.team === 0).id;
  const redShip = srv.sim.units.find(u => u.team === 1).id;
  await post(port, a.hello.id, { type: 'grab', unit: blueShip });
  await post(port, b.hello.id, { type: 'grab', unit: redShip });
  await post(port, c.hello.id, { type: 'grab', unit: blueShip + 1 });
  await wait(250);
  assert(a.lastSnap && a.lastSnap.held[0] === blueShip, 'blue holds its ship (seen in snapshot)');
  assert(b.lastSnap && b.lastSnap.held[1] === redShip, 'red holds its ship (seen in snapshot)');
  assert(srv.sim.units[blueShip + 1].held === false, 'spectator cannot grab');
  await post(port, b.hello.id, { type: 'grab', unit: blueShip + 2 });
  await wait(150);
  assert(srv.sim.held[1] === redShip, "red cannot grab blue's ships");

  // Aim + release steers the ship (it turns toward the aim at its own rate).
  await post(port, b.hello.id, { type: 'aim', angle: 1.0 });
  await post(port, b.hello.id, { type: 'release' });
  await wait(150);
  const rs = srv.sim.units[redShip];
  assert(srv.sim.held[1] === -1 && (rs.goal === null ? Math.abs(rs.heading - 1.0) < 0.05 : Math.abs(rs.goal - 1.0) < 1e-6),
    'red release sends its ship turning toward its aim (no snap)');

  // Shared speed setting reaches everyone.
  await post(port, a.hello.id, { type: 'speed', value: 1.5 });
  await wait(150);
  assert(b.lobby && b.lobby.speed === 1.5, 'game speed change is shared');

  // Red leaves: the spectator takes the seat.
  b.req.destroy();
  await wait(250);
  assert(srv.sim.human[1] === true && srv.seats[1] === c.hello.id, 'spectator takes over the empty red seat');
  c.req.destroy();
  await wait(250);
  assert(srv.sim.human[1] === false, 'red goes back to the AI when nobody is left to fly it');

  // Destroy the Carrier over LAN: switch mode, build a ship.
  await post(port, a.hello.id, { type: 'restart', mode: 'carrier' });
  await wait(250);
  assert(srv.sim.mode === 'carrier' && a.lastSnap && a.lastSnap.mode === 'carrier', 'any player can switch the shared game to Destroy the Carrier');
  const before = srv.sim.queue[0].length + srv.sim.units.length;
  await post(port, a.hello.id, { type: 'build', cls: 'fighter' });
  await wait(150);
  assert(srv.sim.queue[0].length + srv.sim.units.length > before, 'blue can order a build from its carrier');
  assert(a.lastSnap.money && a.lastSnap.money.length === 2, 'snapshots carry both sides\' money');

  // Beat mode over LAN: switch mode + song, move a ship to another lane.
  await post(port, a.hello.id, { type: 'restart', mode: 'beat', song: 'drift' });
  await wait(250);
  assert(srv.sim.mode === 'beat' && srv.sim.songId === 'drift', 'any player can start beat mode with a chosen song');
  const myShip = srv.sim.units.find(u => u.team === 0);
  await post(port, a.hello.id, { type: 'lane', unit: myShip.id, lane: 'keys' });
  await wait(150);
  assert(srv.sim.units[myShip.id].lane === 'keys', 'a player can put their ship on a lane');
  assert(a.lastSnap && a.lastSnap.song === 'drift', 'snapshots say which song is playing');

  // Stress test over LAN: lots of ships, weather sampled on every ship.
  const wxBefore = a.wx.length;
  await post(port, a.hello.id, { type: 'restart', mode: 'stress', count: 200 });
  await wait(1300);
  assert(srv.sim.mode === 'stress' && srv.sim.units.length === 400, 'any player can start a stress test (200 ships a side)');
  assert(a.hello.count === 200 && a.hello.mode === 'stress', 'screens are told the mode and ship count');
  assert(srv.sim.units.filter(u => u.state === 'alive').every(u => u.zone >= 0 && u.zone < 4), 'the server knows which radiation zone every ship is in');
  assert(a.perf && a.perf.ships === 400 && a.perf.stepMs > 0 && a.perf.snapKB > 0 && a.perf.outKBs > 0,
    'performance reports reach the screens (tick ' + (a.perf && a.perf.stepMs) + ' ms, snapshot ' + (a.perf && a.perf.snapKB) + ' KB, ' + (a.perf && a.perf.outKBs) + ' KB/s out)');
  const sky = a.wx.slice(wxBefore);
  assert(sky.length >= 3 && sky[0].kf === 0, 'weather keyframes stream to the screen (' + sky.length + ' of the new sky)');
  const capNow = Math.floor(srv.sim.tick / 3 / 5) + 2;
  assert(sky.every(k => k.kf <= capNow), 'a screen never gets weather more than 2 keyframes ahead');
  const wxGot = await get(port, '/wx?kf=1');
  assert(wxGot.status === 200 && JSON.parse(wxGot.body).kf === 1, 'a screen can fetch a missed keyframe from the log');
  const far = await get(port, '/wx?kf=' + (capNow + 50));
  assert(far.status === 404, 'but not one from the future');
  assert((await get(port, '/shared/wx/render.js')).status === 200 && (await get(port, '/shared/../server.js')).status === 404,
    'serves the shared weather scripts and nothing else');

  // Snapshots stay in step with the server sim.
  const t0 = a.lastSnap.tick;
  await wait(400);
  assert(a.lastSnap.tick > t0, 'snapshots keep streaming (tick ' + t0 + ' -> ' + a.lastSnap.tick + ')');

  a.req.destroy();
  srv.server.close();

  // --- Message bus: NATS-style subjects. ---
  console.log('\n[message bus]');
  assert(matches('cmd.*', 'cmd.1') && !matches('cmd.*', 'cmd.1.x') && !matches('cmd.*', 'ctl'), "'*' matches exactly one token");
  assert(matches('state.>', 'state.full') && matches('state.>', 'state.player.1') && !matches('state.>', 'state'), "'>' matches one or more trailing tokens");
  const bus = createBus(), got = [];
  const off = bus.subscribe('cmd.*', (m, s) => got.push(s + ':' + m.n));
  bus.publish('cmd.0', { n: 1 }); bus.publish('ctl', { n: 2 }); off(); bus.publish('cmd.1', { n: 3 });
  assert(got.join() === 'cmd.0:1', 'subscribers get only matching subjects, and unsubscribe works');
  bus.subscribe('echo', (m, subj, replyTo) => { if (replyTo) bus.publish(replyTo, { n: m.n * 2 }); });
  const reply = await bus.request('echo', { n: 21 });
  assert(reply.n === 42, 'request/reply: the responder answers on a private inbox');
  let timedOut = false;
  try { await bus.request('nobody.home', {}, 50); } catch (e) { timedOut = true; }
  assert(timedOut && bus.subscriptions === 1, 'a request with no responder times out and cleans up its inbox');

  // --- Interest filtering: each seat receives only ships near its own. ---
  console.log('\n[interest filtering]');
  const srv2 = createServer({ interestRadius: 250 });
  await new Promise(r => srv2.server.listen(0, '127.0.0.1', r));
  const p2 = srv2.server.address().port;
  const v = await connect(p2);
  await wait(400);
  assert(v.lastSnap && Array.isArray(v.lastSnap.ids), 'a seated player gets a filtered snapshot (with ship ids)');
  assert(v.lastSnap.units.length < srv2.sim.units.length, 'it carries fewer ships than the whole battle (' + v.lastSnap.units.length + ' of ' + srv2.sim.units.length + ')');
  v.req.destroy();
  srv2.server.close();

  console.log('\n' + (failures === 0 ? 'ALL SERVER TESTS PASSED' : failures + ' FAILURE(S)'));
  process.exit(failures === 0 ? 0 : 1);
})();
