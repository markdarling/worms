<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Game;
use App\Models\Turn;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class GameApiController extends Controller
{
    /**
     * GET /api/games/{game}
     *
     * Full game state for client boot. `snapshot` is the latest committed
     * turn's snapshot_after (kept denormalised on games.snapshot), or null for
     * a fresh game. Turns omit snapshot_after to keep the payload small — the
     * client replays commands deterministically instead.
     */
    public function show(Game $game): JsonResponse
    {
        return response()->json([
            'id' => $game->id,
            'name' => $game->name,
            'status' => $game->status,
            'mode' => $game->mode,
            'winner' => $game->winner,
            'config' => $game->config,
            'current_turn' => $game->current_turn,
            'snapshot' => $game->snapshot,
            'players' => $game->players->map(fn ($player) => [
                'name' => $player->name,
                'color' => $player->color,
                'position' => $player->position,
            ])->values(),
            'turns' => $game->turns->map(fn ($turn) => $this->turnPayload($turn))->values(),
        ]);
    }

    /**
     * GET /api/games/{game}/turns?after=N
     *
     * Turns with number > N, ordered, for incremental replay fetch.
     */
    public function turns(Request $request, Game $game): JsonResponse
    {
        $after = (int) $request->query('after', 0);

        $turns = $game->turns()
            ->where('number', '>', $after)
            ->get()
            ->map(fn ($turn) => $this->turnPayload($turn))
            ->values();

        return response()->json($turns);
    }

    /**
     * POST /api/games/{game}/turns
     *
     * Commit one completed turn. The server does not simulate in v1 — it
     * trusts the client and stores the deterministic record (commands +
     * snapshot + state hash) for replay and future server-side validation.
     */
    public function store(Request $request, Game $game): JsonResponse
    {
        $data = $request->validate([
            'number' => ['required', 'integer', 'min:1'],
            // `commands` is the engine's encoded command stream — an opaque
            // JSON-able value (RLE-encoded), so no shape constraint here.
            'commands' => ['required'],
            'snapshot_after' => ['required', 'array'],
            'state_hash' => ['required', 'string', 'max:255'],
            'player_position' => ['required', 'integer', 'min:0'],
            'game_over' => ['nullable', 'boolean'],
            'winner' => ['nullable', 'string', 'max:255'],
            'player_token' => ['nullable', 'string', 'max:64'],
            // Optional one-liner shown during the turn's replay.
            'taunt' => ['nullable', 'string', 'max:160'],
            // Who moves next — computed by the committing client (the server
            // never simulates). Drives push notifications + lobby status.
            'next_position' => ['nullable', 'integer', 'min:0', 'max:7'],
        ]);

        // Remote games: the seat token is the credential. It must exist on this
        // game AND belong to the team the turn is being committed for — a valid
        // team-A token can never commit team B's turn. Hotseat games skip this
        // (one trusted device).
        if ($game->mode === 'remote') {
            $player = $game->players()
                ->where('token', (string) ($data['player_token'] ?? ''))
                ->first();

            if ($player === null || $player->position !== (int) $data['player_position']) {
                return response()->json([
                    'ok' => false,
                    'error' => 'invalid_seat_token',
                ], 403);
            }
        }

        return DB::transaction(function () use ($game, $data) {
            // Re-read inside the transaction so concurrent commits serialise.
            $game = Game::whereKey($game->id)->lockForUpdate()->firstOrFail();

            if ($game->isFinished() || (int) $data['number'] !== $game->current_turn) {
                return response()->json([
                    'ok' => false,
                    'error' => $game->isFinished() ? 'game_finished' : 'turn_number_mismatch',
                    'current_turn' => $game->current_turn,
                    'status' => $game->status,
                ], 409);
            }

            $game->turns()->create([
                'number' => $data['number'],
                'player_position' => $data['player_position'],
                'commands' => $data['commands'],
                'snapshot_after' => $data['snapshot_after'],
                'state_hash' => $data['state_hash'],
                'taunt' => isset($data['taunt']) && trim($data['taunt']) !== '' ? trim($data['taunt']) : null,
            ]);

            $game->snapshot = $data['snapshot_after'];
            $game->current_turn = $game->current_turn + 1;

            if (! empty($data['game_over'])) {
                $game->status = 'finished';
                $game->winner = $data['winner'] ?? null;
                $game->next_position = null;
            } else {
                $game->next_position = $data['next_position'] ?? null;
            }

            $game->save();

            // Closed-tab notification for whoever is up next (runs after the
            // response — no queue worker needed; skipped for hotseat games).
            if ($game->status !== 'finished' && $game->next_position !== null && $game->mode === 'remote') {
                $next = $game->players()->where('position', $game->next_position)->first();
                if ($next !== null) {
                    \App\Jobs\SendTurnPush::dispatchAfterResponse($next->id, $game->name, $next->name);
                }
            }

            return response()->json([
                'ok' => true,
                'current_turn' => $game->current_turn,
            ]);
        });
    }

    /**
     * GET /api/games/{game}/status
     *
     * Lightweight status for the lobby's "your games" list (localStorage,
     * no accounts): name, whose turn, finished/winner.
     */
    public function status(Game $game): JsonResponse
    {
        return response()->json([
            'name' => $game->name,
            'status' => $game->status,
            'winner' => $game->winner,
            'current_turn' => $game->current_turn,
            'next_position' => $game->next_position,
            'teams' => $game->players->map(fn ($p) => ['name' => $p->name, 'color' => $p->color])->values(),
            'updated_at' => optional($game->updated_at)->toIso8601String(),
        ]);
    }

    /**
     * POST /api/push/subscribe
     *
     * Register (or refresh) a web-push subscription for a seat. The seat
     * token is the credential; one row per (seat, endpoint).
     */
    public function pushSubscribe(Request $request): JsonResponse
    {
        $data = $request->validate([
            'player_token' => ['required', 'string', 'max:64'],
            'subscription.endpoint' => ['required', 'string', 'max:2000'],
            'subscription.keys.p256dh' => ['required', 'string', 'max:255'],
            'subscription.keys.auth' => ['required', 'string', 'max:255'],
        ]);

        $player = \App\Models\Player::where('token', $data['player_token'])->first();
        if ($player === null) {
            return response()->json(['ok' => false, 'error' => 'invalid_seat_token'], 403);
        }

        $endpoint = $data['subscription']['endpoint'];
        $player->pushSubscriptions()->updateOrCreate(
            ['endpoint_hash' => hash('sha256', $endpoint)],
            [
                'endpoint' => $endpoint,
                'p256dh' => $data['subscription']['keys']['p256dh'],
                'auth' => $data['subscription']['keys']['auth'],
            ],
        );

        return response()->json(['ok' => true]);
    }

    /**
     * POST /api/games/{game}/rematch
     *
     * Any seat holder of a finished game can spin up a rematch: same teams
     * and settings, fresh seed + worm names, current rules version. Returns
     * the new game's links page (it holds every team's fresh seat link).
     */
    public function rematch(Request $request, Game $game): JsonResponse
    {
        $data = $request->validate([
            'player_token' => ['required', 'string', 'max:64'],
        ]);

        $requester = $game->players()->where('token', $data['player_token'])->first();
        if ($requester === null) {
            return response()->json(['ok' => false, 'error' => 'invalid_seat_token'], 403);
        }
        if (! $game->isFinished()) {
            return response()->json(['ok' => false, 'error' => 'game_not_finished'], 409);
        }

        $config = $game->config;
        $wormsPerTeam = max(1, count($config['teams'][0]['worms'] ?? [1, 2, 3, 4]));
        $seed = random_int(1, 2147483646);
        $wormNames = \App\Support\WormNames::deal(count($config['teams']), $wormsPerTeam);

        $config['rules'] = 2; // rematches always run the current rules
        $config['seed'] = $seed;
        foreach ($config['teams'] as $i => $team) {
            $config['teams'][$i]['worms'] = $wormNames[$i];
        }

        $rematch = DB::transaction(function () use ($game, $config, $seed) {
            $new = Game::create([
                'name' => \App\Support\GameNames::random(),
                'seed' => $seed,
                'config' => $config,
                'status' => 'active',
                'mode' => 'remote',
                'current_turn' => 1,
            ]);
            foreach ($config['teams'] as $position => $team) {
                $new->players()->create([
                    'name' => $team['name'],
                    'color' => $team['color'],
                    'position' => $position,
                    'token' => bin2hex(random_bytes(20)),
                ]);
            }

            return $new;
        });

        return response()->json([
            'ok' => true,
            'links_url' => route('games.links', ['game' => $rematch, 'key' => $rematch->share_key]),
        ]);
    }

    /** Shared turn shape for list responses: {number, player_position, commands}. */
    private function turnPayload(Turn $turn): array
    {
        return [
            'number' => $turn->number,
            'player_position' => $turn->player_position,
            'commands' => $turn->commands,
            'taunt' => $turn->taunt,
        ];
    }
}
