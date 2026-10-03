# 02 · Combat (build order step 2)

The juggle from 01 with guns on it. One shared class table drives both teams —
fighter, bomber, heavy, interceptor, AAA, torpedo, capital — players juggle
theirs, the opposition AI pilots the same rows. Default battle is 6v6: five
fixed-gun ships (incl. a torpedo bomber) plus one capital per side.

## Run

- **Play:** open `combat.html` (mouse or touch; DODGE button / Space, F refocus).
  **Game speed** slider bottom-left (default 0.5×, presets ¼× ½× 1×, pause / P);
  remembered between visits. It only changes how fast real time feeds the
  fixed-tick sim, so results are identical at any speed.
  **Camera** (top right, C cycles): *Fit* keeps all your ships framed (max zoom
  slider), *Snap* zooms the whole screen to the ship you're flying or last
  flew, *Bubble* keeps the wide view with a magnifier around that ship. Every
  camera number is a slider in the panel. Render-only, never touches the sim.
- **Verify:** `node test.js`.

## Combat rules implemented (all headless-verified)

- Firing cones per class with a real wide-vs-narrow trade (AAA 1.1 rad half-angle
  vs heavy 0.16).
- Cooldown only ticks while a valid target is in the cone.
- Targeting enemy-only; friendly fire is a separate toggle, off by default.
- All projectiles AoE with falloff (anti-clumping); crystals detonate shots (cover).
- **Arc-entry lock** (same model as the tank game). First enemy to enter the
  arc is the target, sticky while in the arc (+ grace); `refocus` drops it.
  How centred it was at entry is frozen (`entryQ`: 1 dead centre, 0 edge; for
  turrets, measured off the barrel over `turretEntryArc`) and sets the lock's
  ceiling (`lockEntryFloor` at the edge up to 1). The lock starts at
  `lockStartFrac` of that ceiling and climbs to it over `lockTimeFull` while the
  target stays in the arc — never past it. Lock quality buys three things:
  tighter spread (zero at full lock), target leading (`leadMax`), and faster
  reloads (`fireRateBonus`). Fixed guns can bend a shot within their arc toward
  the led point; turrets slew onto it.
- **Torpedo bomber**: slowest shots in the fleet (105 vs 180+), 3x damage to
  capitals (`vsCapital`), long-lived torpedoes (`projTtl`). Small ships can
  sidestep them; capitals can't. Enemy torpedo AI hunts capitals first.
- **Only capital ships have turrets.** Every other class has fixed forward guns:
  the cone points where the hull points, so you aim by flying at the target.
  Fixed-gun AI flies strafing runs (nose on target, peel off when close, come
  back around). Capitals acquire anything in range at any bearing and slew the
  turret (`gunTurn`) onto it; they fire once it's in the cone.
- **Capital weak points** ride the hull (`weakPoints` per class row, so each
  capital type can have its own layout). Blasts on one do `weakCritMult` damage
  and wear it down; knocked out: bridge -> turret offline, engine -> speed/turn
  x `engineCripple`, vent -> hull bleeds `ventLeak`/s. Placeholder layout: bridge
  at the nose, engine at the tail, a vent on each side.
- Momentum decay (`momentumDrain`, the juggle clock) halved to 0.0275/s.
- Dodge = barrel roll: dead-straight line, flat energy cost, turn lockout after.
- One energy pool per ship = health + ammo + boost. Ships hold fire below an
  energy floor. No recharge yet — that arrives with friendly fields (step 4).
- Update gating tiers (Active/Reduced/Dormant by distance-to-nearest-foe) and a
  fixed-capacity projectile pool are built in; step 3 benchmarks them.

## Gate

**Does neglect visibly cost?** Headless proxy (6v6 with capitals and torpedo
bombers, 90s, seed 4242): neglected team wiped with 4 foes standing (225
ship-seconds); bot-juggled team kept 4 alive and left 2 foes (430
ship-seconds). Costs, visibly.
With fixed guns an unflown ship rarely lines up a shot, so neglect now costs
firepower as well as ships.

## Deferred (flagged, not decided)

Per-class dodge specials are an open fork — dodge is uniform here on purpose.
AI never dodges yet. Harvester/Capital/Dropship/Battery rows land in step 5.
