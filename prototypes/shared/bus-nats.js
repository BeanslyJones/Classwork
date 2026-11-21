// AMANN ASSAULT — the same bus API as bus.js, on a real NATS server.
//
//   const bus = await connectBus('nats://localhost:4222');
//   bus.publish(subject, msg[, replyTo]) / bus.subscribe(pattern, handler(msg, subject, replyTo))
//   bus.request(subject, msg[, timeoutMs]) -> Promise(reply)
//
// Subjects and wildcards ('*', '>') are NATS's own, so nothing else changes.
// One difference from the in-process bus: delivery is asynchronous (a message
// arrives a moment later, not during publish()). Every service already copes,
// because none of them assumes an answer arrives in the same call.
//
// Needs the `nats` npm package (run `npm install` in the repo folder) and a
// running nats-server. Without BUS set, the game uses the in-process bus and
// needs neither.
'use strict';

async function connectBus(url) {
  let nats;
  try { nats = require('nats'); } catch (e) {
    throw new Error('BUS=' + url + ' needs the nats package: run "npm install" in the repo folder first.');
  }
  const nc = await nats.connect({ servers: url, name: 'amann-assault' });
  const jc = nats.JSONCodec();
  const enc = m => jc.encode(m === undefined ? null : m);
  return {
    nats: true,
    url: url,
    publish(subject, msg, replyTo) {
      nc.publish(subject, enc(msg), replyTo ? { reply: replyTo } : undefined);
    },
    subscribe(pattern, handler) {
      const sub = nc.subscribe(pattern, {
        callback: (err, m) => {
          if (err) return;
          let data;
          try { data = jc.decode(m.data); } catch (e) { return; } // ignore non-JSON
          try { handler(data, m.subject, m.reply); } catch (e) { console.error('bus handler error on ' + m.subject + ':', e); }
        },
      });
      return () => sub.unsubscribe();
    },
    request(subject, msg, timeoutMs) {
      return nc.request(subject, enc(msg), { timeout: timeoutMs || 2000 }).then(m => jc.decode(m.data));
    },
    get subscriptions() { return -1; }, // not tracked on NATS
    close() { return nc.drain(); },
  };
}

module.exports = { connectBus };
