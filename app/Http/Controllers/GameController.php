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

        $game = DB::transaction(function () use ($validated, $seed, $config) {
            $game = Game::create([
                'name' => $validated['name'],
                'seed' => $seed,
                'config' => $config,
                'status' => 'active',
                'current_turn' => 1,
            ]);

            foreach ($config['teams'] as $position => $team) {
                $game->players()->create([
                    'name' => $team['name'],
                    'color' => $team['color'],
                    'position' => $position,
                ]);
            }

            return $game;
        });

        return redirect()->route('games.show', $game);
    }

    public function show(Game $game, ?int $turn = null): View
    {
        return view('game', ['game' => $game, 'replayTurn' => $turn]);
    }
}
