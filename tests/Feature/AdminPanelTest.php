<?php

namespace Tests\Feature;

use App\Models\Game;
use App\Models\Setting;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class AdminPanelTest extends TestCase
{
    use RefreshDatabase;

    public function test_first_visit_offers_password_setup_and_logs_in(): void
    {
        $this->get('/admin')->assertOk()->assertSee('Set the admin password');

        $this->post('/admin/setup', ['code' => 'hunter2worms'])
            ->assertRedirect(route('admin'));

        $this->assertNotNull(Setting::get('admin_password_hash'));
        $this->assertTrue(Hash::check('hunter2worms', Setting::get('admin_password_hash')));
        $this->get('/admin')->assertOk()->assertSee('All games');
    }

    public function test_setup_is_rejected_once_password_exists(): void
    {
        Setting::put('admin_password_hash', Hash::make('original'));

        $this->post('/admin/setup', ['code' => 'takeover99'])->assertForbidden();
        $this->assertTrue(Hash::check('original', Setting::get('admin_password_hash')));
    }

    public function test_login_gates_the_games_list(): void
    {
        Setting::put('admin_password_hash', Hash::make('hunter2worms'));

        $game = Game::create([
            'name' => 'Hidden Battle', 'seed' => 1, 'config' => ['seed' => 1],
            'status' => 'active', 'mode' => 'remote', 'current_turn' => 4,
        ]);

        // Not logged in: login form, no game data.
        $this->get('/admin')->assertOk()->assertDontSee('Hidden Battle');

        // Wrong password.
        $this->post('/admin/login', ['code' => 'wrong'])->assertSessionHasErrors('code');
        $this->get('/admin')->assertDontSee('Hidden Battle');

        // Right password: list with spectate link.
        $this->post('/admin/login', ['code' => 'hunter2worms'])->assertRedirect(route('admin'));
        $this->get('/admin')->assertOk()
            ->assertSee('Hidden Battle')
            ->assertSee(route('games.show', $game));
    }

    public function test_analytics_is_gated_and_shows_daily_counts(): void
    {
        Setting::put('admin_password_hash', Hash::make('hunter2worms'));

        // Not logged in → bounced to /admin.
        $this->get('/admin/analytics')->assertRedirect(route('admin'));

        $game = Game::create([
            'name' => 'Charted', 'seed' => 9, 'config' => ['seed' => 9],
            'status' => 'active', 'mode' => 'remote',
        ]);
        $game->turns()->create([
            'number' => 1, 'player_position' => 0,
            'commands' => ['v' => 1], 'snapshot_after' => ['s' => 1], 'state_hash' => 'h',
        ]);

        $this->post('/admin/login', ['code' => 'hunter2worms']);
        $this->get('/admin/analytics')->assertOk()
            ->assertSee('Games created per day')
            ->assertSee('Turns played per day')
            ->assertSee('avg turns / game')
            ->assertSee('<svg', false);
    }

    public function test_games_are_ordered_by_recent_activity(): void
    {
        Setting::put('admin_password_hash', Hash::make('hunter2worms'));
        $old = Game::create(['name' => 'Old One', 'seed' => 1, 'config' => ['seed' => 1], 'status' => 'active']);
        $new = Game::create(['name' => 'Fresh One', 'seed' => 2, 'config' => ['seed' => 2], 'status' => 'active']);
        Game::whereKey($old->id)->update(['updated_at' => now()->subDays(3)]);

        $this->post('/admin/login', ['code' => 'hunter2worms']);
        $html = $this->get('/admin')->getContent();
        $this->assertLessThan(strpos($html, 'Old One'), strpos($html, 'Fresh One'));
    }
}
