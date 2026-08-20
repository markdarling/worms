# Worms: Armistice
A faithful-feeling replication of classic Worms — the look, the physics, the humour — with one evolved axis: it's **asynchronous turn-based**, designed to be played across hours or days, like correspondence chess with explosions. No accounts, no installs: create a game, send each team their private link, and play whenever you like.

## How it plays
- **2–4 teams, 1–8 worms each**, on a destructible, procedurally generated island (several terrain archetypes and visual themes, seeded per game).
- **The full arsenal** — 37 weapons: bazooka, grenades, cluster, banana, holy hand grenade, shotgun, uzi, minigun, longbow, air strikes, napalm, mines, sheep, blowtorch, drill, girder, parachute, teleport, concrete donkey, armageddon and friends.
- **Stamina instead of a turn timer.** The 45-second clock doesn't work async, so time pressure becomes resource pressure: walking, jumping and backflipping drain a per-turn stamina budget, with a retreat reserve that unlocks after firing.
- **The replay is the game feed.** Every turn is recorded as a deterministic command stream. When you open a game, everything you missed plays back cinematically — dead air compressed, action at full pace — with commentary cards, damage summaries, and your opponent's taunt.
- **Sudden death** that actually ends games: from the configured round the water rises faster every round and every worm withers 5 HP a turn.
- **Map hazards, health crates and weapon memory** (rules v2 games), pre-placed armed mines and oil drums included.

## The async layer
- **Turn notifications**: in-page while the tab is open, real web push (service worker + VAPID) with the tab closed.
- **Taunts**: attach a one-liner to your shot; it appears during your opponent's replay.
- **Replay browser**: step through any game turn by turn, share deep links to any moment (`/games/{id}/replay/{turn}`).
- **Rematch + stats**: end-of-game per-team stats (damage, best turn, kills) re-derived by re-simulating the recorded game, and one-click rematch.
- **"Your games"** on the lobby: every seat you've opened in this browser, with live whose-move status. localStorage only — the links are the identity.

## Architecture in one paragraph
The entire simulation lives in the browser (`resources/js/engine/` — plain JavaScript, no framework) and is **strictly deterministic**: fixed 60 Hz timestep, all randomness from a seeded PRNG keyed by `hash(gameSeed, turnNumber)`, no `Math.random`, no `Date`. The Laravel backend (`app/`, SQLite) never simulates; it stores the config, the command stream per turn, a snapshot and a state hash — so a replay *is* the original turn, and any client can rebuild the whole game from the seed plus the recorded inputs. Gameplay rule changes are gated behind `config.rules` so old games replay identically forever.

## Getting started

```bash
composer run setup   # install, .env, key, migrate (SQLite), npm install + build
composer run dev     # serve + vite + queue in one terminal
```

Then open the lobby, create a game, and share the team links (each link IS that team's seat — the links page is guarded by an unguessable share key).

For closed-tab push notifications, generate VAPID keys and add them to `.env` (needs HTTPS in production):

```bash
php -r "require 'vendor/autoload.php'; print_r(Minishlink\WebPush\VAPID::createVapidKeys());"
```

```
VAPID_SUBJECT=mailto:you@example.com
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
```

## Tests

```bash
node resources/js/engine/selftest.js         # ~200 engine assertions — the ENGINE definition of done
node resources/js/engine/mapgen-selftest.js  # map generation invariants
php artisan test                             # backend
```

The engine selftest covers physics feel targets, every weapon, snapshot round-trips, and full-game lockstep determinism across the arsenal.

## Project layout

| Path | What lives there |
|---|---|
| `resources/js/engine/` | The deterministic sim: physics, weapons, terrain, mapgen, projectiles, fire, walkers |
| `resources/js/game/` | The client: renderer, camera, HUD, input recording, replays, notifications, turn cards |
| `app/`, `routes/`, `database/` | Laravel record-keeper: games, turns, seats, push subscriptions, admin panel |
| `docs/` | DESIGN.md (game design + async answers), ARCHITECTURE.md, WEAPONS.md, MAPGEN.md |

## Admin
`/admin` — first visit sets the password. Games listed by recent activity, plus an analytics tab (games and turns per day).

## Notes
- Desktop-only for now: game-facing pages show a friendly gate on mobile.
- Sound assets are ripped-sample stand-ins living in `public/assets/`; missing samples fail silently.
- The scale is tuned so authentic Worms Armageddon weapon values convert at roughly 0.39× WA pixels — see `docs/WEAPONS.md`.
