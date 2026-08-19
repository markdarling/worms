<?php

use App\Http\Controllers\Api\GameApiController;
use App\Http\Controllers\GameController;
use App\Http\Controllers\LobbyController;
use Illuminate\Support\Facades\Route;

// Web
Route::get('/', [LobbyController::class, 'index'])->name('lobby');
Route::post('/games', [GameController::class, 'store'])->name('games.store');
Route::get('/games/{game}', [GameController::class, 'show'])->name('games.show');
// Shareable replay deep-link: opens the game in replay-browser mode at turn {turn}.
Route::get('/games/{game}/replay/{turn}', [GameController::class, 'show'])
    ->whereNumber('turn')->name('games.replay');
// Remote multiplayer: creator's invite-links page (guarded by ?key=share_key)
// and the per-team seat link addressed by an unguessable token.
Route::get('/games/{game}/links', [GameController::class, 'links'])->name('games.links');
Route::get('/play/{token}', [GameController::class, 'play'])
    ->where('token', '[0-9a-f]{40}')->name('games.play');

// API (same-origin JSON, consumed by resources/js/game/api.js).
// CSRF validation is excluded for api/* in bootstrap/app.php.
Route::prefix('api')->group(function () {
    Route::get('/games/{game}', [GameApiController::class, 'show']);
    Route::get('/games/{game}/turns', [GameApiController::class, 'turns']);
    Route::post('/games/{game}/turns', [GameApiController::class, 'store']);
});
