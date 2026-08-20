// All engine tunables in one place. Comments note the "feel" rationale — these
// numbers were tuned so movement/arcs/knockback read like classic Worms at the
// default 2400x900 world scale.
//
// Weapon stats follow docs/WEAPONS.md (authentic WA power-3 values, craters
// converted at ourRadius ≈ 0.39 × WA_diameter).

export const C = {
  TICK_HZ: 60,
  DT: 1 / 60,

  // World defaults (overridable via Sim config)
  WORLD_W: 2400,
  WORLD_H: 900,
  WATER_LEVEL: 840,

  GRAVITY: 350, // px/s^2 — gravity-dominated lobs, floatier than Earth = classic Worms

  // Worm body: small circle. Feet rest 1px above terrain.
  WORM_RADIUS: 5,
  WORM_HP: 100,

  // Movement feel: waddly slow walk, small hop, high backflip.
  WALK_SPEED: 28,        // px/s
  STEP_UP: 3,            // px auto-step per 1px horizontal (ledges + ~45deg slopes)
  SNAP_DOWN: 6,          // px ground-snap when walking downhill; further = airborne fall
  AIM_RATE: 1.4,         // rad/s crosshair swing
  AIM_MAX: Math.PI / 2,  // straight up
  AIM_MIN: -Math.PI / 2, // straight down
  JUMP_VX: 60,
  JUMP_VY: -140,         // apex ~28px — a polite hop
  BACKFLIP_VX: 30,       // backwards (opposite facing)
  BACKFLIP_VY: -190,     // apex ~52px, lands at 192px/s: just under fall-damage threshold

  // Fall damage: |velocity| at landing above threshold hurts; scales with excess.
  FALL_DMG_THRESHOLD: 280, // px/s (~112px free fall) — an ordinary jump off a
                           // ledge lands safely; real cliff drops still hurt
  FALL_DMG_DIVISOR: 4,     // dmg = floor(excess / divisor)
  FALL_DMG_MAX: 50,

  // Stamina (async replacement for the turn timer)
  STAMINA: 100,
  RETREAT_STAMINA: 25,
  WALK_DRAIN_PER_TICK: 0.1, // = 6/s
  JUMP_COST: 10,
  BACKFLIP_COST: 15,
  RETREAT_TICKS: 300,       // fixed 5s retreat window after every attack —
                            // identical for all weapons (classic rule)

  CHARGE_TIME: 1.2, // s to ramp power 0 -> 1; full charge auto-fires (classic)

  WIND_ACCEL: 40, // px/s^2 at |wind| = 1; wind-flagged projectiles only

  // Sudden death — turn-based endgame pressure, three prongs:
  //  1. water rises every turn, ACCELERATING each round so the game always ends
  //  2. every worm withers SUDDEN_DEATH_DECAY hp per turn (never below 1 —
  //     the water or a weapon must land the killing blow, WA nuclear-test style)
  //  3. the trigger itself is a one-off dramatic event (banner + tint + shake)
  SUDDEN_DEATH_ROUND: 10,
  WATER_RISE: 12,        // px per turn at the moment sudden death starts
  WATER_RISE_ACCEL: 4,   // +px per turn for every round since it started
  SUDDEN_DEATH_DECAY: 5, // hp lost per worm per turn, floored at 1 hp

  // Crates
  CRATE_CHANCE: 0.25,
  CRATE_HEALTH: 25,        // hp restored by a health crate (rules >= 2)
  HEALTH_CRATE_SHARE: 0.35, // fraction of crate drops that are health (rules >= 2)
  CRATE_HALF_W: 7,
  CRATE_HALF_H: 6,
  CRATE_FALL_GRAVITY_SCALE: 0.6, // crates drift down a touch slower (parachute-ish)
  // Seeded pick table: [weapon, amount]. Banana weighted 2x — the classic
  // "banana in the crate" moment. Crate-only super weapons live here.
  CRATE_TABLE: [
    ['cluster', 2],
    ['dynamite', 1],
    ['airstrike', 1],
    ['teleport', 1],
    ['banana', 1],
    ['banana', 1],
    ['holygrenade', 1],
    ['homing', 2],
    ['minestrike', 1],
    ['carpetbomb', 1],
    ['donkey', 1],
    ['armageddon', 1],
    ['earthquake', 1],
    ['sheep', 1],
    ['mine', 2],
    ['minigun', 1],
    ['flamethrower', 1],
    ['napalm', 1],
    ['baseballbat', 1],
    ['girder', 2],
    ['selectworm', 1],
  ],

  KNOCK_RADIUS_MULT: 1.3, // knockback reaches a bit beyond the damage radius

  // --- Fire system (petrol / napalm / flame thrower share it) ---
  FIRE_CAP: 120,            // max live flamelets; oldest die first (WA caps at 200)
  FIRE_TURNS: 4,            // flames persist across turns, gone after 4
  FIRE_DMG: 5,              // per contact bundle
  FIRE_DMG_COOLDOWN: 30,    // ticks between bundles per flame (~0.5s)
  FIRE_TURN_CAP: 30,        // max fire damage per worm per turn
  FIRE_BURNS: 3,            // worm-burns a flamelet survives (bodies extinguish fire)
  FIRE_WIND_ACCEL: 120,     // flames are VERY wind-sensitive (3x projectile wind)
  FIRE_GRAV_SCALE: 0.6,     // flames flutter down
  FIRE_RADIUS: 8,           // worm-contact radius

  // Mines (placed + strike): WA proximity diamond ~= 18px circle at our scale.
  MINE: {
    dmg: 50, radius: 38, knock: 300,
    proximity: 18,
    fuseTicks: 180,     // fixed 3s once triggered
    armTicks: 120,      // ~2s arming so the placer can retreat over it
    e: 0.6, f: 0.96,    // MAX-bounce body — shoved further than worms by blasts
    dudChance: 0.2,     // rolled through WA's 6-slot pool (duds cluster)
  },

  // Oil drums (pre-placed map hazard, rules >= 2): explode when caught in any
  // blast or licked by fire, releasing a fireball + burning oil.
  DRUM: {
    dmg: 40, radius: 34, knock: 280,
    triggerPad: 8,   // blast rim slack — a near miss still cooks the drum
    flames: 10,      // burning oil released on detonation
    halfW: 7, halfH: 9,
  },
  // Pre-placed hazard density (rules >= 2): one per this many px of map width.
  HAZARD_MINE_SPACING: 550,
  HAZARD_DRUM_SPACING: 800,
  HAZARD_WORM_CLEARANCE: 55, // hazards never spawn this close to a worm spawn

  // WA bounce presets: MAX = -4% h / -40% v per bounce, MIN = -4% h / -70% v.
  // e = kept normal fraction, f = kept tangential fraction.
  BOUNCE_MAX: { e: 0.6, f: 0.96 },
  BOUNCE_MIN: { e: 0.3, f: 0.96 },

  // Weapon stats (docs/WEAPONS.md). `charged` = hold-to-power weapons.
  // `ammo` present = limited (per-team default count); absent = infinite.
  WEAPONS: {
    // ------------------------------------------------- original nine (corrected)
    bazooka: {
      charged: true, wind: true,
      speedMin: 140, speedMax: 540,
      dmg: 50, radius: 38, knock: 270,
    },
    grenade: {
      charged: true, fusable: true,
      speedMin: 120, speedMax: 470,
      e: 0.3, f: 0.96,                 // WA MIN bounce
      dmg: 50, radius: 38, knock: 270, // WA: same blast as bazooka
    },
    cluster: {
      charged: true, fusable: true, ammo: 5,
      speedMin: 120, speedMax: 470,
      e: 0.3, f: 0.96,
      dmg: 20, radius: 18, knock: 150,      // WA: initial pop = bomblet size
      subCount: 5, subDmg: 20, subRadius: 18, subKnock: 150,
      subSpeed: 170, subSpread: Math.PI / 4, // eject -45..+45 deg from vertical
      subFuse: 540,                          // 9s self-destruct backstop
    },
    shotgun: {
      dmg: 25, craterR: 18, range: 700, shots: 2, knock: 70, // WA 47px crater
    },
    firepunch: {
      dmg: 30, rangeX: 14, rangeY: 16, reach: 10,
      knockVx: 60, knockVy: -230, notchR: 10, // WA quirk: usable in mid-air
    },
    dynamite: {
      ammo: 3, fuseTicks: 300, // 5s
      dmg: 75, radius: 58, knock: 420, // WA 147px crater
      e: 0.05, f: 0.3, // thuds, no bounce
    },
    airstrike: {
      ammo: 2, wind: true,
      count: 5, spacing: 28, mvx: 70, mvy: 260,
      dmg: 30, radius: 24, knock: 200, // WA 61px crater each
    },
    teleport: { ammo: 2 },
    skip: {},

    // ------------------------------------------------------ projectiles (new)
    homing: {
      charged: true, wind: true, ammo: 2, needsTarget: true,
      speedMin: 140, speedMax: 540,
      dmg: 50, radius: 38, knock: 270, // identical to bazooka
      lockTick: 30,     // homing kicks in 0.5s after launch
      homingTicks: 240, // homing dies 4s after launch
      lifeTicks: 600,   // hard self-destruct at 10s
      accel: 700,       // steering accel — weak enough that a miss orbits
      maxSpeed: 400,
    },
    mortar: {
      ammo: 5, fixedSpeed: 480, // no charge: aim only, tap fire
      dmg: 15, radius: 14, knock: 120,
      subCount: 5, subDmg: 15, subRadius: 14, subKnock: 120,
      subSpeed: 150, subSpread: Math.PI / 4, // mirrored around reversed impact v
      aimClamp: 1.4,                          // steepest aim isn't quite vertical
    },
    banana: {
      charged: true, fusable: true, ammo: 1,
      speedMin: 120, speedMax: 470,
      e: 0.6, f: 0.96, // forced MAX bounce — part of the terror
      dmg: 75, radius: 58, knock: 420,
      subCount: 5, subDmg: 75, subRadius: 58, subKnock: 420,
      subSpeed: 190, subSpread: Math.PI / 4,
      subFuse: 540,
    },
    holygrenade: {
      charged: true, ammo: 1,
      speedMin: 120, speedMax: 470,
      e: 0.3, f: 0.96, // forced MIN bounce — thuds and settles
      dmg: 100, radius: 78, knock: 520, // biggest hand-thrown blast in the game
      fuseTicks: 180,   // fixed 3s AND must be at rest
      silenceTicks: 40, // the agonising HALLELUJAH beat
      backstopTicks: 900, // never-rests safety (rolling forever) — 15s
    },
    petrol: {
      charged: true, ammo: 2,
      speedMin: 120, speedMax: 470,
      dmg: 6, radius: 6, knock: 60, // the blast is trivial; the fire is the payload
      flames: 40,
    },

    // ------------------------------------------------------------- melee (new)
    axe: {
      ammo: 2, rangeX: 22, rangeY: 16, reach: 10,
      // dmg = max(1, floor(hp/2)); NO knockback, no crater, hits through terrain
    },
    prod: {
      rangeX: 12, rangeY: 14, reach: 8,
      knockVx: 30, knockVy: -20, // a feather-push; humiliation only
    },
    baseballbat: {
      ammo: 2, dmg: 30, rangeX: 18, rangeY: 16, reach: 10,
      knock: 450,                 // huge — the home-run machine
      aimMaxDeg: 75,              // knock angle aimable 0..75 deg up
    },
    dragonball: {
      dmg: 30, rangeX: 16, rangeY: 14, reach: 10,
      knockVx: 260, knockVy: -80, // flat fling, first worm only
    },

    // ------------------------------------------------------------ guns (new)
    handgun: { burst: 6, cadence: 20, dmg: 5, craterR: 4, knock: 30, jitterDeg: 1.5, range: 700 },
    uzi: { ammo: 3, burst: 10, cadence: 6, dmg: 5, craterR: 4, knock: 35, jitterDeg: 4, range: 700 },
    minigun: { ammo: 2, burst: 20, cadence: 3, dmg: 5, craterR: 4, knock: 40, jitterDeg: 6, range: 700 },
    longbow: {
      ammo: 3, shots: 2, speed: 500,
      dmg: 15, knock: 260,            // strong knock for its damage; no crater
      aimClamp: Math.PI / 4,          // +-45 deg
      stampLen: 24, stampThick: 3,    // arrows embed as terrain
    },

    // ---------------------------------------------------------- strikes (new)
    napalm: {
      ammo: 1, count: 5, spacing: 28, mvx: 70, mvy: 260,
      dmg: 15, radius: 24, knock: 130, // air strike / 2
      flamesPerMissile: 20,
    },
    minestrike: { ammo: 0, count: 5, spacing: 28, mvx: 70, mvy: 260 }, // crate-only
    carpetbomb: {
      ammo: 0, count: 5, spacing: 28, mvx: 70, mvy: 260, // crate-only
      dmg: 30, radius: 24, knock: 200,
      bounces: 5, e: 0.7, f: 0.8, // explodes on EVERY bounce
    },

    // ------------------------------------------------------------ misc (new)
    flamethrower: {
      ammo: 1, flames: 56, cadence: 2, speed: 190, jitterDeg: 4,
      carveR: 3, // only the flame thrower meaningfully burns terrain
    },
    mine: { ammo: 2 }, // stats in C.MINE
    sheep: {
      ammo: 1, dmg: 75, radius: 58, knock: 420,
      timeoutTicks: 1200, // 20s auto-detonate
      walkMult: 2, hopVx: 70, hopVy: -170,
    },
    kamikaze: {
      ammo: 1, pathDmg: 30, dmg: 30, radius: 24, knock: 200,
      speed: 240, ticks: 50, carveR: 8, pathKnock: 200, // ~200px straight carve
    },
    blowtorch: {
      ammo: 3, carveR: 7, speed: 30, maxTicks: 220, // ~110px tunnel over <=3.7s
      push: 80, hitEvery: 15,
    },
    drill: {
      ammo: 3, carveR: 7, speed: 30,
      depthMean: 62, depthSigma: 7, depthMin: 40, depthMax: 90, // seeded Gaussian
      hitEvery: 15,
    },
    girder: {
      ammo: 3, len: 64, thick: 6, range: 250, // 8 angles via fuse 1..8
    },
    parachute: {
      ammo: 2, fallSpeed: 40, steer: 90, windAccel: 40, autoDeployVy: 260,
    },
    earthquake: {
      ammo: 0, ticks: 240, every: 20, impulse: 60, lift: 40, // crate-only
    },
    donkey: {
      ammo: 0, dmg: 100, radius: 78, knock: 520, // crate-only. THE super weapon.
      fallSpeed: 300, stompCooldown: 10, bounceVy: -80, maxStomps: 20,
    },
    armageddon: {
      ammo: 0, minMeteors: 20, maxMeteors: 30, // crate-only. The map-ender.
      dmgMin: 50, dmgMax: 100, radiusMin: 38, radiusMax: 78,
      spreadTicks: 480, vy: 420, vxSpread: 80,
    },
    selectworm: { ammo: 1, pickRadius: 24 },
  },

  // Series of diminishing hits for blowtorch/drill; total capped at 45/worm/turn
  // (shared ledger between the two).
  CARVE_DMG_SERIES: [15, 7, 5, 3, 3, 2, 2, 1],
  CARVE_DMG_CAP: 45,
};

// Fixed ammo serialization order — snapshot v2 encodes per-team ammo as an
// array in exactly this order. First four match snapshot v1's layout.
export const AMMO_IDS = [
  'cluster', 'dynamite', 'airstrike', 'teleport',
  'homing', 'mortar', 'banana', 'holygrenade', 'axe', 'baseballbat',
  'uzi', 'minigun', 'longbow', 'petrol', 'napalm', 'flamethrower',
  'mine', 'minestrike', 'sheep', 'kamikaze', 'blowtorch', 'drill',
  'girder', 'parachute', 'earthquake', 'donkey', 'armageddon',
  'selectworm', 'carpetbomb',
];
