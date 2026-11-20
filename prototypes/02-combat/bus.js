// AMANN ASSAULT — tiny in-process message bus with NATS-style subjects.
//
// Subjects are dot-separated tokens. Subscriptions may use NATS wildcards:
//   '*'  matches exactly one token      cmd.*        -> cmd.0, cmd.1
//   '>'  matches one or more trailing   state.>      -> state.full, state.player.1
// The LAN server routes everything through this, so the services (gateway,
// sim, later collision/visibility workers and shards) only talk via subjects.
// Swapping this module for a real NATS client keeps the same shape:
// publish(subject, msg) / subscribe(subject, handler) -> unsubscribe().
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
  return {
    publish(subject, msg) {
      for (const sub of subs.slice()) if (matches(sub.pattern, subject)) sub.handler(msg, subject);
    },
    subscribe(pattern, handler) {
      const sub = { pattern: pattern, handler: handler };
      subs.push(sub);
      return () => { const i = subs.indexOf(sub); if (i >= 0) subs.splice(i, 1); };
    },
    get subscriptions() { return subs.length; },
  };
}

module.exports = { createBus, matches };
