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
All nine requested icons, one file each, straight from the WA weapon panel:

`icon-bazooka.png`, `icon-grenade.png`, `icon-cluster.png`, `icon-shotgun.png`, `icon-firepnch.png`, `icon-dynamite.png`, `icon-airstrke.png`, `icon-teleport.png`, `icon-skipgo.png`

These are the ".1" (normal) variants; a ".2" hover/selected variant exists in the source zip if needed later. Treat pure black as transparent or draw them on dark panel cells as-is.

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
- **Dynamite placing worm pose**: not copied (WA uses a generic place anim); the throw-grenade strip works as a stand-in.
- **Crate parachute**: no crate-with-parachute sprite exists in the rip (see crates section).
- **Team-colour variants**: source zip has colour-suffixed variants (b/g/r/y/p/c) for crosshair, arrows, markers; only red copied. Re-copy from source asset 13597 if needed.
- The full source zips (900+ sprites, 2,600+ voice files across 40+ soundbanks) are not vendored here — only the curated set. Re-download from the source URLs above for more.
