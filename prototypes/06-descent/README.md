# 06 · Loadout → descent → landing (build order step 6)

One continuous sequence: build the dropship cross-section, launch, hold the
line down, land where your flying earned.

## Run

- **Play:** open `descent.html`. Tap a palette module, tap cells to place/erase,
  LAUNCH, then drag left/right (or arrow keys) to stay in the corridor.
- **Verify:** `node test.js`.

## Systems (all headless-verified)

- **Grid builder, 13 module types** with three rule layers: structure (everything
  chains to hull), edge placement (thrusters/sensors), and power gating (BFS
  from reactors/batteries; underpowered = inactive, shown faded). Tonnage sums
  live. ⚠ Module taxonomy is PLACEHOLDER — 13 slots exercising the rules, stats
  invented; replace wholesale when the real table exists.
- **Descent minigame:** seeded three-sine guide + seeded gusts; steer command is
  a single [-1,1] axis (the whole wire format). Tonnage stretches the fall and
  divides steering authority. Outside the corridor, turbulence chips the hull.
- **Performance carries over:** average tracking error → scatter radius (floor
  at `scatterBase` — the planet always gets a vote) AND arrival fuel/hull.
  Landing offset is seeded, scaled by earned scatter: same flying + same seed =
  same landing.
- **Prewarm hook:** `prewarm-ground` event fires at 50% descent — where ground
  generation starts streaming in the real build (never block the main thread).

## Gate

**Does descent skill visibly tighten scatter?** Bot sweep (seed 606): ace
err 26.9 → scatter 99; sluggish 44.9 → 139; barely-steering 56.8 → 165, with
hull 100%/87%/57%. A genuine trade surfaced untuned: tracking hard burns fuel
(45% vs 76% arrival) but saves hull and scatter — fuel-vs-precision is a real
pilot decision.

## Open forks (NOT decided — flagged per the brief)

- **Descent energy-bank**: whether good flying also banks energy beyond
  stats/scatter. `DescentResult` is where it would bolt on.
- Scatter radius numbers, module taxonomy/stats, and how many of the 13 types
  survive contact with the real design.
