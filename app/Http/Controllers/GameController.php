<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreGameRequest;
use App\Models\Game;
use App\Support\WormNames;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\View\View;

class GameController extends Controller
{
    /** World size presets, keyed by the form's preset value. */
    private const WORLD_SIZES = [
        'small' => ['width' => 1800, 'height' => 800],
        'medium' => ['width' => 2400, 'height' => 900],
        'large' => ['width' => 3200, 'height' => 1000],
    ];

    public function store(StoreGameRequest $request): RedirectResponse
    {
        $validated = $request->validated();

        $teams = array_values($validated['teams']);
        $size = self::WORLD_SIZES[$validated['world_size']];
        $seed = random_int(1, 2147483646);
        $wormNames = WormNames::deal(count($teams), (int) $validated['worms_per_team']);

        // Config shape must exactly match the Sim config contract:
        // { seed, width, height, teams: [{name, color, worms}], wormHp, stamina, suddenDeathRound }
        $config = [
            'seed' => $seed,
            'width' => $size['width'],
            'height' => $size['height'],
            'teams' => collect($teams)->map(fn (array $team, int $i) => [
                'name' => $team['name'],
                'color' => strtolower($team['color']),
                'worms' => $wormNames[$i],
            ])->all(),
            'wormHp' => 100,
            'stamina' => 100,
            'suddenDeathRound' => (int) $validated['sudden_death_round'],
        ];

        // All new games are remote (link-per-team). The mode column and the
        // hotseat pass-device flow remain only for games created before this.
        $mode = 'remote';

        $game = DB::transaction(function () use ($validated, $seed, $config, $mode) {
            $game = Game::create([
                'public_id' => bin2hex(random_bytes(20)),
                'name' => $validated['name'],
                'seed' => $seed,
                'config' => $config,
                'status' => 'active',
                'mode' => $mode,
                'current_turn' => 1,
                'share_key' => bin2hex(random_bytes(20)),
            ]);

            foreach ($config['teams'] as $position => $team) {
                $game->players()->create([
                    'name' => $team['name'],
                    'color' => $team['color'],
                    'position' => $position,
                    // Seat token: the unguessable invite link AND the turn-commit
                    // credential for this team (160 bits of entropy).
                    'token' => bin2hex(random_bytes(20)),
                ]);
            }

            return $game;
        });

        // Games aren't listed anywhere — the links page is the one place the
        // creator collects every URL, so both modes land there.
        return redirect()->route('games.links', ['game' => $game, 'key' => $game->share_key]);
    }

    /** Creator-only page listing each team's invite link. Guarded by share_key. */
    public function links(Game $game): View
    {
        abort_unless(hash_equals((string) $game->share_key, (string) request()->query('key', '')), 403);

        return view('links', ['game' => $game]);
    }

    /** A team seat, addressed by its unguessable token. */
    public function play(string $token): View
    {
        $player = \App\Models\Player::where('token', $token)->firstOrFail();
        $game = $player->game;

        return view('game', [
            'game' => $game,
            'replayTurn' => null,
            'playerToken' => $player->token,
            'playerPosition' => $player->position,
        ]);
    }

    public function show(Game $game, ?int $turn = null): View
    {
        return view('game', ['game' => $game, 'replayTurn' => $turn]);
    }
}
