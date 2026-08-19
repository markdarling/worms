@extends('layouts.app')

@section('title', $game->name . ' — Game links')

@section('content')
<div class="lobby">
    <h1>{{ $game->name }}</h1>
    <p class="lobby-tagline">Every link below is private and unguessable — a team link IS that team's seat.</p>

    <div class="lobby-card">
        @if ($game->mode === 'remote')
            <h2>Team links</h2>
            <p class="lobby-hint">Send each team their own link; keep yours.</p>
            <ul class="lobby-links-list">
                @foreach ($game->players as $player)
                    <li class="lobby-link-row">
                        <span class="lobby-team-chip" style="--team-color: {{ $player->color }}">{{ $player->name }}</span>
                        <div class="lobby-link-field">
                            <input type="text" readonly value="{{ route('games.play', $player->token) }}" onclick="this.select()">
                            <button type="button" class="lobby-copy-icon" data-copy title="Copy link">⧉</button>
                        </div>
                        <a class="lobby-btn lobby-btn--small" href="{{ route('games.play', $player->token) }}">Open</a>
                    </li>
                @endforeach
            </ul>
            <h2>Spectator link</h2>
            <p class="lobby-hint">Watch-only — safe to share anywhere.</p>
        @else
            <h2>Game link</h2>
            <p class="lobby-hint">Hotseat game — open on the shared device to play.</p>
        @endif

        <ul class="lobby-links-list">
            <li class="lobby-link-row">
                <span class="lobby-team-chip" style="--team-color: #6b7a8c">{{ $game->mode === 'remote' ? 'Watch' : 'Play' }}</span>
                <div class="lobby-link-field">
                    <input type="text" readonly value="{{ route('games.show', $game) }}" onclick="this.select()">
                    <button type="button" class="lobby-copy-icon" data-copy title="Copy link">⧉</button>
                </div>
                <a class="lobby-btn lobby-btn--small" href="{{ route('games.show', $game) }}">Open</a>
            </li>
        </ul>

        <p class="lobby-hint">
            Bookmark <a href="{{ route('games.links', ['game' => $game, 'key' => $game->share_key]) }}">this page</a> to find the links again
            · start another game in the <a href="{{ route('lobby') }}">lobby</a>.
        </p>
    </div>
</div>

{{-- Clipboard API needs a secure context (HTTPS/localhost); worms.test over
     plain HTTP doesn't qualify, so fall back to select + execCommand. --}}
<script>
    document.querySelectorAll('[data-copy]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const input = btn.closest('.lobby-link-field').querySelector('input');
            let ok = false;
            if (window.isSecureContext && navigator.clipboard) {
                ok = await navigator.clipboard.writeText(input.value).then(() => true, () => false);
            }
            if (!ok) {
                input.select();
                input.setSelectionRange(0, input.value.length);
                ok = document.execCommand('copy');
            }
            btn.textContent = ok ? '✓' : '!';
            setTimeout(() => { btn.textContent = '⧉'; }, 1400);
        });
    });
</script>
@endsection
