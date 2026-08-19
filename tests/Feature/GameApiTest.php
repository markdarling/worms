<?php

namespace Tests\Feature;

use App\Models\Game;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class GameApiTest extends TestCase
{
    use RefreshDatabase;

    private function makeGame(array $overrides = []): Game
    {
        $config = [
            'seed' => 987654,
            'width' => 2400,
            'height' => 900,
            'teams' => [
                ['name' => 'Red', 'color' => '#e84545', 'worms' => ['Boggy B', 'Spadge']],
                ['name' => 'Blue', 'color' => '#4593e8', 'worms' => ['Clagnut', 'Suzette']],
            ],
            'wormHp' => 100,
            'stamina' => 100,
            'suddenDeathRound' => 10,
        ];

        $game = Game::create(array_merge([
            'name' => 'API Test Match',
            'seed' => 987654,
            'config' => $config,
            'status' => 'active',
            'current_turn' => 1,
        ], $overrides));

        $game->players()->create(['name' => 'Red', 'color' => '#e84545', 'position' => 0]);
        $game->players()->create(['name' => 'Blue', 'color' => '#4593e8', 'position' => 1]);

        return $game;
    }

    private function turnPayload(int $number, array $overrides = []): array
    {
        return array_merge([
            'number' => $number,
            'commands' => [['ticks' => 60, 'input' => ['left' => true]]],
            'snapshot_after' => ['turnNumber' => $number, 'waterLevel' => 850, 'worms' => []],
            'state_hash' => 'hash-'.$number,
            'player_position' => ($number - 1) % 2,
            'game_over' => null,
            'winner' => null,
        ], $overrides);
    }

    public function test_state_fetch_returns_contract_shape(): void
    {
        $game = $this->makeGame();
        $this->postJson("/api/games/{$game->public_id}/turns", $this->turnPayload(1))->assertOk();

        $response = $this->getJson("/api/games/{$game->public_id}");

        $response->assertOk()->assertJson([
            'id' => $game->id,
            'name' => 'API Test Match',
            'status' => 'active',
            'winner' => null,
            'current_turn' => 2,
            'players' => [
                ['name' => 'Red', 'color' => '#e84545', 'position' => 0],
                ['name' => 'Blue', 'color' => '#4593e8', 'position' => 1],
            ],
        ]);

        $data = $response->json();
        $this->assertSame(
            ['id', 'name', 'status', 'mode', 'winner', 'config', 'current_turn', 'snapshot', 'players', 'turns'],
            array_keys($data)
        );
        $this->assertSame($game->config, $data['config']);

        // snapshot = latest turn's snapshot_after.
        $this->assertSame(1, $data['snapshot']['turnNumber']);

        // Turns are ordered and omit snapshot_after / state_hash.
        $this->assertCount(1, $data['turns']);
        $this->assertSame(['number', 'player_position', 'commands'], array_keys($data['turns'][0]));
        $this->assertSame(1, $data['turns'][0]['number']);
    }

    public function test_state_fetch_snapshot_is_null_for_fresh_game(): void
    {
        $game = $this->makeGame();

        $this->getJson("/api/games/{$game->public_id}")
            ->assertOk()
            ->assertJson(['snapshot' => null, 'current_turn' => 1, 'turns' => []]);
    }

    public function test_turn_posting_happy_path(): void
    {
        $game = $this->makeGame();

        $this->postJson("/api/games/{$game->public_id}/turns", $this->turnPayload(1))
            ->assertOk()
            ->assertExactJson(['ok' => true, 'current_turn' => 2]);

        $game->refresh();
        $this->assertSame(2, $game->current_turn);
        $this->assertSame('active', $game->status);
        $this->assertSame(1, $game->snapshot['turnNumber']);

        $turn = $game->turns()->sole();
        $this->assertSame(1, $turn->number);
        $this->assertSame(0, $turn->player_position);
        $this->assertSame('hash-1', $turn->state_hash);
        $this->assertSame([['ticks' => 60, 'input' => ['left' => true]]], $turn->commands);
    }

    public function test_turn_number_conflict_returns_409(): void
    {
        $game = $this->makeGame();

        // Stale commit (game is on turn 1, client posts turn 2).
        $this->postJson("/api/games/{$game->public_id}/turns", $this->turnPayload(2))
            ->assertStatus(409)
            ->assertJson(['ok' => false, 'current_turn' => 1]);

        // Duplicate commit of an already-stored turn.
        $this->postJson("/api/games/{$game->public_id}/turns", $this->turnPayload(1))->assertOk();
        $this->postJson("/api/games/{$game->public_id}/turns", $this->turnPayload(1))
            ->assertStatus(409)
            ->assertJson(['ok' => false, 'current_turn' => 2]);

        $this->assertSame(1, $game->turns()->count());
    }

    public function test_finished_game_rejects_turns(): void
    {
        $game = $this->makeGame(['status' => 'finished', 'winner' => 'Red']);

        $this->postJson("/api/games/{$game->public_id}/turns", $this->turnPayload(1))
            ->assertStatus(409)
            ->assertJson(['ok' => false, 'error' => 'game_finished']);

        $this->assertSame(0, $game->turns()->count());
    }

    public function test_game_over_turn_sets_status_and_winner(): void
    {
        $game = $this->makeGame();

        $this->postJson("/api/games/{$game->public_id}/turns", $this->turnPayload(1, [
            'game_over' => true,
            'winner' => 'Blue',
        ]))->assertOk();

        $game->refresh();
        $this->assertSame('finished', $game->status);
        $this->assertSame('Blue', $game->winner);
    }

    public function test_incremental_turns_fetch_after_n(): void
    {
        $game = $this->makeGame();
        foreach ([1, 2, 3] as $n) {
            $this->postJson("/api/games/{$game->public_id}/turns", $this->turnPayload($n))->assertOk();
        }

        $response = $this->getJson("/api/games/{$game->public_id}/turns?after=1");

        $response->assertOk();
        $turns = $response->json();
        $this->assertSame([2, 3], array_column($turns, 'number'));
        $this->assertSame(['number', 'player_position', 'commands'], array_keys($turns[0]));
    }

    public function test_turn_post_validates_required_fields(): void
    {
        $game = $this->makeGame();

        $this->postJson("/api/games/{$game->public_id}/turns", ['number' => 1])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['commands', 'snapshot_after', 'state_hash', 'player_position']);
    }
}
