# Gameplay quality and verification

## Reference direction

Team17's [Worms Armageddon Anniversary Edition](https://www.team17.com/games/worms-armageddon-anniversary-edition) emphasizes turn-based battles and a varied arsenal. [Worms W.M.D](https://www.team17.com/games/worms-w-m-d/) emphasizes readable 2D art, classic weapons, and additional tactical systems. The [W.M.D mobile release](https://www.team17.com/news/worms-w-md-mobilize-out-now-on-apple-android) demonstrates the series' suitability for touch and solo play.

This implementation keeps Armistice's asynchronous stamina system. It does not attempt to claim feature parity with those games.

## This iteration

- Solo creation: first team is human; remaining teams are computer-controlled. Normal and Hard vary shot search density. Online and pass-and-play remain available.
- Computer candidates are rehearsed in the actual simulation inside a module worker. Candidate scoring rewards enemy damage and kills, penalizes friendly fire, and conserves airstrikes. The expanded tactical planner considers ranged, thrown, melee, planted and aerial weapons plus defensive teleportation. It evaluates short movement and retreat routes; it does not plan rope traversal or use every weapon. No physics or replay rules changed.
- Computer turns are ordinary recorded commands. The human seat authorizes saving both sides' turns; anonymous viewers cannot drive a solo game. The host browser must be open for computer turns.
- Touch movement, jump, flip, aim and charge/release firing; drag to pan, zoom and follow buttons; existing tap-to-target weapons and fuse selection. Pointer cancellation clears controls. Layouts account for safe areas and phone orientations.
- Animation callers now convert milliseconds to seconds, matching the renderer contract.
- Failed saves retain the finished turn in memory and expose retry. Keep the page open until the save succeeds.

## Repeatable checks

```sh
node resources/js/engine/selftest.js
node resources/js/engine/mapgen-selftest.js
node resources/js/engine/computer-selftest.js
npm run build
php artisan test
```

Real-device Safari/Android testing, performance profiling on low-end phones, more tactical AI movement and weapons, accessibility review, and extended multiplayer soak testing remain necessary before making a premium-release quality claim. “Perfect” or “AAA” cannot be established by automated checks alone.

Browser regression checks (isolated test database only; they create games):

```sh
npx playwright install --with-deps chromium
BASE_URL=http://127.0.0.1:8000 npm run test:browser
```

The browser check covers 1440×900 desktop, 390×844 portrait touch, and 844×390 landscape touch: creation, a human/computer turn pair, reload, a charged shot, and a simulated save failure with successful retry. Screenshots go into a temporary directory. This is Chromium emulation, not a substitute for real-device testing.

## Results for this iteration

- Production Vite build passed, including the module worker.
- Existing engine checks: 198 passed; map generation checks: 24 passed.
- Computer tests passed on three maps at both difficulty levels, including command encoding/replay equality and an exposed-target damage check.
- Backend: 29 tests, 164 assertions passed.
- Chromium browser checks passed in all three viewport sizes, including real emulated touch events and save retry.
- Browser testing exposed and resolved missing asset-base imports and a worker message race during asynchronous engine initialization.
- The optional, absent hallelujah sound still generates a harmless 404; no replacement audio was invented.
- Deployed on 2026-09-07 to https://ai.markdarling.com/worms/ after user approval. Previous image retained as `worms-web:rollback-20260907`; a consistent pre-deployment SQLite backup is at `/tmp/worms-predeploy-20260907.sqlite`.

## Live solo turn presentation (2026-09-08)

Solo now introduces the active computer worm on camera for at least 1.4 seconds while planning, then keeps its selected weapon visible for 650ms before continuing normal-speed commands. A compact LIVE · CPU panel shows thinking, aiming, charging, and attack resolution. Solo no longer mounts the replay button or post-turn commentary cards; asynchronous multiplayer retains its replay flow. These presentation pauses do not step the world or add commands to the recording.

`node resources/js/game/computer-playback-selftest.js` verifies pacing and unchanged command recording. Browser regression coverage also requires visible thinking/aiming stages and verifies the absence of replay framing in solo.

The live solo presentation passed desktop, portrait-touch, and landscape-touch browser checks, including saving/reloading and failed-save recovery. Deployed on 2026-09-08; public HTTPS page and updated JavaScript/CSS verified. Rollback image: `worms-web:rollback-20260908`; pre-deployment database backup: `/tmp/worms-predeploy-20260908.sqlite`.

## Computer worker path correction

The initial browser tests used a root-mounted server and missed a production-only worker URL error: Vite emitted `/build/assets/computer-worker-…` while the application is mounted at `/worms/`. The failed worker path caused the former error fallback to save Skip Go. Read-only inspection confirmed actual saved solo turns were skips; the same positions produced valid attacks when evaluated directly.

Vite now emits relative asset URLs. If workers are unavailable, the same planner runs locally. A failure of both planners leaves the computer turn uncommitted and shows an error instead of consuming it as a skip.

Browser checks must also run against an isolated Apache container mounted at `/worms/`. The tests assert the computer's submitted commands contain an actual attack. `BASE_URL=http://127.0.0.1:8125/worms/ node tests/browser/computer-worker.cjs` checks WebKit worker loading and deliberately blocked-worker fallback (`npx playwright install --with-deps webkit` required).

The path fix passed Chromium desktop and both phone orientations against `/worms/`, with real attack commands checked. WebKit passed both normal worker execution and intentionally blocked-worker fallback. Deployed and verified the worker bundle under the public HTTPS `/worms/build/assets/` path. Rollback image: `worms-web:rollback-worker-fix`.

## Tactical intelligence and personalities

The computer now uses a bounded tactical utility search, with separate perception/candidate generation, simulation-based scoring, personality selection, and imperfect execution. This requires no external AI service. Bruiser values pressure and knockouts; Trickster favors thrown explosives and less direct attacks; Survivor weights safety, teammate protection and ammunition conservation more highly. Mixed assigns a stable style to each computer team from the map seed; existing solo games receive this automatically. New-game personality choices persist into rematches.

Candidates include short approaches, moving away, a jump over an obstruction, ranged attacks, grenade fuses, close-range knockouts, planted explosives with retreat, sheep detonation, aerial attacks, and safer-ground teleports when injured or near water. The real simulation accounts for blast groups, terrain, friendly fire, ammunition, knockback and drowning. It rewards healing and improved positions, penalizes repeated weapons, and varies choices among similarly useful tactics. Aim/power/target error is applied AFTER selecting a tactic, so the search cannot compensate it away. Hard has smaller errors and a wider trajectory search; it is still fallible.

This is a local tactical planner, not a long-horizon strategist or a general terrain pathfinder. It cannot coordinate multi-turn ambushes or use the entire utility arsenal. Non-terminating simulation outcomes are excluded from playable plans without optimizing misses back into perfect shots.

`computer-tactics-selftest.js` covers teammate protection, exploiting a cliff, arsenal variety across successive turns, real movement and retreat, finite ammo, repeatable personality/decision selection, imperfect accuracy and exact replay.

## Tactical AI deployment (2026-09-08)

The final tactical build passed the engine, map, computer, presentation, PHP, Chromium, and WebKit checks. WebKit verified both the normal worker and the local fallback with a visible real attack. The build is deployed at https://ai.markdarling.com/worms/. The previous production image is retained as `worms-web:rollback-before-tactics`; the pre-deployment database copy is `/tmp/worms-before-tactics.sqlite`.
