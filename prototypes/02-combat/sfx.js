// RADIANT WARFRONT — synthesized sound effects (Web Audio, no audio files).
// Render-side only: reads sim events, never touches sim state.
//
// Signal chain: voices -> dry bus + reverb send -> master gain -> compressor -> out.
// Every effect is built from oscillators and filtered noise with short envelopes,
// lightly randomized so rapid fire doesn't sound like a loop. Voices are budgeted
// per category so 12 ships firing at once stay punchy instead of a wall of noise.
(function (root) {
  'use strict';
  let ctx = null, master = null, dry = null, verbSend = null, noiseBuf = null;
  let volume = 0.7, muted = false;
  try {
    const v = parseFloat(localStorage.getItem('rw.sfx.volume'));
    if (v >= 0 && v <= 1) volume = v;
    muted = localStorage.getItem('rw.sfx.muted') === '1';
  } catch (e) {}

  function init() {
    if (ctx) return ctx;
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 6;
    comp.attack.value = 0.003; comp.release.value = 0.18;
    master = ctx.createGain();
    master.gain.value = muted ? 0 : volume;
    master.connect(comp); comp.connect(ctx.destination);
    dry = ctx.createGain(); dry.gain.value = 1; dry.connect(master);
    // Short generated room reverb: decaying stereo noise impulse.
    const verb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 1.4), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    verb.buffer = ir;
    verbSend = ctx.createGain(); verbSend.gain.value = 0.22;
    verbSend.connect(verb); verb.connect(master);
    // One shared second of white noise for every noise voice.
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    return ctx;
  }
  // Browsers only allow audio after a user gesture: call this from one.
  function unlock() {
    if (!init()) return;
    if (ctx.state === 'suspended') ctx.resume();
  }
  function ready() { return ctx && ctx.state === 'running' && !muted && volume > 0; }

  // --- voice budget: at most `max` voices per category per `win` seconds ---
  const budget = {};
  function allow(cat, max, win) {
    const now = ctx.currentTime, b = budget[cat] || (budget[cat] = []);
    while (b.length && b[0] < now - win) b.shift();
    if (b.length >= max) return false;
    b.push(now); return true;
  }

  // --- building blocks ---
  function out(pan, vol, wet) {
    const g = ctx.createGain(); g.gain.value = vol;
    let node = g;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan || 0));
      g.connect(p); node = p;
    }
    node.connect(dry);
    if (wet) { const s = ctx.createGain(); s.gain.value = wet; node.connect(s); s.connect(verbSend); }
    return g;
  }
  function env(param, t, peak, attack, decay) {
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(peak, t + attack);
    param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }
  function tone(dest, type, f0, f1, t, attack, decay, peak) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + attack + decay);
    env(g.gain, t, peak, attack, decay);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + attack + decay + 0.05);
    return o;
  }
  function noise(dest, filterType, f0, f1, q, t, attack, decay, peak) {
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    f.type = filterType; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + attack + decay);
    env(g.gain, t, peak, attack, decay);
    src.connect(f); f.connect(g); g.connect(dest);
    const off = Math.random() * 0.5;
    src.start(t, off); src.stop(t + attack + decay + 0.05);
  }
  const jit = (v, amt) => v * (1 + (Math.random() * 2 - 1) * amt);

  // --- the sounds ---
  const GUN = {
    // light blaster: bright zap, quick pitch drop
    fighter:     (d, t) => { tone(d, 'sawtooth', jit(1500, .08), 420, t, .002, .07, .22); noise(d, 'highpass', 3000, 3000, .7, t, .001, .03, .12); },
    interceptor: (d, t) => { tone(d, 'square', jit(2100, .08), 700, t, .001, .045, .14); noise(d, 'highpass', 4500, 4500, .7, t, .001, .02, .08); },
    // autocannon: punchy mid thud with grit
    heavy:       (d, t) => { tone(d, 'triangle', jit(340, .06), 95, t, .002, .11, .45); noise(d, 'bandpass', 1400, 500, 1.2, t, .001, .07, .35); },
    // flak: dry pop
    aaa:         (d, t) => { noise(d, 'bandpass', jit(900, .15), 300, 1.5, t, .001, .06, .4); tone(d, 'sine', 180, 80, t, .001, .05, .2); },
    // bomb release: low thoomp
    bomber:      (d, t) => { tone(d, 'sine', jit(160, .05), 48, t, .004, .22, .6); noise(d, 'lowpass', 900, 200, .8, t, .002, .14, .3); },
    // torpedo launch: rising whoosh with a hiss
    torpedo:     (d, t) => { noise(d, 'bandpass', 350, 1800, 2.5, t, .03, .45, .45); tone(d, 'sawtooth', 90, 160, t, .01, .4, .12); },
    // capital turret: big cannon with a long tail
    capital:     (d, t) => { tone(d, 'sine', jit(110, .04), 38, t, .003, .45, .75); noise(d, 'lowpass', 2400, 180, .7, t, .002, .35, .55); },
  };
  const GUN_WET = { capital: .5, torpedo: .3, bomber: .3, heavy: .15 };

  const api = {
    unlock: unlock,
    get volume() { return volume; },
    get muted() { return muted; },
    setVolume(v) {
      volume = Math.max(0, Math.min(1, v));
      if (master) master.gain.value = muted ? 0 : volume;
      try { localStorage.setItem('rw.sfx.volume', String(volume)); } catch (e) {}
    },
    setMuted(m) {
      muted = !!m;
      if (master) master.gain.value = muted ? 0 : volume;
      try { localStorage.setItem('rw.sfx.muted', muted ? '1' : '0'); } catch (e) {}
    },
    // pan -1..1 (screen left..right), vol 0..1 (distance falloff applied by the caller)
    shot(cls, pan, vol) {
      if (!ready() || vol < 0.04) return;
      const heavyGun = cls === 'capital' || cls === 'torpedo' || cls === 'bomber';
      if (!allow(heavyGun ? 'shotBig' : 'shot', heavyGun ? 4 : 9, 0.12)) return;
      (GUN[cls] || GUN.fighter)(out(pan, vol * 0.55, GUN_WET[cls] || 0.08), ctx.currentTime + Math.random() * 0.004);
    },
    // bullet impact; big = torpedo/bomb sized blast
    impact(big, pan, vol) {
      if (!ready() || vol < 0.04 || !allow(big ? 'impBig' : 'imp', big ? 4 : 6, 0.12)) return;
      const d = out(pan, vol * (big ? 0.7 : 0.25), big ? 0.35 : 0.05), t = ctx.currentTime;
      if (big) { tone(d, 'sine', 90, 35, t, .004, .5, .8); noise(d, 'lowpass', 3000, 150, .7, t, .002, .6, .7); }
      else noise(d, 'highpass', jit(2500, .3), 1200, .9, t, .001, .04, .5);
    },
    // a ship destroyed
    explosion(size, pan, vol) {
      if (!ready() || vol < 0.03 || !allow('boom', 3, 0.25)) return;
      const d = out(pan, vol * Math.min(1, 0.6 + size * 0.2), 0.45), t = ctx.currentTime, s = Math.max(1, size);
      tone(d, 'sine', 70 / Math.sqrt(s), 28, t, .005, .9 * Math.sqrt(s), .9);
      noise(d, 'lowpass', 4000, 120, .6, t, .004, 1.1 * Math.sqrt(s), .85);
      // crackle tail
      for (let i = 0; i < 6; i++) noise(d, 'highpass', 2000 + Math.random() * 3000, 1500, 1, t + .12 + Math.random() * .6, .001, .05, .25);
    },
    // capital weak point knocked out: metallic clang + crunch
    weakDown(pan, vol) {
      if (!ready() || !allow('weak', 2, 0.3)) return;
      const d = out(pan, Math.max(0.35, vol) * 0.7, 0.5), t = ctx.currentTime;
      const car = ctx.createOscillator(), mod = ctx.createOscillator(), mg = ctx.createGain(), g = ctx.createGain();
      car.frequency.value = 420; mod.frequency.value = 420 * 1.41; mg.gain.value = 600;
      mod.connect(mg); mg.connect(car.frequency); car.connect(g); g.connect(d);
      env(g.gain, t, .5, .002, 1.2);
      car.start(t); mod.start(t); car.stop(t + 1.3); mod.stop(t + 1.3);
      noise(d, 'bandpass', 1800, 400, 1.5, t, .002, .35, .6);
    },
    dodge(pan) {
      if (!ready() || !allow('dodge', 2, 0.2)) return;
      const d = out(pan, 0.4, 0.15), t = ctx.currentTime;
      noise(d, 'bandpass', 2400, 500, 3, t, .02, .32, .55);
    },
    lock(quality) { // your held ship locked a target; higher pitch = better entry
      if (!ready() || !allow('lock', 2, 0.25)) return;
      const d = out(0, 0.22, 0.05), t = ctx.currentTime, f = 700 + 500 * quality;
      tone(d, 'square', f, f, t, .002, .05, .25);
      tone(d, 'square', f * 1.5, f * 1.5, t + .07, .002, .06, .25);
    },
    order() {
      if (!ready()) return;
      const d = out(0, 0.25, 0.05), t = ctx.currentTime;
      tone(d, 'triangle', 660, 990, t, .003, .09, .5);
    },
    select() {
      if (!ready()) return;
      const d = out(0, 0.2, 0.03), t = ctx.currentTime;
      tone(d, 'sine', 1200, 1500, t, .002, .05, .45);
    },
    ui() {
      if (!ready()) return;
      const d = out(0, 0.22, 0.02), t = ctx.currentTime;
      tone(d, 'square', 520, 520, t, .001, .03, .3); tone(d, 'square', 780, 780, t + .035, .001, .04, .25);
    },
    // title/menu sting
    sting() {
      if (!ready()) return;
      const d = out(0, 0.35, 0.6), t = ctx.currentTime;
      [196, 247, 294, 392].forEach((f, i) => tone(d, 'sawtooth', f, f * 0.995, t + i * 0.09, .01, .9, .18));
      tone(d, 'sine', 49, 40, t, .02, 1.6, .5);
    },
  };
  root.SFX = api;
})(typeof self !== 'undefined' ? self : this);
