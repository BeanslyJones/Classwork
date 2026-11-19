# Architecture baseline — build order step 3

Recorded `node bench.js` output. Re-run after any sim change; regressions
against these numbers are the thing this gate exists to catch.

- Sim: 02-combat/sim.js @ 100 units (50v50, all five classes), 20 crystals, arena r=2000, seed 9001
- Ticks measured: 10000 (after 500 warmup) · budget: one 30 Hz tick = 33.33 ms
- Machine: Intel(R) Xeon(R) Processor @ 2.10GHz × 4, Node v22.23.5, linux

| run        | mean ms | p50 ms | p99 ms | max ms | alive@end | shots |
|------------|---------|--------|--------|--------|-----------|-------|
| gating OFF | 0.746 | 0.723 | 1.564 | 6.611 | 100 | 18335 |
| gating ON  | 0.655 | 0.684 | 1.294 | 4.431 | 100 | 18452 |

Tier split at end (gating ON, Active/Reduced/Dormant): 10/23/67.
Projectile pool: 18452 fired, 0 dropped, zero allocations after construction.

Gate: **stable tick time @ 100 units** — p99 under half the 30 Hz budget, worst
tick inside one frame, deterministic with gating engaged. See bench assertions.
