<?php

namespace Tests\Feature;

use App\Models\Game;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class GameCreationTest extends TestCase
{
    use RefreshDatabase;

    private function validPayload(array $overrides = []): array
    {
        return array_merge([
            'name' => 'Sunday Skirmish',
            'teams' => [
                ['name' => 'Red', 'color' => '#e84545'],
                ['name' => 'Blue', 'color' => '#4593e8'],
            ],
            'worms_per_team' => 4,
            'sudden_death_round' => 10,
            'world_size' => 'medium',
        ], $overrides);
    }

    public function test_creates_game_with_contract_shaped_config_and_players(): void
    {
        $response = $this->post('/games', $this->validPayload());

        $game = Game::sole();
        $response->assertRedirect(route('games.show', $game));

        $this->assertSame('Sunday Skirmish', $game->name);
        $this->assertSame('active', $game->status);
        $this->assertSame(1, $game->current_turn);
        $this->assertNull($game->snapshot);

        // Config must exactly match the Sim config contract shape.
        $config = $game->config;
        $this->assertSame(
            ['seed', 'width', 'height', 'teams', 'wormHp', 'stamina', 'suddenDeathRound'],
            array_keys($config)
        );
        $this->assertSame($game->seed, $config['seed']);
        $this->assertSame(2400, $config['width']);
        $this->assertSame(900, $config['height']);
        $this->assertSame(100, $config['wormHp']);
        $this->assertSame(100, $config['stamina']);
        $this->assertSame(10, $config['suddenDeathRound']);

        $this->assertCount(2, $config['teams']);
        foreach ($config['teams'] as $team) {
            $this->assertSame(['name', 'color', 'worms'], array_keys($team));
            $this->assertCount(4, $team['worms']);
            $this->assertContainsOnly('string', $team['worms']);
        }

        // Worm names must be unique across the whole game.
        $allNames = array_merge(...array_column($config['teams'], 'worms'));
        $this->assertSame(count($allNames), count(array_unique($allNames)));

        // Player rows mirror the teams array, 0-based positions.
        $players = $game->players;
        $this->assertCount(2, $players);
        $this->assertSame([0, 1], $players->pluck('position')->all());
        $this->assertSame(['Red', 'Blue'], $players->pluck('name')->all());
        $this->assertSame(['#e84545', '#4593e8'], $players->pluck('color')->all());
    }

    public function test_world_size_presets_map_to_dimensions(): void
    {
        $this->post('/games', $this->validPayload(['world_size' => 'large']));

        $config = Game::sole()->config;
        $this->assertSame(3200, $config['width']);
        $this->assertSame(1000, $config['height']);
    }

    public function test_rejects_invalid_payloads(): void
    {
        $this->post('/games', $this->validPayload(['teams' => [['name' => 'Solo', 'color' => '#e84545']]]))
            ->assertSessionHasErrors('teams');

        $this->post('/games', $this->validPayload(['worms_per_team' => 9]))
            ->assertSessionHasErrors('worms_per_team');

        $this->post('/games', $this->validPayload([
            'teams' => [
                ['name' => 'Red', 'color' => 'red'],
                ['name' => 'Blue', 'color' => '#4593e8'],
            ],
        ]))->assertSessionHasErrors('teams.0.color');

        $this->post('/games', $this->validPayload(['world_size' => 'gigantic']))
            ->assertSessionHasErrors('world_size');

        $this->assertSame(0, Game::count());
    }
}
