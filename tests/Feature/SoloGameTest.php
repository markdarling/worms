<?php

namespace Tests\Feature;

use App\Models\Game;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class SoloGameTest extends TestCase
{
    use RefreshDatabase;

    private function createSolo(): Game
    {
        $response = $this->post('/games', [
            'name' => 'Computer test', 'mode' => 'solo', 'difficulty' => 'hard', 'computer_personality' => 'trickster',
            'teams' => [['name' => 'Human', 'color' => '#ff4444'], ['name' => 'CPU', 'color' => '#4488ff']],
            'worms_per_team' => 2, 'sudden_death_round' => 10, 'world_size' => 'small',
        ]);
        $game = Game::sole();
        $response->assertRedirect(route('games.play', ['token' => $game->players()->where('position', 0)->first()->token]));
        return $game;
    }

    public function test_solo_creation_assigns_computer_and_preserves_settings(): void
    {
        $game = $this->createSolo();
        $this->assertSame('solo', $game->mode);
        $this->assertSame([1], $game->config['computerTeams']);
        $this->assertSame('hard', $game->config['difficulty']);
        $this->assertSame('trickster', $game->config['computerPersonality']);
        $this->get(route('games.play', ['token' => $game->players()->first()->token]))->assertOk()->assertDontSee('desktop-gate');
    }

    public function test_only_human_seat_can_commit_computer_turns(): void
    {
        $game = $this->createSolo();
        $payload = ['number' => 1, 'player_position' => 1, 'commands' => ['v' => 1, 'n' => 1, 'runs' => []],
            'snapshot_after' => ['test' => true], 'state_hash' => 'test'];
        $url = '/api/games/'.$game->public_id.'/turns';
        $this->postJson($url, $payload)->assertForbidden();
        $this->postJson($url, $payload + ['player_token' => $game->players()->where('position', 1)->first()->token])->assertForbidden();
        $this->postJson($url, $payload + ['player_token' => $game->players()->where('position', 0)->first()->token])->assertOk();
    }

    public function test_rematch_preserves_solo_mode(): void
    {
        $game = $this->createSolo();
        $game->update(['status' => 'finished']);
        $this->postJson('/api/games/'.$game->public_id.'/rematch', [
            'player_token' => $game->players()->where('position', 0)->first()->token,
        ])->assertOk();
        $rematch = Game::latest('id')->first();
        $this->assertSame('solo', $rematch->mode);
        $this->assertSame('trickster', $rematch->config['computerPersonality']);
        $this->assertSame([1], $rematch->config['computerTeams']);
    }

    public function test_unknown_modes_are_rejected(): void
    {
        $this->post('/games', ['mode' => 'unknown'])->assertSessionHasErrors('mode');
        $this->post('/games', ['computer_personality' => 'unknown'])->assertSessionHasErrors('computer_personality');
    }
}
