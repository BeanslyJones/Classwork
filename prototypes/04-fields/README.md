# 04 · Two touching radiation fields (build order step 4)

The isolation prototype the build order demands before fields touch combat:
one test ship, two field emitters, the full attrition ruleset.

## Run

- **Play:** open `fields.html` (mouse or touch; BOOST/Space = maneuver; panel
  has live color/battery/protection controls — drag a battery slider and watch
  the seam walk).
- **Verify:** `node test.js`.

## Rules implemented (all headless-verified)

- **The wheel:** cinder > bloom > brine > halo > cinder; opposite pairs neutral.
  Drain multipliers ordered attuned < strong < neutral < weak — a lean, not a wall.
- **Friendly field:** zero loss unless shooting, being shot, or maneuvering
  (hard turn or boost). Recharge happens only here, only while cruising clean.
- **Outside:** drain = base × wheel matchup × (1 − protLevel × protClip);
  protection never clips all of it. Open ground has its own mild bleed.
- **Same-color fields merge, allegiance-blind:** influences add; a merged region
  shelters every team that projects that color into it — but only where their
  own field actually reaches.
- **Different colors clash at a battery-weighted seam:** equal batteries put the
  seam at the midpoint; draining one battery walks it monotonically toward the
  weaker field. `seamBetween()` exposes it for tests and HUD.
- **Drift:** fields wander deterministically (seeded) when `fieldDriftSpeed` > 0
  — the slot weather (step 8) will drive.

## Gate

**Do color changes play without being a wall?** Headless proxy: worst-matchup
straight crossing of an 800-unit hostile field lands with 71% energy — a cost.
Orbiting inside the same field crystallizes you at ~17s — a commitment. Feel
check on the sliders is yours.

## Not here yet (by design)

Field damage (capitals/dropships only), cone-shaped projections with live
resize, protection clipping visuals at the seam, weather as the drift driver.
