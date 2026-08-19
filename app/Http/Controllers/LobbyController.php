<?php

namespace App\Http\Controllers;

use App\Models\Game;
use Illuminate\View\View;

class LobbyController extends Controller
{
    public function index(): View
    {
        return view('lobby', [
            'games' => Game::with('players')->latest('updated_at')->get(),
            'defaultTeams' => [
                ['name' => 'Red', 'color' => '#e84545'],
                ['name' => 'Blue', 'color' => '#4593e8'],
                ['name' => 'Green', 'color' => '#45e86b'],
                ['name' => 'Yellow', 'color' => '#e8d445'],
            ],
            'worldSizes' => [
                'small' => 'Small (1800 x 800)',
                'medium' => 'Medium (2400 x 900)',
                'large' => 'Large (3200 x 1000)',
            ],
        ]);
    }
}
