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
  camera number is a slider in the panel, and the active mode's zoom also has
  a slider right under the camera buttons. Grabbing a ship selects it; tapping
  empty space (or Esc) deselects and closes the bubble. Ships hidden under the
  bubble show through as outlines at their true positions. Render-only, never
  touches the sim.
- Every class has its own hull silhouette (render-only `HULLS` table in the page).
- **Verify:** `node test.js`.

## LAN multiplayer

1. On any computer on your Wi-Fi (Node.js installed, nothing else needed):
   `node server.js` from this folder (or `PORT=9000 node server.js`).
2. It prints addresses like `http://192.168.1.20:8080/`. Open that on each
   phone/computer on the same Wi-Fi.
3. First to join flies **blue**, second flies **red**, anyone else spectates
   (and takes over a seat if a player leaves). An empty seat is flown by the AI,
   so one person can still play solo against it.

How it works: the server runs the one true battle and streams snapshots to
every screen ~30x/s (Server-Sent Events); screens only send their controls
(grab / aim / release / dodge / refocus) back. No screen simulates on its own,
so phones and computers can't drift out of sync. Game speed, pause, restart and
tunable sliders are shared — any player's change applies to everyone.
`node server.test.js` checks seating, control, spectators and hand-back to the AI.

Not yet: the claude.ai link is single-player only (a hosted page can't reach
your LAN). No lag smoothing — fine on home Wi-Fi, untested over anything slower.

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
- **Crystals are off for now** (`hazardCount` 0, `wreckCrystals` 0): no seeded
  crystals, and dead ships don't leave crystal wrecks. Both are sliders if you
  want them back.
- **Landscape, two hands.** On a phone held sideways the layout keeps the
  middle clear: game speed bottom-left, REFOCUS and DODGE bottom-right, camera
  top-right. Portrait on a phone shows a "turn sideways" prompt (dismissable);
  Android Chrome also pins landscape where it can. The **bubble** now magnifies
  the middle of the selected ship's firing arc (half its range ahead along the
  gun), gliding as the ship turns.
- **Turning radius per class** (`turnRadius`, world units; `turnRadiusScale`
  scales the whole fleet): interceptor 90, fighter 110, AAA 120, bomber and
  torpedo 150, heavy 160, capital 200. Angular rate = current speed / radius,
  and every source of turning (pilot, AI, crystal evasion, drift) is capped by
  it — nothing snaps. A released ship keeps turning toward the direction you
  set (faint dashed line) at its own rate; a dodge rolls along the current
  heading. Crystal look-ahead grows with turn radius, and a close call
  overrides the pilot/AI turn. Unflown ships keep at least `minSpeed` 50.
- **AI reaction time** (`aiReactSec` 6s): each AI ship re-picks its heading
  that often (staggered) and turns toward it in between — about one steering
  decision per second across six ships, close to a juggling player's budget.
  Without it, six always-steering AI ships beat one human pilot every time
  once turns became slow.
- **Time to kill** (one attacker, sustained fire, centre entry): ~2-4s on small
  ships, ~10s on a capital, ~5s for a torpedo bomber on a capital. Damage and
  energy pools are tuned to that; the `[time to kill]` test holds the ranges.
  Fixed-gun arcs are wide (heavy ±26° .. AAA ±80°) and shots bend within the
  arc toward the target, so pointing roughly at an enemy is enough.
- **Torpedo bomber**: slowest shots in the fleet (105 vs 180+), 2.9x damage to
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
bombers, 10 battles x 90s): neglected team kills 1.5 enemies per battle (153
avg ship-seconds); a bot that flings its slowest ship at the nearest enemy
every 1.5s kills 2.9 (334). With wide turns most battles are still going at
90s, so the gate judges kills and survival, not wins.
With fixed guns an unflown ship rarely lines up a shot, so neglect now costs
firepower as well as ships.

## Deferred (flagged, not decided)

Per-class dodge specials are an open fork — dodge is uniform here on purpose.
AI never dodges yet. Harvester/Capital/Dropship/Battery rows land in step 5.
