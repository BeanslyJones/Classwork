// AMANN ASSAULT — tiny in-process message bus with NATS-style subjects.
//
// Subjects are dot-separated tokens. Subscriptions may use NATS wildcards:
//   '*'  matches exactly one token      cmd.*        -> cmd.0, cmd.1
//   '>'  matches one or more trailing   state.>      -> state.full, state.player.1
// Services (gateway, sim, weather agents, later shards) only talk via subjects.
// Swapping this module for a real NATS client keeps the same shape:
//   publish(subject, msg[, replyTo])
//   subscribe(subject, handler(msg, subject, replyTo)) -> unsubscribe()
//   request(subject, msg[, timeoutMs]) -> Promise(reply)   (NATS request/reply)
// Loads in Node (require) and in the browser (window.Bus).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Bus = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function matches(pattern, subject) {
    const p = pattern.split('.'), s = subject.split('.');
    for (let i = 0; i < p.length; i++) {
      if (p[i] === '>') return s.length > i;
      if (i >= s.length) return false;
      if (p[i] !== '*' && p[i] !== s[i]) return false;
    }
    return p.length === s.length;
  }

  function createBus() {
    const subs = [];
    let inbox = 0;
    const bus = {
      publish(subject, msg, replyTo) {
        for (const sub of subs.slice()) if (matches(sub.pattern, subject)) sub.handler(msg, subject, replyTo);
      },
      subscribe(pattern, handler) {
        const sub = { pattern: pattern, handler: handler };
        subs.push(sub);
        return () => { const i = subs.indexOf(sub); if (i >= 0) subs.splice(i, 1); };
      },
      // Ask one responder and wait for its answer on a private inbox subject.
      request(subject, msg, timeoutMs) {
        return new Promise((resolve, reject) => {
          const replyTo = '_INBOX.' + (++inbox);
          let timer = null;
          const off = bus.subscribe(replyTo, reply => { off(); if (timer) clearTimeout(timer); resolve(reply); });
          timer = setTimeout(() => { off(); reject(new Error('no reply on ' + subject)); }, timeoutMs || 2000);
          bus.publish(subject, msg, replyTo);
        });
      },
      get subscriptions() { return subs.length; },
    };
    return bus;
  }

  return { createBus: createBus, matches: matches };
});
