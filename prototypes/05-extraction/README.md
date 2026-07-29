# 05 · Dropship · battery vessel · harvest · extraction (build order step 5)

The 02 combat sim with the mission economy on top. Default mission: dropship +
harvester + battery vessel + two combat ships vs a four-raider opposition pack.
No reinforcements — the enemy is the loot.

## Run

- **Play:** open `extraction.html`. LAUNCH (or L) any time. Grab the diamond
  (battery vessel), park it inside an enemy to siphon, ZAP (Z) to discharge,
  DETONATE (X) to trade it for a blast and rich salvage.
- **Verify:** `node test.js`.

## Systems (all headless-verified)

- **Dropship battery = mission clock.** Passive drain forever; resupplying hurt
  friendlies pays straight out of it; the climb burns it fast. Zero battery —
  grounded or mid-climb — is strand-and-crystallize.
- **Harvester** mines autonomously: seeks the nearest crystal, orbits it (never
  stops moving), cracks it into cargo, hauls to the dropship, repeats. Fully
  targetable; exempt from crystal avoidance by trade.
- **Salvage tiers:** raw crystal ×1, dead-ship salvage ×3, detonated battery
  vessel ×5.
- **Battery vessel:** siphons enemy ships in contact range into its store
  (ships only, never fields — conservation verified), shares to hurt friendlies,
  discharges as an AoE weapon, detonates scaling with stored charge and
  crystallizes into rich salvage. Starting capacity = 20% of max (slider).
- **Extraction:** launch anytime; climb time = base + cargo mass × perMass;
  shootable the whole way up; success removes the dropship with its hold.

## Gate

**Is extraction a gamble, not a win button?** Headless proxy (seed 5150):
climb ticks 300 empty → 515 at 8 mass → 839 at 20 mass. Under fire, an empty
hold escapes; a 30-mass hold is shot down mid-climb. Launching with 60 battery
against a ~266 climb cost strands you in the air. Three different ways to lose
the same button.

## Deferred (flagged, not decided)

Battery tether (purchased upgrade), cloaking field, detonation rad-matchup
scaling (needs step 4 fields merged in), battery-vs-field upgrade path (open
fork), crashed-salvage-harvestable-by-ground-units-only nuance, capital class.
