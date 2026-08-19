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

    public function test_lobby_does_not_list_or_leak_existing_games(): void
    {
        $game = Game::create([
            'name' => 'Secret Skirmish',
            'seed' => 12345,
            'config' => ['seed' => 12345],
            'status' => 'active',
            'current_turn' => 3,
        ]);
        $game->players()->create(['name' => 'Red', 'color' => '#e84545', 'position' => 0]);
        $game->players()->create(['name' => 'Blue', 'color' => '#4593e8', 'position' => 1]);

        // Games are link-addressed and private: the lobby must not reveal
        // their names or unguessable URLs.
        $this->get('/')
            ->assertOk()
            ->assertDontSee('Secret Skirmish')
            ->assertDontSee($game->public_id);
    }
}
