# Worms: Armistice — Game Design
A faithful-feeling replication of classic Worms (look, physics, humour) with one evolved axis: the game is **asynchronous turn-based** — designed to be played across hours or days, like correspondence chess. Short term it runs as local hotseat ("pass the device"); the architecture is network-shaped from day one.

## The core design problem
Classic Worms is real-time *within* each turn. Async play breaks three pillars, and each gets a deliberate answer:

### 1. The turn timer → the stamina budget
The 45-second clock is Worms' hidden skill mechanic: it forces rushed aim, panicked movement, misplaced dynamite. An async player may take an hour per turn, so a clock is meaningless — and without pressure every shot becomes a perfect snipe.

**Answer:** time pressure becomes **resource pressure**. Each turn grants a stamina budget (default 100). Walking drains ~6/sec, jumps cost 10, backflips 15. When stamina is empty the worm can still aim and fire, but not move. After firing, a **retreat reserve** (25 stamina, unusable before firing) unlocks — the async equivalent of the classic 5-second retreat.

Aiming remains free and precise, with **no trajectory preview** (classic rule). The game intentionally becomes more deliberate and chess-like: skill lives in reading wind, terrain and fuse timing, not clicking fast.

### 2. Missing the action → the replay is the game feed
In couch Worms you watch every enemy turn; async players miss everything between visits.

**Answer:** every turn is recorded as a **deterministic command stream**. On opening a game, the player watches a replay of all turns since their last visit (skippable, speed toggle). This is where the drama lives — your mate's dynamite backfiring at 2am plays back for you at breakfast. Replays cost nothing extra: they simply re-run the simulation with the recorded inputs.

### 3. Random integrity → seeded determinism
If the client rolls dice, an async player refreshes until the wind favours them.

**Answer:** all per-turn randomness derives from `turnSeed = hash(gameSeed, turnNumber)`: wind, crate drops and contents, terrain generation from `gameSeed`. Refreshing re-derives identical values. The server stores the command stream + a post-turn state hash, so networked play can later validate turns by re-simulation.

## Turn structure
1. **Turn opens** — replay of unseen turns, then: wind revealed (bar indicator), any seeded crate drop lands, active worm highlighted with camera pan.
2. **Move phase** — walk / jump / backflip within stamina. Taking any damage ends the turn immediately (classic rule).
3. **Attack** — open weapon panel, select, aim (crosshair rotates around worm), charge power, fire. One weapon use per turn; shotgun grants two shots.
4. **Retreat** — retreat stamina unlocks after firing.
5. **Resolution** — explosions, terrain craters, knockback, chain reactions (oil drums/mines later), fall damage, drowning. Sim runs until world is settled.
6. **End of turn** — sudden-death water rise (if active), commit: command stream + snapshot POSTed to the server; next player up. Hotseat inserts a "pass the device" screen here.

## Match rules
- 2–4 teams, 1–8 worms each (default: 2 teams × 4 worms, 100 HP).
- Worm rotation cycles through each team's living worms in order.
- **Sudden death** after round 10 (configurable): the water rises every turn and *accelerates* every round, and all worms wither 5 HP per turn (floored at 1 — the water or a weapon lands the kill). Guarantees an async game cannot zombie on.
- Win: last team with a living worm. Draw possible.

## Rules versioning (config.rules)
Gameplay rules added after launch are gated on `config.rules` so that older
games — whose command streams were recorded under the old rules — replay
identically forever. Games without a `rules` key are v1. **Rules v2** (all new
games) adds: per-team weapon memory between turns, health crates (35% of
drops, +25 HP), and pre-placed map hazards (armed mines + oil drums that
detonate when blasted or burned, spilling fire).

## Async meta layer (no accounts — links and this browser are the identity)
- **Turn notifications**: in-page Notification while the tab is hidden, plus
  web push (service worker + VAPID) with the tab closed. The committing client
  reports `next_position` (the server never simulates); the server pushes to
  that seat's subscriptions.
- **Taunts**: an optional one-liner attached to each committed turn, shown as
  a speech-bubble card while that turn's replay plays.
- **Turn cards**: after every replayed (and own) turn, a commentary line +
  damage summary derived by diffing worm HP across the turn.
- **End-of-game stats + rematch**: stats re-derived by re-simulating the
  recorded game; any seat holder can spin up a rematch (same teams/settings,
  fresh seed and worm names, current rules).
- **"Your games"** on the lobby: seats visited are remembered in
  localStorage; status (whose move) comes from `/api/games/{id}/status`.

## Weapons (v1)

| Weapon | Ammo | Notes |
|---|---|---|
| Bazooka | ∞ | Wind-affected rocket, 50 dmg max, classic arc |
| Grenade | ∞ | 1–5s fuse (selectable), bounces, not wind-affected |
| Cluster Bomb | 5 | Grenade that splits into 5 clusters |
| Shotgun | ∞ | Hitscan, 2 shots of 25, turn continues between shots |
| Fire Punch | ∞ | Melee uppercut, 30 dmg + strong upward knockback |
| Dynamite | 3 | Placed, 5s fuse, 75 dmg, huge knockback |
| Air Strike | 2 | 5 missiles from chosen direction, wind-affected, unusable in caves |
| Teleport | 2 | Click destination, ends turn |
| Skip Go | ∞ | Ends turn |

Crates may contain extra ammo of limited weapons (seeded).

## Physics feel targets (the "it feels like Worms" checklist)
- 60 Hz fixed-timestep sim; identical results on every machine (no `Math.random`, seeded PRNG only).
- Waddly slow walk; small forward jump arc; high backwards backflip.
- Projectiles: gravity-dominated arcs; bazooka pushed by wind each tick; grenades bounce with energy loss.
- Explosions: circular terrain subtraction, radial knockback with distance falloff, damage numbers float up.
- Fall damage above a velocity threshold; landing hard ends the turn.
- Water is instant death: plop, bubbles, worm gone.
- Wind affects bazooka and air strike only — never grenades (classic).

## Look and feel (procedural — mimic the style, no ripped assets)
- Side-view destructible **island terrain** over water: dark soil with texture noise, bright grass lip along the top edge, cavern pockets. Generated from `gameSeed`.
- Sky gradient, drifting parallax clouds, animated water with layered waves at the bottom of the world.
- **Worms**: pink, bean-shaped, big white eyes; team-coloured name + HP tag floating above; blink; look toward aim direction; gravestone on death; "oh no" wide-eyes when a projectile lands nearby.
- HUD: wind bar (top), team health bars totalised (bottom), floating damage numbers, weapon panel grid (right-click or button), vertical power-charge bar while charging, comic chunky font.
- Camera: follows active worm, pans to projectiles and explosions, edge-scroll and drag to look around, screen shake on big hits.

## Network evolution path (not built now, shaped for)
Local hotseat already commits turns through the same REST API a remote client would use. Later: accounts, seat claiming, turn notifications (email/push), server-side turn validation by re-running the deterministic sim in a worker, spectator mode from replay data. Nothing in the current data model changes.
