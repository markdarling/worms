// All engine tunables in one place. Comments note the "feel" rationale — these
// numbers were tuned so movement/arcs/knockback read like classic Worms at the
// default 2400x900 world scale.

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
  RETREAT_IDLE_TICKS: 180,  // 3s of no input in retreat ends the turn

  CHARGE_TIME: 1.2, // s to ramp power 0 -> 1; full charge auto-fires (classic)

  WIND_ACCEL: 40, // px/s^2 at |wind| = 1; affects bazooka + airstrike only

  // Sudden death
  SUDDEN_DEATH_ROUND: 10,
  WATER_RISE: 12, // px per turn once active

  // Crates
  CRATE_CHANCE: 0.25,
  CRATE_HALF_W: 7,
  CRATE_HALF_H: 6,
  CRATE_FALL_GRAVITY_SCALE: 0.6, // crates drift down a touch slower (parachute-ish)
  // Seeded pick table: [weapon, amount]
  CRATE_TABLE: [
    ['cluster', 2],
    ['dynamite', 1],
    ['airstrike', 1],
    ['teleport', 1],
  ],

  KNOCK_RADIUS_MULT: 1.3, // knockback reaches a bit beyond the damage radius

  // Weapon stats (DESIGN.md table). `charged` = hold-to-power weapons.
  // `ammo` present = limited (per-team count); absent = infinite.
  WEAPONS: {
    bazooka: {
      charged: true, wind: true,
      speedMin: 140, speedMax: 540,
      dmg: 50, radius: 38, knock: 270,
    },
    grenade: {
      charged: true, fusable: true,
      speedMin: 120, speedMax: 470,
      restitution: 0.45, friction: 0.82,
      dmg: 45, radius: 34, knock: 240,
    },
    cluster: {
      charged: true, fusable: true, ammo: 5,
      speedMin: 120, speedMax: 470,
      restitution: 0.45, friction: 0.82,
      dmg: 25, radius: 24, knock: 180,      // the pop before the split
      subCount: 5, subDmg: 20, subRadius: 20, subKnock: 150,
      subSpreadVx: 100, subVyMin: 110, subVyRange: 90,
    },
    shotgun: {
      dmg: 25, craterR: 8, range: 700, shots: 2, knock: 70,
    },
    firepunch: {
      dmg: 30, rangeX: 14, rangeY: 16, reach: 10,
      knockVx: 60, knockVy: -230, notchR: 10,
    },
    dynamite: {
      ammo: 3, fuseTicks: 300, // 5s
      dmg: 75, radius: 50, knock: 420,
      restitution: 0.05, friction: 0.3, // thuds, no bounce
    },
    airstrike: {
      ammo: 2, wind: true,
      count: 5, spacing: 28, mvx: 70, mvy: 260,
      dmg: 30, radius: 30, knock: 200,
    },
    teleport: { ammo: 2 },
    skip: {},
  },
};
