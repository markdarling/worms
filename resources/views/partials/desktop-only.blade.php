{{-- Desktop-only gate: full-screen overlay shown on mobile viewports via CSS
     media query (see .desktop-gate in game.css). The game needs a keyboard
     and a big screen, so small/touch viewports get told to come back on
     desktop instead of a broken battlefield. Pure CSS — no JS. --}}
<div class="desktop-gate">
    <div class="desktop-gate__card">
        <div class="desktop-gate__worm">🪱</div>
        <p class="desktop-gate__kicker">Incoming!</p>
        <h1 class="desktop-gate__title">Bigger Battlefield Required</h1>
        <p class="desktop-gate__text">
            Worms: Armistice needs a keyboard and a proper screen.
            Open this link in a desktop browser to play.
        </p>
        <p class="desktop-gate__hint">Your game will be waiting — it's turn-based, no rush.</p>
    </div>
</div>
