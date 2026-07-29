# RADIANT WARFRONT — prototype pipeline

Self-contained HTML5 prototypes, each verified headless in Node before any
Unity port. Every folder: `sim.js` (pure, DOM-free, fixed tick, seeded RNG,
semantic commands only) + `test.js` (run `node test.js`) + a playable page
(open the `.html`, mouse and touch both work).

## Build order status

| step | folder | gate | status |
|------|--------|------|--------|
| 1 juggle | `prototypes/01-juggle` | tense with 4 ships? | built · **needs playtest** |
| 2 combat | `prototypes/02-combat` | neglect visibly costs? | built · gate proxy passes |
| 3 architecture | `prototypes/03-architecture` | stable tick @ 100 units, baseline recorded | done — see BASELINE.md |
| 4 fields | `prototypes/04-fields` | color changes not a wall? | built · gate proxy passes |
| 5 extraction | `prototypes/05-extraction` | extraction a gamble? | built · gate proxy passes |
| 6 descent | `prototypes/06-descent` | descent skill tightens scatter? | built · gate proxy passes |
| 7 art | — | — | **blocked on sprites** (Inspector slots, hitbox overlay = Unity-side) |
| 8 weather | `prototypes/08-weather` | fronts survive; seed-stable | **skeleton only — needs v12 spec** for funnel + 10 pair-events |
| 9 command | `prototypes/09-command` | commanding still juggling? | built · order-TTL model is provisional |

Gate proxies are headless bots; the feel gates still need hands on the sticks.

## Open forks — waiting on the owner (never decided silently)

Descent energy-bank · battery-vs-field upgrade path · third no-drain condition
in friendly field · per-class dodge specials · outfit shared IFF · artillery
circle grow-vs-tighten · camera quadrant-split vs light overlay · opposition
cap scaling · scatter radius numbers.

Decisions I made that deserve review (each flagged in its README):
momentum-scaled crystal avoidance (01) · order-TTL hired-pilot model (09) ·
13-module placeholder taxonomy (06) · merged same-color shelter semantics (04).
