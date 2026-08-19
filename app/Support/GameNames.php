<?php

namespace App\Support;

/**
 * Worms-flavoured random game names — "Soggy Kerfuffle", "Glorious Standoff".
 * Used to prefill the lobby form and as the fallback when no name is given.
 */
class GameNames
{
    private const ADJECTIVES = [
        'Sunday', 'Soggy', 'Glorious', 'Reckless', 'Muddy', 'Explosive',
        'Diplomatic', 'Grubby', 'Slippery', 'Heroic', 'Petty', 'Sneaky',
        'Cheeky', 'Damp', 'Furious', 'Polite', 'Unnecessary', 'Midnight',
        'Teatime', 'Wobbly', 'Grand', 'Tiny', 'Endless', 'Awkward',
    ];

    private const NOUNS = [
        'Skirmish', 'Standoff', 'Quarrel', 'Rumble', 'Vendetta', 'Kerfuffle',
        'Squabble', 'Fracas', 'Melee', 'Tiff', 'Ruckus', 'Showdown',
        'Grudge Match', 'Punch-Up', 'Disagreement', 'Uprising', 'Scuffle',
        'Armistice', 'Bombardment', 'Escalation',
    ];

    public static function random(): string
    {
        return self::ADJECTIVES[random_int(0, count(self::ADJECTIVES) - 1)]
            . ' '
            . self::NOUNS[random_int(0, count(self::NOUNS) - 1)];
    }
}
