// AMANN ASSAULT (Radiant Warfront prototype 02): combat on top of the juggle.
// Extends 01's momentum/crystallize core with the shared class table, firing
// cones, target-gated cooldowns, AoE projectiles, lock-scaled spread, dodge,
// and one energy pool per ship (= health + ammo + boost).
// Pure sim. No DOM. Fixed tick, one seeded RNG stream, semantic commands only.
// Update gating (Active/Reduced/Dormant) and projectile pooling are first-class
// here — step 3's hardening lives in this sim and is benchmarked from 03/.
//
// Guns: every gun is an object with its own aim, target, lock and reload. A
// fixed-gun ship's one gun IS the ship (its gunAngle/targetId/lockQ… fields),
// riding the hull. The Grayzer carries two side turrets, each confined to a
// 90-degree sector on its own side of the hull.
//
// Modes: 'skirmish' (fixed 6v6) and 'carrier' (Destroy the Carrier: each side
// has a carrier that builds ships with money earned per second plus salvage).
//
// Scaling architecture (built to be shardable, Massdrift-style):
//  - Two-phase tick. THINK: every ship reads a frozen frame of the world as it
//    was at the start of the tick and writes only to itself; anything that
//    touches another ship (a shot, a battery recharge, a wreck) becomes an
//    intent. RESOLVE: intents are applied in ship-id order. So the result never
//    depends on which order (or on which machine) ships were thought about.
//  - Each ship has its own RNG stream, so its randomness doesn't depend on who
//    was processed before it.
//  - Every neighbour query (targets, cones, battery, collisions, blasts) goes
//    through a spatial grid instead of all-pairs loops.
//  - Ships carry an owner (the player who commands them) — the unit a shard
//    would own.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CombatSim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TUNABLES = {
    tickRate:        { value: 30,    min: 10,  max: 120,  tooltip: 'Fixed sim ticks per second.' },
    arenaRadius:     { value: 560,   min: 200, max: 2000, tooltip: 'Soft arena radius. No boundary death.' },
    aiApmMatch:      { value: 1.0,   min: 0.25, max: 3,   tooltip: 'AI actions per minute as a multiple of its human opponent\'s APM (1 = match the player). Each AI action re-aims one ship, like one player grab.' },
    aiApmDefault:    { value: 30,    min: 5,   max: 200,  tooltip: 'APM assumed for a player before there is history (blends out over the first ~10s), and for AI vs AI.' },
    aiApmMin:        { value: 10,    min: 0,   max: 100,  tooltip: 'Floor on AI APM so an idle player still faces an opponent that moves.' },
    edgeSteer:       { value: 2.2,   min: 0,   max: 10,   tooltip: 'Corrective turn (rad/s) past the soft edge.' },
    minSpeed:        { value: 50,    min: 0,   max: 100,  tooltip: 'Speed floor while momentum > 0.' },
    momentumDrain:   { value: 0.0275, min: 0,   max: 0.5,  tooltip: 'Momentum lost per second while unpossessed (player team only): an ignored ship slows toward minSpeed and drifts. Ships never stall.' },
    driftNoise:      { value: 1.4,   min: 0,   max: 8,    tooltip: 'Heading wobble (rad/s) at zero momentum.' },
    crystallizeSec:  { value: 1.2,   min: 0.1, max: 5,    tooltip: 'Seconds from fatal blow to crystallized salvage.' },
    hazardCount:     { value: 0,     min: 0,   max: 30,   tooltip: 'Seeded crystal formations (off for now). Projectiles detonate on them (cover). Reset to apply.' },
    wreckCrystals:   { value: 0,     min: 0,   max: 1,    tooltip: '1 = dead ships leave a crystal wreck that kills on contact and blocks shots (off for now).' },
    hazardBandInner: { value: 220,   min: 50,  max: 1000, tooltip: 'Crystal-free inner disc radius.' },
    hazardRadiusMin: { value: 24,    min: 5,   max: 100,  tooltip: 'Smallest crystal radius.' },
    hazardRadiusMax: { value: 48,    min: 5,   max: 160,  tooltip: 'Largest crystal radius.' },
    unitRadius:      { value: 10,    min: 4,   max: 30,   tooltip: 'Unit collision radius (art scale decoupled).' },
    avoidRange:      { value: 90,    min: 0,   max: 300,  tooltip: 'Crystal look-ahead for unheld ships, added on top of the ship\'s own turn radius (wide turners look further ahead).' },
    avoidSteer:      { value: 1.0,   min: 0,   max: 1,    tooltip: 'Share of the hull\'s turn rate unheld ships spend evading crystals (scaled by momentum on human sides).' },
    turnRadiusScale: { value: 1.0,   min: 0.3, max: 3,    tooltip: 'Multiplies every class turnRadius. Bigger = wider, lazier turns for the whole fleet.' },
    lockTimeFull:    { value: 1.6,   min: 0.2, max: 6,    tooltip: 'Seconds held in the arc to climb from the starting lock to its ceiling.' },
    lockSpreadMax:   { value: 0.35,  min: 0,   max: 1.5,  tooltip: 'Aim error (radians) at zero lock. Spread scales down with lock quality.' },
    lockEntryFloor:  { value: 0.35,  min: 0,   max: 1,    tooltip: 'Lock ceiling for a target that entered at the very edge of the arc. Dead-centre entry = 1.' },
    lockStartFrac:   { value: 0.3,   min: 0,   max: 1,    tooltip: 'Lock starts at this fraction of its ceiling, then climbs over lockTimeFull.' },
    turretEntryArc:  { value: 1.57,  min: 0.2, max: 3.14, tooltip: 'Turrets: how far off the barrel (radians) counts as a worst-case entry.' },
    leadMax:         { value: 1.0,   min: 0,   max: 1.5,  tooltip: 'Target leading at full lock (1 = aims exactly where the target will be).' },
    fireRateBonus:   { value: 0.6,   min: 0,   max: 2,    tooltip: 'Extra fire rate at full lock (0.6 = reloads 60% faster).' },
    coneGraceSec:    { value: 0.5,   min: 0,   max: 3,    tooltip: 'Seconds a target may slip out of cone before the lock is dropped.' },
    autoFireFloor:   { value: 0.15,  min: 0,   max: 0.9,  tooltip: 'Ships hold fire below this energy fraction — shooting spends the same pool that keeps them alive.' },
    dodgeCost:       { value: 18,    min: 0,   max: 100,  tooltip: 'Flat energy cost of a barrel roll. Big on purpose.' },
    dodgeSpeedMult:  { value: 2.6,   min: 1,   max: 6,    tooltip: 'Speed multiplier during the roll. Straight line only.' },
    dodgeDurSec:     { value: 0.45,  min: 0.1, max: 2,    tooltip: 'Roll duration.' },
    dodgeLockoutSec: { value: 0.8,   min: 0,   max: 3,    tooltip: 'Turn lockout after the roll — readable and interceptable.' },
    projTtlSec:      { value: 2.2,   min: 0.5, max: 6,    tooltip: 'Projectile lifetime; flak detonates at end of life.' },
    weakCritMult:    { value: 2.5,   min: 1,   max: 6,    tooltip: 'Damage multiplier when a blast lands on a capital weak point.' },
    weakHp:          { value: 300,   min: 5,   max: 1000, tooltip: 'Damage a weak point absorbs before it is knocked out.' },
    bridgeTurn:      { value: 0.4,   min: 0,   max: 1,    tooltip: 'Bridge knocked out: turret traverse speed multiplier (fire control damaged, not dead).' },
    bridgeLockCap:   { value: 0.3,   min: 0,   max: 1,    tooltip: 'Bridge knocked out: the turret\'s lock can climb no higher than this (sloppy aim).' },
    spawnDist:       { value: 330,   min: 100, max: 1000, tooltip: 'How far from the centre each team starts. Further = the fight builds up instead of opening point-blank. Reset to apply.' },
    ventLeak:        { value: 3,     min: 0,   max: 20,   tooltip: 'Energy/sec a capital bleeds per breached reactor vent.' },
    engineCripple:   { value: 0.5,   min: 0.1, max: 1,    tooltip: 'Speed and turn multiplier once a capital loses its engines.' },
    hangarCripple:   { value: 0.5,   min: 0.1, max: 1,    tooltip: 'Carrier hangar knocked out: build speed multiplier.' },
    batteryScale:    { value: 1.0,   min: 0,   max: 3,    tooltip: 'Multiplies the Grayzer battery: its capacity, recharge and the energy it pours into friendly ships.' },
    incomePerSec:    { value: 8,     min: 0,   max: 50,   tooltip: 'Destroy the Carrier: money each side earns per second while its carrier lives.' },
    startMoney:      { value: 250,   min: 0,   max: 2000, tooltip: 'Destroy the Carrier: money each side starts with.' },
    salvageFrac:     { value: 0.4,   min: 0,   max: 1,    tooltip: 'Destroy the Carrier: a wreck is worth this fraction of the dead ship\'s cost. Any ship that flies over it collects it.' },
    wreckSec:        { value: 45,    min: 5,   max: 300,  tooltip: 'Seconds a wreck stays before drifting off.' },
    maxShips:        { value: 16,    min: 4,   max: 60,   tooltip: 'Destroy the Carrier: most ships a side may have at once (carrier and Grayzer included).' },
    beatSliceSec:    { value: 0.25,  min: 0.03, max: 1,   tooltip: 'Beat mode: ship-seconds a note gives the ships on its lane (they move, reload and fire only while their slice runs).' },
    // Missiles, rockets, torpedoes (fired with the lock mini-game). They can hit allies.
    missileSpeed:    { value: 175,   min: 60,  max: 400,  tooltip: 'Missile speed (units/s).' },
    missileTurn:     { value: 3.0,   min: 0.2, max: 8,    tooltip: 'How hard a missile can turn (rad/s) at a perfect lock. A worse lock turns less.' },
    missileDamage:   { value: 30,    min: 5,   max: 120,  tooltip: 'Missile blast damage.' },
    missileReload:   { value: 3.0,   min: 0.3, max: 12,   tooltip: 'Seconds between missiles.' },
    rocketSpeed:     { value: 280,   min: 80,  max: 600,  tooltip: 'Rocket speed. Rockets are dumb: they fly where the lock icon was.' },
    rocketDamage:    { value: 18,    min: 2,   max: 80,   tooltip: 'Rocket blast damage.' },
    rocketReload:    { value: 1.2,   min: 0.2, max: 8,    tooltip: 'Seconds between rockets.' },
    torpedoSpeed:    { value: 105,   min: 40,  max: 300,  tooltip: 'Torpedo speed.' },
    torpedoArmDist:  { value: 170,   min: 0,   max: 600,  tooltip: 'Torpedoes run dumb this far, then go active and search for a target.' },
    torpedoSearch:   { value: 280,   min: 50,  max: 800,  tooltip: 'How far an active torpedo can see a target (ahead of it).' },
    torpedoTurn:     { value: 1.3,   min: 0.1, max: 5,    tooltip: 'How hard an active torpedo turns toward its target.' },
    torpedoReload:   { value: 4.0,   min: 0.5, max: 15,   tooltip: 'Seconds between torpedoes.' },
    lockIconSpeed:   { value: 150,   min: 20,  max: 500,  tooltip: 'Lock icon speed (units/s) on a yellow lock. Green is slower, red and white faster.' },
    lockCatch:       { value: 55,    min: 10,  max: 200,  tooltip: 'Let go with the icon within this distance of the target to lock it. Closer = better tracking.' },
    friendlyFire:    { value: 0,     min: 0,   max: 1,    tooltip: 'Separate toggle, off by default. AoE never hurts allies unless this is 1.' },
    gateReducedDist: { value: 700,   min: 100, max: 4000, tooltip: 'Farther than this from any foe -> Reduced tier (combat every 2nd tick).' },
    gateDormantDist: { value: 1400,  min: 200, max: 8000, tooltip: 'Farther than this -> Dormant tier (every 4th tick, no target acquisition).' },
  };

  // Shared class table — the SAME rows drive player ships and opposition.
  // Tuned for time-to-kill (one attacker, sustained fire, centre entry):
  // ~3s on small ships (interceptor ~2s .. heavy ~3.5s), ~10s on a capital
  // (torpedo bomber ~5s). Re-measure with the TTK test if you change a row.
  // Unity port: one ScriptableObject per row; numbers become [Range] fields there.
  // turnRadius: world units. Ships can never turn tighter than this — angular
  // rate = current speed / turnRadius — so bigger, slower hulls swing wider.
  // turret: carries turrets (`turrets` lists each mount: hull angle, how far it
  // may swing either side of that angle, and its spot on the hull). Everything
  // else has one fixed forward gun — the cone points where the hull points.
  // size: collision radius multiplier on unitRadius.
  // cost / buildTime: what a carrier pays and how long it takes to build one.
  const CLASSES = {
    fighter:     { speed: 150, turnRadius: 110, energyMax: 100, turret: false, gunTurn: 0, size: 1, cost: 100, buildTime: 6,
                   coneHalf: 0.65, coneRange: 230, cooldown: 0.167, shotCost: 0.67, damage: 7.2,  aoe: 26, projSpeed: 198, projTtl: 1.51 },
    bomber:      { speed: 100, turnRadius: 150, energyMax: 116, turret: false, gunTurn: 0, size: 1, cost: 150, buildTime: 9,
                   coneHalf: 0.80, coneRange: 270, cooldown: 0.533, shotCost: 2.0, damage: 26.3, aoe: 72, projSpeed: 108, projTtl: 3.25 },
    heavy:       { speed: 112, turnRadius: 160, energyMax: 125, turret: false, gunTurn: 0, size: 1, cost: 150, buildTime: 9,
                   coneHalf: 0.45, coneRange: 320, cooldown: 0.267, shotCost: 1.33, damage: 14, aoe: 18, projSpeed: 258, projTtl: 1.61 },
    interceptor: { speed: 215, turnRadius: 90, energyMax: 58,  turret: false, gunTurn: 0, size: 1, cost: 80, buildTime: 5,
                   coneHalf: 0.70, coneRange: 180, cooldown: 0.117, shotCost: 0.5, damage: 5.1,  aoe: 16, projSpeed: 222, projTtl: 1.05 },
    aaa:         { speed: 70,  turnRadius: 120, energyMax: 105, turret: false, gunTurn: 0, size: 1, cost: 120, buildTime: 7,
                   coneHalf: 1.40, coneRange: 210, cooldown: 0.1, shotCost: 0.4, damage: 4.25,  aoe: 36, projSpeed: 156, projTtl: 1.75 },
    // Torpedo bomber: capital killer. Slow, heavy shots that small ships can
    // sidestep but a lumbering capital can't. vsCapital multiplies damage on
    // capitals; projTtl lets the slow torpedo actually reach its range.
    torpedo:     { speed: 90,  turnRadius: 150, energyMax: 116, turret: false, gunTurn: 0, size: 1, cost: 160, buildTime: 10, launcher: 'torpedo', manualOnly: true,
                   coneHalf: 0.55, coneRange: 300, cooldown: 1.6, shotCost: 4.67, damage: 38.8, aoe: 28, projSpeed: 105, projTtl: 3.71,
                   vsCapital: 4.0 },
    // Capital (the Grayzer, the player's dropship; one per side). Two side
    // turrets, each confined to a 90-degree sector (traverse = 45 deg either side
    // of straight out). Battery: recharges friendly ships' energy in range.
    // weakPoints: spots on the hull in hull-local units of the ship's radius
    // (+x = nose). A blast landing on one does weakCritMult damage and wears
    // it down; knocked out, it costs the ship something:
    //   bridge -> turrets' fire control damaged (slow traverse, sloppy lock)
    //   engine -> speed/turn crippled      vent -> hull bleeds energy (ventLeak)
    // Different capital types are just different rows with different layouts.
    capital:     { speed: 45,  turnRadius: 200, energyMax: 678, turret: true,  gunTurn: 3.0, size: 2.2,
                   coneHalf: 0.3, coneRange: 400, cooldown: 0.9, shotCost: 1.33, damage: 16.6, aoe: 30, projSpeed: 180, projTtl: 2.9,
                   turrets: [
                     { mount:  Math.PI / 2, traverse: Math.PI / 4, ox: -0.05, oy:  0.6 },
                     { mount: -Math.PI / 2, traverse: Math.PI / 4, ox: -0.05, oy: -0.6 },
                   ],
                   battery: { max: 300, recharge: 5, range: 200, rate: 15 },
                   weakPoints: [
                     { type: 'bridge', x: 1.05,  y: 0,     r: 0.4 },
                     { type: 'engine', x: -1.0,  y: 0,     r: 0.45 },
                     { type: 'vent',   x: -0.1,  y: 0.75,  r: 0.35 },
                     { type: 'vent',   x: -0.1,  y: -0.75, r: 0.35 },
                   ] },
    // Carrier: the base in Destroy the Carrier. No guns; builds ships with the
    // side's money. Never stalls. Losing it loses the game.
    carrier:     { speed: 28,  turnRadius: 260, energyMax: 1600, turret: false, noGuns: true, noStall: true, gunTurn: 0, size: 3.2,
                   coneHalf: 0, coneRange: 0, cooldown: 1, shotCost: 0, damage: 0, aoe: 0, projSpeed: 1, projTtl: 1,
                   weakPoints: [
                     { type: 'hangar', x: 0.55,  y: 0,     r: 0.35 },
                     { type: 'engine', x: -1.0,  y: 0,     r: 0.4 },
                     { type: 'vent',   x: -0.3,  y: 0.7,   r: 0.3 },
                     { type: 'vent',   x: -0.3,  y: -0.7,  r: 0.3 },
                   ] },
    // Missile boat: no guns, only tracking missiles fired with the lock mini-game.
    missileBoat: { speed: 100, turnRadius: 140, energyMax: 110, turret: false, gunTurn: 0, size: 1.1, cost: 170, buildTime: 10,
                   launcher: 'missile', manualOnly: true,
                   coneHalf: 0.6, coneRange: 380, cooldown: 1, shotCost: 0, damage: 0, aoe: 0, projSpeed: 175, projTtl: 1 },
  };
  // Launchers (rockets also ride on the Heavy alongside its guns).
  CLASSES.heavy.launcher = 'rocket';
  // Ordnance from the lock mini-game. seek: 'lock' = tracks the locked target
  // and leads it; 'none' = dumb; 'search' = dumb until armDist, then hunts.
  const ORD_KIND = { missile: 1, rocket: 2, torpedo: 3 };
  function ordnance(T, kind) {
    if (kind === 'missile') return { speed: T.missileSpeed, turn: T.missileTurn, ttl: 4.5, damage: T.missileDamage, aoe: 30, reload: T.missileReload, cost: 6, vsCapital: 1.5 };
    if (kind === 'rocket') return { speed: T.rocketSpeed, turn: 0, ttl: 1.6, damage: T.rocketDamage, aoe: 24, reload: T.rocketReload, cost: 3, vsCapital: 1 };
    return { speed: T.torpedoSpeed, turn: T.torpedoTurn, ttl: 6, damage: 38.8, aoe: 30, reload: T.torpedoReload, cost: 6, vsCapital: 4.0,
             armDist: T.torpedoArmDist, search: T.torpedoSearch };
  }
  const GRADE_SPEED = [1.7, 1.7, 1.0, 0.55]; // icon speed by lock grade: none, red, yellow, green
  const GRADE_LOCK = [0, 0.5, 0.8, 1];      // how much a caught lock is worth by grade
  const CLASS_LIST = Object.keys(CLASSES); // stable order: network class codes
  const BUILDABLE = ['fighter', 'interceptor', 'heavy', 'bomber', 'aaa', 'torpedo'];
  const isCapitalHull = cls => !!(CLASSES[cls].turret || CLASSES[cls].noGuns); // big ships: capital ordnance + weak points

  // --- Beat mode: songs are note sheets every player and server shares, so a
  // note never needs sending over the network — only which ship is on which lane.
  // Each bar is 16 sixteenth-note steps: 'x' = hit (accent), 'o' = softer hit,
  // '.' = rest. Pitched lanes (bass, keys) carry a note number per hit.
  const LANES = ['kick', 'snare', 'hat', 'bass', 'keys', 'crash'];
  const DEFAULT_LANE = { capital: 'kick', carrier: 'kick', heavy: 'snare', bomber: 'snare', fighter: 'hat',
                         interceptor: 'hat', torpedo: 'bass', aaa: 'keys', missileBoat: 'bass' };
  const SONGS = {
    assault: {
      name: 'Assault', bpm: 124,
      bars: {
        kick:  ['x...x...x...x...', 'x...x...x...x...', 'x...x...x...x...', 'x...x...x.x.x.x.'],
        snare: ['....x.......x...', '....x.......x...', '....x.......x...', '....x.......x.xx'],
        hat:   ['x.x.x.x.x.x.x.x.', 'x.x.x.x.x.x.x.x.', 'x.x.x.x.x.x.x.x.', 'xxxxxxxxxxxxxxxx'],
        bass:  ['x..x..x...x..x..', 'x..x..x...x..x..', 'x..x..x...x..x..', 'x..x..x.x.x.x...'],
        keys:  ['x...x.x...x.x...', '..x...x.x...x...', 'x...x.x...x.x...', 'x.x.x.x.x.x.x.x.'],
        crash: ['x...............', '................', '................', '................'],
      },
      pitch: { bass: [36, 36, 39, 41, 36, 34, 36, 39], keys: [60, 63, 67, 70, 67, 63, 72, 70] },
    },
    drift: {
      name: 'Drift', bpm: 96,
      bars: {
        kick:  ['x.........x.....', 'x.........x..x..', 'x.........x.....', 'x.....x...x...x.'],
        snare: ['........x.......', '........x.......', '........x.......', '........x...o.o.'],
        hat:   ['x.o.x.o.x.o.x.o.', 'x.o.x.o.x.o.x.o.', 'x.o.x.o.x.o.x.o.', 'x.o.x.o.x.xxx.o.'],
        bass:  ['x.......x.......', 'x.......x...x...', 'x.......x.......', 'x...x...x...x...'],
        keys:  ['x.x.x.x.x.x.x.x.', 'x.x.x.x.x.x.x.x.', 'x.x.x.x.x.x.x.x.', 'x.x.x.x.xxxxxxxx'],
        crash: ['x...............', '................', '................', '........x.......'],
      },
      pitch: { bass: [33, 33, 31, 28], keys: [57, 60, 64, 69, 64, 60, 62, 65] },
    },
  };
  // Precompute each song: per lane, the hit (if any) at every step of the loop.
  for (const id in SONGS) {
    const sg = SONGS[id], bars = sg.bars.kick.length;
    sg.steps = bars * 16;
    sg.stepSec = 60 / sg.bpm / 4;
    sg.hits = {};
    sg.share = {};
    for (const lane of LANES) {
      const arr = new Array(sg.steps).fill(0);
      let n = 0, k = 0;
      (sg.bars[lane] || []).forEach((bar, b) => {
        for (let i = 0; i < 16; i++) {
          const ch = bar[i];
          if (ch === 'x' || ch === 'o') {
            const pitches = sg.pitch && sg.pitch[lane];
            arr[b * 16 + i] = { v: ch === 'x' ? 1 : 0.6, p: pitches ? pitches[k++ % pitches.length] : 0 };
            n++;
          }
        }
      });
      sg.hits[lane] = arr;
      sg.share[lane] = n / sg.steps; // fraction of steps this lane plays
    }
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Uniform spatial hash grid: cell -> ids. Rebuilt each tick.
  function Grid(cell) { this.cell = cell; this.map = new Map(); }
  Grid.prototype.clear = function () { this.map.clear(); };
  Grid.prototype.key = function (cx, cy) { return (cx + 32768) * 65536 + (cy + 32768); };
  Grid.prototype.insert = function (id, x, y) {
    const k = this.key(Math.floor(x / this.cell), Math.floor(y / this.cell));
    let b = this.map.get(k);
    if (!b) { b = []; this.map.set(k, b); }
    b.push(id);
  };
  // Calls fn(id) for every id in cells overlapping the circle (caller checks distance).
  Grid.prototype.query = function (x, y, r, fn) {
    const c = this.cell, x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c);
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const b = this.map.get(this.key(cx, cy));
      if (b) for (let i = 0; i < b.length; i++) fn(b[i]);
    }
  };

  const TAU = Math.PI * 2;
  function wrapAngle(a) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }
  function turnToward(current, target, maxStep) {
    const d = wrapAngle(target - current);
    return current + Math.max(-maxStep, Math.min(maxStep, d));
  }

  const ALIVE = 'alive', CRYSTALLIZING = 'crystallizing', CRYSTALLIZED = 'crystallized';
  const PLAYER = 0, ENEMY = 1;

  // roster: array of {cls, team}. Default: mirror 6v6 — five fixed-gun ships
  // (incl. a torpedo bomber) plus one Grayzer per side.
  function defaultRoster() {
    return [
      { cls: 'fighter', team: PLAYER }, { cls: 'bomber', team: PLAYER },
      { cls: 'heavy', team: PLAYER }, { cls: 'interceptor', team: PLAYER },
      { cls: 'capital', team: PLAYER }, { cls: 'torpedo', team: PLAYER }, { cls: 'missileBoat', team: PLAYER },
      { cls: 'fighter', team: ENEMY }, { cls: 'bomber', team: ENEMY },
      { cls: 'heavy', team: ENEMY }, { cls: 'interceptor', team: ENEMY },
      { cls: 'capital', team: ENEMY }, { cls: 'torpedo', team: ENEMY }, { cls: 'missileBoat', team: ENEMY },
    ];
  }
  // Destroy the Carrier: carrier + Grayzer + a small starting wing per side.
  function carrierRoster() {
    const r = [];
    for (const team of [PLAYER, ENEMY]) {
      for (const cls of ['fighter', 'heavy', 'capital', 'fighter', 'carrier']) r.push({ cls: cls, team: team });
    }
    return r;
  }

  // Stress test: `count` ships per side, mostly small craft, a Grayzer every 50.
  const STRESS_MIX = ['fighter', 'missileBoat', 'interceptor', 'heavy', 'fighter', 'bomber', 'interceptor', 'torpedo', 'aaa', 'fighter'];
  function stressRoster(count) {
    const r = [];
    for (const team of [PLAYER, ENEMY]) for (let i = 0; i < count; i++) {
      r.push({ cls: i % 50 === 25 ? 'capital' : STRESS_MIX[i % STRESS_MIX.length], team: team });
    }
    return r;
  }

  // opts: { mode: 'skirmish' | 'carrier' | 'beat' | 'stress', song, count }
  function Sim(seed, overrides, roster, opts) {
    this.seed = seed >>> 0;
    this.mode = (opts && opts.mode) || 'skirmish';
    this.T = {};
    for (const k in TUNABLES) this.T[k] = TUNABLES[k].value;
    if (this.mode === 'carrier') { this.T.arenaRadius = 820; this.T.spawnDist = 430; }
    // Stress test: ships per side (10-1000) and a bigger arena to hold them.
    this.stressCount = this.mode === 'stress' ? Math.max(10, Math.min(1000, Math.round((opts && opts.count) || 150))) : 0;
    if (this.stressCount) {
      this.T.arenaRadius = Math.round(520 + 30 * Math.sqrt(this.stressCount * 2));
      this.T.spawnDist = Math.round(220 + 8 * Math.sqrt(this.stressCount));
    }
    // Beat mode: the song is the shared clock that hands ships their time.
    this.song = this.mode === 'beat' ? (SONGS[opts && opts.song] || SONGS.assault) : null;
    this.songId = this.song ? ((opts && SONGS[opts.song]) ? opts.song : 'assault') : null;
    this.beatStep = -1;
    if (overrides) for (const k in overrides) {
      if (!(k in this.T)) throw new Error('unknown tunable: ' + k);
      this.T[k] = overrides[k];
    }
    this.rng = mulberry32(this.seed);
    this.tick = 0;
    this.dt = 1 / this.T.tickRate;
    // Per-team control. human[team]: that side is flown by a person (juggle
    // rules: momentum drain, stall) rather than the opposition AI. Single
    // player = blue human, red AI; LAN multiplayer flips red to human.
    this.held = [-1, -1];
    this.aim = [0, 0];
    this.human = [true, false];
    // APM matching: ticks of each side's actions (grab / dodge / refocus) over
    // the last 30s; the AI spends a matching budget, one ship re-aim per action.
    this.actions = [[], []];
    this.aiBudget = [0, 0];
    this.aiPick = [-1, -1];
    this.pending = [];
    this.events = [];
    // Destroy the Carrier economy.
    this.money = [0, 0];
    this.queue = [[], []]; // per side: [{ cls, left }] — one builds at a time
    this.wrecks = [];
    this.winner = -1;
    this.aiBuildIdx = [0, 0];
    if (this.mode === 'carrier') this.money = [this.T.startMoney, this.T.startMoney];

    this.hazards = [];
    const inner = this.T.hazardBandInner, outer = this.T.arenaRadius - this.T.hazardRadiusMax;
    for (let i = 0; i < this.T.hazardCount; i++) {
      let placed = null;
      for (let attempt = 0; attempt < 40 && !placed; attempt++) {
        const ang = this.rng() * TAU;
        const r = this.T.hazardRadiusMin + this.rng() * (this.T.hazardRadiusMax - this.T.hazardRadiusMin);
        const lo = inner + r;
        const dist = lo + this.rng() * Math.max(0, outer - lo);
        const c = { x: Math.cos(ang) * dist, y: Math.sin(ang) * dist, r: r, salvage: false };
        let ok = true;
        for (const h of this.hazards) {
          if (Math.hypot(h.x - c.x, h.y - c.y) < h.r + c.r + this.T.unitRadius * 4) { ok = false; break; }
        }
        if (ok) placed = c;
      }
      if (placed) this.hazards.push(placed);
    }

    // Teams spawn on opposite sides of the safe disc, already moving.
    const list = roster || (this.mode === 'carrier' ? carrierRoster() : this.stressCount ? stressRoster(this.stressCount) : defaultRoster());
    // Stress test: each side starts as a block (columns facing the enemy).
    const cols = this.stressCount ? Math.max(4, Math.ceil(Math.sqrt(this.stressCount) / 1.5)) : 0, gap = 34;
    this.units = [];
    let pIdx = 0, eIdx = 0;
    const perTeam = [list.filter(r => r.team === PLAYER).length, list.filter(r => r.team === ENEMY).length];
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      const slot = r.team === PLAYER ? pIdx++ : eIdx++;
      const n = perTeam[r.team];
      const baseAng = r.team === PLAYER ? Math.PI : 0; // player west, enemy east
      const ang = baseAng + ((slot - (n - 1) / 2) * 0.35);
      if (!CLASSES[r.cls]) throw new Error('unknown class: ' + r.cls);
      if (cols) {
        const side = r.team === PLAYER ? -1 : 1, rows = Math.ceil(n / cols);
        const x = side * (this.T.spawnDist + (slot % cols) * gap), y = (Math.floor(slot / cols) - (rows - 1) / 2) * gap;
        this._spawn(r.cls, r.team, x, y, baseAng + Math.PI);
        continue;
      }
      // Carriers sit well behind their line.
      const dist = this.T.spawnDist + (r.cls === 'carrier' ? 260 : 0);
      const a = r.cls === 'carrier' ? baseAng : ang;
      this._spawn(r.cls, r.team, Math.cos(a) * dist, Math.sin(a) * dist, baseAng + Math.PI);
    }

    // Projectile pool. Fixed-capacity free list; nothing allocates per shot.
    // Free-list pool: O(1) to take a slot, grows in chunks if a huge battle
    // fills it (up to MAX_PROJECTILES), so large fleets don't silently lose shots.
    this.projectiles = [];
    this._free = [];
    this._growPool(1024);
    this.poolStats = { fired: 0, dropped: 0 };
    this.grid = new Grid(256);  // start-of-tick positions (THINK reads)
    this.gridNow = new Grid(64); // post-move positions (projectile hits, blasts)
    this.frame = [];
  }

  const MAX_PROJECTILES = 65536;
  Sim.prototype._growPool = function (n) {
    const start = this.projectiles.length, end = Math.min(MAX_PROJECTILES, start + n);
    for (let i = start; i < end; i++) {
      this.projectiles.push({ i: i, active: false, x: 0, y: 0, vx: 0, vy: 0, ttl: 0, owner: -1, team: -1, damage: 0, aoe: 0, vsCap: 1,
                              kind: 0, target: -1, turn: 0, speed: 0, arm: 0, search: 0, ff: false });
    }
    for (let i = end - 1; i >= start; i--) this._free.push(i); // lowest index handed out first
    return end > start;
  };

  function newGun(heading, mount, cooldown) {
    return { gunAngle: heading + mount, targetId: -1, outOfConeTime: 0, cooldown: cooldown,
             entryQ: 0, lockCap: 0, lockQ: 0, entered: Object.create(null) };
  }

  // Create a ship. Ships can be added mid-battle (carrier builds); ids are
  // array indices and never reused.
  Sim.prototype._spawn = function (clsName, team, x, y, heading) {
    const cls = CLASSES[clsName], id = this.units.length;
    const u = {
      id: id, cls: clsName, team: team,
      owner: team, // the player commanding this ship (today: one player per side)
      rng: mulberry32((this.seed ^ Math.imul(id + 1, 0x9E3779B1)) >>> 0),
      x: x, y: y, heading: heading,
      momentum: 1, stallTimer: 0, crystallizeTimer: 0,
      goal: null, // heading a released ship is still turning toward (no snap turns)
      decTick: -1 - id, // AI: tick of this ship's last re-aim (oldest goes next)
      energy: cls.energyMax,
      // A fixed-gun ship's gun state lives on the ship itself.
      // Arc-entry lock: entryQ = how centred the target was when it entered
      // the arc (1 = dead centre, 0 = edge), frozen at entry. lockCap is the
      // ceiling that entry allows; lockQ climbs toward it while held in the arc.
      gunAngle: heading, targetId: -1, outOfConeTime: 0, cooldown: cls.cooldown,
      entryQ: 0, lockCap: 0, lockQ: 0, entered: Object.create(null),
      vx: 0, vy: 0,
      dodgeTimer: 0, lockoutTimer: 0,
      beingShotTimer: 0, // set when damaged; drives the "being shot" attrition condition later
      tier: 0, // 0 Active, 1 Reduced, 2 Dormant — update gating
      state: ALIVE, held: false,
      weak: (cls.weakPoints || []).map(w => ({ type: w.type, x: w.x, y: w.y, r: w.r, hp: this.T.weakHp, out: false })),
      battery: cls.battery ? cls.battery.max * this.T.batteryScale : 0,
      lane: DEFAULT_LANE[clsName] || 'kick', // beat mode: the instrument that gives this ship its time
      activeLeft: 0,   // beat mode: ship-seconds left in the current slice
      shipTime: 0,     // beat mode: total ship-seconds this ship has had
      ml: null,        // lock mini-game while the launch button is held: { lx, ly, dir, grade, target }
      launchCd: 0, aiRelease: 0,
    };
    // Guns: turrets carry their own state; a fixed-gun ship's one gun is itself.
    if (cls.turrets) {
      u.guns = cls.turrets.map(t => Object.assign(newGun(heading, t.mount, cls.cooldown), { mount: t.mount, traverse: t.traverse, ox: t.ox, oy: t.oy }));
    } else if (cls.noGuns) {
      u.guns = [];
    } else {
      u.mount = 0; u.traverse = 0; u.ox = 0; u.oy = 0;
      u.guns = [u];
    }
    this.units.push(u);
    return u;
  };

  // Back-compat for single-player callers: heldUnit / aimAngle = blue's.
  Object.defineProperty(Sim.prototype, 'heldUnit', {
    get: function () { return this.held[0]; }, set: function (v) { this.held[0] = v; } });
  Object.defineProperty(Sim.prototype, 'aimAngle', {
    get: function () { return this.aim[0]; }, set: function (v) { this.aim[0] = v; } });

  // Hand a side to a person (true) or back to the AI (false).
  Sim.prototype.setHuman = function (team, on) {
    if (this.human[team] === !!on) return;
    this.human[team] = !!on;
    if (this.held[team] >= 0) { this.units[this.held[team]].held = false; this.held[team] = -1; }
    for (const u of this.units) if (u.team === team && u.state === ALIVE) { u.momentum = 1; u.stallTimer = 0; }
    this.events.push({ type: 'control', team: team, human: !!on, tick: this.tick });
  };

  // Commands carry an optional team (default 0 = blue). A side can only touch
  // its own ships, and only while a person is flying it.
  Sim.prototype.command = function (cmd) { this.pending.push(cmd); };

  Sim.prototype._dropLock = function (g) {
    g.targetId = -1; g.lockQ = 0; g.lockCap = 0; g.entryQ = 0; g.outOfConeTime = 0;
    for (const k in g.entered) delete g.entered[k];
  };

  Sim.prototype._applyCommands = function () {
    for (const cmd of this.pending) {
      const team = cmd.team | 0;
      if (team !== 0 && team !== 1) continue;
      if (!this.human[team]) continue;
      if (cmd.type === 'grab') {
        const u = this.units[cmd.unit];
        // One grabbable unit at a time per side, own ships only — targeting stays
        // enemy-only, possession stays friendly-only.
        if (!u || u.team !== team || u.state !== ALIVE) continue;
        if (this.held[team] >= 0) this.units[this.held[team]].held = false;
        this.held[team] = cmd.unit;
        u.held = true;
        this.aim[team] = u.heading;
        this.events.push({ type: 'grabbed', unit: cmd.unit, team: team, tick: this.tick });
        this.actions[team].push(this.tick);
      } else if (cmd.type === 'aim') {
        if (typeof cmd.angle === 'number' && isFinite(cmd.angle)) this.aim[team] = cmd.angle;
      } else if (cmd.type === 'release') {
        if (this.held[team] < 0) continue;
        const u = this.units[this.held[team]];
        u.held = false;
        u.goal = this.aim[team]; // keeps turning toward it at its own rate after release
        u.momentum = 1;
        u.stallTimer = 0;
        this.events.push({ type: 'released', unit: this.held[team], team: team, tick: this.tick });
        this.held[team] = -1;
      } else if (cmd.type === 'order') {
        // Click-to-move: turn this side's ship toward a direction at its own
        // turn rate. Same effect as a fling: re-energises it (momentum 1).
        const u = this.units[cmd.unit];
        if (!u || u.team !== team || u.state !== ALIVE || u.held) continue;
        if (typeof cmd.angle !== 'number' || !isFinite(cmd.angle)) continue;
        u.goal = cmd.angle;
        u.momentum = 1;
        u.stallTimer = 0;
        this.events.push({ type: 'ordered', unit: u.id, team: team, tick: this.tick });
        this.actions[team].push(this.tick);
      } else if (cmd.type === 'launchHold') {
        const u = this._actor(cmd, team);
        if (u && u.state === ALIVE && CLASSES[u.cls].launcher && !u.ml && u.launchCd <= 0) this._mlStart(u);
      } else if (cmd.type === 'launchRelease') {
        const u = this._actor(cmd, team);
        if (u && u.ml) this._mlRelease(u);
      } else if (cmd.type === 'dodge') {
        const u = this._actor(cmd, team);
        if (!u || u.state !== ALIVE || u.dodgeTimer > 0 || u.lockoutTimer > 0) continue;
        if (u.energy <= this.T.dodgeCost) continue; // can't roll yourself to death
        u.energy -= this.T.dodgeCost;
        u.dodgeTimer = this.T.dodgeDurSec;
        u.goal = null; // rolls straight along its current heading — no snap
        this.events.push({ type: 'dodge', unit: u.id, tick: this.tick });
        this.actions[team].push(this.tick);
      } else if (cmd.type === 'refocus') {
        // Retarget: drop every gun's lock so the first NEW cone entrant takes priority.
        const u = this._actor(cmd, team);
        if (!u) continue;
        for (const g of u.guns) this._dropLock(g);
        u.retargetTick = this.tick; // the next lock this ship takes is a retarget (cue)
        this.events.push({ type: 'refocus', unit: u.id, team: team, tick: this.tick });
        this.actions[team].push(this.tick);
      } else if (cmd.type === 'lane') {
        // Beat mode: put one of your ships on an instrument lane.
        const u = this.units[cmd.unit];
        if (!u || u.team !== team || LANES.indexOf(cmd.lane) < 0) continue;
        u.lane = cmd.lane;
        this.events.push({ type: 'lane', unit: u.id, lane: u.lane, team: team, tick: this.tick });
      } else if (cmd.type === 'build') {
        this._queueBuild(team, cmd.cls);
      }
    }
    this.pending.length = 0;
  };

  const APM_WINDOW_SEC = 30, APM_PRIOR_SEC = 10;
  // A side's actions per minute over the last 30s, blended with aiApmDefault
  // while there's little history so the AI doesn't start frozen or frantic.
  Sim.prototype.apm = function (team) {
    const T = this.T, win = APM_WINDOW_SEC * T.tickRate, list = this.actions[team];
    while (list.length && list[0] <= this.tick - win) list.shift();
    const elapsed = Math.min(this.tick, win) / T.tickRate;
    // The prior fades out as the window fills, so a full window is the true rate.
    const prior = APM_PRIOR_SEC * Math.max(0, 1 - elapsed / APM_WINDOW_SEC);
    return (list.length + T.aiApmDefault * prior / 60) / ((elapsed + prior) / 60 || 1);
  };
  // The APM an AI side is allowed: its human opponent's, times aiApmMatch.
  Sim.prototype.aiApm = function (team) {
    const T = this.T, opp = 1 - team;
    const base = this.human[opp] ? this.apm(opp) : T.aiApmDefault;
    return Math.max(T.aiApmMin, base * T.aiApmMatch);
  };

  // Ship a dodge/refocus acts on: the one being held, else the one named in the
  // command (a ship selected with a number key) if it's this side's and alive.
  Sim.prototype._actor = function (cmd, team) {
    if (this.held[team] >= 0) return this.units[this.held[team]];
    const u = typeof cmd.unit === 'number' ? this.units[cmd.unit] : null;
    return u && u.team === team && u.state === ALIVE ? u : null;
  };

  // --- Destroy the Carrier: economy and building ---
  Sim.prototype.carrierOf = function (team) {
    for (const u of this.units) if (u.cls === 'carrier' && u.team === team && u.state === ALIVE) return u;
    return null;
  };
  Sim.prototype.teamShips = function (team) {
    let n = 0;
    for (const u of this.units) if (u.team === team && u.state === ALIVE) n++;
    return n + this.queue[team].length;
  };
  Sim.prototype._queueBuild = function (team, clsName) {
    if (this.mode !== 'carrier' || this.winner >= 0) return false;
    if (BUILDABLE.indexOf(clsName) < 0) return false; // one Grayzer, one carrier: never built
    const cls = CLASSES[clsName];
    if (!this.carrierOf(team) || this.money[team] < cls.cost) return false;
    if (this.teamShips(team) >= this.T.maxShips || this.queue[team].length >= 5) return false;
    this.money[team] -= cls.cost;
    this.queue[team].push({ cls: clsName, left: cls.buildTime });
    this.events.push({ type: 'queued', team: team, cls: clsName, tick: this.tick });
    return true;
  };
  Sim.prototype._economy = function (dt) {
    const T = this.T;
    for (let t = 0; t < 2; t++) {
      const car = this.carrierOf(t);
      if (!car) continue;
      this.money[t] += T.incomePerSec * dt;
      // AI builds a steady mix whenever it can afford the next ship.
      if (!this.human[t] && this.queue[t].length === 0) {
        const plan = ['fighter', 'heavy', 'torpedo', 'fighter', 'interceptor', 'bomber', 'aaa'];
        if (this._queueBuild(t, plan[this.aiBuildIdx[t] % plan.length])) this.aiBuildIdx[t]++;
      }
      const job = this.queue[t][0];
      if (!job) continue;
      job.left -= dt * (this._weakFlag(car, 'hangar') ? T.hangarCripple : 1);
      if (job.left <= 0) {
        this.queue[t].shift();
        const off = T.unitRadius * CLASSES.carrier.size * 1.4;
        const u = this._spawn(job.cls, t, car.x + Math.cos(car.heading) * off, car.y + Math.sin(car.heading) * off, car.heading);
        if (this.human[t]) u.goal = car.heading;
        this.events.push({ type: 'built', unit: u.id, team: t, cls: job.cls, tick: this.tick });
      }
    }
    // Wrecks: any ship flying over one salvages it for its side.
    for (let i = this.wrecks.length - 1; i >= 0; i--) {
      const w = this.wrecks[i];
      w.ttl -= dt;
      let taken = null;
      for (const u of this.units) {
        if (u.state !== ALIVE || CLASSES[u.cls].noGuns) continue;
        if (Math.hypot(u.x - w.x, u.y - w.y) < T.unitRadius * CLASSES[u.cls].size + 14) { taken = u; break; }
      }
      if (taken) {
        this.money[taken.team] += w.value;
        this.events.push({ type: 'salvage', team: taken.team, unit: taken.id, value: w.value, x: w.x, y: w.y, tick: this.tick });
        this.wrecks.splice(i, 1);
      } else if (w.ttl <= 0) this.wrecks.splice(i, 1);
    }
    // Win: a side whose carrier is gone loses.
    if (this.winner < 0) {
      const alive = [!!this.carrierOf(0), !!this.carrierOf(1)];
      if (!alive[0] || !alive[1]) {
        this.winner = alive[0] ? 0 : (alive[1] ? 1 : 2);
        this.events.push({ type: 'victory', team: this.winner, tick: this.tick });
      }
    }
  };

  Sim.prototype._kill = function (u, cause) {
    if (u.state !== ALIVE) return;
    u.state = CRYSTALLIZING;
    u.crystallizeTimer = 0;
    if (u.held) { u.held = false; this.held[u.team] = -1; }
    this.events.push({ type: 'crystallizing', unit: u.id, cause: cause, tick: this.tick });
  };

  Sim.prototype._damage = function (u, amount, cause) {
    if (u.state !== ALIVE) return;
    u.energy -= amount;
    u.beingShotTimer = 1.0;
    if (u.energy <= 0) { u.energy = 0; this._kill(u, cause); }
  };

  // Where a gun sits in the world (turrets are offset on the hull).
  Sim.prototype.gunPos = function (u, g) {
    if (g === u || (!g.ox && !g.oy)) return { x: u.x, y: u.y };
    const r = this.T.unitRadius * CLASSES[u.cls].size, c = Math.cos(u.heading), s = Math.sin(u.heading);
    return { x: u.x + (g.ox * c - g.oy * s) * r, y: u.y + (g.ox * s + g.oy * c) * r };
  };

  // Is v inside gun g's firing cone (range + angle from the barrel)?
  Sim.prototype._inCone = function (u, v, g) {
    g = g || u;
    const p = this.gunPos(u, g), cls = CLASSES[u.cls];
    const dx = v.x - p.x, dy = v.y - p.y;
    if (dx * dx + dy * dy > cls.coneRange * cls.coneRange) return false;
    return Math.abs(wrapAngle(Math.atan2(dy, dx) - g.gunAngle)) <= cls.coneHalf;
  };

  // Acquisition zone. A fixed gun can only acquire what is in its forward cone.
  // A turret acquires anything in range within the sector it can swing through
  // (plus its cone), then slews onto it.
  Sim.prototype._canAcquire = function (u, v, g) {
    g = g || u;
    if (g === u) return this._inCone(u, v, g);
    const p = this.gunPos(u, g), cls = CLASSES[u.cls];
    const dx = v.x - p.x, dy = v.y - p.y;
    if (dx * dx + dy * dy > cls.coneRange * cls.coneRange) return false;
    return Math.abs(wrapAngle(Math.atan2(dy, dx) - (u.heading + g.mount))) <= g.traverse + cls.coneHalf;
  };

  Sim.prototype._fireProjectile = function (u, angle, g, from) {
    const cls = CLASSES[u.cls];
    if (!this._free.length && !this._growPool(this.projectiles.length)) { this.poolStats.dropped++; return; }
    const p = this.projectiles[this._free.pop()];
    from = from || this.gunPos(u, g || u);
    p.active = true;
    p.x = from.x; p.y = from.y;
    p.vx = Math.cos(angle) * cls.projSpeed; p.vy = Math.sin(angle) * cls.projSpeed;
    p.owner = u.id; p.team = u.team;
    p.damage = cls.damage; p.aoe = cls.aoe;
    p.ttl = cls.projTtl || this.T.projTtlSec;
    p.vsCap = cls.vsCapital || 1;
    p.kind = 0; p.target = -1; p.turn = 0; p.ff = false;
    this.poolStats.fired++;
  };

  // ---- Lock mini-game: hold to start the icon bouncing in the cone, let go to launch. ----
  // The target is the enemy closest to the cone's centre line (ties: the nearer one).
  // Grade = where it sits in the cone: 3 green centre, 2 yellow, 1 red edge, 0 none.
  Sim.prototype._mlTarget = function (u) {
    const cls = CLASSES[u.cls];
    let best = -1, bestOff = Infinity, bestD = Infinity;
    // Near-equal angles (within 0.03 rad) count as a tie: the nearer ship wins, then the lower id.
    const consider = v => {
      if (v.state !== ALIVE || v.team === u.team) return;
      const dx = v.x - u.x, dy = v.y - u.y, d = Math.hypot(dx, dy);
      if (d > cls.coneRange) return;
      const off = Math.abs(wrapAngle(Math.atan2(dy, dx) - u.heading));
      if (off > cls.coneHalf) return;
      const tie = Math.abs(off - bestOff) <= 0.03;
      if ((!tie && off < bestOff) || (tie && (d < bestD || (d === bestD && v.id < best)))) { best = v.id; bestOff = off; bestD = d; }
    };
    if (this._gridLive || this.tick > 0) this.grid.query(u.x, u.y, cls.coneRange + 300, id => consider(this.units[id])); // +300: ships move during the tick
    else for (const v of this.units) consider(v);
    const h = cls.coneHalf;
    return { target: best, grade: best < 0 ? 0 : bestOff < h / 3 ? 3 : bestOff < 2 * h / 3 ? 2 : 1 };
  };
  Sim.prototype._mlStart = function (u) {
    const t = this._mlTarget(u);
    u.ml = { lx: 0, ly: 0, dir: (u.rng() * 2 - 1) * CLASSES[u.cls].coneHalf * 0.85, grade: t.grade, target: t.target };
  };
  Sim.prototype._mlMove = function (u, dt) {
    const cls = CLASSES[u.cls], m = u.ml, t = this._mlTarget(u);
    m.grade = t.grade; m.target = t.target;
    const sp = this.T.lockIconSpeed * GRADE_SPEED[m.grade];
    let vx = Math.cos(m.dir) * sp, vy = Math.sin(m.dir) * sp;
    m.lx += vx * dt; m.ly += vy * dt;
    const R = cls.coneRange, H = cls.coneHalf, r = Math.hypot(m.lx, m.ly);
    if (r > R) { // bounce off the far arc
      const nx = m.lx / r, ny = m.ly / r, k = vx * nx + vy * ny;
      vx -= 2 * k * nx; vy -= 2 * k * ny; m.lx = nx * R * 0.999; m.ly = ny * R * 0.999;
    }
    const a = Math.atan2(m.ly, m.lx);
    if (r > 1 && Math.abs(a) > H) { // bounce off a cone edge
      const e = a > 0 ? H : -H, ex = Math.cos(e), ey = Math.sin(e), k = vx * ex + vy * ey, rr = Math.hypot(m.lx, m.ly);
      vx = 2 * k * ex - vx; vy = 2 * k * ey - vy;
      m.lx = Math.cos(e * 0.995) * rr; m.ly = Math.sin(e * 0.995) * rr;
    }
    m.dir = Math.atan2(vy, vx);
  };
  Sim.prototype._mlRelease = function (u) {
    const m = u.ml, kind = CLASSES[u.cls].launcher, o = ordnance(this.T, kind);
    u.ml = null;
    const c = Math.cos(u.heading), sn = Math.sin(u.heading);
    const ix = u.x + m.lx * c - m.ly * sn, iy = u.y + m.lx * sn + m.ly * c;
    let lock = 0;
    const t = m.target >= 0 ? this.units[m.target] : null;
    if (t && t.state === ALIVE) lock = Math.max(0, 1 - Math.hypot(t.x - ix, t.y - iy) / this.T.lockCatch) * GRADE_LOCK[m.grade];
    // Fly toward the icon (a perfectly caught lock flies at the target itself).
    const ax = lock > 0 ? t.x : ix, ay = lock > 0 ? t.y : iy;
    const angle = (Math.abs(ax - u.x) + Math.abs(ay - u.y) < 1) ? u.heading : Math.atan2(ay - u.y, ax - u.x);
    if (!this._free.length && !this._growPool(this.projectiles.length)) { this.poolStats.dropped++; return; }
    const p = this.projectiles[this._free.pop()], ur = this.T.unitRadius * CLASSES[u.cls].size;
    p.active = true; p.x = u.x + Math.cos(angle) * ur; p.y = u.y + Math.sin(angle) * ur;
    p.vx = Math.cos(angle) * o.speed; p.vy = Math.sin(angle) * o.speed; p.speed = o.speed;
    p.owner = u.id; p.team = u.team; p.damage = o.damage; p.aoe = o.aoe; p.ttl = o.ttl; p.vsCap = o.vsCapital;
    p.kind = ORD_KIND[kind]; p.ff = true;
    p.target = kind === 'missile' && lock > 0 ? t.id : -1;
    p.turn = kind === 'missile' ? o.turn * lock : kind === 'torpedo' ? o.turn : 0;
    p.arm = kind === 'torpedo' ? o.armDist : 0; p.search = kind === 'torpedo' ? o.search : 0;
    u.launchCd = o.reload; u.energy -= o.cost;
    this.poolStats.fired++;
    this.events.push({ type: 'launch', unit: u.id, kind: kind, lock: Math.round(lock * 100) / 100, grade: m.grade, target: p.target, tick: this.tick });
  };
  // Every launcher ship, in id order: reload, move held icons, and let the AI play.
  Sim.prototype._launchers = function (dt) {
    for (const u of this.units) {
      const cls = CLASSES[u.cls];
      if (!cls.launcher) continue;
      if (u.state !== ALIVE) { u.ml = null; continue; }
      if (this.song && u.activeLeft <= 0) continue; // beat mode: only inside its slice
      if (u.launchCd > 0) u.launchCd -= dt;
      if (!this.human[u.team] && !u.ml && u.launchCd <= 0 && u.energy > cls.energyMax * 0.25 && this._mlTarget(u).target >= 0) {
        this._mlStart(u); // AI: hold for a random moment, then let go
        u.aiRelease = this.tick + Math.round((0.35 + u.rng() * 1.3) * this.T.tickRate);
      }
      if (u.ml) {
        this._mlMove(u, dt);
        if (!this.human[u.team] && this.tick >= u.aiRelease) this._mlRelease(u);
      }
    }
  };

  // Guided flight: missiles chase their lock (leading it), torpedoes run dumb
  // until armed, then search ahead for the best target (capitals first).
  Sim.prototype._guide = function (p, dt) {
    if (p.kind === 3 && p.target < 0) {
      p.arm -= p.speed * dt;
      if (p.arm <= 0) {
        const head = Math.atan2(p.vy, p.vx);
        let best = -1, bestS = Infinity;
        this.gridNow.query(p.x, p.y, p.search, id => {
          const v = this.units[id];
          if (v.state !== ALIVE || v.team === p.team) return;
          const d = Math.hypot(v.x - p.x, v.y - p.y);
          if (d > p.search || Math.abs(wrapAngle(Math.atan2(v.y - p.y, v.x - p.x) - head)) > 1.0) return;
          const sc = d * (isCapitalHull(v.cls) ? 0.5 : 1);
          if (sc < bestS || (sc === bestS && id < best)) { bestS = sc; best = id; }
        });
        p.target = best;
      }
    }
    if (p.target < 0 || p.turn <= 0) return;
    const t = this.units[p.target];
    if (!t || t.state !== ALIVE) { p.target = -1; return; }
    const d = Math.hypot(t.x - p.x, t.y - p.y), lead = d / p.speed; // aim where it will be
    const want = Math.atan2(t.y + t.vy * lead - p.y, t.x + t.vx * lead - p.x), cur = Math.atan2(p.vy, p.vx);
    const turn = Math.max(-p.turn * dt, Math.min(p.turn * dt, wrapAngle(want - cur)));
    p.vx = Math.cos(cur + turn) * p.speed; p.vy = Math.sin(cur + turn) * p.speed;
  };

  Sim.prototype._weakFlag = function (u, type) {
    for (const w of u.weak) if (w.out && w.type === type) return true;
    return false;
  };

  // Which intact weak point (if any) a blast at (bx, by) lands on.
  Sim.prototype._weakHit = function (u, bx, by) {
    if (!u.weak.length) return null;
    const ur = this.T.unitRadius * CLASSES[u.cls].size;
    const c = Math.cos(-u.heading), s = Math.sin(-u.heading);
    const dx = bx - u.x, dy = by - u.y;
    const lx = (dx * c - dy * s) / ur, ly = (dx * s + dy * c) / ur; // hull-local, radius units
    let best = null, bestD = Infinity;
    for (const w of u.weak) {
      if (w.out) continue;
      const d = Math.hypot(lx - w.x, ly - w.y);
      if (d < w.r + 6 / ur && d < bestD) { bestD = d; best = w; }
    }
    return best;
  };

  Sim.prototype._detonate = function (p) {
    if (p.active && p.i !== undefined) this._free.push(p.i);
    p.active = false;
    this.events.push({ type: 'detonation', x: p.x, y: p.y, aoe: p.aoe, big: p.damage >= 25 || p.vsCap > 1, tick: this.tick });
    const hits = [];
    if (this._gridLive) this.gridNow.query(p.x, p.y, p.aoe + this.maxHullR, id => hits.push(id));
    else for (const u of this.units) hits.push(u.id); // called outside a tick (tests/tools): no grid yet
    hits.sort((a, b) => a - b); // fixed order regardless of grid bucket layout
    for (const id of hits) {
      const u = this.units[id];
      if (u.state !== ALIVE) continue;
      if (u.team === p.team && !this.T.friendlyFire && !p.ff) continue; // FF toggle (ordnance always can)
      if (p.ff && u.id === p.owner) continue;
      const ur = this.T.unitRadius * CLASSES[u.cls].size;
      const d = Math.hypot(u.x - p.x, u.y - p.y);
      if (d < p.aoe + ur) {
        const falloff = 1 - Math.max(0, d - ur) / p.aoe;
        let dmg = p.damage * falloff;
        if (isCapitalHull(u.cls) && p.vsCap) dmg *= p.vsCap; // anti-capital ordnance
        const w = this._weakHit(u, p.x, p.y);
        if (w) {
          dmg *= this.T.weakCritMult;
          w.hp -= dmg;
          this.events.push({ type: 'weakHit', unit: u.id, weak: w.type, tick: this.tick });
          if (w.hp <= 0) {
            w.hp = 0; w.out = true;
            this.events.push({ type: 'weakDown', unit: u.id, weak: w.type, x: p.x, y: p.y, tick: this.tick });
          }
        }
        this._damage(u, dmg, 'shot');
      }
    }
  };

  // One gun's turn: track cone entries, keep/acquire the first entrant, aim
  // (leading the target as the lock improves), traverse, and fire.
  Sim.prototype._gunnery = function (u, g, gi, cls, dt, bridgeOut) {
    const T = this.T, isTurret = g !== u;
    // Track cone entry ticks for first-to-enter priority (other ships read from
    // the frozen frame; candidates come from the spatial grid).
    const F = this.frame, pos0 = this.gunPos(u, g);
    for (const k in g.entered) {
      const v = F[k];
      if (!v || !v.alive || !this._canAcquire(u, v, g)) delete g.entered[k];
    }
    this.grid.query(pos0.x, pos0.y, cls.coneRange, id => {
      const v = F[id];
      if (!v.alive || v.team === u.team || g.entered[id] !== undefined) return;
      if (this._canAcquire(u, v, g)) g.entered[id] = this.tick;
    });
    // Validate / acquire target. First to enter the cone wins and keeps priority.
    let target = g.targetId >= 0 ? F[g.targetId] : null;
    if (target && !target.alive) { target = null; g.targetId = -1; g.lockQ = 0; }
    if (target) {
      if (this._canAcquire(u, target, g)) g.outOfConeTime = 0;
      else {
        g.outOfConeTime += dt;
        if (g.outOfConeTime > T.coneGraceSec) { target = null; g.targetId = -1; g.lockQ = 0; g.outOfConeTime = 0; }
      }
    }
    const pos = this.gunPos(u, g);
    if (!target) {
      let bestTick = Infinity, best = -1;
      for (const id in g.entered) {
        const et = g.entered[id];
        if (et < bestTick || (et === bestTick && +id < best)) { bestTick = et; best = +id; }
      }
      if (best >= 0) {
        target = F[best];
        g.targetId = best; g.outOfConeTime = 0;
        // Freeze entry quality: how far off the arc centre (or turret barrel) it came in.
        const off = Math.abs(wrapAngle(Math.atan2(target.y - pos.y, target.x - pos.x) - g.gunAngle));
        const worst = isTurret ? T.turretEntryArc : cls.coneHalf;
        g.entryQ = 1 - Math.min(1, off / worst);
        g.lockCap = T.lockEntryFloor + (1 - T.lockEntryFloor) * g.entryQ;
        g.lockQ = g.lockCap * T.lockStartFrac;
        const retarget = u.retargetTick !== undefined && this.tick - u.retargetTick < T.tickRate * 3;
        if (retarget) u.retargetTick = undefined;
        this.events.push({ type: 'locked', unit: u.id, gun: gi, target: best, entryQ: g.entryQ, retarget: retarget, tick: this.tick });
      }
    }
    if (bridgeOut) g.lockCap = Math.min(g.lockCap, T.bridgeLockCap);

    // Where to aim: straight at the target at zero lock, fully led at full lock.
    let aimAngle = isTurret ? u.heading + g.mount : u.heading;
    if (target) {
      const dist = Math.hypot(target.x - pos.x, target.y - pos.y);
      const lead = (dist / cls.projSpeed) * g.lockQ * T.leadMax;
      aimAngle = Math.atan2(target.y + target.vy * lead - pos.y, target.x + target.vx * lead - pos.x);
    }
    // Turrets slew toward the aim point, never leaving their sector; a damaged
    // bridge slows them. Fixed guns always point where the hull points.
    if (isTurret) {
      const centre = u.heading + g.mount;
      const want = centre + Math.max(-g.traverse, Math.min(g.traverse, wrapAngle(aimAngle - centre)));
      g.gunAngle = turnToward(g.gunAngle, want, cls.gunTurn * (bridgeOut ? T.bridgeTurn : 1) * dt);
      const rel = wrapAngle(g.gunAngle - centre); // hull turning can't drag it out of its sector
      if (Math.abs(rel) > g.traverse) g.gunAngle = centre + Math.sign(rel) * g.traverse;
    } else {
      g.gunAngle = u.heading;
    }

    if (target && this._inCone(u, target, g)) {
      // Lock climbs toward the ceiling its entry earned — never past it.
      g.lockQ = Math.min(g.lockCap, g.lockQ + g.lockCap * (1 - T.lockStartFrac) * dt / T.lockTimeFull);
      // Cooldown only ticks with a valid target in the cone; a better lock reloads faster.
      g.cooldown -= dt * (1 + T.fireRateBonus * g.lockQ);
      if (g.cooldown <= 0 && !cls.manualOnly && u.energy > cls.energyMax * T.autoFireFloor + cls.shotCost) {
        const spread = T.lockSpreadMax * (1 - g.lockQ);
        // Fixed guns can only nudge the shot within their arc; turrets fire down the barrel.
        const base = isTurret ? g.gunAngle
          : g.gunAngle + Math.max(-cls.coneHalf, Math.min(cls.coneHalf, wrapAngle(aimAngle - g.gunAngle)));
        const angle = base + (u.rng() * 2 - 1) * spread;
        this._fires.push({ u: u, g: g, gi: gi, angle: angle, spread: spread, x: pos.x, y: pos.y }); // spawned in RESOLVE
        u.energy -= cls.shotCost; // shooting spends the pool that is also your health
        g.cooldown = cls.cooldown; // 'fired' event is emitted in RESOLVE with the shot
      }
    }
  };

  // Grayzer battery: recharges itself slowly and pours energy into friendly
  // ships in range that are below full.
  Sim.prototype._battery = function (u, cls, dt) {
    const b = cls.battery, k = this.T.batteryScale;
    u.battery = Math.min(b.max * k, u.battery + b.recharge * k * dt);
    const F = this.frame, near = [];
    this.grid.query(u.x, u.y, b.range, id => near.push(id));
    near.sort((a, c) => a - c);
    for (const id of near) {
      if (u.battery <= 0) break;
      const v = F[id];
      if (id === u.id || v.team !== u.team || !v.alive) continue;
      const vmax = CLASSES[v.cls].energyMax;
      if (v.energy >= vmax) continue;
      if (Math.hypot(v.x - u.x, v.y - u.y) > b.range) continue;
      const give = Math.min(b.rate * k * dt, vmax - v.energy, u.battery);
      u.battery -= give;
      this._charges.push({ to: id, from: u.id, amount: give }); // applied in RESOLVE
    }
  };

  // The nearest enemy for an AI ship to go after (from the frozen frame).
  // Anti-capital ships treat capitals and carriers as much closer than they are.
  Sim.prototype._aiTarget = function (u, cls) {
    const F = this.frame, huntCapitals = !!cls.vsCapital;
    let best = null, bestD = Infinity;
    const consider = id => {
      const v = F[id];
      if (!v.alive || v.team === u.team) return;
      const d = Math.hypot(v.x - u.x, v.y - u.y) * (huntCapitals && v.capital ? 0.25 : 1);
      if (d < bestD || (d === bestD && id < best.id)) { bestD = d; best = v; }
    };
    for (const r of [600, 1600]) { this.grid.query(u.x, u.y, r, consider); if (best && bestD <= r) return best; }
    for (let id = 0; id < F.length; id++) consider(id); // far away: fall back to everyone
    return best;
  };

  // THINK for one ship: steering, movement and gun decisions. Reads other ships
  // only through this.frame (the world at the start of the tick); writes only to
  // itself; anything aimed at another ship is pushed as an intent.
  Sim.prototype._think = function (u) {
    const T = this.T, dt = this.dt;
    if (u.state === CRYSTALLIZED) return;
    if (u.state === CRYSTALLIZING) {
      u.crystallizeTimer += dt;
      if (u.crystallizeTimer >= T.crystallizeSec) {
        u.state = CRYSTALLIZED;
        this._deaths.push(u); // its crystal / salvage wreck is placed in RESOLVE
        this.events.push({ type: 'crystallized', unit: u.id, tick: this.tick });
      }
      return;
    }

    const cls = CLASSES[u.cls];
    // Beat mode: a ship only lives through the time its lane gives it. Between
    // notes it is frozen in place — no movement, no reloading, no firing — but it
    // can still be hit. Its cooldowns run on ship-time, not on the music.
    if (this.song) {
      if (u.activeLeft <= 0) { u.vx = 0; u.vy = 0; return; }
      u.activeLeft -= dt;
      u.shipTime += dt;
    }
    if (u.beingShotTimer > 0) u.beingShotTimer -= dt;
    if (u.lockoutTimer > 0) u.lockoutTimer -= dt;

    // Knocked-out weak points keep costing the capital.
    let cripple = 1;
    if (u.weak.length) {
      let vents = 0;
      for (const w of u.weak) if (w.out && w.type === 'vent') vents++;
      if (vents) { this._damage(u, vents * T.ventLeak * dt, 'breach'); if (u.state !== ALIVE) return; }
      if (this._weakFlag(u, 'engine')) cripple = T.engineCripple;
    }
    if (cls.battery) this._battery(u, cls, dt);

    // --- Steering. Every source of turning is capped by the hull's turn rate:
    // current speed / turnRadius. No ship ever snaps to a new heading. ---
    const juggles = this.human[u.team] && !cls.noStall; // carriers cruise steadily, never stall
    const curSpeed = (juggles ? T.minSpeed + u.momentum * (cls.speed - T.minSpeed) : cls.speed) * cripple;
    const maxTurn = curSpeed / (cls.turnRadius * T.turnRadiusScale) * (u.tier === 1 ? 2 : 1); // rad/s (Reduced tier steps half as often)
    const heading0 = u.heading;
    if (u.dodgeTimer > 0) {
      // Barrel roll: dead straight, no steering of any kind.
      u.dodgeTimer -= dt;
      if (u.dodgeTimer <= 0) u.lockoutTimer = T.dodgeLockoutSec;
    } else if (u.held) {
      if (u.lockoutTimer <= 0) u.heading = turnToward(u.heading, this.aim[u.team], maxTurn * dt);
    } else if (this.human[u.team]) {
      // Unpossessed ship on a human-flown side: the juggle clock runs.
      if (juggles) u.momentum = Math.max(0, u.momentum - T.momentumDrain * dt);
      if (u.goal !== null && u.lockoutTimer <= 0) {
        u.heading = turnToward(u.heading, u.goal, maxTurn * dt);
        if (Math.abs(wrapAngle(u.goal - u.heading)) < 1e-3) u.goal = null;
      }
      if (juggles) u.heading += (u.rng() * 2 - 1) * T.driftNoise * (1 - u.momentum) * dt;
    } else {
      // Opposition AI: same class table, seeks nearest player ship to gun range.
      // It only re-aims a ship when it spends an action on it (APM-matched,
      // see the budget above); in between the ship turns toward its last goal
      // and flies on, just like a released player ship.
      const decide = this.aiPick[u.team] === u.id;
      if (u.goal !== null) u.heading = turnToward(u.heading, u.goal, maxTurn * dt);
      if (decide && cls.noGuns) {
        // AI carrier: hold station behind its own line, circling.
        const homeX = (u.team === PLAYER ? -1 : 1) * (T.spawnDist + 260);
        const dx = homeX - u.x, dy = -u.y;
        u.goal = Math.hypot(dx, dy) > 90 ? Math.atan2(dy, dx) : u.heading + Math.PI / 2;
      } else if (u.tier < 2 && decide) {
        let tgt = null, tgtD = Infinity;
        const huntCapitals = !!cls.vsCapital;
        for (const v of this.units) {
          if (v.team === u.team || v.state !== ALIVE) return;
          // Anti-capital ships treat capitals and carriers as much closer than they are.
          const d = Math.hypot(v.x - u.x, v.y - u.y) * (huntCapitals && isCapitalHull(v.cls) ? 0.25 : 1);
          if (d < tgtD) { tgtD = d; tgt = v; }
        }
        if (tgt) tgtD = Math.hypot(tgt.x - u.x, tgt.y - u.y);
        if (tgt) {
          const toTgt = Math.atan2(tgt.y - u.y, tgt.x - u.x);
          let want;
          if (cls.turret) {
            // Turret ship: close to range, then turn broadside so a side turret bears.
            want = tgtD > cls.coneRange * 0.7 ? toTgt : toTgt + Math.PI / 2;
          } else {
            // Fixed guns: strafing runs. Nose on target; peel off when too
            // close, swing back around for the next pass.
            want = tgtD > cls.coneRange * 0.35 ? toTgt : toTgt + Math.PI * 0.6;
          }
          u.goal = want;
        }
      }
    }

    // Crystal evasion for everything unheld and not mid-roll. Only crystals
    // ahead matter, and a ship that turns wide has to start turning early:
    // look-ahead = avoidRange + its turn radius. It veers to whichever side
    // the crystal isn't on, using its own hull turn rate.
    if (!u.held && u.dodgeTimer <= 0 && T.avoidSteer > 0) {
      const look = T.avoidRange + cls.turnRadius * T.turnRadiusScale;
      let nearest = null, nearestGap = Infinity, nearestRel = 0;
      for (const h of this.hazards) {
        const dx = h.x - u.x, dy = h.y - u.y;
        const rel = wrapAngle(Math.atan2(dy, dx) - u.heading);
        if (Math.abs(rel) > Math.PI / 2) return; // behind us
        const gap = Math.hypot(dx, dy) - h.r - T.unitRadius * cls.size;
        if (gap < look && gap < nearestGap) { nearestGap = gap; nearest = h; nearestRel = rel; }
      }
      if (nearest) {
        const away = u.heading - (nearestRel >= 0 ? 1 : -1) * Math.PI / 2;
        const urgency = Math.min(1, 1.5 * (1 - Math.max(0, nearestGap) / look));
        const str = juggles ? u.momentum : 1;
        // Close call: evasion overrides whatever the pilot/AI was turning toward.
        const from = urgency > 0.6 ? heading0 : u.heading;
        u.heading = turnToward(from, away, maxTurn * T.avoidSteer * str * urgency * dt);
      }
    }

    // Hull limit: whatever asked for the turn (pilot, AI, evasion, drift), the
    // ship can't swing faster than its turn radius allows.
    if (u.dodgeTimer <= 0) {
      const d = wrapAngle(u.heading - heading0), lim = maxTurn * dt;
      if (Math.abs(d) > lim) u.heading = heading0 + Math.sign(d) * lim;
    }

    // Ships never stall: an ignored ship just slows to minSpeed and drifts.

    // --- Movement ---
    let speed = juggles ? T.minSpeed + u.momentum * (cls.speed - T.minSpeed) : cls.speed;
    if (u.dodgeTimer > 0) speed = cls.speed * T.dodgeSpeedMult;
    speed *= cripple;
    u.vx = Math.cos(u.heading) * speed; u.vy = Math.sin(u.heading) * speed;
    u.x += u.vx * dt;
    u.y += u.vy * dt;

    const distFromCenter = Math.hypot(u.x, u.y);
    if (distFromCenter > T.arenaRadius && u.dodgeTimer <= 0) {
      u.heading = turnToward(u.heading, Math.atan2(-u.y, -u.x), Math.min(T.edgeSteer, maxTurn) * dt);
    }

    for (const h of this.hazards) {
      if (Math.hypot(u.x - h.x, u.y - h.y) < h.r + T.unitRadius * cls.size) { this._kill(u, 'contact'); break; }
    }
    if (u.state !== ALIVE) return;

    if (u.guns[0] === u) u.gunAngle = u.heading; // fixed guns ride the hull

    // --- Gunnery. Reduced tier: every 2nd tick. Dormant: no acquisition at all. ---
    if (u.tier === 2 || (u.tier === 1 && (this.tick & 1) === 1)) return;
    const bridgeOut = cls.turret && this._weakFlag(u, 'bridge');
    for (let gi = 0; gi < u.guns.length; gi++) this._gunnery(u, u.guns[gi], gi, cls, dt, bridgeOut);
  };

  Sim.prototype.step = function () {
    const T = this.T, dt = this.dt;
    this.events.length = 0;
    this._applyCommands();

    // --- Beat mode: when the song reaches a new step, every lane that plays on
    // it hands its ships a time slice. Shared song + tick = same on every machine.
    if (this.song) {
      const sg = this.song, step = Math.floor(this.tick * dt / sg.stepSec);
      if (step !== this.beatStep) {
        this.beatStep = step;
        const at = step % sg.steps;
        for (const lane of LANES) {
          const hit = sg.hits[lane][at];
          if (!hit) continue;
          this.events.push({ type: 'note', lane: lane, step: at, v: hit.v, p: hit.p, tick: this.tick });
          for (const u of this.units) {
            if (u.state === ALIVE && u.lane === lane) u.activeLeft = Math.max(u.activeLeft, T.beatSliceSec * hit.v);
          }
        }
      }
    }

    // --- AI action budget: each AI side earns re-aims at its matched APM and
    // spends one per action on the ship it re-aimed longest ago. ---
    for (let t = 0; t < 2; t++) {
      this.aiPick[t] = -1;
      if (this.human[t]) { this.aiBudget[t] = 0; continue; }
      this.aiBudget[t] = Math.min(2, this.aiBudget[t] + this.aiApm(t) / 60 * dt);
      if (this.aiBudget[t] < 1) continue;
      let pick = null;
      for (const u of this.units) {
        if (u.team !== t || u.state !== ALIVE) continue;
        if (this.song && u.activeLeft <= 0) continue; // beat mode: only a ship that's in its slice can act
        if (!pick || u.decTick < pick.decTick) pick = u;
      }
      if (pick) { this.aiPick[t] = pick.id; pick.decTick = this.tick; this.aiBudget[t] -= 1; }
    }

    // --- Frozen frame + spatial grid: what every ship sees this tick. ---
    const F = this.frame;
    F.length = this.units.length;
    this.grid.clear();
    let maxHull = 0;
    for (const u of this.units) {
      const c = CLASSES[u.cls];
      F[u.id] = { id: u.id, x: u.x, y: u.y, vx: u.vx, vy: u.vy, team: u.team, cls: u.cls,
                  alive: u.state === ALIVE, energy: u.energy, capital: isCapitalHull(u.cls) };
      if (u.state === ALIVE) this.grid.insert(u.id, u.x, u.y);
      maxHull = Math.max(maxHull, T.unitRadius * c.size);
    }
    this.maxHullR = maxHull;

    // --- Update gating: tier by distance to the nearest living foe. ---
    for (const u of this.units) {
      if (u.state !== ALIVE) continue;
      let near = Infinity;
      const scan = id => { const v = F[id]; if (v.alive && v.team !== u.team) near = Math.min(near, Math.hypot(v.x - u.x, v.y - u.y)); };
      this.grid.query(u.x, u.y, T.gateReducedDist, scan);
      if (near > T.gateReducedDist) this.grid.query(u.x, u.y, T.gateDormantDist, scan);
      u.tier = near > T.gateDormantDist ? 2 : (near > T.gateReducedDist ? 1 : 0);
      if (u.held) u.tier = 0; // the possessed ship is always full-rate
    }

    // --- THINK (order-independent: see _think) ---
    this._fires = []; this._charges = []; this._deaths = [];
    const n = this.units.length;
    for (let i = 0; i < n; i++) this._think(this.units[this._reverseThink ? n - 1 - i : i]);

    // --- RESOLVE: apply intents in ship-id order. ---
    this._fires.sort((a, b) => a.u.id - b.u.id || a.gi - b.gi);
    for (const f of this._fires) {
      this._fireProjectile(f.u, f.angle, f.g, f);
      this.events.push({ type: 'fired', unit: f.u.id, gun: f.gi, target: f.g.targetId, spread: f.spread, lockQ: f.g.lockQ, tick: this.tick });
    }
    this._launchers(dt);
    this._charges.sort((a, b) => a.to - b.to || a.from - b.from);
    for (const c of this._charges) {
      const v = this.units[c.to];
      if (v.state !== ALIVE) continue;
      v.energy = Math.min(CLASSES[v.cls].energyMax, v.energy + c.amount);
      v.charging = this.tick;
    }
    this._deaths.sort((a, b) => a.id - b.id);
    for (const u of this._deaths) {
      if (T.wreckCrystals) this.hazards.push({ x: u.x, y: u.y, r: T.unitRadius * 1.6, salvage: true });
      // Destroy the Carrier: the wreck is worth salvaging.
      const c = CLASSES[u.cls];
      if (this.mode === 'carrier' && !c.noGuns) {
        const value = Math.round((c.cost || 400) * T.salvageFrac);
        if (value > 0) this.wrecks.push({ x: u.x, y: u.y, value: value, ttl: T.wreckSec });
      }
    }

    // --- Projectiles: move, contact-detonate on foes and crystals, flak at end of life. ---
    this.gridNow.clear();
    for (const u of this.units) if (u.state === ALIVE) this.gridNow.insert(u.id, u.x, u.y);
    this._gridLive = true;
    for (const p of this.projectiles) {
      if (!p.active) continue;
      if (p.kind) this._guide(p, dt);
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.ttl -= dt;
      let boom = p.ttl <= 0;
      if (!boom) {
        this.gridNow.query(p.x, p.y, this.maxHullR + 4, id => {
          if (boom) return;
          const u = this.units[id];
          if (u.state !== ALIVE || u.id === p.owner) return;
          if (u.team === p.team && !this.T.friendlyFire && !p.ff) return; // missiles/rockets/torpedoes hit allies too
          if (Math.hypot(u.x - p.x, u.y - p.y) < this.T.unitRadius * CLASSES[u.cls].size + 4) boom = true;
        });
      }
      if (!boom) {
        for (const h of this.hazards) {
          if (Math.hypot(h.x - p.x, h.y - p.y) < h.r) { boom = true; break; } // crystals are cover
        }
      }
      if (boom) this._detonate(p);
    }

    this._gridLive = false;
    if (this.mode === 'carrier') this._economy(dt);
    if (this.stressCount && this.tick % 15 === 0) this._reinforce();

    this.tick++;
  };

  // Stress test: destroyed ships come back as reinforcements at their side's
  // rear (same slot, same id), so the load holds steady. Deterministic: in id
  // order, positions from the sim's seeded RNG.
  Sim.prototype._reinforce = function () {
    const T = this.T, per = [0, 0], cols = Math.max(4, Math.ceil(Math.sqrt(this.stressCount) / 1.5));
    const depth = Math.ceil(this.stressCount / cols) * 34, cap = Math.max(12, Math.ceil(this.stressCount / 6));
    for (let id = 0; id < this.units.length; id++) {
      const old = this.units[id];
      if (old.state !== CRYSTALLIZED || per[old.team] >= cap) continue;
      per[old.team]++;
      const side = old.team === PLAYER ? -1 : 1;
      const x = side * (T.spawnDist + cols * 34 + 40 + this.rng() * 120), y = (this.rng() - 0.5) * depth;
      const fresh = this._spawn(old.cls, old.team, x, y, old.team === PLAYER ? 0 : Math.PI);
      this.units.pop();
      fresh.id = id; fresh.decTick = -1 - id;
      fresh.rng = mulberry32((this.seed ^ Math.imul(id + 1, 0x9E3779B1) ^ Math.imul(this.tick + 1, 0x85EBCA6B)) >>> 0);
      this.units[id] = fresh;
      for (const u of this.units) for (const g of u.guns) if (g.targetId === id) { g.targetId = -1; g.lockQ = 0; g.lockCap = 0; }
      for (let t = 0; t < 2; t++) if (this.held[t] === id) this.held[t] = -1;
    }
  };

  Sim.prototype.aliveCount = function (team) {
    let n = 0;
    for (const u of this.units) if (u.state === ALIVE && (team === undefined || u.team === team)) n++;
    return n;
  };

  Sim.prototype.teamEnergy = function (team) {
    let e = 0;
    for (const u of this.units) if (u.state === ALIVE && u.team === team) e += u.energy;
    return e;
  };

  // --- Network snapshot (LAN multiplayer). The server owns the one true sim and
  // ships this to clients ~30x/s; clients copy it into a local Sim that they only
  // render (never step), so different browsers' float maths can't drift apart.
  const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;
  const STATE_CODE = { alive: 0, crystallizing: 1, crystallized: 2 };
  const CODE_STATE = ['alive', 'crystallizing', 'crystallized'];
  const gunSnap = g => [r3(g.gunAngle), g.targetId, r3(g.lockQ), r3(g.lockCap), r3(g.entryQ)];
  function gunApply(g, a) { g.gunAngle = a[0]; g.targetId = a[1]; g.lockQ = a[2]; g.lockCap = a[3]; g.entryQ = a[4]; }
  // viewer (optional): { team, radius } — interest management. Only that side's
  // ships and other ships within `radius` of one of them are sent (with `ids`),
  // the visibility-worker job in a sharded build. Omit it for the full state.
  Sim.prototype.snapshot = function (events, viewer) {
    let list = this.units;
    if (viewer) {
      const mine = this.units.filter(u => u.team === viewer.team && u.state === ALIVE), r2v = viewer.radius * viewer.radius;
      list = this.units.filter(u => u.team === viewer.team ||
        mine.some(m => (m.x - u.x) * (m.x - u.x) + (m.y - u.y) * (m.y - u.y) <= r2v));
    }
    const units = list.map(u => [
      r2(u.x), r2(u.y), r3(u.heading), r3(u.gunAngle), r3(u.momentum), r2(u.energy),
      STATE_CODE[u.state], u.held ? 1 : 0, u.targetId, r3(u.lockQ), r3(u.lockCap), r3(u.entryQ),
      r3(u.crystallizeTimer), u.weak.map(w => w.out ? -1 : r2(w.hp)),
      u.goal === null ? null : r3(u.goal),
      CLASS_LIST.indexOf(u.cls), u.team,
      u.guns[0] === u ? 0 : u.guns.map(gunSnap),
      r2(u.battery), u.charging === this.tick - 1 || u.charging === this.tick ? 1 : 0,
      LANES.indexOf(u.lane), r3(u.activeLeft),
      u.ml ? [r2(u.ml.lx), r2(u.ml.ly), u.ml.grade, u.ml.target] : 0, r2(u.launchCd),
    ]);
    const proj = [];
    // [.., kind, team, dormant]: dormant = a torpedo still running dumb (enemies can't see it yet)
    for (const p of this.projectiles) if (p.active) proj.push([r2(p.x), r2(p.y), r2(p.vx), r2(p.vy), p.vsCap > 1 ? 1 : 0, p.kind, p.team,
      p.kind === 3 && p.arm > 0 && p.target < 0 ? 1 : 0]);
    return {
      tick: this.tick, held: this.held.slice(), aim: this.aim.map(r3), human: this.human.slice(),
      units: units, proj: proj, ids: viewer ? list.map(u => u.id) : undefined, count: this.units.length,
      hazards: this.hazards.map(h => [r2(h.x), r2(h.y), r2(h.r), h.salvage ? 1 : 0]),
      events: events || [],
      apm: [Math.round(this.apm(0)), Math.round(this.apm(1))],
      aiApm: [Math.round(this.aiApm(0)), Math.round(this.aiApm(1))],
      mode: this.mode, money: this.money.map(Math.floor), winner: this.winner, song: this.songId,
      queue: this.queue.map(q => q.map(j => [j.cls, r2(j.left)])),
      wrecks: this.wrecks.map(w => [r2(w.x), r2(w.y), w.value, r2(w.ttl)]),
    };
  };
  Sim.prototype.applySnapshot = function (snap) {
    this.tick = snap.tick; this.held = snap.held; this.aim = snap.aim; this.human = snap.human;
    if (snap.ids) for (const u of this.units) u.hidden = true; // filtered view: only listed ships are current
    snap.units.forEach((a, k) => {
      const i = snap.ids ? snap.ids[k] : k;
      let u = this.units[i];
      const cls = CLASS_LIST[a[15]] || 'fighter', team = a[16] | 0;
      if (!u) {
        // A ship the server built after we joined: create it locally to render.
        while (this.units.length < i) this._spawn('fighter', 0, 0, 0, 0).state = CRYSTALLIZED;
        u = this._spawn(cls, team, a[0], a[1], a[2]);
      } else if (a[15] !== undefined && (u.cls !== cls || u.team !== team)) {
        // Out of step with the server (e.g. it switched game mode): rebuild this slot.
        const fresh = this._spawn(cls, team, a[0], a[1], a[2]);
        this.units.pop(); fresh.id = i; if (fresh.guns[0] === fresh) fresh.guns = [fresh];
        this.units[i] = u = fresh;
      }
      u.x = a[0]; u.y = a[1]; u.heading = a[2]; u.gunAngle = a[3]; u.momentum = a[4]; u.energy = a[5];
      u.state = CODE_STATE[a[6]]; u.held = !!a[7]; u.targetId = a[8]; u.lockQ = a[9]; u.lockCap = a[10];
      u.entryQ = a[11]; u.crystallizeTimer = a[12]; u.goal = a[14] === undefined ? null : a[14];
      a[13].forEach((hp, k) => { if (u.weak[k]) { u.weak[k].out = hp < 0; u.weak[k].hp = Math.max(0, hp); } });
      if (Array.isArray(a[17])) a[17].forEach((ga, k) => { if (u.guns[k] && u.guns[k] !== u) gunApply(u.guns[k], ga); });
      if (a[18] !== undefined) u.battery = a[18];
      u.charging = a[19] ? snap.tick : -10;
      if (a[20] !== undefined && a[20] >= 0) u.lane = LANES[a[20]];
      if (a[21] !== undefined) u.activeLeft = a[21];
      u.ml = a[22] ? { lx: a[22][0], ly: a[22][1], grade: a[22][2], target: a[22][3] } : null;
      u.launchCd = a[23] || 0;
      u.hidden = false;
    });
    while (this.projectiles.length < snap.proj.length && this._growPool(1024)) { /* grow to fit */ }
    let k = 0;
    for (const p of this.projectiles) {
      const a = snap.proj[k];
      if (a) { p.active = true; p.x = a[0]; p.y = a[1]; p.vx = a[2]; p.vy = a[3]; p.vsCap = a[4] ? 2 : 1; p.kind = a[5] | 0; p.team = a[6] | 0; p.arm = a[7] ? 1 : 0; p.target = -1; k++; }
      else p.active = false;
    }
    this.hazards = snap.hazards.map(h => ({ x: h[0], y: h[1], r: h[2], salvage: !!h[3] }));
    this.events = snap.events;
    this._netApm = snap.apm; this._netAiApm = snap.aiApm;
    if (snap.mode) this.mode = snap.mode;
    if (snap.song && SONGS[snap.song] && this.songId !== snap.song) { this.song = SONGS[snap.song]; this.songId = snap.song; }
    if (snap.money) this.money = snap.money;
    if (snap.winner !== undefined) this.winner = snap.winner;
    if (snap.queue) this.queue = snap.queue.map(q => q.map(j => ({ cls: j[0], left: j[1] })));
    if (snap.wrecks) this.wrecks = snap.wrecks.map(w => ({ x: w[0], y: w[1], value: w[2], ttl: w[3] }));
  };

  Sim.prototype.stateHash = function () {
    let h = 0x811c9dc5;
    const mix = str => { for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } };
    mix('t' + this.tick + 'h' + this.held.join(',') + 'm' + this.human.join(',') + 'b' + this.aiBudget.map(b => b.toFixed(4)).join(',') +
        '$' + this.money.map(m => m.toFixed(2)).join(',') + 'w' + this.wrecks.length + 'q' + this.queue.map(q => q.length).join(','));
    for (const u of this.units) {
      mix(u.id + ':' + u.state + ':' + u.x.toFixed(3) + ',' + u.y.toFixed(3) + ',' + u.heading.toFixed(4) +
          ',' + u.momentum.toFixed(4) + ',' + u.energy.toFixed(3) + ',' + u.battery.toFixed(3) + ',' + u.lane + u.activeLeft.toFixed(4));
      for (const g of u.guns) mix(g.gunAngle.toFixed(4) + ',' + g.targetId + ',' + g.lockQ.toFixed(4));
      for (const w of u.weak) mix(w.type + w.hp.toFixed(2));
      if (u.goal !== null) mix('g' + u.goal.toFixed(4));
    }
    let live = 0;
    for (const p of this.projectiles) if (p.active) { live++; mix(p.x.toFixed(2) + ',' + p.y.toFixed(2)); }
    mix('pr' + live + 'hz' + this.hazards.length);
    return (h >>> 0).toString(16);
  };

  return { Sim: Sim, TUNABLES: TUNABLES, CLASSES: CLASSES, CLASS_LIST: CLASS_LIST, BUILDABLE: BUILDABLE,
           SONGS: SONGS, LANES: LANES, DEFAULT_LANE: DEFAULT_LANE,
           mulberry32: mulberry32, PLAYER: PLAYER, ENEMY: ENEMY };
});
