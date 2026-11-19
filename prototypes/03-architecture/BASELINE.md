# Architecture baseline — build order step 3

Recorded `node bench.js` output. Re-run after any sim change; regressions
against these numbers are the thing this gate exists to catch.

- Sim: 02-combat/sim.js @ 100 units (50v50, all five classes), 20 crystals, arena r=2000, seed 9001
- Ticks measured: 10000 (after 500 warmup) · budget: one 30 Hz tick = 33.33 ms
- Machine: Intel(R) Xeon(R) Processor @ 2.10GHz × 4, Node v22.23.5, linux

| run        | mean ms | p50 ms | p99 ms | max ms | alive@end | shots |
|------------|---------|--------|--------|--------|-----------|-------|
| gating OFF | 0.621 | 0.578 | 1.267 | 4.495 | 100 | 12643 |
| gating ON  | 0.510 | 0.502 | 0.979 | 3.338 | 100 | 12778 |

Tier split at end (gating ON, Active/Reduced/Dormant): 0/3/97.
Projectile pool: 12778 fired, 0 dropped, zero allocations after construction.

Gate: **stable tick time @ 100 units** — p99 under half the 30 Hz budget, worst
tick inside one frame, deterministic with gating engaged. See bench assertions.
