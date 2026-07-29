# 09 · Command layer (build order step 9, single-player core)

The 02 combat sim plus three hireable AI groups taking semantic orders.

## Run

- **Play:** open `command.html`. Tap G1/G2/G3 (or keys 1–3), then tap the map —
  near an enemy = ATTACK, open ground = RALLY. Grabbing ships directly still
  works exactly like 02. Button rings show each order's remaining TTL.
- **Verify:** `node test.js`.

## The model (PROVISIONAL — review this, it's a design call)

Orders are point-targeted, group-scoped, and **TTL-limited** (default 12s).
While an order is live, hired pilots hold that group: momentum frozen, ships
flown competently. When it expires the group drops back onto the juggle clock
and starts decaying. That makes commanding itself a juggle — you rotate
attention across three order timers plus any ships you fly by hand. The TTL
mechanism is my bridge between "hireable AI" and "nothing relieves the juggle";
if hired pilots should instead cost currency, or degrade, or persist, this is
the knob to rip out.

## Gate

**Does commanding still feel like juggling?** Headless proxy (6v6, 90s, seed
909): neglect 102 ship-seconds · orders-only 222 · orders + hands-on juggling
384. Orders visibly beat neglect, hands-on play composes on top, and orders
alone still lose ships — attention stays finite. Feel check is yours.

## Out of scope here (flagged)

Co-op role split and per-player cameras (multiplayer), camera quadrant-split
vs light overlay (open fork — this prototype is single-camera), order types
beyond attack/rally (escort, mine, screen…), group hiring economics.
