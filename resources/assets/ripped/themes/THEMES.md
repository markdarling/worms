# Terrain Themes
Seven extra W:A terrain themes ripped for the local-only POC, extracted 19/08/2026 from the same "WA Terrain" zip as Forest (The Spriters Resource, asset 124540 — see `../MANIFEST.md` for source rules; art copyright Team17, not for distribution). The Forest theme stays where it is (`../terrain-forest-*.png`, from the zip's `Terrain/Forest/` folder); everything here follows the identical naming/mapping, one folder per theme.

## File mapping (identical to the Forest extraction)

| Our name | Zip source file | Role |
|---|---|---|
| `terrain-{theme}-texture.png` | `text.png` | Tileable soil fill (draw where mask is solid), 256x256 |
| `terrain-{theme}-soil.png` | `soil.png` | Darker tileable under-soil/alternate fill, 256x256 |
| `terrain-{theme}-grass.png` | `grass.png` | Top-edge grass/edging strip, **black key** |
| `terrain-{theme}-back.png` | `back.png` | Distant backdrop silhouette layer, **black key** |
| `terrain-{theme}-gradient.png` | `gradient.png` | Sky gradient column — stretch horizontally |

All files verified as valid PNGs (type + dimensions via `file`/sips) and visually checked on a contact sheet. All are 8-bit palettised PNGs with no alpha — key pure black rgb(0,0,0) out of grass and back at load time, exactly as MANIFEST.md documents for the Forest files. texture/soil are full-bleed (no key needed). Gradients are opaque columns.

## Themes

| Theme | texture / soil | grass | back | gradient | Fill avg colour (texture / soil) | Look |
|---|---|---|---|---|---|---|
| desert | 256x256 / 256x256 | 136x64 | 640x160 | 8x916 | rgb(101,65,32) / rgb(36,20,2) | Dry stacked mud-brick soil, pale sand top edging; dusk red-brown sky |
| hell | 256x256 / 256x256 | 140x32 | 640x156 | 8x916 | rgb(216,138,45) / rgb(128,36,1) | Molten lava fill, glowing orange crust edging, dark red rock backdrop |
| snow | 256x256 / 256x256 | 140x32 | 640x157 | 8x900 | rgb(218,226,251) / rgb(106,106,184) | Packed snow fill, blue-ice under-soil, snow-drift lip, night-blue mountains |
| cheese | 256x256 / 256x256 | 136x16 | 640x152 | 8x916 | rgb(195,146,31) / rgb(69,38,4) | Holey yellow cheese fill (the classic), rind edging, cheese-moon backdrop |
| manhattan | 256x256 / 256x256 | 136x16 | 640x158 | 8x916 | rgb(67,75,86) / rgb(22,25,48) | Blue-grey pipework/concrete fill, pale concrete kerb edge, skyline backdrop |
| jungle | 256x256 / 256x256 | 136x64 | 640x156 | 8x916 | rgb(115,111,113) / rgb(14,14,13) | Mossy stone-cobbles fill, leafy vine edging, lush undergrowth backdrop |
| tools | 256x256 / 256x256 | 136x16 | 640x160 | 8x916 | rgb(86,57,17) / rgb(35,11,4) | Pegboard/cork fill with hooks, workbench-shelf backdrop cluttered with tools |

## Renderer notes
- **Grass strip heights differ from Forest** (Forest is 144x16). cheese/manhattan/tools are 16px like Forest; hell/snow are 32px; desert/jungle are 64px (taller edging art — treat the whole height as the depth-indexed band, i.e. the bake's `2 + depth*2` row lookup and 64px tile width need to become per-theme parameters; see `docs/MAPGEN.md` §4.2).
- Manhattan's grass strip is a solid concrete kerb (only ~5% black) — it has almost no keyed gaps, so the bake's "black gap pixel → darkened soil" branch will rarely fire there. Desert/jungle strips are ~55% black key (sparse tufts/vines).
- Hell/snow have strongly non-green edging; the bake's procedural green fallback colours and the hardcoded brown outline rgb(42,26,16) will look wrong for them — theme the outline colour.
- Gradient quirks: snow's gradient is 8x900 (not 916). Several themes (hell, cheese, manhattan, tools) share the same night gradient (dark blue rgb(36,42,74) top → warm brown rgb(46,24,2) horizon); desert's runs dusk-green to deep red.

## Missing pieces / gaps
- **No water tint art** in the pack — W:A water colour is engine-side. Pick per-theme tints in code (suggestions in MAPGEN.md §4.2).
- **Debris + bridges + decorative objects not copied** (every theme in the zip also has `debris.png`, `bridge.png`/`bridge-l.png`/`bridge-r.png` and 5–20 decorative object sprites — cactus/skull/taxicab/snowman/etc.). Re-extract from the zip in scratchpad or re-download (source URL in MANIFEST.md) if map dressing is ever wanted.
- The zip holds **29 themes total**; 21 more are available (Beach, Farm, Space, Pirate, Medieval, Dungeon, Music, Sports, Time, Tribal, Urban, Gulf, Hospital, Easter, Art, Construction, Fruit, Tentacle, plus dash-prefixed `-Beach/-Desert/-Farm/-Forest/-Hell` variants with alternate art). Note the dash-prefixed `-Desert`/`-Hell` are *different art* from the `Desert`/`Hell` used here (ours match the non-dash `Forest` set already in use).
- **Hedgewars (GPL) art** could fill anything genuinely absent — it ships full themes (LandTex + border/grass + sky + flakes) e.g. Nature, Hell, Snow, Cave, Fruit under GPL at hedgewars/hw `share/hedgewars/Data/Themes/`. Pointer only; not downloaded. GPL art is redistributable where the ripped Team17 art is not, so it would also be the swap-in path if this POC ever stopped being private.
