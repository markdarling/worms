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
// Owner's admin panel: password set on first visit (stored hashed in the
// settings table — never in code), session-gated, lists all games.
Route::get('/admin', [\App\Http\Controllers\AdminController::class, 'index'])->name('admin');
Route::get('/admin/analytics', [\App\Http\Controllers\AdminController::class, 'analytics'])->name('admin.analytics');
Route::post('/admin/setup', [\App\Http\Controllers\AdminController::class, 'setup'])->name('admin.setup');
Route::post('/admin/login', [\App\Http\Controllers\AdminController::class, 'login'])->name('admin.login');
Route::post('/admin/logout', [\App\Http\Controllers\AdminController::class, 'logout'])->name('admin.logout');

// API (same-origin JSON, consumed by resources/js/game/api.js).
// CSRF validation is excluded for api/* in bootstrap/app.php.
Route::prefix('api')->group(function () {
    Route::get('/games/{game}', [GameApiController::class, 'show']);
    Route::get('/games/{game}/turns', [GameApiController::class, 'turns']);
    Route::post('/games/{game}/turns', [GameApiController::class, 'store']);
});
