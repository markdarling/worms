@extends('layouts.app')

@section('title', 'Lobby — Worms: Armistice')

@section('content')
<main class="lobby">
    <header class="lobby-header">
        <h1 class="lobby-title">Worms: Armistice</h1>
        <p class="lobby-tagline">Asynchronous turn-based artillery — correspondence chess with explosions.</p>
    </header>

    <section class="lobby-card lobby-card--new-game">
        <h2 class="lobby-card-title">New Game</h2>

        @if ($errors->any())
            <ul class="lobby-errors">
                @foreach ($errors->all() as $error)
                    <li class="lobby-errors-item">{{ $error }}</li>
                @endforeach
            </ul>
        @endif

        <form class="lobby-form" method="POST" action="{{ route('games.store') }}">
            @csrf

            <div class="lobby-form-row">
                <label class="lobby-form-label" for="game-name">Game name</label>
                <input class="lobby-form-input" type="text" id="game-name" name="name"
                       value="{{ old('name') }}" placeholder="Sunday Skirmish" required maxlength="100">
            </div>

            <div class="lobby-form-row">
                <label class="lobby-form-label" for="team-count">Teams</label>
                <select class="lobby-form-select" id="team-count" data-team-count>
                    @foreach ([2, 3, 4] as $count)
                        <option value="{{ $count }}" @selected(count(old('teams', [1, 2])) === $count)>{{ $count }} teams</option>
                    @endforeach
                </select>
            </div>

            <fieldset class="lobby-form-teams">
                <legend class="lobby-form-legend">Team names &amp; colours</legend>
                @foreach ($defaultTeams as $i => $team)
                    <div class="lobby-form-team" data-team-row="{{ $i }}" @if ($i >= count(old('teams', [1, 2]))) hidden @endif>
                        <input class="lobby-form-input lobby-form-team-name" type="text"
                               name="teams[{{ $i }}][name]" aria-label="Team {{ $i + 1 }} name"
                               value="{{ old("teams.$i.name", $team['name']) }}" maxlength="50">
                        <input class="lobby-form-color" type="color"
                               name="teams[{{ $i }}][color]" aria-label="Team {{ $i + 1 }} colour"
                               value="{{ old("teams.$i.color", $team['color']) }}">
                    </div>
                @endforeach
            </fieldset>

            <div class="lobby-form-row">
                <label class="lobby-form-label" for="worms-per-team">Worms per team</label>
                <input class="lobby-form-input" type="number" id="worms-per-team" name="worms_per_team"
                       value="{{ old('worms_per_team', 4) }}" min="1" max="8" required>
            </div>

            <div class="lobby-form-row">
                <label class="lobby-form-label" for="sudden-death-round">Sudden death round</label>
                <input class="lobby-form-input" type="number" id="sudden-death-round" name="sudden_death_round"
                       value="{{ old('sudden_death_round', 10) }}" min="1" max="100" required>
            </div>

            <div class="lobby-form-row">
                <label class="lobby-form-label" for="world-size">World size</label>
                <select class="lobby-form-select" id="world-size" name="world_size">
                    @foreach ($worldSizes as $value => $label)
                        <option value="{{ $value }}" @selected(old('world_size', 'medium') === $value)>{{ $label }}</option>
                    @endforeach
                </select>
            </div>

            <button class="lobby-form-submit" type="submit">Start Game</button>
        </form>
    </section>

    <section class="lobby-card lobby-card--games">
        <h2 class="lobby-card-title">Games</h2>

        @if ($games->isEmpty())
            <p class="lobby-games-empty">No games yet — start one above.</p>
        @else
            <ul class="lobby-games-list">
                @foreach ($games as $game)
                    <li class="lobby-game">
                        <div class="lobby-game-info">
                            <span class="lobby-game-name">{{ $game->name }}</span>
                            <span class="lobby-game-meta">
                                <span class="lobby-game-status lobby-game-status--{{ $game->status }}">
                                    {{ $game->status === 'finished' ? ($game->winner ? "Finished — {$game->winner} won" : 'Finished — draw') : 'Active' }}
                                </span>
                                <span class="lobby-game-turn">Turn {{ $game->current_turn }}</span>
                            </span>
                            <span class="lobby-game-players">
                                @foreach ($game->players as $player)
                                    <span class="lobby-game-player" style="--team-color: {{ $player->color }}">{{ $player->name }}</span>
                                @endforeach
                            </span>
                        </div>
                        <a class="lobby-game-continue" href="{{ route('games.show', $game) }}">
                            {{ $game->status === 'finished' ? 'View' : 'Continue' }}
                        </a>
                    </li>
                @endforeach
            </ul>
        @endif
    </section>
</main>

{{-- Minimal page behaviour: show/hide team rows to match the team count.
     Hidden rows have their inputs disabled so they are not submitted. --}}
<script>
    (function () {
        const select = document.querySelector('[data-team-count]');
        const rows = Array.from(document.querySelectorAll('[data-team-row]'));

        function sync() {
            const count = parseInt(select.value, 10);
            rows.forEach((row, i) => {
                const active = i < count;
                row.hidden = !active;
                row.querySelectorAll('input').forEach((input) => { input.disabled = !active; });
            });
        }

        select.addEventListener('change', sync);
        sync();
    })();
</script>
@endsection
