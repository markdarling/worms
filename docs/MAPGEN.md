# Map Generation v2 — Spec
Deterministic upgrade to `resources/js/engine/terrain.js` (archetypes + reachability) and the renderer theme pipeline. Written 19/08/2026 from research into Hedgewars' land generator, W:A's own random-level system, and general 2D destructible-terrain PCG. No code here — implementable spec only.

## 1. Prior Art (what the good generators actually do)

### Hedgewars (GPL, the gold standard)
Verified from source: `rust/landgen/src/outline_template_based/` in the hedgewars/hw repo (`outline.rs`, `template_based.rs`, `outline_template.rs`) and `share/hedgewars/Data/map_templates.yaml`.

1. **Templates are hand-authored polygons whose vertices are rectangles.** Each template (~40 ship in `map_templates.yaml`) stores per-island point lists like `{x: 952, y: 528, w: 610, h: 300}` — the actual vertex is a uniform random point inside that rect. One template therefore yields endless variants while guaranteeing the gross shape (two towers, one arch, archipelago…). Templates carry flags: `can_mirror`, `can_flip`, `is_negative` (cavern: solid/empty inverted), `can_invert`, plus `fill_points` (seed points known to be inside the empty region) and optional invisible `walls` polygons that constrain distortion.
2. **Random mirror/flip** of all points (2 coin flips) — 4 looks per template for free.
3. **Edge distortion by recursive normal displacement.** Repeatedly: for every polygon edge, take the midpoint and push it along the edge normal by a random signed distance. The distance is bounded by (a) distance to the map border, (b) distance to the nearest *other* segment or point along that normal (computed with ray intersections — this is what prevents self-intersection), and (c) `edge_length * 128 / distortion_limiting_factor` where the limiting factor is randomised per map in `100..170` (spikiness dial). Edges shorter than `3 * distance_divisor` stop dividing. Loop until no edge divides — fractal detail with a structural guarantee.
4. **Bezierize** the final polyline (5 segments per curve) to smooth the jaggies.
5. **Rasterize + flood fill**: draw outline, flood-fill from `fill_points`, redraw outline. `is_negative` swaps solid/empty for roofed cavern maps.

Key insight for us: **authored macro-shape + randomised micro-detail, with distortion bounded so the topology never changes.** Reachability is mostly implied by the template (its author knows the two towers are jump-connected); Hedgehogs also all get girders and ropes, so Hedgewars can afford disconnection we cannot.

### Worms Armageddon itself
worms2d.info is behind an anti-bot wall; from community sources (Worms wiki, wkTerrainSync/MapGEN docs, Team17 forum archive): W:A's random landscape generator also works from a library of stock landscape *shapes* (per amount-of-land setting), textures the chosen silhouette with the theme's `text.png`/`grass.png` art, sprinkles theme objects, and picks a random theme per random map. Its object/worm placer scans for standable ground and **refuses to place worms/mines/barrels too close to another worm; if it cannot fit everything it falls back to manual (teleport-in) placement**. It does not guarantee walk-connectivity — random W:A maps famously strand worms on islets, which the community tolerates because of ninja rope/teleport. Since our POC has a much thinner utility set, we must be stricter than W:A.

### Others
- **Bamboy360 "Worms Style Procedural Level Generation"**: scatter points on a tiny grid (40x20) → Prim's MST to connect them (guaranteed connected skeleton!) → Bresenham lines → probabilistic growth → upscale ×10–30 → contour trace → Chaikin smoothing → flood fill. The MST-skeleton idea is the cheapest connectivity-by-construction trick in the literature and we adopt it for the Floating Chunks archetype.
- **Julian Fietkau, "Generating Worms-style Terrain with Simplex Noise"**: threshold 2D noise biased by a vertical gradient (solid at bottom, air on top); good texture, no topology control — same weakness our current generator has.
- **Warmux/OpenLiero/WebLiero**: Warmux ships hand-made maps only; Liero-family fills the whole frame with material (cavern by construction) so connectivity is trivially diggable. Nothing further to steal.

Conclusion: keep our cheap raster primitives (they are fine), add **archetype recipes** (the template idea, parameterised instead of hand-drawn polygons, plus one true polygon-blob primitive), and add an **explicit post-hoc reachability pass** — the thing none of the originals needed but we do.

## 2. Archetypes

### 2.1 Primitives (existing + 2 new)
Existing in `Terrain.generate`: surface synthesis (base line + 4 sinusoid octaves + 2 value-noise octaves, `drama` factor, edge taper), seabed line, sea-channel carving, pocket/ellipse carving, tunnel random-walks, additive lumps, floating ellipse islands.

New primitives to add:

- **`blob(seed, cx, cy, rBase, verts, rough)`** — Hedgewars-lite distorted polygon, additive or subtractive. Build a `verts`-gon (8–14) around `(cx, cy)` with per-vertex radius `rBase * (0.6 + rng()*0.8)`. Then 3 rounds of midpoint subdivision: new point = edge midpoint displaced along the edge normal by `(rng()-0.5) * edgeLen * rough`, `rough` halving per round, displacement clamped to `min(edgeLen*0.45, rBase*0.35)` (the clamp is our cheap substitute for Hedgewars' full intersection test — at ≤0.45 of edge length a convex-ish polygon cannot self-intersect badly enough to matter on a raster). Rasterize by scanline even-odd fill. This replaces "elliptical everything" and is what makes islands look hand-drawn.
- **`roof(seed)`** — cavern ceiling: fill rows `0..roofY(x)` solid where `roofY(x)` is an independent surface-synthesis line mirrored downward (base `height*0.16`, own octaves), then join to side walls (fill `x < wallW(y)` and `x > width-1-wallW(y)`, `wallW` noise-wobbled 40–90px). Gives the closed W:A cavern look.

All primitives keep the existing pattern: every random stream is `makeRng(hashSeed(seed, TAG))` with a distinct constant `TAG`, consumed in a fixed order.

### 2.2 The recipes
Archetype is picked before anything else: `pick = makeRng(hashSeed(seed, 0xA0C1))()` against a cumulative weight table. Weights chosen so the classic looks dominate but every session sees variety.

| # | Archetype | Weight | Recipe (parameter deltas from current generator) |
|---|---|---|---|
| 1 | **Archipelago** | 0.26 | Current behaviour, formalised: channels = 1–2 always (never 0), drama 0.85–1.3, pockets 10–16, tunnels 1–3, floating islands 0–2. |
| 2 | **Single Island** | 0.20 | Channels = 0. Widen edge taper margin to `width*0.16`. drama 0.7–1.1, pockets 12–18 (interior interest instead of sea gaps), lumps 7–10. |
| 3 | **Highlands** | 0.16 | baseY `height*0.34`, drama 1.3–1.7, noise octave A amp ×1.5. Channels = 0–1. Tunnels 3–5 (cave-riddled massif), wide-ellipse pocket bias 0.7. |
| 4 | **Cavern** | 0.14 | Single Island base with baseY `height*0.30`, then `roof(seed)` + side walls. No floating islands. Tunnels 4–6 seeded *between* floor and roof so interior connects. Sky gradient still drawn but mostly hidden; renderer unchanged. |
| 5 | **Floating Chunks** | 0.13 | No surface fill at all. Place 5–8 `blob` islands: pick centres by rejection-free jittered grid (3–4 columns × 2 rows in the play box, jitter ±25%), rBase 70–140px top row, 90–170px bottom row. Connect the chunk graph with an MST (Prim over centre distances, deterministic tie-break by index) and thicken each MST edge into a 26–34px-wide bridge strip of overlapping solid circles — connectivity by construction (Bamboy trick). |
| 6 | **Twin Peaks** | 0.11 | Two-lobe surface: base line is `baseY + peak(x, p1) + peak(x, p2)` where `peak` is a raised-cosine of height `height*(0.28..0.4)` and half-width `width*(0.12..0.18)` centred at `width*0.28±0.06` and `width*0.72±0.06`; valley floor near `height*0.62`. One optional channel dead-centre (p=0.4). Tunnels 1–2 per peak. |

Post-recipe, all archetypes run the same finishing passes in fixed order: lumps → floating islands (where allowed) → **reachability pass (§3)** → done.

Determinism note: archetypes must not share rng streams. Tag layout suggestion: `0xA0C1` archetype pick, `0x7e44+arch` main stream, blobs `hashSeed(seed, 0xB10B + i)`, roof `0x400F`, MST bridges `0xB41D`. Never reuse a tag.

## 3. Reachability Guarantee

### 3.1 Standability + connectivity model
Run after generation, before spawn selection, on the raw bitmap. Budget target ≤ 15ms for 2400×900 (measured primitives: one full-bitmap column scan is ~2.2M cell reads — trivially <10ms in JS).

1. **Standable spots.** Reuse the exact predicate of `findSpawnSpots` (physics.js — body clearance + headroom + above water) but at column step **8px** (it uses 12 today; 8 gives the graph enough resolution). Record spots as `{x, y, col: x>>3}`. Multiple spots per column allowed (ledges under overhangs).
2. **Jump-reach adjacency.** Engine numbers: `JUMP_VX 60`, `JUMP_VY -140`, apex ≈ 28px ⇒ full-jump horizontal range ≈ 48px, and any drop is survivable (no fall damage cap concerns for spawn logic). Connect spots `a, b` with an undirected edge when `|a.x - b.x| ≤ 24` **and** `|a.y - b.y| ≤ 30` (walk/hop), **or** `|a.x - b.x| ≤ 48` and `b.y - a.y ≥ -30` treated symmetrically (jump across small gaps). This is a deliberate *under*-approximation of true reach (one-way drops are ignored); an under-approximation can only make us stricter, never strand a worm.
3. **Regions.** Union-find over spots (deterministic order: sort by x then y — the scan already produces that order). O(n α(n)), n ≈ 300–900 spots.
4. **Verdict.** Let `R1` = largest region, `need` = total worms. Map is *healthy* when `R1.count ≥ max(need * 4, 0.55 * totalSpots)`. The 0.55 fraction stops "two big halves" maps from putting everyone on one side — for Archipelago/Twin Peaks, *instead* accept the top `k ≤ 3` regions each having `≥ need` spots and spanning ≥ 20% of playfield width (islands are legitimate there; every island just has to be big enough to host a full rotation of worms).

### 3.2 Placement rules
Replace the pick logic in `Sim.newGame` (sim.js) — `findSpawnSpots` stays, filtered:

- **Eligible spots** = spots in accepted regions only. Sealed pockets and micro-islands are simply never in an accepted region.
- **Minimum spacing 60px** (W:A behaviour: nothing spawns near a worm). Greedy: iterate the deterministic shuffled order (existing `hashSeed(seed, 0x51ed)` stream), skip any spot within 60px euclidean of an already-chosen one; if a full pass can't seat everyone, halve the spacing and repeat (30, then 15, then 0 — bounded, deterministic).
- **Team interleaving.** Sort chosen spots by x; deal them round-robin by team (`t = i % teams`) *then* shuffle assignment within each team with the existing stream. No team gets clumped in one corner, and no team deterministically owns the left edge.
- Keep the existing "too few spots" throw as the final backstop, but §3.3 should make it unreachable.

### 3.3 Repair strategy (degenerate seeds)
Deterministic, bounded, cheap — in order:

1. **Ramp carve (attempt once).** If verdict failed because regions 1 and 2 are individually fine but the fraction test failed: find the closest pair of spots `(a ∈ R1, b ∈ R2)` (n² over ≤ a few hundred border spots is fine, or grid-bucket it), carve a walkable ramp: overlapping `destroy`-style circles r=12 stepped 8px along the straight line a→b, clamped to slope ≤ 45° by inserting horizontal dog-legs (walk the line in x-major steps, limit `|dy| ≤ dx`). Also *add* a 6px floor strip under the carved line where it crosses air/water gaps ≤ 90px wide (a causeway). Re-run §3.1.
2. **Deterministic re-roll (≤ 3 attempts).** Regenerate everything with `Terrain.generate(hashSeed(seed, 0x5EED0 + attempt), w, h)` — same archetype table, new streams. The sim's other consumers still use the original `seed`, so nothing else shifts. Store nothing: the same original seed always walks the same attempt chain, so replays/netplay stay in sync.
3. **Plateau fallback.** Existing centre-plateau fill, kept as-is (now also gets the spawn pass, which trivially passes).

Perf: worst case = 4 generations + 4 reachability passes ≈ 4 × (gen ~8ms + pass ~12ms) ≈ 80ms once at game start — acceptable; typical case one pass, <25ms, inside the 50ms budget.

## 4. Themes

### 4.1 Assets
Ripped W:A theme art lives in `resources/assets/ripped/themes/{name}/` (see `themes/THEMES.md`): 7 new themes (desert, hell, snow, cheese, manhattan, jungle, tools) + the existing Forest set in `ripped/` root. Per theme, five files matching the Forest naming: `terrain-{name}-texture.png` (256×256 tileable fill), `-soil.png` (256×256 dark under-soil), `-grass.png` (top-edge strip, black-keyed, heights vary 16–64px), `-back.png` (~640×160 backdrop silhouette, black-keyed), `-gradient.png` (8×900–916 sky gradient).

### 4.2 Theme model
A theme is data, not code — one registry object in `sprites.js`:

```js
const THEMES = {
  forest:    { dir: null, grassTileW: 64, grassRows: 16, waterTint: 'rgba(24,68,140,0.95)', outline: [42,26,16] },
  desert:    { dir: 'themes/desert', grassTileW: 64, grassRows: 64, waterTint: 'rgba(20,90,130,0.95)', outline: [60,32,10] },
  // … hell, snow, cheese, manhattan, jungle, tools
};
```

- `dir` resolves the five files (`null` = legacy flat forest files); the four sprite-table entries `terrainSoil/terrainGrass/skyGradient/backdrop` become theme-parameterised loads instead of hardcoded `terrain-forest-*` names (sprites.js lines 57–60 today).
- `grassTileW`/`grassRows`: the bake step currently hardcodes `GRASS_TILE_W = 64` and samples grass row `2 + depth*2` (renderer.js `_bakeRect`) — both become theme fields, because strips differ (desert/jungle grass is 136×64, hell/snow 140×32, cheese/manhattan/tools 136×16).
- `outline`: the 2px dark edge colour, currently hardcoded `(42,26,16)` brown — per theme (snow wants slate blue, hell near-black red).
- `waterTint`: replaces the `WATER_BACK`/`WATER_FRONT` colour constants; front layers derive from the tint by fixed alpha/lightness offsets.
- Fallback rule: any missing/unloadable file falls back to the procedural colours already in `_bakeRect` — themes can ship partial.

### 4.3 Selection + bake integration
- **Selection:** `config.theme` (user pick from lobby) wins; otherwise `themeNames[hashSeed(seed, 0x7EE3) % themeNames.length]` with `themeNames` sorted alphabetically (stable across builds). Optional nicety: bias by archetype (Cavern → hell/dungeon-ish, Floating Chunks → cheese/space-ish) via a per-archetype candidate list, same hash.
- **Determinism:** theme is presentation-only. It must not touch the sim: no sim rng consumption, nothing in snapshots except the `theme` string in config (needed so replays render identically). The bake (`_syncTerrain`/`_bakeRect`) already only reads the bitmap + textures, so swapping textures is safe; dirty-rect rebakes and scorch blending work unchanged.
- Backdrop draw and sky gradient code paths need zero changes beyond sourcing the theme's images (`getBackdropImage`, `skyGradient`).

## 5. Determinism + Performance Notes for the Implementer
- **RNG discipline is the whole game.** Only `makeRng(hashSeed(seed, TAG))`; unique TAG per stream (keep a comment-table of used tags at the top of terrain.js); consume in source order; never branch on float equality; never call a stream inside a conditional whose predicate depends on another stream's *later* values. `Math.random`, `Date`, iteration over object keys: forbidden in engine code.
- **Cross-engine floats:** keep using `dsin` (the deterministic sine table) for anything angle-shaped; `Math.sqrt`/basic arithmetic are IEEE-exact and fine; avoid `Math.pow` with non-integer exponents and any `Math.sin/cos/atan2` in generation.
- **Serialization unchanged:** archetypes only write the same Uint8Array; RLE round-trip, `destroy`, dirty rects untouched. Snapshot compatibility is automatic.
- **Perf budget (2400×900):** surface synthesis ~2.2M cell writes ≈ 5–8ms; blobs/roof are bounded-area rasters, ≈1–2ms each; reachability pass ≈ 12ms (one column scan + union-find over <1k spots); worst-case repair chain ≈ 80ms one-off at `newGame`. Nothing per-frame changes. Bake cost is unchanged (theme swap is a texture pointer swap).
- **Testing hooks:** `selftest.js` should add (a) golden hashes of `serialize().data` for a fixed seed per archetype, (b) an assertion sweep of ~200 seeds × verdict-must-pass-after-repair, (c) spot-spacing and team-interleave invariants. Any intentional generator change re-goldens (a) — that is the point of the goldens.

## 6. Sources
- Hedgewars source: `hedgewars/hw` GitHub mirror — `rust/landgen/src/outline_template_based/{outline.rs,template_based.rs,outline_template.rs}`, `share/hedgewars/Data/map_templates.yaml`
- Bamboy360, "Worms Style Procedural Level Generation" — https://bamboy360.com/blog/worms_level_generation/
- Julian Fietkau, "Generating Worms-style Terrain with Simplex Noise" — https://fietkau.blog/2023/generating_terrain_simplex_noise
- Worms wiki "Random Landscape Generator", wkTerrainSync/MapGEN (nizikawa-worms), Team17 forum archive on worm placement; worms2d.info (anti-bot walled at research time, community claims cross-checked against the above)
