<?php

namespace Tests\Feature;

use App\Models\Game;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class LobbyTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutVite();
    }

    public function test_lobby_renders_with_new_game_form(): void
    {
        $response = $this->get('/');

        $response->assertOk()
            ->assertSee('New Game')
            ->assertSee('name="worms_per_team"', false)
            ->assertSee('name="sudden_death_round"', false)
            ->assertSee('name="world_size"', false);
    }

    public function test_lobby_lists_existing_games_with_continue_link(): void
    {
        $game = Game::create([
            'name' => 'Sunday Skirmish',
            'seed' => 12345,
            'config' => ['seed' => 12345],
            'status' => 'active',
            'current_turn' => 3,
        ]);
        $game->players()->create(['name' => 'Red', 'color' => '#e84545', 'position' => 0]);
        $game->players()->create(['name' => 'Blue', 'color' => '#4593e8', 'position' => 1]);

        $this->get('/')
            ->assertOk()
            ->assertSee('Sunday Skirmish')
            ->assertSee('Turn 3')
            ->assertSee('Red')
            ->assertSee('Blue')
            ->assertSee(route('games.show', $game));
    }
}
