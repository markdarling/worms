{{-- Game page: the JS owns this page entirely — no markup chrome beyond the
     canvas, the HUD mount point, and the game id for main.js to boot from. --}}
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{ $game->name }} — Worms: Armistice</title>
    <script>
        window.GAME_ID = @json($game->public_id);
        window.REPLAY_TURN = {{ ($replayTurn ?? null) !== null ? (int) $replayTurn : 'null' }};
        window.PLAYER_TOKEN = @json($playerToken ?? null);
        window.PLAYER_POSITION = @json($playerPosition ?? null);
        window.SPECTATE_URL = @json(route('games.show', $game));
        window.LINKS_URL = @json($linksUrl ?? null);
        window.GAME_NAME = @json($game->name);
        window.VAPID_PUBLIC_KEY = @json(config('services.webpush.public_key'));
    </script>
    @vite(['resources/css/game.css', 'resources/js/game/main.js'])
</head>
<body>
    <canvas id="game-canvas"></canvas>
    <div id="hud-root"></div>
    @include('partials.desktop-only')
</body>
</html>
