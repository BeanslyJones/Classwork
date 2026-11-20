# 02 · Combat (build order step 2)

The juggle from 01 with guns on it. One shared class table drives both teams —
fighter, bomber, heavy, interceptor, AAA, torpedo, capital — players juggle
theirs, the opposition AI pilots the same rows. Default battle is 6v6: five
fixed-gun ships (incl. a torpedo bomber) plus one capital per side.

## Run

- **Play:** open `combat.html` (mouse or touch). Select a ship by clicking it
  or pressing 1–6, then click the map to send it that way (it turns at its own
  rate). Or drag a ship to steer it directly. Click the selected ship again or
  press Esc to deselect. DODGE / Space and REFOCUS / F act on the held ship,
  else the selected one. Orders and grabs count toward your APM.
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

## Title, garage, sound

The game is called **Amann Assault**. It opens on a title screen with an AI vs
AI battle running behind it (BATTLE starts a fresh fight; ☰ MENU returns).
**GARAGE** shows every ship class — placeholder names (THE JACK fighter,
GRAYZER capital dropship, …), a silhouette with its firing arc and weak points,
and stat bars read live from `CLASSES`, so they always match the battle.
**Sound** (`sfx.js`) is synthesized with Web Audio — no audio files: a distinct
gun per class, impacts, big blasts, ship explosions, weak-point clangs, dodge,
lock-on, order/select/UI blips. Stereo from screen position, distance falloff,
a short reverb and a compressor; voices are budgeted so rapid fire stays clean.
Volume/mute on the title screen, M toggles mute.

## Destroy the Carrier, Grayzer, cones, retarget, tutorial

- **Modes** (title screen): SKIRMISH (fixed 6v6), DESTROY THE CARRIER, TUTORIAL.
- **Destroy the Carrier** (`mode: 'carrier'`): each side has a carrier (HIVE —
  no guns, never stalls, 1600 hull, weak points incl. a hangar that halves
  build speed), one Grayzer and a small starting wing. Money: `startMoney` 250,
  `incomePerSec` 8 while your carrier lives, plus **salvage** — every dead ship
  leaves a wreck worth `salvageFrac` (40%) of its cost that any ship can fly over
  to collect (`wreckSec` 45s). Build from the bar at the bottom or Q W E A S D
  (cost / build time per class in `CLASSES`; queue of 5; `maxShips` 16 per
  side). Grayzers and carriers can't be built: one each. The AI builds a steady
  mix. Lose your carrier, lose the game.
- **Grayzer**: two side turrets, each confined to a 90° sector (±45° off
  straight out), fire rate turned down (0.9s per turret). **Battery** (300,
  +5/s): friendly ships within 200 recharge at 15/s each (cyan beam; cyan ring
  shows the charge). `batteryScale` tunes it all.
- **Cones** are drawn in entry-quality zones: green middle (can reach a full
  lock), yellow, red edges (lowest lock ceiling). All of yours are shown; an
  enemy's only when it is within `enemyConePx` screen pixels of one of your
  ships (CAMERA panel).
- **Retarget**: T (or F) / RETARGET button. Brackets snap onto any of your
  ships' new targets; after a manual retarget the cue is bigger, labelled and
  beeps.
- **Tutorial**: 12 guided steps in a small battle; each waits for you to do
  the move (select, order, drag, retarget, dodge, camera) and ends with a fight.

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
- **AI matches your APM** (`aiApmMatch` 1.0). Your actions per minute
  (grabs, dodges, refocuses) are measured over the last 30s; the AI earns
  actions at the same rate and spends each one re-aiming the ship it re-aimed
  longest ago — in between its ships fly on toward their last heading, like
  your released ships. Floor `aiApmMin` 10 so an idle player still faces a
  moving AI; `aiApmDefault` 30 is assumed until there's history. Both APMs show
  top left.
- **Rapid fire, light bullets, slow shots.** Guns fire ~3x as often for about
  a third of the damage per bullet (torpedo 1.5x / 0.6x), and bullets fly at
  60% of their old speed with lifetimes long enough to reach full range.
  Projectile pool raised to 1024.
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
  and wear it down; knocked out: bridge -> turret damaged (traverse x
  `bridgeTurn`, lock capped at `bridgeLockCap`; dome turns orange), engine -> speed/turn
  x `engineCripple`, vent -> hull bleeds `ventLeak`/s. Placeholder layout: bridge
  at the nose, engine at the tail, a vent on each side.
- Momentum decay (`momentumDrain`) 0.0275/s: an ignored ship slows toward
  `minSpeed` and drifts (amber ring). **Ships never stall.**
- Dodge = barrel roll: dead-straight line, flat energy cost, turn lockout after.
- One energy pool per ship = health + ammo + boost. Ships hold fire below an
  energy floor. No recharge yet — that arrives with friendly fields (step 4).
- Update gating tiers (Active/Reduced/Dormant by distance-to-nearest-foe) and a
  fixed-capacity projectile pool are built in; step 3 benchmarks them.

## Gate

**Does neglect visibly cost?** Headless proxy (6v6 with capitals and torpedo
bombers, 10 battles x 90s): neglected team kills 0.4 enemies per battle (228
avg ship-seconds); a bot that flings its slowest ship at the nearest enemy
every 1.5s kills 1.6 (464). Slow bullets plus wide turns make moving fights
long — most battles are still going at 90s — so the gate judges kills and
survival, not wins.
With fixed guns an unflown ship rarely lines up a shot, so neglect now costs
firepower as well as ships.

## Deferred (flagged, not decided)

Per-class dodge specials are an open fork — dodge is uniform here on purpose.
AI never dodges yet. Harvester/Capital/Dropship/Battery rows land in step 5.
