@extends('layouts.app')

@section('title', 'Admin — Worms: Armistice')

@section('content')
<div class="lobby">
    <h1>All games</h1>
    <p class="lobby-tagline">Ordered by recent activity · Open drops into spectator view.</p>

    <div class="lobby-card">
        @if ($games->isEmpty())
            <p class="lobby-hint">No games yet.</p>
        @else
            <ul class="admin-games">
                @foreach ($games as $game)
                    <li class="admin-game">
                        <div class="admin-game__info">
                            <span class="admin-game__name">{{ $game->name }}</span>
                            <span class="admin-game__meta">
                                {{ $game->status === 'finished'
                                    ? ($game->winner ? "Finished — {$game->winner} won" : 'Finished — draw')
                                    : "Turn {$game->current_turn}" }}
                                · {{ $game->mode }}
                                · {{ $game->updated_at->diffForHumans() }}
                            </span>
                            <span class="admin-game__teams">
                                @foreach ($game->players as $player)
                                    <span class="lobby-team-chip lobby-team-chip--small" style="--team-color: {{ $player->color }}">{{ $player->name }}</span>
                                @endforeach
                            </span>
                        </div>
                        <span class="admin-game__actions">
                            <a class="lobby-btn lobby-btn--small" href="{{ route('games.show', $game) }}">Open</a>
                            <a class="admin-game__links" href="{{ route('games.links', ['game' => $game, 'key' => $game->share_key]) }}">links</a>
                        </span>
                    </li>
                @endforeach
            </ul>
        @endif

        <form method="POST" action="{{ route('admin.logout') }}" class="admin-logout">
            @csrf
            <button type="submit" class="lobby-btn lobby-btn--small lobby-btn--muted">Log out</button>
        </form>
    </div>
</div>
@endsection
