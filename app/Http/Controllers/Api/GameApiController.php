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
            ]);

            $game->snapshot = $data['snapshot_after'];
            $game->current_turn = $game->current_turn + 1;

            if (! empty($data['game_over'])) {
                $game->status = 'finished';
                $game->winner = $data['winner'] ?? null;
            }

            $game->save();

            return response()->json([
                'ok' => true,
                'current_turn' => $game->current_turn,
            ]);
        });
    }

    /** Shared turn shape for list responses: {number, player_position, commands}. */
    private function turnPayload(Turn $turn): array
    {
        return [
            'number' => $turn->number,
            'player_position' => $turn->player_position,
            'commands' => $turn->commands,
        ];
    }
}
