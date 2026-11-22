# Amann Assault — Handoff

Everything a new person (or agent) needs to pick this project up: what it is, how
to run it, how the code is laid out, what's been measured, what's decided, what's
open, and where every idea came from.

- **Repo:** `BeanslyJones/Classwork` — branches `main` (what the owner's HP runs)
  and `claude/radiant-warfront-brief-m5hauk` (working branch; kept equal to `main`).
- **Owner:** BeanslyJones. Tests on a Windows HP (server), a Mac, and **Android
  tablets** (largest browser compatibility matters).
- **Names:** the project started as **Radiant Warfront**, was also called
  **Directional Front**, and is now **Amann Assault** — all the same game.
- **Date of this handoff:** 2026-11-22.

---

## 1. What the game is

A browser fleet battler where you **juggle** a small fleet: you can steer only one
ship at a time, so the skill is deciding which ship gets your attention. It is
being built toward a **massively multiplayer mercenary game** with **fractal
fleets**: a leader flies a few large ships, each carrying a captain's wing of
medium ships, each carrying a pilot's wing of small ships (decisions 26–30).

The original brief (Radiant Warfront) adds a living planet: four radiation types
on a colour wheel (cinder, bloom, brine, halo) that drain or shelter ships,
weather fronts that move those zones, dropships, descent onto a live shared map,
extraction with loot, salvage, and a Tetris-style part grid for loadouts.

---

## 2. How to run it

Needs **Node.js** (LTS from nodejs.org). No other install for the default mode.

| What | Command (from the `Classwork` folder) |
|---|---|
| Game server (default, built-in bus) | `node prototypes/02-combat/server.js` or `npm start` |
| Play | `http://localhost:8080` on the server PC; other devices use the printed `http://192.168.x.x:8080` |
| Server load page | `http://localhost:8080/perf.html` (takes no player seat) |
| Single player, no server | open `prototypes/02-combat/combat.html` directly, or the published artifact (§10) |
| All tests | `npm test` |

**With real NATS** (optional; weather runs as its own program on its own core):

1. Download `nats-server` from https://github.com/nats-io/nats-server/releases →
   **Assets** → the file ending `-windows-amd64.zip` (x64 Windows; the `arm64`
   build gives "machine type mismatch"). Put `nats-server.exe` in `Classwork/`.
2. Double-click **`start-nats.bat`** (or in PowerShell: `.\start-nats.bat`). It runs
   `npm install` once, starts NATS, the game server and the weather service in
   their own windows.

**Environment switches** (PowerShell: `$env:NAME="value"; node ...`):

| Variable | Effect |
|---|---|
| `PORT` | Server port (default 8080) |
| `BUS=nats://localhost:4222` | Use a real NATS server instead of the in-process bus |
| `WEATHER=external` | With `BUS`, leave weather to `weather-service.js` |
| `COMPRESS=0` | Turn off gzip of each screen's live stream |
| `DELTA=0` | Turn off dead reckoning (send the whole battle every update) |
| `SNAP_HZ` | Updates per second to screens (default 30) |
| `SEATS` | Player seats, 2–8 (default 8) |
| `INTEREST_RADIUS` | Send each side only ships near its own (off by default) |

**Troubleshooting seen so far:** PowerShell needs `.\` to run a script in the
current folder; `EADDRINUSE` means an old server still runs (`taskkill /f /im node.exe`);
`start-nats.bat` must not contain brackets inside `if (...)` blocks (fixed).

---

## 3. Code map

```
Classwork/
├─ DECISIONS.md              owner's design decisions 1–31 (the source of truth)
├─ README.md                 prototype pipeline overview
├─ package.json              npm start / weather / test; nats = optional dependency
├─ start-nats.bat            one-click Windows launcher (NATS + server + weather)
├─ docs/HANDOFF.md           this file
└─ prototypes/
   ├─ 01-juggle/             first slice: juggling 4 ships
   ├─ 02-combat/             ★ the game (Amann Assault)
   │  ├─ sim.js              deterministic battle core (server + browser), 1.7k lines
   │  ├─ combat.html         browser client: drawing, input, menus, all modes, 2k lines
   │  ├─ sfx.js              synthesized sound + music (Web Audio, no files)
   │  ├─ server.js           LAN server: gateway + sim service + weather service
   │  ├─ weather-service.js  weather as its own program (NATS)
   │  ├─ perf.html           live server load page
   │  ├─ test.js             headless game tests
   │  ├─ server.test.js      LAN / bus / weather-over-LAN tests
   │  └─ README.md           features, controls, NATS setup
   ├─ 03-architecture/       bench.js + BASELINE.md (tick-time benchmark)
   ├─ 04-fields/             radiation fields: wheel, drain, seams (standalone)
   ├─ 05-extraction/         dropship battery clock, harvesters, loot (standalone)
   ├─ 06-descent/            part-grid builder + descent minigame (standalone)
   ├─ 08-weather/            weather viewer + tests (uses shared/wx)
   ├─ 09-command/            hired AI groups with timed orders (standalone)
   └─ shared/
      ├─ bus.js              in-process bus: NATS-style subjects, publish/subscribe/request
      ├─ bus-nats.js         same API on a real NATS server
      └─ wx/                 weather: rng.js, global.js (sky sim), field.js
                             (global/regional/local sampling), agents.js (bus
                             adapters), render.js (CPU drawing)
```

Everything loads both in Node (`require`) and in the browser (`<script>`), except
`server.js`, `weather-service.js` and `bus-nats.js` (Node only).

---

## 4. Architecture

### 4.1 The battle core (`sim.js`)
- **Fixed 30 Hz tick, deterministic:** seeded RNG (`mulberry32`), per-ship RNG,
  semantic commands only. Same seed + same commands = same battle, bit for bit.
- **Two-phase tick:** THINK (each ship reads a frozen start-of-tick frame and writes
  only itself, producing intents) → RESOLVE (intents applied in ship-id order).
  A test thinks ships in reverse order and gets an identical battle.
- **Spatial grid** (`Grid`, 256 cells for the frame, 64 after movement) for all
  neighbour queries; growable projectile pool (up to 65,536).
- **Controllers:** 8 seats; seat & 1 = side. Each side's ships are dealt out
  between its players (`setControllers`); you fly only ships you own
  (`_mayFly`). Fleet Battle uses each player's drafted fleet.
- **Update levels (TESTING, decision 25):** ships far from enemies update less often
  (Active < 700, Reduced < 1400, Dormant). Levels now come from a distance map
  spread across grid squares (`_gateByField`, switch `gateField`), not a per-ship
  search.
- **Profiling:** `sim.profile = true` sums time per phase into `sim.prof`
  (commands, ai, grid, think, resolve, missiles, damage, projectiles, upkeep).
- **Modes:** skirmish (7v7), carrier, beat (music time slices), stress
  (100–1,000 ships, reinforcements), fleet (draft + timed deploys), tutorial.
- **Weapons:** auto-firing guns with arc-entry locks; **missiles / rockets /
  torpedoes** via a hold-and-release lock mini-game (§6).

### 4.2 Services and the bus (`server.js`)
All services talk only through subjects on a bus (in-process `bus.js`, or NATS via
`bus-nats.js`). Today they run in one Node process; weather can run separately.

| Subject | From → to | Notes |
|---|---|---|
| `cmd.<seat>` | gateway → sim | grab, aim, release, order, dodge, refocus, lane, launchHold/Release, nextShip, build |
| `ctl` | gateway → sim | speed, pause, restart (mode/song/count), tune, fleet draft |
| `seat.<seat>` | gateway → sim | player joined / left |
| `state.full` | sim → gateway | dead-reckoning updates (full refresh ~1/s) |
| `state.player.<side>` | sim → gateway | only with `INTEREST_RADIUS` (full snapshots) |
| `sim.settings`, `sim.restarted`, `sim.perf`, `sim.keyframe` | sim ↔ gateway | settings, restarts, perf numbers, "send everything" on join |
| `wx.ctl` / `wx.clock` | sim → weather | reset to a new sky / battle time |
| `wx.global.kf` | weather → all | weather keyframe (~1.6 KB) every 0.5 s, 2 ahead |
| `wx.kf.get` | any → keyframe log | request/reply for a missed keyframe |
| `wx.stats`, `wx.hello` | weather → sim | stats; "I (re)started, send the sky" |

Browsers connect to the **gateway** only (HTTP + Server-Sent Events, gzip): `/events`
(live stream), `/cmd` (POST commands), `/wx?kf=n` (missed weather keyframe, never
past "now + 2"), `/perf-events` + `/perf-cmd` (load page). Visual map of this:
the Bus Map artifact (§10).

### 4.3 Weather (`shared/wx`, decision 22)
- **Global:** one seeded sky sim (gas parcels with cohesion, repulsion, wind)
  publishing keyframes 2 ahead; logged.
- **Regional:** keyframes baked per region into small grids, blended in time.
- **Local:** regional field read at a point nudged ≤ D (24 units) by seeded noise,
  so the battlefield never moves a seam more than D from the map.
- Sampling maths uses only + − × ÷ sqrt floor and integer hashing (bit-identical
  everywhere; a test greps for sin/cos/exp/pow).
- **Effects on ships are OFF** (owner's call): zones are look-and-feel only so far.
  Weather affects only the lowest game layer.
- Drawn on the **CPU** (`render.js`) into a low-res image, upscaled; WebGL shader
  version proposed, not built.

### 4.4 Network traffic (decision 31)
- **Built:** gzip per screen (sync-flushed); **dead reckoning** — screens move ships
  along an arc from (x, y, heading, speed, turn rate); the server re-sends a ship
  only when that guess is > 2 units / 0.05 rad off or its state changed; shots sent
  once when fired (steering missiles/torpedoes re-sent); full refresh every 30
  updates and on join. `drPredict`, `snapshotDelta`, `_applyDelta` in `sim.js`.
- **Planned:** only what you can see (matters in the big world), binary format,
  hidden things never sent (anti-cheat), slower updates for far / overhead units,
  plan-change rules at helper boundaries (decision 31).

---

## 5. Measured numbers (this container, 4 cores, one Node process)

| Measurement | Result |
|---|---|
| Normal battle tick | well under 1 ms |
| 300-ship stress | ~5–6 ms / tick (budget 33 ms), ~22% of a core |
| 1,000-ship stress, before distance map | ~21 ms median, up to ~36–55 ms peaks; "spatial grid" = 52% of tick |
| 1,000 ships, distance map vs old search | grid 13.4 → **0.24 ms**; whole tick 21.3 → **7.3 ms**; levels agree 90% (map overestimates near the 700 edge) |
| 1,000 ships with gzip (one screen) | 3,561 → **906 KB/s** on the wire (3.9×), all 30 updates/s intact, gzip = 3.4% of a core per screen |
| Full snapshot size | ~5 KB (normal), ~100–145 KB (1,000 ships) |
| Weather keyframe | ~1.6 KB (48 parcels), ~6 KB (192), ~25 KB (768) |
| Weather sample | ~0.5–1 µs local; region bake ~0.6 ms (48 parcels) to ~8.6 ms (768) |
| Weather bus robustness | 40% loss + shuffle + duplicates → bit-identical samples |
| Dead reckoning | **not yet measured** (built after the last measurements) |

Practical capacity today: ~1,000 ships in one battle on one core; network was the
real limit on Wi-Fi before gzip / dead reckoning. Server uses **one core**; the
bus split exists so services can move to their own cores/machines.

---

## 6. Feature status

| Feature | State |
|---|---|
| Skirmish, Carrier, Tutorial, Garage, sound | Playable, tested |
| Beat Battle (music time slices, planning screen) | Playable; browser-tested |
| Stress test + weather + load page | Playable; measured |
| Missiles / rockets / torpedoes + lock mini-game, missile boat (QUIVER) | Built; **syntax-checked only** |
| Enemy reticles, silent torpedoes until active, torpedo search cones | Built; untested |
| Lock = 100% inside health ring, 1% at catch distance (55) | Built; untested |
| Fleet Battle (draft, name/colour/pattern generator, timed deploys) | Built; one headless smoke run |
| 8 seats, ships dealt per player, dimmed teammates, gold badges, MINE / H, pinch zoom, ship size boost | Built; screenshot of badges only |
| Distance-map update levels (decision 25) | **TESTING, needs revisit** |
| NATS adapter + separate weather program | Built; **not run against NATS here** (owner has NATS on the HP) |
| gzip stream | Built; measured |
| Dead reckoning | Built; server start verified; **not measured** |
| Turn-based mode | Not started |

---

## 7. Design decisions (summary — full text in `DECISIONS.md`)

1–15: early calls (descent energy bank, battery vs shield tracks, shield crowding,
part grid shapes, IFF / friendly fire, artillery, camera modes, multiplayer world &
salvage, descent on the live map, weighted-random parts, capitals as dropships with
weak points, arc-entry locks, pacing, turning radius, APM-matched AI).
16 name Amann Assault · 17 cones/carrier/tutorial batch · 18 ships never stall ·
19 MMO-ready architecture · 20 beat mode · 21 turn mode (planned) ·
22 weather architecture (zones first, effects off, top-down layers, logged keyframes) ·
23 missiles, Fleet Battle, 8 players · 24 **scaling options** (A Massdrift player
shards, B location cells + hand-off, C fleet trackers that merge in engagements) ·
25 distance-map update levels (TESTING) · 26 **fractal fleets** (leash areas,
rally points, tethers, shields as equipment, hangars & evac, agency, defection) ·
27 contracts & negotiation · 28 hiring market, yellow/red rescue alerts with blind
bids · 29 **REP** (hidden tracks, slow, weighted votes, investigations, badges +
history, visible Command, REP-gated commanding, Material, Level from XP, rough
bands) · 30 ship sizes, roles, part customisation · 31 **network traffic plan**.

---

## 8. Open questions and next steps

**Design (owner to decide):** what REP gates besides commanding (prices / deposits?);
what Level unlocks; exact size-class list, counters and exceptions; how much more of
the map bigger ships see; final ship names (NEEDLE, ANVIL, MANTA, BULWARK, HARPOON,
HIVE, QUIVER are placeholders); the weather v12 spec (10 named pair-events matrix,
gas weight / pressure wind — never received); turn length for turn mode.

**Engineering, in suggested order:**
1. Play session on the HP + Android tablets of everything marked untested (§6).
2. Measure dead reckoning (1-minute check; `DELTA=0` to compare).
3. Distance map: cautious reading near level edges, auto-switch when sparse,
   buffer reuse (decision 25 revisit).
4. WebGL shader for weather drawing, CPU fallback (big win on tablets).
5. Low-graphics toggle for tablets.
6. Hide hidden things server-side (dormant torpedoes, out-of-view ships).
7. Gateway onto its own process over NATS; then battle workers / fleet trackers.
8. First playable fractal-fleet slice (leader, cap ship, wing, leash, rally point).
9. `docs/design/` notes per system (proposed layout in the chat; not created).

**Known issues:** the 1,000-ship benchmark check in `03-architecture/bench.js` times
out (set aside); slow moving fights (~1 kill per side per 30–45 s); carrier economy
numbers are first guesses; settings aren't sent to a screen until something changes
(the first `hello` lacks seed/mode; harmless today).

---

## 9. Working conventions (for whoever continues)

- **Owner's preferences:** one design question at a time; plain language; **don't
  run sims/tests/screenshots unless asked** (token cost) — when allowed, cap at
  1 minute; syntax-check (`node --check`) before committing.
- **Commits:** `git -c user.email="beanslyjones@gmail.com" -c user.name="BeanslyJones" commit`
  with the session's Co-Authored-By / Claude-Session trailers; push the working
  branch and fast-forward `main` (`git push origin HEAD:main`) so the HP can update.
- **Delivering to the HP:** the HP has no Git; send a zip
  (`git archive --format=zip --prefix=Classwork/ -o Classwork.zip HEAD`). Keep the
  whole folder (server needs `prototypes/shared`).
- **Publishing the single-player page:** inline `sim.js`, `sfx.js`, `shared/bus.js`
  and `shared/wx/{rng,field,global,agents,render}.js` into `combat.html` in place of
  their `<script src>` tags, then republish the artifact.
- Record every owner decision in `DECISIONS.md` as it's made.

---

## 10. Published pages (claude.ai artifacts, private to the owner)

| Page | Link |
|---|---|
| Amann Assault (single player) | https://claude.ai/artifact/6XNbNMXeWSwMDPawdoRo4L |
| Amann Assault — Game Design Document (Nov 20; predates decisions 23–31) | https://claude.ai/artifact/51i3cVTo4V5LwdqbNABXeY |
| Directional Front: Game Design Document (earlier name; land-RTS concept) | https://claude.ai/artifact/C4idY2LhikjD7FFaGMooh7 |
| Amann Assault Bus Map | https://claude.ai/artifact/1oLqMrhX3coBqu1y338D1C |
| Radiation Weather (viewer) | https://claude.ai/artifact/RS4a9D7gLzCEowzRT1Ho9j |
| Older prototype pages: 01 Juggle, 04 Fields, 05 Extraction, 06 Descent, 09 Command | in the owner's artifact gallery |

---

## 11. Sources and references

**Read during development**
- Massdrift (MMO, NATS + two-phase tick, 16,000-player battles) — YouTube:
  [How I'm using NATS to build an MMO for 16,000 player battles](https://www.youtube.com/watch?v=FQTWNjfk6Ps),
  [Why (and how) my MMO uses a two-phase tick](https://www.youtube.com/watch?v=CNIDpY90jIU),
  [Why (and how) I'm building an MMO for 16,000 player battles](https://www.youtube.com/watch?v=_q6SmNYa06U).
  The videos couldn't be opened from the dev environment; details used came from
  the owner's pasted summary: Apply → Calculate two-phase tick, workers own player
  slices, one-tick-late damage, railgun closest-claim hits, torpedo salvo owner vs
  defender resolution, collision and visibility pods (pair parity + bitmaps),
  conductor tick barrier (`combat.sync.tick` / ACKs), JetStream `raw.inputs`,
  recovery stream (last 8 slices per worker), 400 ms tick, ~3 ms p99 bus latency at
  4,000 players, 72 shards, CPU-pinned pods, live shard migration.
- [Terminal Velocity — GDC 2024 slides (NATS at scale)](https://media.gdcvault.com/gdc2024/Slides/GDC+slide+presentations/Jones_Edwin_Terminal_Velocity_Lessons.pdf)
- [Ambient discussion on NATS clusters for multiplayer](https://www.Github.com/AmbientRun/Ambient/discussions/1115)
- [Photon — Building a seamless MMO backend across machines](https://blog.photonengine.com/building-a-seamless-mmo-backend-across-machines/)
- NATS server releases: https://github.com/nats-io/nats-server/releases ; Node
  client: the `nats` npm package (v2 API: `connect`, `JSONCodec`, `subscribe`,
  `request`).

**From general knowledge (not re-checked during this work)**
- Spatial sharding prior art: BigWorld (cells, ghosts, moving borders; World of
  Tanks), KBEngine (open-source BigWorld-style engine), EVE Online (node per star
  system; Time Dilation for overload), Hadean Aether Engine (octree split/merge;
  EVE: Aether Wars demo ~14,000 clients), Dual Universe (octree server partition),
  Improbable SpatialOS (spatial workers; largely stepped back from game studios).
- Deterministic lockstep (StarCraft / Age of Empires), dead reckoning, interest
  management, chamfer distance transforms.
- Free hosting notes (terms change; verify): Oracle Cloud Always Free (Arm VMs up
  to 4 cores / 24 GB, ~10 TB egress), Google Cloud e2-micro (~1 GB egress), AWS
  credit-based free tier, Render / Railway / Fly.io trials, Synadia Cloud (hosted
  NATS), Tailscale (private network to the home HP).

**Design inspirations named by the owner (Directional Front doc):** OpenFront,
Line War, War of Dots, Kohan. Comparison done with a squadron-commander concept
(simultaneous planning, energy/wing states; SteamBirds, Frozen Synapse, X-Wing).

**Not available:** the owner's July 2–3, 2026 chat about REP (only two recovered
points, now in decision 29); the weather v12 spec.
