# 02 · Combat (build order step 2)

The juggle from 01 with guns on it. One shared class table drives both teams —
fighter, bomber, heavy, interceptor, AAA — players juggle theirs, the opposition
AI pilots the same rows.

## Run

- **Play:** open `combat.html` (mouse or touch; DODGE button / Space, F refocus).
- **Verify:** `node test.js`.

## Combat rules implemented (all headless-verified)

- Firing cones per class with a real wide-vs-narrow trade (AAA 1.1 rad half-angle
  vs heavy 0.16).
- Cooldown only ticks while a valid target is in the cone.
- Targeting enemy-only; friendly fire is a separate toggle, off by default.
- All projectiles AoE with falloff (anti-clumping); crystals detonate shots (cover).
- Spread scales with lock quality (zero at full lock, `lockTimeFull`).
- First-to-enter-cone target priority, sticky while in cone (+ grace), `refocus`
  command drops the lock.
- Guns rotate independently of hull (`gunAngle`, per-class `gunTurn`).
- Dodge = barrel roll: dead-straight line, flat energy cost, turn lockout after.
- One energy pool per ship = health + ammo + boost. Ships hold fire below an
  energy floor. No recharge yet — that arrives with friendly fields (step 4).
- Update gating tiers (Active/Reduced/Dormant by distance-to-nearest-foe) and a
  fixed-capacity projectile pool are built in; step 3 benchmarks them.

## Gate

**Does neglect visibly cost?** Headless proxy (4v4, 90s, seed 4242): neglected
team wiped with 2 foes standing (75 ship-seconds); bot-juggled team cleared all
foes with a survivor (171 ship-seconds). Costs, visibly.

## Deferred (flagged, not decided)

Per-class dodge specials are an open fork — dodge is uniform here on purpose.
AI never dodges yet. Harvester/Capital/Dropship/Battery rows land in step 5.
