# Architecture Contract
This document is the binding contract between the three build tracks (backend, engine, presentation). Build **exactly against these interfaces** — the integration layer (`main.js`, `input.js`, `replay.js`) is written against this contract, not against your implementation.

Plain modern JavaScript (ES modules), no frameworks, no TypeScript. Laravel 12 + Vite. No external JS runtime dependencies.

## File ownership

```
app/, database/, routes/, resources/views/        → BACKEND track
resources/js/engine/                              → ENGINE track
resources/js/game/renderer.js, sprites.js,
  camera.js, hud.js, resources/css/game.css       → PRESENTATION track
resources/js/game/main.js, input.js, replay.js,
  api.js                                          → INTEGRATION (do not create/edit)
```

No track edits files outside its ownership. `vite.config.js` inputs: `resources/js/game/main.js`, `resources/css/game.css` (integration owns this edit; backend track should reference `@vite(['resources/css/game.css', 'resources/js/game/main.js'])` in the game view).

## Coordinate system & units
- World pixels; origin top-left, +y down. World size from config (default 2400×900). Water surface at `state.waterLevel` (y px, rises in sudden death).
- Sim runs at fixed `TICK_HZ = 60`. One `sim.step(input)` = 1 tick. Renderer may interpolate but the sim is the single source of truth.

## ENGINE track — `resources/js/engine/`

### `rng.js`
```js
export function makeRng(seed)        // mulberry32; returns () => float [0,1)
export function hashSeed(...ints)    // deterministic int hash combiner
```

### `constants.js`
All tunables: gravity, walk speed, jump velocities, stamina costs, weapon stats table, explosion radii/damage, fall damage threshold, TICK_HZ, world defaults. Single object export `C`.

### `terrain.js`
```js
export class Terrain {
  static generate(seed, width, height)   // island-style destructible map
  solid(x, y)                            // bool, world px (ints)
  destroy(cx, cy, r)                     // carve circle, returns nothing
  serialize()                            // {width, height, data: base64-RLE string}
  static deserialize(obj)
  width; height;
  version;                               // int, incremented on every destroy() — renderer watches this
  dirtyRects;                            // array of {x,y,w,h} since last consumed; renderer may clear it
}
```
Internally a `Uint8Array(width*height)`, 1 = solid. Generation: seeded value-noise island with overhangs and a guaranteed navigable top surface; grass/soil distinction is presentation's job (renderer reads the bitmap).

### `commands.js`
Input for one tick is a plain object:
```js
{ left, right, jump, backflip, aimUp, aimDown, charge, fire, weapon /* string|null: select weapon */, fuse /* 1-5|null */, target /* {x,y}|null for teleport/airstrike */ }
```
Booleans default false. `encodeCommands(tickInputs[]) -> compact JSON-able` (RLE runs of identical inputs), `decodeCommands(encoded) -> tickInputs[]`. Round-trip must be lossless.

### `worm.js`, `physics.js`, `projectiles.js`, `weapons.js`
Internal to the engine — shape is the engine track's choice, but weapons/stats must match DESIGN.md. Weapon ids: `bazooka, grenade, cluster, shotgun, firepunch, dynamite, airstrike, teleport, skip`.

### `sim.js` — the heart
```js
export class Sim {
  static newGame(config) -> Sim
  // config: { seed, width, height, teams: [{name, color, worms: [names]}],
  //           wormHp, stamina, suddenDeathRound, ... } (defaults from C)

  static fromSnapshot(config, snapshot) -> Sim

  beginTurn(turnNumber)   // derives turnSeed = hashSeed(config.seed, turnNumber);
                          // sets wind [-1..1], resolves crate drop, activates next living worm
  step(input)             // advance one tick with a commands.js input object
  snapshot()              // JSON-able: terrain.serialize() + worms + ammo + turnNumber + waterLevel + rngState-free (all randomness is per-turn derived)
  stateHash()             // deterministic string hash of snapshot for validation

  // read-only accessors
  state   // { worms: [{id, teamIndex, name, hp, x, y, facing, aimAngle, alive, ...}],
          //   projectiles: [...], wind, waterLevel, turnNumber, round,
          //   activeWormId, stamina, retreatStamina, selectedWeapon, ammo: {teamIndex: {weapon: n}},
          //   power (0-1 while charging), suddenDeath: bool }
  phase   // 'move' | 'retreat' | 'resolving' | 'turn-over' | 'game-over'
  winner  // null | teamIndex | 'draw'   (valid when phase === 'game-over')
  drainEvents() -> Event[]   // clears and returns queue
}
```

**Phases:** `move` (pre-fire; movement + aim + fire accepted) → `retreat` (post-fire movement only; also entered mid-shotgun) → `resolving` (projectiles in flight / world settling; inputs ignored) → `turn-over` (turn done; caller calls `beginTurn(n+1)`) → `game-over`. Damage taken during `move` jumps straight to `resolving` → `turn-over` (classic rule). The sim itself decides transitions; the caller just steps and reads `phase`.

**Determinism rule:** no `Math.random`, no `Date`, no iteration over object keys where order affects outcomes. All randomness from `makeRng(turnSeed)` created in `beginTurn`.

### Events (renderer contract)
Each `{type, ...}` — emitted, never re-emitted:
`explosion {x, y, r, strength}`, `damage {wormId, amount, x, y}`, `wormDied {wormId, x, y}`, `splash {x, y}`, `fire {weapon, x, y, angle, power}`, `bounce {x, y}`, `crateLanded {x, y, contents}`, `crateCollected {wormId, contents}`, `fallDamage {wormId, amount}`, `turnStart {wormId, wind}`, `suddenDeath {}`, `waterRise {level}`, `wormTalk {wormId, kind}` (kind: 'ohno'|'laugh'|'grave').

## PRESENTATION track — `resources/js/game/`

### `sprites.js`
Procedural sprite factory (offscreen canvases, no image assets): worm body (pink bean, eyes, facing/aim variants or parameterised draw fn), gravestone, crate, dynamite, mine, bazooka shell, grenade, cluster, explosion ring, weapon panel icons (one per weapon id), water tile, cloud shapes. Export drawing functions or cached canvases — presentation's choice, used only by renderer/hud.

### `camera.js`
```js
export class Camera {
  constructor(viewW, viewH, worldW, worldH)
  follow(x, y)         // smooth pan target
  shake(strength)
  nudge(dx, dy)        // manual pan (drag / edge scroll), suspends follow briefly
  update(dt)
  apply(ctx) / worldToScreen(x,y) / screenToWorld(x,y)
  zoom                 // supported but default 1
}
```

### `renderer.js`
```js
export class Renderer {
  constructor(canvas, sim, camera)
  handleEvents(events)   // consume sim.drainEvents() output: spawn particles, damage numbers, shake, talk bubbles
  render(dt)             // full frame: sky, clouds, terrain (cached layer, re-blit dirtyRects on terrain.version change), water, crates, worms (name+hp tags, aim crosshair for active worm), projectiles, particles, fx
}
```
Terrain rendering: on first draw, bake the bitmap into a coloured layer (soil texture + grass lip along upward-facing edges + darker outline). On `terrain.version` change, re-bake only `dirtyRects`.

### `hud.js`
```js
export class Hud {
  constructor(rootEl, callbacks)
  // callbacks: { onWeaponSelect(id), onFuseSelect(1-5), onSkip() }
  update(simState, phase)   // wind bar, stamina bar, team health totals, ammo counts, selected weapon, power bar while charging, turn banner, replay banner controls
  showPassDevice(playerName, onReady)   // hotseat interstitial overlay
  showGameOver(winnerName)
  setReplayMode(on, {onSkip, onSpeed})
}
```
HUD is DOM (divs over the canvas), styled by `game.css`. Weapon panel is a grid overlay listing all weapon ids with icons from sprites.js and ammo counts.

### `game.css`
Full styling: canvas layout (fills viewport), HUD, weapon panel, overlays, chunky game font (system font stack styled appropriately or bundled open font via CSS), lobby page classes (`.lobby-*` — backend's Blade views will use these class names, coordinate via BEM-ish naming: `.lobby`, `.lobby-card`, `.lobby-form`, `.lobby-games-list`).

## BACKEND track — Laravel

SQLite (default Laravel 12 setup). No auth for v1 (hotseat).

### Migrations / models
```
games:   id, name, seed (unsigned int), config (json), status (enum: active|finished),
         current_turn (int, default 1), snapshot (json, nullable), winner (string, nullable), timestamps
players: id, game_id FK, name, color (string hex), position (int 0-based), timestamps
turns:   id, game_id FK, number (int), player_position (int), commands (json),
         snapshot_after (json), state_hash (string), created_at
unique(game_id, number)
```
Models: `Game` (hasMany players ordered by position, hasMany turns ordered by number), `Player`, `Turn`. Casts for json columns.

### Routes & controllers
Web (`routes/web.php`):
- `GET /` → LobbyController@index — lobby: new-game form (game name, per-team name+colour for 2–4 teams, worms per team 1–8, world size preset, sudden death round) + list of games (status, turn count, continue/view links). Blade views `lobby.blade.php`, layout `layouts/app.blade.php`.
- `POST /games` → GameController@store — validates, creates Game (random seed via `random_int`, config json assembled to match Sim config shape incl. teams array), creates Players; redirect to game page.
- `GET /games/{game}` → GameController@show — renders `game.blade.php`: full-viewport canvas + HUD root div + `<script>window.GAME_ID = {id}</script>` + `@vite(['resources/css/game.css','resources/js/game/main.js'])`.

API (`routes/web.php` under `/api` prefix is fine, or routes/api if wired; same-origin, CSRF: exclude `/api/*` or send the token — backend picks and documents in a comment):
- `GET /api/games/{game}` → JSON `{ id, name, status, winner, config, current_turn, snapshot, players: [{name,color,position}], turns: [{number, player_position, commands}] }` (turns ordered; omit snapshot_after in list for payload size, include `snapshot` = latest turn's snapshot_after or null).
- `GET /api/games/{game}/turns?after=N` → turns with number > N (same shape), for incremental replay fetch.
- `POST /api/games/{game}/turns` body `{number, commands, snapshot_after, state_hash, player_position, game_over: bool|null, winner: string|null}` → 409 if number ≠ current_turn or game finished; stores turn, sets game.snapshot = snapshot_after, increments current_turn; if game_over, set status/winner. Returns `{ok: true, current_turn}`.

Server does NOT simulate in v1 — it trusts the client and stores the deterministic record (validation worker is the documented future path).

## INTEGRATION layer (pre-written against this contract — do not modify)
`api.js` (fetch wrappers), `input.js` (keyboard/mouse → per-tick command objects + recording), `replay.js` (feed recorded commands into a fresh Sim at 1×/2×/4×), `main.js` (boot: fetch game → build Sim from snapshot or newGame → replay unseen turns → hotseat loop: pass-device → beginTurn → run ticks from input → phase turn-over → encode + POST → next). Fixed-timestep accumulator loop; render each animation frame.

### Keybindings (input.js implements; hud.js should display a help hint)
←/→ walk · ↵ jump · ⌫ backflip · ↑/↓ aim · Space hold = charge, release = fire · 1-5 fuse · Tab/right-click weapon panel · click = target (teleport/airstrike) · mouse drag / edges = pan camera.
