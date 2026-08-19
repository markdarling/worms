# Ripped Asset Manifest
Classic Worms Armageddon sprites and sounds for the local-only POC. Ripped sprites are copyright Team17 (1998–2001); sourced from The Spriters Resource / The Sounds Resource (ripper: Random Talking Bush). Downloaded 19/08/2026. Not for distribution.

## Sources

| Source | URL | What came from it |
|---|---|---|
| WA "General Sprites" zip | https://www.spriters-resource.com/pc_computer/wormsgeddon/asset/13597/ | All worm anims, weapons, icons, crates, graves, UI, effects |
| WA "Terrain" zip | https://www.spriters-resource.com/pc_computer/wormsgeddon/asset/124540/ | terrain-forest-* files |
| Worms 2 "Gravestones" sheet | https://www.spriters-resource.com/pc_computer/worms2/asset/192899/ | gravestones-w2-sheet.png |
| WA "Sound Effects" zip | https://www.sounds-resource.com/pc_computer/wormsgeddon/asset/398149/ | sounds/*.wav (non-voice) |
| WA "Default Soundbanks" zip | https://www.sounds-resource.com/pc_computer/wormsgeddon/asset/398258/ | sounds/voice-*.wav (English bank) |

## Format Rules (read this first)
Every sprite except the icons, wind bar, and terrain files is a **vertical film strip of square frames**:

- Worm/weapon/UI strips: frame is **60x60 px**; frame count = height / 60 (e.g. 60x900 = 15 frames, 60x1920 = 32 frames). Frame 0 is at the top.
- `worm-parachute.png` uses **90x90 px** frames (17 frames).
- `ui-airstrike-marker.png` uses **30x30 px** frames (64 frames).
- `fx-explosion-circle100.png` uses **200x200** frames (4), `fx-explosion-circle50.png` **100x100** (8), `fx-smoke.png` **20x20** (28).

**Key colours (no alpha channel — key these out at load time):**

- Worm/projectile strips: solid **rgb(128,128,192)** lavender background.
- Crates, gravestones, oil-drum style strips: solid **rgb(192,192,128)** khaki background.
- Icons, wind bar, terrain, effects: **black rgb(0,0,0)** background (icons have a coloured border design on black; treat pure black as transparent).

**Aim strips are angle tables, not animations.** For any `-aim-` or projectile rotation strip with 32 frames, frame index maps to aim/rotation angle across the strip (WA convention: full angle sweep from straight down to straight up for aim poses; full 360° rotation for projectiles). Pick the frame nearest the current angle. The `-up`/`-down` suffixed files are the worm's body pitched for standing on up/down slopes — the unsuffixed file (level ground) is all the POC needs.

## Worm Sprites (60x60 frames, key rgb(128,128,192))

| File | Size | Frames | Use |
|---|---|---|---|
| worm-idle.png | 60x1200 | 20 | Idle breathing loop (level ground). `-up`/`-down` variants for slopes. |
| worm-blink.png | 60x360 | 6 | Blink overlay/expression, play occasionally over idle |
| worm-walk.png | 60x900 | 15 | Walk cycle loop |
| worm-jump.png | 60x600 | 10 | Jump take-off |
| worm-fly.png | 60x1920 | 32 | Airborne/knocked pose (angle table) |
| worm-fall.png | 60x120 | 2 | Falling loop |
| worm-aim-bazooka.png | 60x1920 | 32 | Bazooka aim angle table (frame = aim angle) |
| worm-throw-grenade.png | 60x1920 | 32 | Grenade aim/throw angle table |
| worm-throw-cluster.png | 60x1920 | 32 | Cluster bomb aim/throw angle table |
| worm-aim-shotgun.png | 60x1920 | 32 | Shotgun aim angle table |
| worm-firepunch.png | 60x1020 | 17 | Fire punch uppercut animation |
| worm-die.png | 60x3600 | 60 | Death animation (grimace, pop) |
| worm-win.png | 60x840 | 14 | Victory celebration |
| worm-parachute.png | 90x1530 | 17 (90x90) | Parachute descent |

The worm is the neutral pink worm — team colour in WA is applied via palette, so these are team-agnostic as-is.

## Gravestones & Crates (60x60 frames, key rgb(192,192,128))

| File | Size | Frames | Use |
|---|---|---|---|
| gravestone-1.png … gravestone-6.png | 60x1200 | 20 each | Six gravestone styles, bobbing/shine loop. Pick one style per team. |
| crate-weapon.png | 60x3660 | 61 | Weapon crate: spin/shine loop, final frames are the collect-dissolve |
| crate-weapon-v.png | 60x900 | 15 | Weapon crate alternate (static shine loop) |
| crate-health.png | 60x3660 | 61 | Health/medical crate (red cross), same layout as weapon crate |
| crate-utility.png | 60x3840 | 64 | Utility crate (bonus) |
| gravestones-w2-sheet.png | 1221x4456 | grid | BONUS: Worms 2 compiled sheet — team-coloured graves incl. submerged-in-water variants; blue grid background, ~54x60 cells. Lower priority than gravestone-1..6. |

No dedicated parachute-on-crate sprite was in the rip — crates in WA fall without one by default; use worm-parachute.png art if a chuted crate is wanted.

## Projectiles (60x60 frames, key rgb(128,128,192))

| File | Size | Frames | Use |
|---|---|---|---|
| proj-bazooka-shell.png | 60x1920 | 32 | Bazooka shell, 360° rotation table — pick frame by velocity angle |
| proj-grenade.png | 60x1920 | 32 | Grenade, 360° rotation table |
| proj-cluster.png | 60x1920 | 32 | Cluster bomb, 360° rotation table |
| proj-cluster-bomblet.png | 60x360 | 6 | Cluster bomblet (small submunition) |
| proj-dynamite.png | 60x7740 | 129 | Dynamite stick with sizzling fuse animation (long loop) |

## Weapon Panel Icons (32x32, black background)
All are ".1" (normal) variants from the WA weapon panel; a ".2" hover/selected variant exists in the source zip if needed later. Treat pure black as transparent or draw them on dark panel cells as-is.

Original nine: `icon-bazooka.png`, `icon-grenade.png`, `icon-cluster.png`, `icon-shotgun.png`, `icon-firepnch.png`, `icon-dynamite.png`, `icon-airstrke.png`, `icon-teleport.png`, `icon-skipgo.png`

Arsenal expansion (added 19/08/2026, same source zip; source filename in brackets):

| File | Source | Weapon |
|---|---|---|
| icon-homing.png | hmissile.1 | Homing Missile |
| icon-mortar.png | mortar.1 | Mortar |
| icon-banana.png | banana.1 | Banana Bomb |
| icon-holygrenade.png | hgrenade.1 | Holy Hand Grenade |
| icon-axe.png | axe.1 | Battle Axe |
| icon-prod.png | prod.1 | Prod |
| icon-baseballbat.png | baseball.1 | Baseball Bat |
| icon-dragonball.png | dragball.1 | Dragon Ball |
| icon-handgun.png | handgun.1 | Handgun |
| icon-uzi.png | uzi.1 | Uzi |
| icon-minigun.png | minigun.1 | Minigun |
| icon-longbow.png | longbow.1 | Longbow |
| icon-petrol.png | petrolbm.1 | Petrol Bomb |
| icon-napalm.png | firestrk.1 | Napalm Strike ("fire strike" internally) |
| icon-flamethrower.png | thrower.1 | Flame Thrower |
| icon-mine.png | mine.1 | Mine |
| icon-minestrike.png | minestrk.1 | Mine Strike |
| icon-sheep.png | sheep.1 | Sheep |
| icon-kamikaze.png | kamikaze.1 | Kamikaze |
| icon-blowtorch.png | blwtorch.1 | Blow Torch |
| icon-drill.png | drill.1 | Pneumatic Drill |
| icon-girder.png | girder.1 | Girder |
| icon-parachute.png | parachut.1 | Parachute |
| icon-earthquake.png | quake.1 | Earthquake |
| icon-donkey.png | donkey.1 | Concrete Donkey |
| icon-armageddon.png | armagedn.1 | Armageddon |
| icon-selectworm.png | select.1 | Select Worm |
| icon-carpetbomb.png | carpet.1 | Mike's Carpet Bomb |

All 28 verified visually (contact sheet) and by dimensions — every file is a valid 32x32 PNG. Icons for every other WA weapon (super sheep, mole, pigeon, rope, jetpack, freeze, etc.) exist in the source zip under `Weapon Icons/` if the document-only tier is ever built.

## Arsenal Expansion Sprites (added 19/08/2026, source zip asset 13597)
**Key colours vary per file in this batch** — sampled and verified per file below. KH = khaki rgb(192,192,128), LV = lavender rgb(128,128,192). All strips are vertical, frame 0 at top. "32 rot" = 360° rotation table (pick frame by angle); "32 aim" = aim-angle table.

### Projectiles & entities

| File | Size | Frames | Key | Use |
|---|---|---|---|---|
| proj-homing.png | 60x1920 | 32 rot | KH | Homing missile, blue (pre-lock / homing OK) |
| proj-homing-active.png | 60x1920 | 32 rot | KH | Homing missile red variant (lock failed / timed out) |
| proj-mortar.png | 60x1920 | 32 rot | KH | Mortar shell |
| proj-banana.png | 60x1920 | 32 rot | LV | Banana bomb (also use for the 5 cluster bananas) |
| proj-holygrenade.png | 60x1920 | 32 rot | LV | Holy Hand Grenade |
| mine-idle.png | 60x1920 | 32 | LV | Mine, unarmed/idle (rotation/roll table) |
| mine-armed.png | 60x1920 | 32 | LV | Mine, armed/flashing red light |
| sheep-walk.png | 60x480 | 8 | KH | Sheep walk cycle (hop = arc between walk loops) |
| sheep-fall.png | 60x1920 | 32 | KH | Sheep airborne/falling table |
| proj-arrow.png | 60x1920 | 32 rot | KH | Longbow arrow (frame 0 = pointing down). Source zip also has arrow00–31 as single frames |
| proj-petrol.png | 60x1920 | 32 rot | KH | Petrol bomb bottle |
| proj-airstrike-missile.png | 60x1920 | 32 rot | KH | Air/napalm strike drop missile |
| proj-carpet.png | 60x600 | 10 | LV | Carpet bomb rolled carpet (bounce anim). carpet2.png variant in source |
| proj-fireball.png | 72x1440 | 20 (72x72) | KH | Dragon Ball energy fireball |
| donkey.png | 158x246 | 2 (158x123) | KH | Concrete Donkey (2-frame stomp bob) |
| fx-meteor.png | 50x500 | 10 (50x50) | LV | Armageddon meteor (comic face, flaming) |
| fx-fire-petrol.png | 60x1200 | 20 | LV | Petrol/napalm ground-fire loop (source petrol1.png; petrol2–6 + petrol-1..4 variants in source) |
| fx-flame-big.png | 60x1920 | 32 | LV | Larger flame loop (source flame2.png; flame1.png = existing fx-flame.png, byte-identical) |

### Girders (terrain-add pieces, key LV; axis-aligned pieces fill their box entirely)
`girder-long-0..8.png` (~64px beam) and `girder-short-0..8.png` (~32px beam): 9 placement steps sweeping 180° in 22.5° increments (0 = vertical, 4 = horizontal, 8 = vertical again; 1–3/5–7 diagonals). Dimensions vary per angle (e.g. long: 20x140 vertical, 140x20 horizontal, 116x114 diagonal). WA offers 8 angles x 2 lengths — these files cover all of them.

### Worm weapon poses

| File | Size | Frames | Key | Use |
|---|---|---|---|---|
| worm-axe.png | 104x416 | 4 (104x104) | KH | Battle axe swing |
| worm-bat-aim.png | 60x1920 | 32 aim | LV | Baseball bat aim table |
| worm-bat-swing.png | 60x1920 | 32 | LV | Baseball bat swing (per-angle) |
| worm-prod.png | 60x300 | 5 | LV | Prod poke |
| worm-blowtorch.png | 80x1200 | 15 (80x80) | KH | Blow torch digging (torch lit) |
| worm-blowtorch-aim.png | 60x780 | 13 | KH | Blow torch raise/aim |
| worm-drill.png | 60x240 | 4 | KH | Pneumatic drill jackhammering |
| worm-kamikaze-1..5.png | 60x300 | 5 each | KH | Kamikaze flight poses (5 files ≈ direction variants: level/diagonal/vertical) |
| worm-handgun.png | 60x1920 | 32 aim | KH | Handgun aim table (whandf.png in source = firing variant) |
| worm-uzi.png | 60x1920 | 32 aim | LV | Uzi firing aim table (source wuzif.png) |
| worm-minigun.png | 90x2880 | 32 aim (90x90) | LV | Minigun firing aim table (muzzle flash needs the 90px frame) |
| worm-longbow.png | 60x960 | 16 | **rgb(32,32,248) blue** | Longbow draw/fire (odd key colour — sampled, verified) |

No dedicated aim/throw pose was copied for homing/mortar/banana/HHG/petrol/sheep/mine — WA reuses generic strips: `worm-aim-bazooka.png` for shoulder-launched (homing, mortar), `worm-throw-grenade.png` for thrown (banana, HHG, petrol), and dynamite-style place for mine/sheep release. Flame thrower worm pose was not found under an obvious name in the rip (procedural fallback or reuse blowtorch pose).

## Terrain (Forest theme, black = transparent where applicable)

| File | Size | Use |
|---|---|---|
| terrain-forest-texture.png | 256x256 | Tileable soil fill texture (draw where terrain mask is solid) |
| terrain-forest-soil.png | 256x256 | Alternate tileable soil/underside texture |
| terrain-forest-grass.png | 144x16 | Grass edging strip for terrain top edges |
| terrain-forest-back.png | 640x159 | Distant background silhouette layer |
| terrain-forest-gradient.png | 8x916 | Sky gradient — stretch horizontally across the canvas |

29 other themes (Hell, Desert, Snow, Space, Pirate, Cheese…) exist in the source zip if a different look is wanted.

## UI Elements

| File | Size | Frames | Use |
|---|---|---|---|
| ui-wind-left.png / ui-wind-right.png | 96x13 | 1 | Wind bar chevrons (left/right). Clip horizontally in proportion to wind strength. Black background. |
| ui-crosshair.png | 60x1920 | 32 (60x60) | Red crosshair, angle table matching the aim strips — use frame matching aim angle. Key rgb(128,128,192). |
| ui-arrow-down.png | 60x1800 | 30 (60x60) | Red bouncing "your worm" arrow marker. Key rgb(128,128,192). |
| ui-airstrike-marker.png | 30x1920 | 64 (30x30) | Airstrike target cursor animation. Key rgb(128,128,192). |

## Effects (black background)

| File | Size | Frames | Use |
|---|---|---|---|
| fx-explosion-circle100.png | 200x800 | 4 (200x200) | Large explosion flash circle |
| fx-explosion-circle50.png | 100x800 | 8 (100x100) | Medium explosion flash circle |
| fx-explosion-pow.png | 60x720 | 12 (60x60) | Comic "POW"-style explosion burst |
| fx-flame.png | 60x1920 | 32 (60x60) | Fire/flame loop |
| fx-smoke.png | 20x560 | 28 (20x20) | Small dark smoke puff |

## Sounds (sounds/, all WAV)
SFX: `explosion-1/2/3`, `splash`, `bazooka-fire`, `aim-powerup`, `throw-release`, `grenade-bounce`, `shotgun-fire`, `shotgun-reload`, `firepunch-impact`, `teleport`, `airstrike-jet`, `dynamite-fuse`, `worm-select`, `ui-select`, `ui-click`, `crate-land`, `crate-collect`, `worm-land`, `worm-impact`, `round-start`, `timer-tick`.

Voices (English bank): `voice-ohdear`, `voice-nooo`, `voice-uhoh` (the classic "oh no" moments), `voice-byebye` (death), `voice-jump1/2`, `voice-hello`, `voice-ow1`, `voice-oops`, `voice-laugh`, `voice-perfect`, `voice-incoming`, `voice-fire`, `voice-grenade`, `voice-victory`.

## Missing / Notes
- **Flame thrower worm pose**: MISSING — no obvious `wthrower`/`wflame` file in the rip's Worms folder; reuse worm-blowtorch-aim or procedural fallback.
- **Sheep-launcher/super-sheep, mole, pigeon, cows, skunk, old woman, vase, jetpack, rope sprites**: present in the source zip (sheeplau/spsheep/mole*/pigeon*/cow*/skunk*/woman/vase*/wjetfly*/rope*) but NOT copied — document-only tier.
- **Earthquake / Select Worm / Skip Go**: no entity sprite needed (screen shake / UI / anim already covered).
- **Kamikaze smoke trail**: source has Effects/kamismk.png if wanted.
- **Napalm strike plane/van art**: WA draws the strike plane off-screen; none in rip. Mine Strike drops use mine-idle.png; Carpet Bomb uses proj-carpet.png.
- **Dynamite placing worm pose**: not copied (WA uses a generic place anim); the throw-grenade strip works as a stand-in.
- **Crate parachute**: no crate-with-parachute sprite exists in the rip (see crates section).
- **Team-colour variants**: source zip has colour-suffixed variants (b/g/r/y/p/c) for crosshair, arrows, markers; only red copied. Re-copy from source asset 13597 if needed.
- The full source zips (900+ sprites, 2,600+ voice files across 40+ soundbanks) are not vendored here — only the curated set. Re-download from the source URLs above for more.
