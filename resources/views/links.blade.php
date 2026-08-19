@extends('layouts.app')

@section('title', $game->name . ' — Game links')

@section('content')
<div class="lobby">
    <h1>{{ $game->name }}</h1>
    <p class="lobby-tagline">
        Game created! Games aren't listed anywhere — these links are the only way in, so save this page.
    </p>

    <div class="lobby-card">
        @if ($game->mode === 'remote')
            <h2>Team invite links</h2>
            <p class="lobby-hint">Send each team their own link. A link is that team's seat — it's unguessable and lets its holder (and only them) play that team's turns.</p>
            <ul class="lobby-links-list">
                @foreach ($game->players as $player)
                    <li class="lobby-link-row">
                        <span class="lobby-team-chip" style="--team-color: {{ $player->color }}">{{ $player->name }}</span>
                        <input class="lobby-link-input" type="text" readonly
                               value="{{ route('games.play', $player->token) }}"
                               onclick="this.select()">
                        <button type="button" class="lobby-btn lobby-btn--small"
                                onclick="navigator.clipboard.writeText(this.previousElementSibling.value).then(() => { this.textContent = '✓ Copied'; setTimeout(() => this.textContent = 'Copy', 1500); })">Copy</button>
                    </li>
                @endforeach
            </ul>
            <h2>Spectator link</h2>
            <p class="lobby-hint">Watch-only — safe to share anywhere.</p>
        @else
            <h2>Game link</h2>
            <p class="lobby-hint">Hotseat game — open this link on the shared device to play. Anyone with it can take turns.</p>
        @endif

        <div class="lobby-link-row">
            <span class="lobby-team-chip" style="--team-color: #6b7a8c">{{ $game->mode === 'remote' ? 'Watch' : 'Play' }}</span>
            <input class="lobby-link-input" type="text" readonly
                   value="{{ route('games.show', $game) }}"
                   onclick="this.select()">
            <button type="button" class="lobby-btn lobby-btn--small"
                    onclick="navigator.clipboard.writeText(this.previousElementSibling.value).then(() => { this.textContent = '✓ Copied'; setTimeout(() => this.textContent = 'Copy', 1500); })">Copy</button>
        </div>

        <p class="lobby-hint">
            Bookmark this page to find everything again:
            <a href="{{ route('games.links', ['game' => $game, 'key' => $game->share_key]) }}">this links page</a>.
        </p>

        @if ($game->mode !== 'remote')
            <p class="lobby-hint">
                <a href="{{ route('games.show', $game) }}" class="lobby-btn">Start playing →</a>
            </p>
        @endif
    </div>
</div>
@endsection
