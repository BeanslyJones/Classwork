# 01 · The Juggle (build order step 1)

One always-moving ship possessed at a time — hold, aim, release — bounced between
four ships whose momentum drains whenever you're not holding them. Momentum at zero
= stall = short grace window = crystallize. Crystals kill on contact; dead ships
become salvage crystals. No boundary death (soft edge steer).

## Run

- **Play:** open `juggle.html` in a browser (works from `file://`).
- **Verify:** `node test.js` — determinism, neglect, stall rescue, tension sweep, 100k-tick soak.

## Controls (keyboard/mouse dev surface)

- Mouse down near a ship → grab. Drag → aim (heading is from the ship's position). Release → fling, momentum restored.
- `1`–`4` hold → grab that ship directly; key up → release.
- `R` restart same seed · `N` new seed.

## Design notes

- Pure sim (`sim.js`) is DOM-free and identical in browser and Node. Fixed tick,
  one seeded RNG stream, semantic commands only (`grab`/`aim`/`release`) — the
  exact shape the server-authoritative port needs.
- All tunables live in `TUNABLES` with range + tooltip → map 1:1 to serialized
  `[Range]` Inspector fields in the Unity port.
- Unheld ships evade crystals with strength scaled by momentum: healthy ships
  thread the field alone; decayed ships wobble and dodge badly. Neglect is a
  spiral, not a coin flip.

## Gate

**Is it tense with 4 ships?** — human playtest question. Headless proxy (seed 1337,
~167s): service every 1.5s → 4/4 alive; every 5s → 1/4; never → 0/4. The pressure
gradient exists; feel needs a hand on the mouse.
