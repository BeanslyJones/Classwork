# 08 · Weather — deterministic core SKELETON (build order step 8, partial)

⚠ **This is not v12.** The brief calls for rebuilding v12 clean from its spec —
the four-layer funnel (planet sim → hemisphere vectors → window primitives →
client upscale) and the ten named pair-events need that spec document. What's
here is the verifiable core that everything in the brief's weather section pins
down, built vector-native so v12 can grow out of it (or replace it).

## Run

- **Watch:** open `weather.html` — drag `cohesion` to 0 and watch the soup form.
- **Verify:** `node test.js`.

## What's implemented and verified

- **Vector-native:** the whole planet sim is 48 weighted moving parcels (12 per
  gas). No grid state; ownership at any point is derived. Planet always fully
  partitioned by construction; no gas ever goes extinct (tested).
- **Four immiscible gases** (cinder/bloom/brine/halo): cross-gas repulsion,
  boids-style same-gas cohesion + short-range separation (a gas is a region,
  never a dot), seeded shearing wind.
- **Self-cohesion is structural:** cohesion ON holds ≤ 5 clusters at tick 1200;
  OFF fragments to 17 — soup by ~tick 1200, matching the design note.
- **Bloom deliberately weak:** 0.35× cohesion → dispersion 290 vs 177 average
  for the other gases (5-seed average).
- **Director, not renderer:** output is `fronts()` — pair-front parameter sets
  {pair, length, centroid, intensity}. The HTML client upscales a 72² ownership
  sample; the sim never paints.
- **Determinism:** identical seed → identical sky AND identical front sets;
  verified through 5000 ticks.

## Missing, needs the v12 spec (do not invent)

- The ten named pair-events (The Forge, Sinkmaw, Overbloom, Flashover, Quench
  Fracture, Wildfire Front, Detonation, Frost Lattice, Squall, Pollen Storm) —
  `PAIR_EVENTS` is a placeholder table with TODO conditions.
- Hemisphere vector layer and window-primitive extraction (funnel layers 2–3).
- Sphere topology (skeleton runs on a torus).
- Wiring fronts into 04's field drift as the zone driver.
