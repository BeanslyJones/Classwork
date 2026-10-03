# Architecture baseline — build order step 3

Recorded `node bench.js` output. Re-run after any sim change; regressions
against these numbers are the thing this gate exists to catch.

- Sim: 02-combat/sim.js @ 100 units (50v50, all five classes), 20 crystals, arena r=2000, seed 9001
- Ticks measured: 10000 (after 500 warmup) · budget: one 30 Hz tick = 33.33 ms
- Machine: Intel(R) Xeon(R) Processor @ 2.80GHz × 4, Node v22.22.0, linux

| run        | mean ms | p50 ms | p99 ms | max ms | alive@end | shots |
|------------|---------|--------|--------|--------|-----------|-------|
| gating OFF | 1.310 | 1.271 | 2.422 | 7.195 | 100 | 16136 |
| gating ON  | 1.315 | 1.286 | 2.291 | 3.738 | 100 | 16251 |

Tier split at end (gating ON, Active/Reduced/Dormant): 100/0/0.
Projectile pool: 16251 fired, 0 dropped, zero allocations after construction.

Gate: **stable tick time @ 100 units** — p99 under half the 30 Hz budget, worst
tick inside one frame, deterministic with gating engaged. See bench assertions.
