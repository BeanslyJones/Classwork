// Headless check of the LAN server. Run: node server.test.js
'use strict';
const http = require('http');
const { createServer } = require('./server.js');

let failures = 0;
function assert(cond, label) {
  if (cond) console.log('  PASS  ' + label);
  else { failures++; console.error('  FAIL  ' + label); }
}
const wait = ms => new Promise(r => setTimeout(r, ms));

// Minimal SSE client: collects events by type.
function connect(port) {
  return new Promise((resolve, reject) => {
    const c = { hello: null, lastSnap: null, lobby: null, req: null };
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

  // Snapshots stay in step with the server sim.
  const t0 = a.lastSnap.tick;
  await wait(400);
  assert(a.lastSnap.tick > t0, 'snapshots keep streaming (tick ' + t0 + ' -> ' + a.lastSnap.tick + ')');

  a.req.destroy();
  srv.server.close();
  console.log('\n' + (failures === 0 ? 'ALL SERVER TESTS PASSED' : failures + ' FAILURE(S)'));
  process.exit(failures === 0 ? 0 : 1);
})();
