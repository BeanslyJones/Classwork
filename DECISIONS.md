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
