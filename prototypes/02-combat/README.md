# 02 · Combat (build order step 2)

The juggle from 01 with guns on it. One shared class table drives both teams —
fighter, bomber, heavy, interceptor, AAA, capital — players juggle theirs, the
opposition AI pilots the same rows. Default battle is 5v5: four fixed-gun ships
plus one capital per side.

## Run

- **Play:** open `combat.html` (mouse or touch; DODGE button / Space, F refocus).
  **Game speed** slider bottom-left (default 0.5×, presets ¼× ½× 1×, pause / P);
  remembered between visits. It only changes how fast real time feeds the
  fixed-tick sim, so results are identical at any speed.
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
- **Only capital ships have turrets.** Every other class has fixed forward guns:
  the cone points where the hull points, so you aim by flying at the target.
  Fixed-gun AI flies strafing runs (nose on target, peel off when close, come
  back around). Capitals acquire anything in range at any bearing and slew the
  turret (`gunTurn`) onto it; they fire once it's in the cone.
- Dodge = barrel roll: dead-straight line, flat energy cost, turn lockout after.
- One energy pool per ship = health + ammo + boost. Ships hold fire below an
  energy floor. No recharge yet — that arrives with friendly fields (step 4).
- Update gating tiers (Active/Reduced/Dormant by distance-to-nearest-foe) and a
  fixed-capacity projectile pool are built in; step 3 benchmarks them.

## Gate

**Does neglect visibly cost?** Headless proxy (5v5 with capitals, 90s, seed
4242): neglected team wiped with all 5 foes standing (97 ship-seconds);
bot-juggled team kept 3 alive and left 1 foe (323 ship-seconds). Costs, visibly.
With fixed guns an unflown ship rarely lines up a shot, so neglect now costs
firepower as well as ships.

## Deferred (flagged, not decided)

Per-class dodge specials are an open fork — dodge is uniform here on purpose.
AI never dodges yet. Harvester/Capital/Dropship/Battery rows land in step 5.
