@extends('layouts.app')

@section('title', 'Lobby — Worms: Armistice')

@section('content')
<main class="lobby">
    <header class="lobby-header">
        <h1 class="lobby-title">Worms: Armistice</h1>
        <p class="lobby-tagline">Asynchronous turn-based artillery — correspondence chess with explosions.</p>
    </header>

    {{-- "Your games": seats remembered in this browser's localStorage (no
         accounts). The game page records each seat visited; status comes from
         the lightweight /api/games/{id}/status endpoint. --}}
    <section class="lobby-card lobby-card--mine" id="my-games" hidden>
        <h2 class="lobby-card-title">Your Games</h2>
        <ul class="lobby-mygames" id="my-games-list"></ul>
    </section>

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
                       value="{{ old('name', $suggestedName) }}" required maxlength="100">
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
                        <input class="lobby-form-color" type="color"
                               name="teams[{{ $i }}][color]" aria-label="Team {{ $i + 1 }} colour"
                               value="{{ old("teams.$i.color", $team['color']) }}">
                        <input class="lobby-form-input lobby-form-team-name" type="text"
                               name="teams[{{ $i }}][name]" aria-label="Team {{ $i + 1 }} name"
                               value="{{ old("teams.$i.name", $team['name']) }}" maxlength="50">
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
                <p class="lobby-form-help">From this round the water rises faster every round and all worms wither 5&nbsp;HP a turn — no game drags on forever.</p>
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

</main>

{{-- "Your games" list: seats live in localStorage['worms-seats'] (written by
     the game page). Each row shows whose turn it is via /status. --}}
<script>
    (function () {
        let seats;
        try { seats = JSON.parse(localStorage.getItem('worms-seats') || '{}'); } catch { return; }
        const ids = Object.keys(seats).sort((a, b) => (seats[b].seen || 0) - (seats[a].seen || 0)).slice(0, 15);
        if (!ids.length) return;

        const card = document.getElementById('my-games');
        const list = document.getElementById('my-games-list');
        card.hidden = false;

        const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
        const forget = (id) => {
            delete seats[id];
            try { localStorage.setItem('worms-seats', JSON.stringify(seats)); } catch { /* ignore */ }
        };

        for (const id of ids) {
            const seat = seats[id];
            const li = document.createElement('li');
            li.className = 'lobby-mygame';
            li.innerHTML = `
                <span class="lobby-team-chip" style="--team-color: ${esc(seat.color || '#888')}">${esc(seat.team || '?')}</span>
                <a class="lobby-mygame-name" href="${esc(seat.url)}">${esc(seat.name || 'Game')}</a>
                <span class="lobby-mygame-status">…</span>
                <button type="button" class="lobby-mygame-forget" title="Remove from this list">✕</button>
            `;
            li.querySelector('.lobby-mygame-forget').addEventListener('click', () => { forget(id); li.remove(); });
            list.appendChild(li);

            const badge = li.querySelector('.lobby-mygame-status');
            fetch(`/api/games/${id}/status`, { headers: { Accept: 'application/json' } })
                .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
                .then((s) => {
                    if (s.status === 'finished') {
                        badge.textContent = s.winner && s.winner !== 'draw' ? `🏁 ${s.winner} won` : '🏁 Draw';
                        badge.classList.add('is-finished');
                    } else if (s.next_position === seat.position) {
                        badge.textContent = '🔴 Your move!';
                        badge.classList.add('is-yourmove');
                    } else if (s.next_position != null && s.teams && s.teams[s.next_position]) {
                        badge.textContent = `⏳ ${s.teams[s.next_position].name}'s move`;
                    } else {
                        badge.textContent = `⏳ Turn ${s.current_turn}`;
                    }
                })
                .catch((e) => {
                    if (String(e.message) === '404') { forget(id); li.remove(); return; }
                    badge.textContent = '—';
                });
        }
    })();
</script>

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
