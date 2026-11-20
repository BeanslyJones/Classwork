// WEATHER — drawing (browser only). Shared by the weather viewer and the battle.
// Shades the field at a reduced resolution, upscales it, and adds sparks where
// two zones push into each other. Looks only: nothing here changes the game.
//
//   const r = createRenderer({ dim: 0.6 });
//   r.draw(ctx, client, cam, dt)   cam = { W, H, x0, y0, upp, fitUpp }
//     x0, y0  weather-world point at the screen's top-left (CSS pixels)
//     upp     weather-world units per CSS pixel
//     fitUpp  upp when the whole map fits (keeps seams/sparks steady when zoomed)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.Wx = root.Wx || {}).render = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COL = [[255, 122, 69], [226, 103, 216], [63, 201, 160], [232, 210, 122]]; // cinder, bloom, brine, halo
  const W8 = 4; // one local-detail nudge per W8 x W8 samples, blended between (it's smooth)

  function createRenderer(options) {
    // every: reshade the field once per this many frames; in between, the last
    // picture is moved/scaled with the camera (the sky changes slowly).
    const view = Object.assign({ layer: 'local', seamWidth: 0.16, pScale: 8, sparks: 1, pixel: 3, dim: 1, every: 1 }, options || {});
    let frameNo = 0, shot = null; // shot = camera of the last shaded picture
    const low = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    const lctx = low && low.getContext('2d');
    let img = null, warpX = new Float32Array(0), warpY = new Float32Array(0);
    const out = new Float64Array(12), wv = [0, 0], sparks = [], cand = [];
    let candN = 0, seamW = view.seamWidth;
    const stats = { ms: 0, sparks: 0 };

    function shade(d, i, o, nudge) {
      const c = COL[o[0]], m = o[2];
      const e = m < seamW ? 1 - m / seamW : 0;                      // 1 on the seam, 0 inside
      const k = (0.30 + 0.24 * Math.min(1, m * 2.4) + 0.07 * nudge) * view.dim;
      const pn = o[4] / view.pScale;
      const heat = e * e * e * (pn > 0 ? (pn > 1 ? 1 : pn) : 0);
      const tear = e * e * (pn < 0 ? (pn < -1 ? 1 : -pn) : 0);
      // Seam colour: every gas blended by its share, so it never jumps.
      const s0 = o[8], s1 = o[9], s2 = o[10], s3 = o[11];
      const mr = s0 * COL[0][0] + s1 * COL[1][0] + s2 * COL[2][0] + s3 * COL[3][0];
      const mg = s0 * COL[0][1] + s1 * COL[1][1] + s2 * COL[2][1] + s3 * COL[3][1];
      const mb = s0 * COL[0][2] + s1 * COL[1][2] + s2 * COL[2][2] + s3 * COL[3][2];
      const mixw = e * e * 0.75, dark = 1 - 0.6 * tear, hot = (0.75 + 0.6 * heat) * view.dim;
      let r = (c[0] * k * (1 - mixw) + mr * mixw * hot) * dark + 120 * heat * view.dim;
      let g = (c[1] * k * (1 - mixw) + mg * mixw * hot) * dark + 110 * heat * view.dim;
      let b = (c[2] * k * (1 - mixw) + mb * mixw * hot) * dark + 95 * heat * view.dim;
      d[i] = r > 255 ? 255 : r; d[i + 1] = g > 255 ? 255 : g; d[i + 2] = b > 255 ? 255 : b; d[i + 3] = 255;
      return heat;
    }

    function drawField(ctx, client, cam) {
      const px = view.pixel, bw = Math.ceil(cam.W / px), bh = Math.ceil(cam.H / px);
      if (low.width !== bw || low.height !== bh) { low.width = bw; low.height = bh; img = lctx.createImageData(bw, bh); }
      const d = img.data, upp = cam.upp * px, x0 = cam.x0, y0 = cam.y0, layer = view.layer;
      const lw = Math.ceil(bw / W8) + 2, lh = Math.ceil(bh / W8) + 2;
      if (layer === 'local') {
        if (warpX.length < lw * lh) { warpX = new Float32Array(lw * lh); warpY = new Float32Array(lw * lh); }
        for (let j = 0; j < lh; j++) for (let i = 0; i < lw; i++) {
          client.warpAt(x0 + i * W8 * upp, y0 + j * W8 * upp, wv);
          warpX[j * lw + i] = wv[0]; warpY[j * lw + i] = wv[1];
        }
      }
      candN = 0;
      seamW = view.seamWidth * Math.pow(Math.min(1, cam.upp / cam.fitUpp), 0.75);
      const Dn = client.opts.D > 0 ? client.opts.D * 0.7071 : 1;
      for (let y = 0; y < bh; y++) {
        const wy = y0 + y * upp;
        for (let x = 0; x < bw; x++) {
          const wx = x0 + x * upp, i = (y * bw + x) * 4;
          if (layer === 'global') {
            const c = COL[client.gasGlobal(wx, wy)], k = 0.5 * view.dim;
            d[i] = c[0] * k; d[i + 1] = c[1] * k; d[i + 2] = c[2] * k; d[i + 3] = 255;
            continue;
          }
          let sx = wx, sy = wy, nudge = 0;
          if (layer === 'local') {
            const fx = x / W8, fy = y / W8, ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy, o = iy * lw + ix;
            const dx = (warpX[o] * (1 - tx) + warpX[o + 1] * tx) * (1 - ty) + (warpX[o + lw] * (1 - tx) + warpX[o + lw + 1] * tx) * ty;
            const dy = (warpY[o] * (1 - tx) + warpY[o + 1] * tx) * (1 - ty) + (warpY[o + lw] * (1 - tx) + warpY[o + lw + 1] * tx) * ty;
            sx += dx; sy += dy; nudge = dx / Dn;
          }
          client.sampleRegional(sx, sy, out);
          const heat = shade(d, i, out, nudge);
          if (heat > 0.25 && candN < 600 && Math.random() < 0.08) {
            cand[candN++] = [wx, wy, out[5], out[6], heat, out[0], out[1]];
          }
        }
      }
      if (layer === 'global') { // the map has no glow: mark seams where neighbours differ
        for (let y = 0; y < bh - 1; y++) for (let x = 0; x < bw - 1; x++) {
          const i = (y * bw + x) * 4, r = i + 4, dn = i + bw * 4;
          if (d[i] !== d[r] || d[i + 1] !== d[r + 1] || d[i] !== d[dn] || d[i + 1] !== d[dn + 1]) { d[i] = d[i + 1] = d[i + 2] = 235 * view.dim; }
        }
      }
      lctx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(low, 0, 0, bw * px, bh * px);
    }

    function updateSparks(dt, cam) {
      const z = cam.upp / cam.fitUpp;
      const rate = view.sparks * candN * 0.5 * dt * 6 * Math.min(1, z * z * 4); // same density in the world at any zoom
      for (let k = 0; k < rate && sparks.length < 900; k++) {
        const c = cand[(Math.random() * candN) | 0];
        if (!c) break;
        const a = Math.random() * 6.2832, s = 8 + 30 * c[4] * Math.random();
        sparks.push({ x: c[0], y: c[1], vx: c[2] * 2 + Math.cos(a) * s, vy: c[3] * 2 + Math.sin(a) * s,
                      life: 0, max: 0.35 + Math.random() * 0.7, col: Math.random() < 0.5 ? c[5] : c[6] });
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.life += dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= 1 - 1.5 * dt; s.vy *= 1 - 1.5 * dt;
        if (s.life >= s.max) sparks.splice(i, 1);
      }
    }
    function drawSparks(ctx, cam) {
      if (!sparks.length) return;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const sz = Math.max(1.2, Math.min(4, 2.4 * cam.fitUpp / cam.upp));
      for (const s of sparks) {
        const sx = (s.x - cam.x0) / cam.upp, sy = (s.y - cam.y0) / cam.upp;
        if (sx < -10 || sy < -10 || sx > cam.W + 10 || sy > cam.H + 10) continue;
        const a = (1 - s.life / s.max) * 0.9 * view.dim, c = COL[s.col];
        ctx.fillStyle = 'rgba(' + Math.min(255, c[0] + 90) + ',' + Math.min(255, c[1] + 90) + ',' + Math.min(255, c[2] + 90) + ',' + a.toFixed(3) + ')';
        ctx.fillRect(sx - sz / 2, sy - sz / 2, sz, sz);
      }
      ctx.restore();
    }

    return {
      view: view, stats: stats, COL: COL,
      // dt: seconds since last frame for sparks (0 = frozen).
      draw(ctx, client, cam, dt) {
        const t0 = performance.now();
        const reuse = shot && view.every > 1 && (frameNo++ % view.every) !== 0 && shot.W === cam.W && shot.H === cam.H &&
                      shot.layer === view.layer && Math.abs(shot.upp / cam.upp - 1) < 0.2;
        if (reuse) {
          const k = shot.upp / cam.upp, px = view.pixel;
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(low, (shot.x0 - cam.x0) / cam.upp, (shot.y0 - cam.y0) / cam.upp, low.width * px * k, low.height * px * k);
        } else {
          drawField(ctx, client, cam);
          shot = { x0: cam.x0, y0: cam.y0, upp: cam.upp, W: cam.W, H: cam.H, layer: view.layer };
        }
        if (dt > 0) updateSparks(dt, cam);
        drawSparks(ctx, cam);
        stats.ms = stats.ms * 0.9 + (performance.now() - t0) * 0.1;
        stats.sparks = sparks.length;
      },
      clearSparks() { sparks.length = 0; },
    };
  }

  return { createRenderer: createRenderer, COL: COL };
});
