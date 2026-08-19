<?php

namespace Tests\Feature;

use App\Models\Game;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RemoteMultiplayerTest extends TestCase
{
    use RefreshDatabase;

    private function makeRemoteGame(): Game
    {
        $config = [
            'seed' => 42,
            'width' => 1800,
            'height' => 800,
            'teams' => [
                ['name' => 'Red', 'color' => '#e84545', 'worms' => ['A']],
                ['name' => 'Blue', 'color' => '#4593e8', 'worms' => ['B']],
            ],
            'wormHp' => 100,
            'stamina' => 100,
            'suddenDeathRound' => 10,
        ];

        $game = Game::create([
            'name' => 'Remote Test',
            'seed' => 42,
            'config' => $config,
            'status' => 'active',
            'mode' => 'remote',
            'current_turn' => 1,
            'share_key' => bin2hex(random_bytes(20)),
        ]);

        foreach ($config['teams'] as $position => $team) {
            $game->players()->create([
                'name' => $team['name'],
                'color' => $team['color'],
                'position' => $position,
                'token' => bin2hex(random_bytes(20)),
            ]);
        }

        return $game;
    }

    private function turnPayload(array $overrides = []): array
    {
        return array_merge([
            'number' => 1,
            'player_position' => 0,
            'commands' => ['v' => 1, 'n' => 1, 'runs' => [[1, 0, 0, 0, 0]]],
            'snapshot_after' => ['stub' => true],
            'state_hash' => 'abc123',
        ], $overrides);
    }

    public function test_remote_game_creation_generates_unique_tokens_and_redirects_to_links(): void
    {
        $response = $this->post('/games', [
            'name' => 'Net Game',
            'mode' => 'remote',
            'teams' => [
                ['name' => 'Red', 'color' => '#e84545'],
                ['name' => 'Blue', 'color' => '#4593e8'],
            ],
            'worms_per_team' => 2,
            'sudden_death_round' => 10,
            'world_size' => 'small',
        ]);

        $game = Game::latest('id')->first();
        $response->assertRedirect(route('games.links', ['game' => $game, 'key' => $game->share_key]));

        $tokens = $game->players->pluck('token');
        $this->assertCount(2, $tokens->unique());
        foreach ($tokens as $token) {
            $this->assertMatchesRegularExpression('/^[0-9a-f]{40}$/', $token);
        }
    }

    public function test_links_page_requires_share_key(): void
    {
        $game = $this->makeRemoteGame();

        $this->get("/games/{$game->public_id}/links")->assertForbidden();
        $this->get("/games/{$game->public_id}/links?key=wrong")->assertForbidden();
        $this->get("/games/{$game->public_id}/links?key={$game->share_key}")
            ->assertOk()
            ->assertSee($game->players[0]->token)
            ->assertSee($game->players[1]->token);
    }

    public function test_play_route_resolves_seat_by_token(): void
    {
        $game = $this->makeRemoteGame();
        $player = $game->players[1];

        $this->get("/play/{$player->token}")
            ->assertOk()
            ->assertSee('window.PLAYER_POSITION = 1', false);

        $this->get('/play/' . str_repeat('0', 40))->assertNotFound();
    }

    public function test_remote_turn_commit_requires_matching_seat_token(): void
    {
        $game = $this->makeRemoteGame();
        [$red, $blue] = [$game->players[0], $game->players[1]];

        // No token → rejected.
        $this->postJson("/api/games/{$game->public_id}/turns", $this->turnPayload())
            ->assertStatus(403)->assertJsonPath('error', 'invalid_seat_token');

        // Blue's token cannot commit Red's turn.
        $this->postJson("/api/games/{$game->public_id}/turns", $this->turnPayload([
            'player_token' => $blue->token,
            'player_position' => 0,
        ]))->assertStatus(403)->assertJsonPath('error', 'invalid_seat_token');

        // Red's token for Red's turn → accepted.
        $this->postJson("/api/games/{$game->public_id}/turns", $this->turnPayload([
            'player_token' => $red->token,
            'player_position' => 0,
        ]))->assertOk()->assertJsonPath('current_turn', 2);
    }

    public function test_hotseat_games_do_not_require_tokens(): void
    {
        $game = $this->makeRemoteGame();
        $game->update(['mode' => 'hotseat']);

        $this->postJson("/api/games/{$game->public_id}/turns", $this->turnPayload())
            ->assertOk();
    }

    public function test_api_never_leaks_tokens_or_share_key(): void
    {
        $game = $this->makeRemoteGame();

        $json = $this->getJson("/api/games/{$game->public_id}")->assertOk()->json();
        $flat = json_encode($json);
        $this->assertStringNotContainsString($game->share_key, $flat);
        foreach ($game->players as $player) {
            $this->assertStringNotContainsString($player->token, $flat);
        }
    }
}
