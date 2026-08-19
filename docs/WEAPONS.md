# Weapons — Complete Arsenal Spec
Implementation spec for the full classic Worms Armageddon (WA) arsenal. Stats researched 19/08/2026 from the Worms Knowledge Base (worms2d.info) — per-weapon pages pulled as raw wikitext (`https://worms2d.info/<Page>?action=raw`; the wiki blocks plain fetches). Everything below quotes WA's **power-3 (default) scheme values**, the numbers the classic game shipped with.

## Conventions
- **Damage** = max HP injury at the explosion centre; falls off with distance exactly like our existing explosion code.
- **WA crater sizes** are quoted as pixel diameters at WA scale. Our bazooka (radius 38) matches WA's 97 px crater, so: `ourRadius ≈ 0.39 × WA_diameter`. Conversion table used throughout:

| WA crater | 35 px | 47 px | 61 px | 97 px | 123 px | 147 px | 199 px |
|---|---|---|---|---|---|---|---|
| our radius | 14 | 18 | 24 | 38 | 48 | 58 | 78 |

- **Ammo** columns are *our suggested defaults* (WA-Intermediate-flavoured). worms2d.info does not publish per-scheme ammo counts, so these are design choices, marked ⭐ where a weapon is classically crate-only ("super weapon").
- **Determinism**: every "random" below (spread, cluster angles, drill depth, dud rolls, meteor placement, sheep decisions, earthquake impulses) MUST come from the turn-seeded RNG (`turnSeed`), consumed in a fixed order. No `Math.random`, no wall-clock.
- **Engine system vocabulary** used in implementation notes: `projectile` (arc + explode), `hitscan-burst` (instant ray shots), `melee` (adjacent hit + knock), `strike` (off-screen plane drops N payloads on a click-target line), `fire-entity` (flame particles that live across turns), `walker` (autonomous ground creature), `terrain-add` (girder), `terrain-carve` (torch/drill/kamikaze channels), `worm-state` (parachute etc.), `set-piece` (donkey/armageddon scripted events).

## Summary Table (implement tier)

| id | Weapon | Dmg | Our radius | Wind | Charge | Ammo | Targeting | Ends turn |
|---|---|---|---|---|---|---|---|---|
| homing | Homing Missile | 50 | 38 | y (pre-lock) | y | 2 | click target + aim/charge | y |
| mortar | Mortar | 5×15 | 14 each | n | n (fixed) | 5 | aim only | y |
| banana | Banana Bomb | 5×75 | 58 each | n | y | 1 | aim + charge | y |
| holygrenade | Holy Hand Grenade | 100 | 78 | n | y | 1 | aim + charge | y |
| axe | Battle Axe | 50% cur HP | — | n | n | 2 | melee | y |
| prod | Prod | 0 | — | n | n | ∞ | melee | y |
| baseballbat | Baseball Bat | 30 | — | n | n | 2 | melee, aimable | y |
| dragonball | Dragon Ball | 30 | — | n | n | ∞ | melee | y |
| handgun | Handgun | 6×5 | 4 (11 px bite) | n | n | ∞ | aim, burst | y (after burst) |
| uzi | Uzi | 10×5 | 4 each | n | n | 3 | aim, burst | y |
| minigun | Minigun | 20×5 | 4 each | n | n | 2 | aim, burst | y |
| longbow | Longbow | 2×15 | 0 (no crater) | n | n | 3 | aim, 2 shots | y (after 2nd) |
| petrol | Petrol Bomb | fire | 6 + 40 flames | flames: y | y | 2 | aim + charge | y |
| napalm | Napalm Strike | 5×15 + fire | 24 each | fire: very | n | 1 | click target | y |
| flamethrower | Flame Thrower | 56 flamelets | — | y | n | 1 | aim, stream | y |
| mine | Mine | 50 | 38 | n | n | 2 | place at feet | y (min 5 s retreat) |
| minestrike | Mine Strike | 5×50 | 38 each | n | n | ⭐0 | click target | y |
| sheep | Sheep | 75 | 58 | n | n | 1 | release (facing) | y |
| kamikaze | Kamikaze | 30/worm + 30 | 24 (61 px) | n | n | 1 | 8-direction | y (worm dies) |
| blowtorch | Blow Torch | ≤45 total | tunnel | n | n | 3 | 3 angles/side | y |
| drill | Pneumatic Drill | ≤45 total | tunnel | n | n | 3 | at feet, down | y |
| girder | Girder | 0 | — | n | n | 3 | click place | y |
| parachute | Parachute | 0 | — | y (drift) | n | 2 | toggle | **n** (utility) |
| earthquake | Earthquake | 0 (indirect) | — | n | n | ⭐0 | instant | y |
| donkey | Concrete Donkey | 100/stomp | 78 | n | n | ⭐0 | click target | y |
| armageddon | Armageddon | 50–100/meteor | 38–78 | n | n | ⭐0 | instant | y |
| selectworm | Select Worm | — | — | — | — | 1 | pick worm | **n** (utility) |
| carpetbomb | Mike's Carpet Bomb | 5 carpets ×30/bounce | 24 each | n | n | ⭐0 | click target | y |

## Corrections to the existing nine
Exact WA power-3 values vs what `constants.js` has now:

| Weapon | WA damage | WA crater → our radius | Current | Action |
|---|---|---|---|---|
| bazooka | 50 | 97 → 38 | 50 / 38 | ✓ already exact |
| grenade | **50** | **97 → 38** | 45 / 34 | bump dmg 45→50, radius 34→38 (same blast as bazooka) |
| cluster | initial **20**, 5×**20** | 47 → **18** each (initial = bomblet size) | 25/24, sub 20/20 | initial dmg 25→20, radius 24→18; sub radius 20→18. Bomblets eject −45°..+45° from vertical; unexploded bomblets self-destruct after 9 s |
| shotgun | 25 ×2 | 47 → 18 crater | 25, craterR 8 | crater 8→18. Victims always propelled along the shot direction |
| firepunch | 30 | no crater, cuts terrain above | 30 | ✓; WA quirk: usable in mid-air |
| dynamite | 75 | 147 → 58 | 75 / 50 | radius 50→58. Fixed 5 s fuse ✓, does not roll ✓, min 5 s retreat guaranteed |
| airstrike | 5×**30** | 61 → **24** each | 30 / 30 | radius 30→24. Missiles explode on impact; left/right key picks approach side |
| teleport | — | — | — | ✓ ends turn (classic quirk: the one movement utility that does) |
| skip | — | — | — | ✓ |

Grenade bounce, exact WA: MAX bounce = −4% horizontal / −40% vertical per bounce; MIN bounce = −4% / −70%. (Our restitution 0.45 ≈ MIN-ish; if we ever expose the bounce toggle these are the two presets.)

---

## Implement Tier

### Homing Missile (`homing`)
**Damage:** 50 max (identical damage/crater table to bazooka).  
**Radius:** WA 97 px → 38.  
**Fuse:** explodes on impact; hard self-destruct 10 s after launch.  
**Wind:** yes while ballistic (launched exactly like a bazooka); homing steering dominates after lock.  
**Charge:** yes.  
**Targeting:** click a map target first, then aim + charge and fire.  
**Homing behaviour (the feel):** flies ballistically for **0.5 s**, then steers toward the target. Attraction is deliberately weak — it arcs widely, and a miss makes it **orbit the target in an ellipse**. **4 s after launch** homing switches off (marker disappears) and it reverts to a plain wind-blown projectile until the 10 s timeout pops it. Sprite turns from blue to red when homing has failed/expired.  
**Implementation notes:** `projectile` with a steering phase: ticks 30–240 apply a capped acceleration toward the stored target point (tune accel so a straight shot connects but a perpendicular launch orbits); after tick 240 zero the steering, swap sprite to `proj-homing-active.png`; explode on terrain/worm contact or at tick 600. Target point is part of the command stream. Deterministic — no randomness at all. Use `proj-homing.png` (32-frame rotation table by velocity angle).

### Mortar (`mortar`)
**Damage:** shell 15 max + **5 clusters × 15 max**.  
**Radius:** WA 35 px → 14 (shell and bomblets identical).  
**Fuse:** none — shell and bomblets all explode on impact.  
**Wind:** no.  
**Charge:** **no — fixed launch speed at maximum power** (aim only, tap fire).  
**Ammo:** 5 suggested.  
**Quirk (the feel):** clusters eject **roughly opposite to the shell's travel direction**. Fired steeply up, the shell falls near-vertically and rains bomblets on the impact zone; fired flat, the clusters come back at the firer. Steepest aim isn't quite vertical; a max-steep shot lands ~240 px away at launch altitude.  
**Implementation notes:** `projectile`, speedMin=speedMax (reuse charged pipeline with locked power). On impact: small explosion, then spawn 5 sub-projectiles seeded from turn RNG with velocities mirrored around the reversed impact-velocity vector (±45° spread like cluster). Reuse the cluster bomblet sub-projectile code and `proj-cluster-bomblet.png`; shell sprite `proj-mortar.png` (32 rot).

### Banana Bomb (`banana`)
**Damage:** initial explosion 75 max, then **5 banana bomblets × 75 max each** — dynamite power ×6; the marquee crate weapon.  
**Radius:** WA 147 px → 58 per explosion.  
**Fuse:** selectable 1–5 s like a grenade; bomblets explode on ground contact (or 9 s self-destruct).  
**Bounce:** **forced MAX bounce** (−4% h / −40% v) — extremely bouncy, part of the terror.  
**Wind:** no. **Charge:** yes.  
**Ammo:** 1 suggested; also weight the crate table towards it (classic "banana in the crate" moment).  
**Cluster mechanics:** identical to cluster bomb — bomblets eject −45°..+45° from vertical, speeds up to 9% below max, from turn RNG. Throw it high so the split scatters.  
**Implementation notes:** `projectile` reusing the cluster template with `restitution ≈ 0.9-vertical-loss-0.4` MAX-bounce character, dmg/radius from above, subCount 5, sub sprite = same banana art. Sprite `proj-banana.png` (32 rot) for shell and bomblets. Turn-continues: no.

### Holy Hand Grenade (`holygrenade`)
**Damage:** **100 max** — the biggest hand-thrown blast in the game.  
**Radius:** WA 199 px → 78. Enormous knockback: can throw worms across the map.  
**Fuse:** **fixed 3 s, and it does not explode when the timer expires — it waits until it has also come completely to rest.** Then: beat of silence → **"HALLELUJAH!" choir → explosion.**  
**Bounce:** forced MIN bounce (−4% h / −70% v) — thuds and settles quickly.  
**Wind:** no. **Charge:** yes. **Ammo:** 1 suggested.  
**Implementation notes:** `projectile` with two-condition detonation: `fuseElapsed && atRest` (atRest = |v| under epsilon for N ticks). On both true, freeze it, play hallelujah (~40-tick anticipation delay — this delay is essential to the feel; the victim gets one agonising beat), then explode. Best-throw pattern (steep lob so it lands dead) emerges naturally. Sprite `proj-holygrenade.png` (32 rot). Sound: needs a hallelujah sample — not in our current sound set, flag for the sounds pass; explosion-3 as fallback.

### Battle Axe (`axe`)
**Damage:** removes **50% of the target's current HP, rounded down** — but always at least 1 (can finish a 1 HP worm). Ignores Damage x2 by nature.  
**Knockback:** **none** — one of the only weapons that doesn't move the target.  
**Terrain:** no crater.  
**Range quirk:** hits all worms in the arc immediately in front, surprisingly long reach, **works through thin terrain**.  
**Wind/charge:** no/no. **Ammo:** 2 suggested. **Targeting:** directional melee. Ends turn.  
**Implementation notes:** `melee`. Hitbox like firepunch's but forward instead of up; for each worm hit apply `dmg = max(1, floor(hp/2))`, zero knockback. Skip the knockback pipeline entirely (also means no turn-ending damage-reaction fling). Halving is deterministic — no RNG. Worm pose `worm-axe.png` (4 frames, 104x104).

### Prod (`prod`)
**Damage:** **0**. A feather-push: nudges the worm in front forward a few pixels.  
**The point:** pure humiliation kill — prod a worm off a ledge / into water / onto a mine. Classic quirk: a blocked target can bounce the push back onto the prodder.  
**Wind/charge:** no/no. **Ammo:** ∞. Ends turn.  
**Implementation notes:** `melee` with dmg 0 and a tiny horizontal impulse (~vx 30, vy −20 — just enough to clear a lip and trigger normal physics/fall/water). Must not count as "damage" for turn-end-on-damage rules (it deals none). Pose `worm-prod.png` (5 frames).

### Baseball Bat (`baseballbat`)
**Damage:** 30, plus **huge knockback** — propels the victim at high velocity a great distance (worms bounce off terrain on the way).  
**Aim:** knock angle is aimable from horizontal to ~75° up; 45° for max distance. Home-run jingle if the victim exits the map's side edge.  
**Wind/charge:** no/no. **Ammo:** 2 suggested. **Targeting:** directional melee, aimable. Ends turn.  
**Implementation notes:** `melee` with aimable launch vector: reuse aim controls clamped to [0°, 75°], impulse magnitude ~2× firepunch's (try knock speed ≈ 450 along aim). Fall damage applies on landing = the classic bat kill. Poses `worm-bat-aim.png` (32 aim table) + `worm-bat-swing.png`. Play a "ding" + jingle if victim crosses the world side boundary (drowning offscreen).

### Dragon Ball (`dragonball`)
**Damage:** 30. Fires a short-range horizontal energy ball; victim flies in the ball's travel direction — flatter and further than firepunch's up-fling.  
**Range:** very short (adjacent worm only, roughly one worm-length in front).  
**Quirks:** hits one worm only; usable in mid-air (skips the ground animation); can nudge mines without triggering them.  
**Wind/charge:** no/no. **Ammo:** ∞ (classic melee trio: firepunch / dragonball / prod). Ends turn.  
**Implementation notes:** `melee`, horizontal variant of firepunch: hitbox extends ~16 px forward, knock vx ≈ ±260, vy ≈ −80. Spawn the `proj-fireball.png` (20 frames, 72x72) as a purely cosmetic short-lived effect travelling ~40 px forward. First worm hit only.

### Handgun (`handgun`)
**Damage:** **6 rounds × 5 max each** (30 total), fired in slow succession.  
**Crater:** 11 px bite per bullet (our ~4 px radius carve).  
**Spread:** slight per-bullet inaccuracy; **you can re-aim between shots** (WA lets aim move during the burst).  
**Knockback:** minimal per bullet but cumulative.  
**Wind/charge:** no/no. **Ammo:** ∞ suggested. Turn ends after the burst (single weapon use).  
**Implementation notes:** `hitscan-burst`: 6 shotgun-style rays at ~20-tick intervals, each `dmg 5, craterR 4, knock ~30`, with a small deterministic angular jitter (±1.5°) from turn RNG. Keep aim input live between shots; firing is one command, jitter replayable from seed. Pose `worm-handgun.png` (32 aim).

### Uzi (`uzi`)
**Damage:** **10 rounds × 5 max**, one every 6 frames (fast).  
**Character:** sprays — noticeably inaccurate, close range; drills a thin line through terrain; strong cumulative push (shove worms off edges).  
**Wind/charge:** no/no. **Ammo:** 3 suggested. Ends turn after burst.  
**Implementation notes:** `hitscan-burst`: 10 rays at 6-tick intervals, dmg 5, craterR 4, jitter ±4° from turn RNG, knock ~35 per hit along the ray. Aim stays live during burst. Pose `worm-uzi.png` (32 aim).

### Minigun (`minigun`)
**Damage:** **20 rounds × 5 max**, one every 3 frames — up to ~100 on a pinned worm.  
**Character:** the room-clearer: chews terrain fast, launches worms very far; widest spread of the three guns.  
**Wind/charge:** no/no. **Ammo:** 2 suggested. Ends turn after burst.  
**Implementation notes:** `hitscan-burst`: 20 rays at 3-tick intervals, dmg 5, craterR 4, jitter ±6° from turn RNG, knock ~40. The cumulative knock naturally produces WA's "worm surfs away on the bullet stream". Pose `worm-minigun.png` (32 aim, 90x90 frames — note larger frame size).

### Longbow (`longbow`)
**Damage:** **2 arrows × 15 max**; like shotgun, **turn continues between the two arrows** and ends after the second.  
**Physics:** fixed-power projectile (no charge), aim limited to ±45° from horizontal; strong knockback for its damage; **no crater — an arrow that hits terrain embeds and becomes part of the landscape** (climbable, blocks movement).  
**Wind:** no. **Ammo:** 3 suggested.  
**Quirk:** an arrow hitting a mine catapults it away at speed.  
**Implementation notes:** hybrid: `projectile` (fast, flat arc, fixed speed ~500) that on worm hit deals 15 + strong along-velocity knock, and on terrain hit **adds** a small arrow-shaped terrain stamp (terrain-add, ~24×4 px along the impact angle) instead of carving. Two-shot state machine copied from shotgun. Sprites `proj-arrow.png` (32 rot); pose `worm-longbow.png`. Aim clamp [−45°, +45°].

### Petrol Bomb (`petrol`)
**Damage:** blast is trivial (tiny 15 px pop → our radius 6); the payload is **40 pieces of fire** scattered from the breaking bottle.  
**Fuse:** explodes on impact (no bounce — the bottle breaks).  
**Wind:** the bottle flies like a grenade (no wind); **the flames are strongly wind-affected**.  
**Charge:** yes. **Ammo:** 2 suggested. Ends turn.  
**Implementation notes:** `projectile` + `fire-entity` spawn: on impact, tiny carve, then seed 40 flame particles with upward/outward velocities from turn RNG; flames then live by the global fire rules (below). Sprite `proj-petrol.png` (32 rot); flames `fx-fire-petrol.png` / `fx-flame.png`.

### Napalm Strike (`napalm`)
**Damage:** 5 missiles × 15 max (explicitly air strike ÷ 2, rounded down) — but the real payload is **61 flamelets per missile** raining down.  
**Radius:** 61 px → 24 per missile.  
**Wind:** the fire is **very wind-sensitive** — the whole point. A napalm target must be chosen reading the wind; flames drift far downwind as they fall.  
**Targeting:** click map target, left/right key picks approach side. **Ammo:** 1 suggested (or crate). Ends turn.  
**Implementation notes:** `strike` (clone airstrike: 5 drops, spacing 28) where each missile impact spawns ~20 flame particles (61 is WA-exact but 20/missile ≈ 100 total is our budget cap; see fire rules) with wind-inherited velocity from turn RNG. Missiles use `proj-airstrike-missile.png`. Unusable in caves like airstrike.

### Flame Thrower (`flamethrower`)
**Damage:** emits **56 flamelets** in a stream over ~2 s; each flamelet burns on contact; potential total ~200 HP on a pinned target but realistically 20–40.  
**Character:** flames **push worms along the stream**, burn through terrain quickly, and are wind-affected mid-flight. Flamelets weaken with each worm burnt (damage splits across a pile). Self-hit stops the attack instantly.  
**Wind:** yes. **Charge:** no (aim + hold). **Ammo:** 1 (classic team special weapon). Ends turn after the stream.  
**Implementation notes:** `fire-entity` emitter: 56 flame particles launched from the muzzle over 120 ticks along the aim direction at moderate speed, each affected by gravity + wind, igniting per the fire rules on landing; each deals contact damage + small push while airborne too. Reuse fx-flame sprites. Worm pose: MISSING in rip — reuse `worm-blowtorch-aim.png`.

### Mine (`mine`) — placed weapon + map-start object
**Damage:** 50 max. **Radius:** 97 px → 38.  
**Placement:** dropped at the worm's feet (drop-and-run); **always grants minimum 5 s retreat** regardless of scheme.  
**Arming/fuse:** player-placed mines: **fixed 3 s fuse** once triggered. Map-start mines: scheme fuse 0–3 s (0 = instant — brutal), optionally random.  
**Proximity trigger:** WA-exact: a 45°-tilted square, centre-to-vertex **48 px** (our scale ~19 px radius diamond; a plain 18 px circle is indistinguishable in play).  
**Dud chance:** scheme option (map-start mines only in spirit): WA rolls from a 6-entry normal/dud pool that refills, so duds cluster realistically. A dud sizzles but never pops.  
**Physics:** bounces like a MAX-bounce grenade; shoved around by explosions (further than worms); a mine blast under a worm launches it upward.  
**Ammo:** 2 suggested. Ends turn (with the 5 s-equivalent retreat).  
**Implementation notes:** two spawn paths, one entity. Entity states: `idle` (sprite mine-idle) → `triggered` (worm enters proximity && not owner-immune-window; sprite mine-armed flashing + beep) → 180-tick fuse → explode (or `dud`: stop, fizzle). Map-start mines: N seeded positions on terrain at game start (option `startMines: 0–8`, fuse option, dud option — dud roll from game seed pool of 6). Placed mines arm ~2 s after placement so the placer can retreat over it. Mines are physics bodies (roll on slopes, knocked by blasts). Retreat: grant max(retreatStamina, 25) — our stamina analogue of the 5 s guarantee.

### Mine Strike (`minestrike`)
**Damage:** **5 mines** dropped from the plane, up to 50 each (97 px → 38).  
**Behaviour:** mines fall on the strike line, **bounce and roll until they settle**, then behave exactly like placed mines (proximity, 3 s fuse). Devastating in bowls where they funnel together.  
**Targeting:** click map target. **Ammo:** ⭐ crate-only super weapon. Ends turn.  
**Implementation notes:** `strike` template (airstrike drop pattern, spacing 28) where each payload is a live mine entity with MAX-bounce restitution instead of an exploding missile. Zero new art: mine sprites + strike code. Unusable in caves.

### Sheep (`sheep`)
**Damage:** 75 max. **Radius:** 147 px → 58 (dynamite-class).  
**Behaviour (the feel):** released at your worm walking in the facing direction; **walks fast and hops** over obstacles (WA sheep hops when it meets a step/edge — cadence: walk ~1 s, hop whenever blocked or at ledges, bounding arcs ~30 px); **second Space press detonates it manually**; auto-detonates after ~**20 s**. Collects crates for its owner en route!  
**Wind/charge:** no/no. **Ammo:** 1 suggested. Ends turn.  
**Implementation notes:** first `walker`: autonomous entity with worm-like ground physics, walk speed ~2× worm, auto-hop (jump impulse) when path blocked or on ledge-drop > threshold, direction reverses on wall. Detonate on: manual command, 1200-tick timeout, or damage. Crate pickup on overlap credits the owning team. All pathing is deterministic (pure function of terrain + seeded start); no RNG needed except optional bleat timing (cosmetic). Sprites `sheep-walk.png` (8 frames) + `sheep-fall.png`. This walker becomes the template for the whole animal-weapon family later.

### Kamikaze (`kamikaze`)
**Damage:** 30 to **each** worm passed through in flight + 30 in the final explosion (61 px → 24). **The user always dies.**  
**Behaviour:** 8-direction aim; worm launches in a dead-straight line, **carving a worm-wide tunnel through terrain** for ~3 girder-lengths (~200 px our scale), damaging and shunting every worm in the path, then explodes (also usable in mid-air; explodes immediately in place if it can't cut).  
**Wind/charge:** no/no. **Ammo:** 1 suggested. Ends turn (fatally — worm HP to 0, no gravestone blast double-dip: the explosion IS the death).  
**Implementation notes:** `terrain-carve` set-piece: pick one of 8 unit vectors; move the worm ~4 px/tick for up to 50 ticks (or until border/indestructible), carving an 8 px-radius channel each tick and applying 30 dmg + along-vector knock to each worm touched once; then explosion (30/24) and remove the worm (skip normal death anim → the blast is the death). Straight-line = fully deterministic. Poses `worm-kamikaze-1..5.png` (direction variants); smoke trail optional.

### Blow Torch (`blowtorch`)
**Damage:** diminishing per touch — 15, 7, 5, 3, 3, 2, 2, 1… capped at **45 total per worm per turn** (cap shared with Pneumatic Drill). Pushes struck worms along the dig direction.  
**Dig:** horizontal tunnel ~**142 px** long (our ~110 px) over max **5 s**; **three angles per facing: +22.5°, 0°, −22.5°**; ends early if it breaks into open air; cancellable with Space; collects crates mid-dig.  
**Wind/charge:** no/no. **Ammo:** 3 suggested. Ends turn after digging (retreat applies).  
**Implementation notes:** `terrain-carve`: worm advances ~0.5 px/tick along chosen vector for ≤300 ticks, carving a worm-height channel; per-worm damage ledger implements the 15/7/5/3… series (shared ledger object with drill). Angle select = up/down keys pre-fire. Deterministic. Pose `worm-blowtorch.png` (15 frames, 80x80).

### Pneumatic Drill (`drill`)
**Damage:** same diminishing series as blow torch, same shared 45 cap; drilled worms knocked left/right **randomly** (turn RNG!).  
**Dig:** straight down for ≤5 s; **depth is seeded-random, Gaussian: mean ~158 px, σ ~18** (WA scale; ours ≈ mean 62, σ 7) — you never quite know where you'll pop out.  
**Quirks:** collects crates; no fall damage during the dig but turn then ends with **no retreat**; drilling from an object's top doesn't detonate it.  
**Wind/charge:** no/no. **Ammo:** 3 suggested. Ends turn.  
**Implementation notes:** `terrain-carve` straight down: sample depth from turn RNG (clamped Gaussian via Box–Muller on seeded uniforms), carve at ~0.5 px/tick, damage ledger shared with blowtorch, knock direction = seeded coin flip per victim. Pose `worm-drill.png` (4 frames).

### Girder (`girder`)
**Effect:** adds an indestructible-feeling steel beam to the terrain. WA truth: **the beam is ordinary terrain once placed** (destructible by later blasts) — "indestructible steel" is a myth; keep it destructible.  
**Shapes:** **8 angles (22.5° steps) × 2 lengths** (short ~32 px, long ~64 px), cycled with arrow keys.  
**Placement rules:** cursor-placed; refused (beep, no cost) if overlapping any worm/object or out of range. WA range scales with scheme power (200 px per star; default mid ≈ 600 px WA ≈ 235 px ours — generous; suggest ~250 px from worm, or unlimited for v1).  
**Ammo:** 3 suggested. **Ends turn** (with retreat).  
**Implementation notes:** first `terrain-add`: stamp the girder pixels into the terrain mask + a steel texture pass in the renderer (girder pixels render metal, not soil — keep a parallel "girder" mask or bake colour into the terrain bitmap). Placement validation: sprite bbox must not intersect worms/mines/crates; must be within range circle. Assets: `girder-long-0..8.png` / `girder-short-0..8.png` cover every angle — stamp the sprite alpha directly. Deterministic (pure placement command).

### Parachute (`parachute`)
**Effect:** utility — cancels fall damage; drifts with wind, steerable (left/right lean, down = sink faster); **auto-deploys** before a damaging fall if selected; Space closes it. **Does not end the turn**; weapons can even be dropped mid-glide (v2, skip for now).  
**Ammo:** 2 suggested.  
**Implementation notes:** `worm-state`: while airborne with chute open, clamp fall speed to ~40 px/s, apply wind accel + player lean, suppress fall damage on landing, close on land. Turn continues (uses no stamina; it's an aerial state). Art exists: `worm-parachute.png` (90x90, 17 frames). Command-stream: open/close events + per-tick lean inputs (already how movement records).

### Earthquake (`earthquake`)
**Effect:** ⭐ super weapon. Shakes the whole map for a few seconds: **no direct damage** — every worm, mine, barrel and crate gets bounced and rolled downhill/off ledges; kills come from falls, mines and water. The only weapon that moves crates.  
**Targeting:** none — instant on use. Ends turn.  
**Implementation notes:** `set-piece`: for ~240 ticks apply small seeded random impulses (turn RNG, fixed consumption order over entity list sorted by id) to every physics body each ~20 ticks + camera shake. Mines can trigger, worms take fall damage naturally. Determinism hinges on stable entity iteration order — sort by entity id.

### Concrete Donkey (`donkey`)
**Effect:** ⭐ THE super weapon. Click a target; the donkey falls from the sky and **stomps repeatedly downward, each stomp a 100-damage, 199 px (→ our 78) explosion**, destroying the entire column of terrain beneath it until it exits into water.  
**Wind:** no. Ends turn.  
**Implementation notes:** `set-piece`: entity spawns at world-top over target x; falls; on terrain contact triggers explosion (100/78) + continues downward at fixed stomp cadence (~every 30 ticks: bounce up slightly, slam, explode) until y > water level. Screen shake + thud each stomp. `donkey.png` (2 frames, 158x123 — scale to ~50 px tall in-world). Deterministic (pure function of target + terrain).

### Armageddon (`armageddon`)
**Effect:** ⭐ the map-ender. **~20–30 meteors** (WA ~100 — budget ours down; option `meteorCount`) rain diagonally across the whole map over ~8 s, each dealing **50–100 damage** with medium-large craters (ours 38–78, seeded per meteor). Hits everyone including the user's team. Placement is pure luck.  
**Targeting:** none — instant. Ends turn.  
**Implementation notes:** `set-piece`: spawn meteors on seeded schedule (turn RNG: x, delay, size tier, velocity ~(±80, 420)); each is a plain projectile with fire trail; explosions reuse standard pipeline. Meteor art `fx-meteor.png` (10 frames). Camera: pull to wide/overview during the shower.

### Select Worm (`selectworm`)
**Effect:** utility — switch the active worm to any living worm on your team; **turn continues** with full stamina/attack intact.  
**Ammo:** 1 per game suggested.  
**Implementation notes:** `worm-state`/UI: consumes ammo, opens a pick (tap a teammate or cycle), swaps `activeWormId`, camera pans. Recorded as a single command. No RNG. Icon only, no sprite needed.

### Mike's Carpet Bomb (`carpetbomb`)
**Damage:** **5 carpets**; each explodes **on every bounce** (30 max, 61 px → 24 per explosion) and vanishes on its ~5th terrain contact — up to ~25 explosions marching across the terrain.  
**Behaviour:** carpets drop on the strike line, then bounce energetically; in a bowl they chain devastatingly.  
**Targeting:** click map target. **Ammo:** ⭐ crate-only super weapon. Ends turn.  
**Implementation notes:** `strike` + bouncing payload: each carpet is a projectile with high restitution (~0.7/0.6) that on each terrain contact triggers a 30/24 explosion (which also relaunches it — apply bounce velocity *after* the carve so it keeps travelling), decrementing a 5-bounce life. Worm contact = explode too (counts a bounce). Sprite `proj-carpet.png` (10 frames). Deterministic.

---

## Cross-cutting systems

### Fire / flames (petrol, napalm, flame thrower — one shared system)
- A **flame particle**: small physics body (gravity + wind while airborne; sticks/slides on terrain, slides down slopes) with a size/energy value.
- **Lifetime:** WA flames persist **across turns**, shrinking each turn; effectively gone 4–5 turns after creation. Ours: `flameTurnsLeft = 4`, size steps down per turn.
- **Damage:** WA never publishes the per-tick number. Design value: **~5 HP per contact-tick bundle** (damage a worm ~every 0.5 s in contact, max ~30 per turn per worm) — tune to feel. Touching fire also ends control (classic: it counts as taking damage → turn ends) and **worms slide on fire** (zero out friction under a burning worm — the napalm-slide-into-water kill must work).
- **Contact decay:** each worm-burn shrinks the flame (worms can extinguish fire with their bodies).
- **Explosions** near flames hurl them around and re-energise them (apply blast impulse to flame particles; reset a fraction of their lifetime).
- **Wind:** airborne flames get full wind acceleration — this is what makes napalm napalm.
- **Global cap:** WA caps at 200 flamelets; ours: cap ~120 live particles, oldest die first (also why a napalm strike wipes old petrol fires — authentic!).
- **Terrain:** only the flame thrower meaningfully burns terrain in WA; give its flamelets a tiny carve on ignition, petrol/napalm flames none.
- **Determinism:** flame spawn velocities and slide jitter all from turn RNG; flames are ordinary sim entities included in the settle check (a turn isn't "settled" while flames still move, but standing fires shouldn't block turn end — treat resting flames as settled).

### Mines (system summary)
Player-placed: at feet, arms after ~2 s, proximity diamond ≈ 18 px radius, fixed 3 s fuse once triggered, 50 dmg / 38 radius, min-5 s-retreat guarantee (stamina analogue: retreat reserve refilled to full). Map-start: `startMines` option (suggest 0/4/8), positions from game seed on walkable terrain, fuse option 0–3 s or random-per-mine (seeded), optional dud chance via WA's 6-slot normal/dud pool consumed per triggered mine. Mines are knockable physics bodies and chain with explosions.

### Girder placement rules
8 angles × 2 lengths; reject on overlap with any entity or terrain-solid majority; range limit ~250 px from worm (WA: 200 px × power stars); placed girder pixels become ordinary destructible terrain rendered as steel. Ends turn.

### Strike template (airstrike, napalm, mine strike, carpet bomb)
One shared implementation: click target (stored in command), approach side (left/right), plane flies off-screen at world-top, releases 5 payloads at fixed spacing (28) with inherited velocity; each strike subtype supplies the payload entity (missile / napalm-missile+flames / mine / bouncing carpet). All unusable under ceilings — payloads simply hit the roof (WA behaviour), no special validation needed beyond a UI warning.

### Classic weapon-panel grid (F1–F12 + utilities) — for the HUD dock
WA's panel is 5 columns × function-key rows; pressing a key cycles its row. Group our dock the same way (implement-tier weapons bolded, rest greyed/hidden until built):

| Key | Row contents (left→right) |
|---|---|
| Util | Jet Pack, Low Gravity, Fast Walk, Laser Sight, Invisibility |
| F1 | **Bazooka**, **Homing Missile**, **Mortar**, Homing Pigeon, Sheep Launcher |
| F2 | **Grenade**, **Cluster Bomb**, **Banana Bomb**, **Battle Axe**, **Earthquake** |
| F3 | **Shotgun**, **Handgun**, **Uzi**, **Minigun**, **Longbow** |
| F4 | **Fire Punch**, **Dragon Ball**, **Kamikaze**, Suicide Bomber, **Prod** |
| F5 | **Dynamite**, **Mine**, **Sheep**, Super/Aqua Sheep, Mole Bomb |
| F6 | **Air Strike**, **Napalm Strike**, Mail Strike, **Mine Strike**, Mole Squadron |
| F7 | **Blow Torch**, **Pneumatic Drill**, **Girder**, **Baseball Bat**, Girder Starter Pack |
| F8 | Ninja Rope, Bungee, **Parachute**, **Teleport**, Scales of Justice |
| F9 | Super Banana Bomb, **Holy Hand Grenade**, **Flame Thrower**, Salvation Army, MB Bomb |
| F10 | **Petrol Bomb**, Skunk, Priceless Ming Vase, French Sheep Strike, **Mike's Carpet Bomb** |
| F11 | Mad Cows, Old Woman, **Concrete Donkey**, Indian Nuclear Test, **Armageddon** |
| F12 | **Skip Go**, Surrender, **Select Worm**, Freeze, Patsy's Magic Bullet |

(Crate-pickup instants — Crate Shower, Crate Spy, Damage x2, Double Turn Time — never appear in the panel.)

---

## Document-Only Tier (future work, one paragraph each)
**Ninja Rope** — swingable grappling hook (max length ~465 px, 90° firing arc, re-shots per power setting); the deepest movement mechanic in Worms — swing physics, weapon-drop from rope, rope-knocking; turn continues. Needs a full constrained-pendulum sim; biggest single physics lift on this list.  
**Bungee** — walk off a ledge with it selected to descend on elastic; steerable, weapons droppable mid-hang; turn continues. Simple spring on the worm.  
**Jet Pack** — flight utility with 30 fuel (~6/sec per thruster), no fall damage while lit; turn continues. Maps cleanly to a stamina-drained flight state.  
**Super Sheep / Aqua Sheep** — sheep that on second press launches into free steerable flight until it hits anything (75 dmg / 147 px); Aqua variant also flies underwater. Needs per-tick steering input recording.  
**Mole Bomb** — hops, then dives and digs through terrain (tunnel apex ~140 px), exploding on contact/manual/20 s (30 dmg / 61 px). Walker + terrain-carve hybrid.  
**Mole Squadron** — strike dropping 5 digging moles (30/61 each). Strike + mole payload.  
**Homing Pigeon** — click-target bird that flies around terrain to the mark; 75 dmg / 147 px; a pathing homing projectile ("homing dynamite").  
**Super Banana Bomb** — manual-detonation banana: space blows the fruit, space again the 5 bomblets (75/147 each); crate-only.  
**Sheep Launcher** — fires the sheep as a fixed-speed projectile that then walks; team special weapon (75/147).  
**Old Woman** — walking dynamite: wanders slowly, 5 s fuse, 75 dmg / 147 px; pure walker + timer.  
**Mad Cows** — releases 1–5 charging cows that explode on collision (75/147 each); walker herd, staggered release.  
**Skunk** — waddles then releases a poison cloud (~5 HP/turn poison; 30/61 blast). **Requires the poison status system** (per-turn HP tick, cure via health crate) — build poison first.  
**Priceless Ming Vase** — dropped like dynamite, 5 s fuse: 75/147 main blast + 3 fragment bomblets; crate-only.  
**French Sheep Strike** — strike dropping 5 flaming sheep that bounce once then explode scattering fire (50/97 each), to La Marseillaise.  
**MB Bomb** — a single wind-blown Martyn Brown head floats down and detonates for 100/199; crate-only.  
**Scales of Justice** — instantly equalises total team HP across all teams; no damage; pure state operation on HP tables.  
**Salvation Army** — walking cluster: 10 s fuse or manual, 75/147 main + 5 tambourine bomblets (60/123).  
**Patsy's Magic Bullet** — click-target relentless homing projectile (even underwater), ~100/199; crate-only.  
**Freeze** — encases your team in ice until your next turn: immune to damage/poison/pushes (Scales, Earthquake and drowning excepted). Worm-state + team flag.  
**Invisibility** — network-only utility: team invisible to remote players until it deals damage; meaningful only once async multiplayer ships (hide worm in opponents' replays).  
**Earthquake variants** — Indian Nuclear Test: earthquake + rising water (one sudden-death step) + poisons every enemy worm; needs poison system.  
**Utilities** — Fast Walk (2× walk speed for the turn ≈ halve stamina walk drain), Low Gravity (halve gravity for the turn — projectiles and knockbacks too), Laser Sight (dotted aim ray for the F3 guns + kamikaze; trivial once hitscan exists), Damage x2 (crate instant: double damage + bigger radii for that team's current turn; ignores percentage weapons like axe), Double Turn Time (crate instant: async analogue = +50 stamina that turn), Crate Spy (crate instant: owner sees crate contents), Crate Shower (crate instant: seeded crates rain for the rest of the turn), Surrender (forfeit: worms wave white flags, team out), Worm Select variants (scheme option: free worm-select every turn vs ammo-limited).

## Determinism checklist for the implementer
1. All spread/jitter/cluster/drill/dud/meteor/earthquake randomness from `turnSeed` RNG, consumed in fixed order (entity lists sorted by id before iteration).
2. Homing steering, sheep pathing, kamikaze, donkey, girders: zero RNG — pure functions of command + world.
3. Flames are sim entities: same spawn order + same seeds = identical fire every replay; cap enforcement must be deterministic (oldest-first by spawn tick, tie-break by entity id).
4. Multi-shot weapons (shotgun 2, longbow 2, handgun/uzi/minigun bursts) record aim per shot in the command stream — aim may change mid-burst.
5. Mines/crates/sheep interacting with the settle-check: turn isn't committed until every entity (including flames in motion and walking sheep) is at rest or expired — cap sheep/set-piece lifetimes so a turn always terminates.
