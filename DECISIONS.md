# Radiant Warfront — owner decisions

Answers to the open forks listed in README.md, recorded as the owner makes them.
Prototypes have not been changed to match yet unless noted.

## 1. Descent energy-bank — NO
Descent pays out only in scatter, arrival fuel and arrival hull (as 06 does now).
No extra energy bank. Keeps the fuel-vs-precision trade as the descent's decision.

## 2. Battery vs. field upgrade path — TWO SEPARATE TRACKS
Battery capacity and field (shield) strength/reach are upgraded independently,
so loadouts can lean battery (siphon/detonate) or field (shelter/push the seam).

## 3. Third no-drain condition in friendly field — THREE MECHANICS
- **Crowding:** each field (shield) supports a set number of ships. Over that
  number, the free ride at home breaks. How it breaks is a per-shield-type
  trait; all four are valid:
  - *Shared load* — every ship inside drains, scaling with how far over cap.
  - *Latecomers pay* — first N in stay free; overflow drains as if outside.
  - *Field drains* — ships stay free; the field's battery pays per ship over.
  - *Recharge stops* — no drain, but no one recharges while over cap.
- **Collapsing battery:** a trait some fields have, not a universal rule. When
  that field's battery runs low, home stops being free.
- **Cargo:** a ship hauling cargo drains its own energy even at home, and that
  drain also puts extra load on the field's battery.

## 4. Per-class dodge specials — CHOSEN MODULES
Several dodge types exist to choose from (not locked to class). Each is a
loadout part with its own footprint shape on the loadout grid, so picking a
dodge competes for space with everything else you build in.

**Extended to all equipment:** every equipment type (dodges, shields, batteries,
thrusters, etc.) gets a unique grid shape AND adjacency effects — placing a part
next to certain other parts gives bonuses or penalties. Loadout layout becomes a
real puzzle, not just a parts list. Supersedes 06's placeholder 13-module
taxonomy once the real table is written.

## 5. Outfit shared IFF — OPTIONAL PART, FF ALWAYS ON
- **Targeting:** IFF stops guns locking outfit-mates.
- **Damage:** all damage is friendly fire — AoE, blasts and stray shots hurt
  anyone they hit, friend or foe. IFF only prevents the lock, not the hit.
- **Shield recharge setting:** the owner chooses who their shield recharges:
  only their own units / their whole team / their outfit.
- **Shelter is universal:** a shield shelters everyone inside it, enemies
  included. Only the recharge is restricted by the setting above.
- **IFF is an optional loadout part** (shape + neighbor effects per §4). Not
  required, and can be switched off in the field to go dark.

## 6. Artillery circle — PER-WEAPON TRAIT
Each artillery part defines its own landing-circle behaviour: some tighten
while aim is held (like 02's lock-scaled spread), some grow with distance or
flight time. Chosen in the loadout like shields and dodges.

## 7. Camera — THREE SELECTABLE MODES (replaces quadrant-split vs overlay)
1. **Fit-all:** camera stays centred on all your units, zooming out to keep
   them in frame, down to a settable max zoom-out.
2. **Snap-to-unit:** press a button and the whole screen zooms to the current
   unit.
3. **Bubble:** a magnifier bubble grows around the current unit showing a
   zoomed-in view of its surroundings, while the rest of the map stays at the
   wide view.
Every attribute of every mode (max zoom, snap speed, bubble size/zoom/grow
speed, etc.) gets its own slider.

## 8. Opposition cap + economy
- Resources are only gathered **on the ground**.
- Missions also **pay out** on completion.
- The game is meant to be **multiplayer** (other players are the real opposition).
- **Opposition cap (for testing):** start at 1 enemy and grow it from there.
- **Wrecks are loot:** haul them home to be processed.
- **Field salvage (idea):** pull parts off wrecks and upgrade in the field. Each
  part has a random chance of being undamaged.
- **Scanner parts** (loadout parts, many choices), e.g. one that tells which
  equipment on a wreck is intact, one that detects wrecks, one that detects
  crystals, etc.
- **Both salvage routes exist:** haul a whole wreck home (full value, heavy
  cargo) or strip parts in the field (light, usable now, random intact chance).
- **How a ship died sets the damage:** a ship that simply ran out of fuel/energy
  leaves a less damaged wreck than one shot down.
- **Crystallized wrecks:** anything that touches the surface turns to crystal,
  so equipment from a crystallized wreck is less useful than a fresh one.

## 9. Scatter radius — DESCENT ON THE LIVE MAP (replaces fixed scatter numbers)
The dropship descends over the **live, shared game map**, not a separate
minigame with a scatter circle. Flying off course doesn't just add a few units
of error — you can land somewhere completely different: in another battle,
or in the wrong type of radiation field. Ties descent to §8's multiplayer map,
04's colour wheel and the scanner parts.

## 10. Part attributes — WEIGHTED RANDOM, PER CELL
- 06's current grid builder is usable as-is for now; no rebuild yet.
- Every part's attributes are rolled with **weighted randomness**, not fixed.
- A part's roll is made **per grid cell**: each cell of a multi-cell part has
  its own weight, so bigger parts get more rolls.
- Goal: no repeating the same build every run. "You gotta work with what you
  got": loadouts are built from what you actually find, salvage and own.
- **Each cell rolls all three:** (1) how much it adds to the part's main stat,
  (2) a weighted chance at a bonus trait (e.g. faster recharge, collapsing
  battery, bigger crowd cap), and (3) its own neighbour bonus/penalty, so the
  same part can be strong or weak depending on where it's placed.

## 11. Capital ships
- A capital ship is **the player's own dropship**. There are no free-floating
  generic capitals.
- **Hired pilots orbit their leader's capital.** When ships are hired, they
  fly around the capital of whoever hired them, and **the hirer controls that
  capital**.
- Capitals are the only ships with turrets (see 02).
- Capitals have **weak points**: specific spots that take extra damage, rather
  than one uniform hull.
- There are **many types** of capital ship (different hulls, weak-point
  layouts, turret setups).
- 02's current `capital` class is a placeholder stand-in for this: one generic
  hull, no weak points, AI-flown on the enemy side.

## 12. Aiming — ARC-ENTRY LOCK (same as the tank game)
- Target = first enemy to enter the firing arc; entry quality is frozen at
  entry (centre good, edge bad) and caps how good the lock can get.
- Holding the target in the arc improves the lock up to that cap. A better lock
  improves accuracy (spread), target leading, and fire rate.
- **Torpedo bomber class**: slow shots, built to kill capital ships.

## 13. Combat pacing
- **No auto-turning.** Ships you aren't flying never steer themselves toward
  enemies. Instead, fixed guns get **wide auto-fire arcs** and bend shots within
  the arc toward the target.
- **Time to kill:** about **3 seconds** for small ships, about **10 seconds** for
  a capital (one attacker, sustained fire). Torpedo bombers kill a capital in ~5s.

## 14. Turning
- Ships have a **turning radius**; bigger, slower ships turn wider.
- **No snap turning.** Setting a direction makes the ship turn toward it at its
  own turn speed, including after you let go.

## 15. AI pace and gunfire
- **The AI matches the player's APM**: it gets the same number of actions per
  minute, each one re-aiming one ship.
- **More bullets, less damage each, slower bullets.**

## 16. Name and ships
- The game is called **Amann Assault**.
- Ship names: **GRAYZER** (capital dropship), **THE JACK** (fighter). Other
  names in the garage (NEEDLE, ANVIL, MANTA, BULWARK, HARPOON) are placeholders.
- Title screen, garage with ship specs, and game sounds added.

## 17. Grayzer, carrier mode, UI
- Cones show green / yellow / red entry zones. All friendly cones visible; enemy
  cones only within X pixels of your ships (slider).
- Retarget hotkey (T, also F) with a visual and audio cue.
- Tutorial added.
- **Grayzer**: lower fire rate; **battery** that recharges friendly ships'
  energy; **two turrets, one per side, each limited to a 90° sector**. One per team.
- **Carrier** that manufactures ships; **Destroy the Carrier** game mode.
- Money: per second, plus salvaging ship wrecks.

## 18. No stalling
- Ships never stall or die from being ignored. An ignored ship slows to
  cruising speed and drifts. (Stalling came from the original brief; dropped.)

## 19. Architecture: massively-multiplayer ready (Massdrift-style)
- Target: compatible with a sharded MMO architecture as described by the owner
  for Massdrift — two-phase tick, sharding by player (not by place), separate
  collision/visibility workers, everything over a message bus (NATS).
- In this codebase that means: two-phase tick (think from a frozen snapshot,
  then resolve), per-ship RNG, players own ships, a spatial grid for
  neighbour queries, a message-bus layer the LAN server uses, and per-player
  interest filtering of state.
- Built first, before the modes below.

## 20. Beat mode (planned, after the architecture)
- The music is a shared clock. Ships (a class or a specific ship) are assigned
  to instrument lanes. A note in a ship's lane gives that ship a **time slice**
  (it moves, its cooldowns tick, it fires if reloaded). Ship cooldowns run on
  the ship's own clock — a note right after firing does not fire again until
  the gun is reloaded AND another note arrives.
- Movement between slices is **interpolated/tweened** so ships glide.
- Pre-battle planning screen: the song summarised per lane (note timeline,
  percentages); drag ships onto lanes to plan attack and defence.
- Instruments: hi-hat, snare, kick, crash, bass line, keys/piano (pitch picks
  the ship, chords trigger several), arpeggio, pads (hold = active), lead,
  claps; sine wave as a continuous modifier rather than a trigger.
- Songs: built-in generated songs first, MIDI import after.

## 21. Turn-based mode (planned)
- Plan orders while paused, then the battle runs for one turn. Ships move
  speed x turn length; fire rate = turn length / cooldown.

## 22. Weather architecture (zones first, effects later)
- **Rad storms on the world map ARE 04's radiation fields**: same four types,
  same wheel, drain, protection and crystallizing rules. Weather's main job is
  to keep players apart on the open-world map; they gear up for the weather
  they expect.
- **Effects are OFF for now.** First get the zones looking and moving well as
  they collide. Power drain and crystallizing come next; other weather effects
  later.
- **Top-down layers:** GLOBAL (the one stateful sim, publishes keyframes) →
  REGIONAL (the interpolator: keyframes baked into a grid per region, blended
  in time) → LOCAL (fine detail that may move a seam at most D units from the
  map). This matches the v12 funnel: planet sim → hemisphere → window → client
  upscale. Not bottom-up: that needs sims everywhere, depends on report order,
  and lets a few players change the planet.
- **Deterministic with randomness:** only the global agent owns a stateful RNG;
  regional/local detail uses a stateless hash of (seed, place, time); sampling
  maths uses only + - * / sqrt floor and integer hashing (bit-identical on
  every machine). Every message carries a version; consumers reject others.
- **On the bus:** `wx.global.kf` (one keyframe of the whole sky, ~1.6 KB,
  published 2 keyframes ahead) and `wx.kf.get` (request/reply to fetch a missed
  keyframe). Consumers store keyframes by number, never guess a missing one,
  and fetch gaps from the log. Clients must never get far-future keyframes
  (that would be a perfect forecast); forecasts come later, blurred by gear.
- **The weather is logged** (keyframes now; storm-collision events later). The
  log is the record; recomputing from the seed is only a cross-check.
- **This weather only affects the lowest game layer.** The layers above it
  are not affected, for now. (If that changes later: descent gusts could be
  the wind along its path, and altitude a simple per-gas profile multiplied
  onto the 2D field, not a 3D sim.)
- Still needed from the v12 spec: the pair-event matrix (10 events, likely one
  per gas pair incl. same-gas) and whether gases have weight / pressure-driven
  wind.

## 23. Missiles, Fleet Battle, more players
- **Missiles** use a lock mini-game: hold, a lock icon bounces in the cone (colour =
  target's place in the cone; worse = faster), let go to launch. Lock is 100% with the
  icon inside the target's health ring, 1% at the catch distance (55) beyond it.
  Missiles track and lead; rockets are dumb; torpedoes run dumb and silent (invisible
  to the enemy) until armed, then search. Ordnance can hit allies. Enemy reticles show.
- **Fleet Battle:** draft a fleet with a budget (name, colour, pattern auto-generated
  with reroll), start with one ship, and every player brings their next ship in on one
  shared timer, adjustable in the lobby (default 20 s). You choose which hangar ship
  comes next.
- **More players:** up to 8 seats on LAN; seat & 1 = side. In Fleet Battle each player
  flies only their own fleet; in other modes players on a side share its ships.

## 24. Scaling to thousands of players — OPTIONS (logged, not decided)
- **Target talked about:** ~8,000 players with less delay than Massdrift's 400 ms tick.
  At ~6 ships each that is ~48,000 ships plus ~25,000 shots in flight; or 2–3 ships
  per player in big battles (16,000–24,000 ships).
- **Option A — Massdrift-style (shard by player):** conductor tick barrier
  (`combat.sync.tick` / ACKs), validators + durable JetStream input stream
  (`raw.inputs`), workers owning players with Apply → Calculate two-phase tick and
  one-tick-late damage, visibility pods (pair parity + per-player bitmaps), collision
  pods, recovery stream (last 8 slices per worker). Cost: all-to-all slice exchange.
- **Option B — shard by location (cells + hand-off):** BigWorld-style cells with ghost
  margins (~max weapon reach + one tick of travel), quadtree split/merge by load
  (Hadean / Dual Universe), hand-off at tick boundaries, EVE-style time dilation for a
  single overloaded cell. Write only a thin cell manager; reuse NATS + our sim.
- **Either way:** binary, changes-only, visibility-filtered updates (max zoom bounds
  what each player needs); shots sent once (deterministic flight), only guided
  ordnance updated; overhead layer (aircraft, artillery arcs, large missiles, lasers)
  as its own service with wider, slower interest; 2D helps by a constant factor;
  ~100–150 ms tick (7–10 Hz) for the big server, client gliding + own-ship prediction,
  lock-game release sent as a tick number.

## 25. Update levels from a distance map — TESTING, NEEDS REVISIT
- Idea from the owner (a "web" passing distances outward), applied to grid squares
  instead of ships: squares holding a side's ships start at 0 and the distance to
  that side spreads outward square to square; each ship reads its own square to get
  its update level (Active < 700, Reduced < 1400, Dormant beyond).
- Replaces the per-ship nearest-enemy search, which was ~52% of the tick at 1,000
  ships. Cost now grows with squares, not ships. Accurate to about one square (128).
- Switch: tunable `gateField` (1 = distance map, the default; 0 = old search).
- Not yet measured or play-tested. Revisit: confirm the gain on the load page, check
  levels near the 700/1400 edges, consider reusing the maps for AI and for what each
  player is sent.

## 26. Fractal fleets (design direction — details still open)
- **Shape:** a leader flies ~4 large ships; each large ship carries a captain's
  wing of ~4 medium ships; each medium ship carries a pilot's wing of ~4 small
  ships. Everyone plays the same juggle, bigger ships higher up. Not every fleet
  has this exact shape. One full tree = 1 + 4 + 16 + 64 = 85 players, ~340 ships.
- **Size matchups:** large beats large; medium can be built for large, medium or
  small; small beats small and medium. Exceptions, e.g. heavy bombers diving a
  huge ship's weak point.
- **View:** the bigger your ship, the more of the map you see (also what the server
  sends you).
- **Tether:** every ship has a battery (many sizes). A parent ship supplies energy
  and radiation shielding to its wing (04's field rules), so wings stay near it.
  Losing the parent cuts that supply: batteries stop being topped up and drain.
- **Leash areas (how orders work):** each wing plays inside a moving circle centred
  on its cap ship or a mobile rally point, moving at a set speed (about the cap
  ship's). Radius = the player's max zoom: the screen stays centred on it and its
  edge is the screen's edge. Ships that fly past the edge are turned back toward
  the centre (today's arena edge, made mobile, one per wing). Nested: pilots follow
  their captain's centre, captains the leader's, the leader the mission zone.
  Commanders give orders by moving the centre; players fly freely inside it.
- **Centre = rally point that smoothly follows the cap ship:** it interpolates
  toward the cap ship's new position at a capped speed (no snapping). If the cap
  ship dies it carries on as a free rally point the commander moves.
- **Most cap ships have no dodge; they have shields instead.** Shields come in many
  kinds and depend on what's equipped (part of the loadout, like 06's builder and
  decision 10's rolled parts).
- **Hangar bays:** large ships can have hangars and recall their wings inside when
  needed (details open: capacity, recharge while docked, relaunch).
- **Cap ship boost (where a cap ship has one):** the wing gets an audio + visual
  cue ("boost in 3…") so they can boost with it. Ships left outside the leash area
  (pulled offscreen) get a few seconds, then are steered back toward the centre.
- **Orders go to the wing, not just the ship at its centre.** A player whose ship
  is destroyed (captain or fleet leader alike) keeps commanding their wing.
- **Agency:** players may ignore orders or leave. Consequences go to their REP.
- **Defecting** to the enemy is possible but should be rare and costly (owner
  dislikes it): leaving a contract makes you neutral with no parent supply, no
  joining the other side in the same battle until you've left the field, wages
  held in escrow and forfeited if you walk, a bigger REP hit mid-fight, optional
  notice periods in contracts, and leaders can blacklist.
- **Retreat:** a player can run and pay another player to fly a dropship down to
  evacuate them (ties to 05 extraction / 06 descent).
- **Leader powers:** reshuffle the fleet and reassign players between wings.
- **Mercenary economy:** the leader pays the players under them (wages / contracts
  still to decide).
