# 08 · Radiation weather: zones on the bus (effects off)

The radiation zones (the same four types as 04's fields: cinder, bloom, brine,
halo) drifting and colliding, built the way the live game will run them:
services talking over the message bus. **No effects on ships yet**; this step
is only how the zones look and move as they meet.

## Run

- **Watch:** open `weather.html`. Drag to pan, scroll or pinch to zoom. Switch
  the layer shown (Local / Regional / Global map), turn on the region grid or
  the gas parcels, and use **packet loss** to drop keyframes on purpose: the
  view fetches the gaps from the log and looks exactly the same.
- **Verify:** `node test.js`.

## How it's built (`prototypes/shared/`)

| File | Layer | Job |
|---|---|---|
| `bus.js` | — | NATS-style bus: publish, subscribe, and now request/reply |
| `wx/rng.js` | — | Seeded stream (global only) + stateless hash and smooth noise |
| `wx/global.js` | GLOBAL | The one stateful sky sim (was `08-weather/sim.js`); emits keyframes |
| `wx/field.js` | REGIONAL + LOCAL | Exact field from a keyframe, region baking, blending, bounded local detail |
| `wx/agents.js` | — | The only bus-aware file: global agent, keyframe log, weather client |

- **Keyframes:** the whole sky (48 parcels) is ~1.6 KB. The global agent
  publishes one every 5 weather ticks (0.5 s) on `wx.global.kf`, 2 keyframes
  ahead of now. The log answers `wx.kf.get` for anything missed.
- **Regional:** each keyframe is baked per region (4 x 4 regions, 32 x 32 cells
  each) only when someone samples there; samples blend the two keyframes
  around now. Baking a whole keyframe ~6 ms; a region ~0.5 ms.
- **Local:** the regional field read at a point nudged by seeded noise, never
  more than D (default 24 units). A local sample is ~0.5–1 µs.
- **Collisions (look only):** each baked cell stores the "pressure" between the
  two strongest gases: positive when they push into each other, negative when
  they pull apart. Seams glow and throw sparks under pressure and tear dark
  when separating. The seam colour blends every gas by its share.

## Verified (node test.js)

Same seed → same sky and same keyframe stream; planet fully partitioned; cohesion
structural; bloom weak; fronts persist; agent always 2 keyframes ahead; 40% loss
+ shuffling + duplicates → bit-identical samples (gaps fetched from the log);
local detail never moves a point more than D and only differs from the map
within D + 2 cells of a seam; `field.js`/`rng.js` contain no sin/cos/exp/pow;
speed budgets.

## Still needs the v12 spec (not invented)

The ten named pair-events (The Forge, Sinkmaw, Overbloom, Flashover, Quench
Fracture, Wildfire Front, Detonation, Frost Lattice, Squall, Pollen Storm) and
any gas weight / pressure-driven wind. Sphere topology (this runs on a torus).
