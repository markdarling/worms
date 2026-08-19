<?php

namespace App\Support;

/**
 * A pool of classic-Worms-flavoured worm names. Names are shuffled once per
 * game at creation time and dealt out so no two worms in a match share a name
 * (pool size 48 covers the 4 teams x 8 worms maximum). The chosen names are
 * stored in the game config, so the sim never needs this class.
 */
class WormNames
{
    private const POOL = [
        'Boggy B', 'Spadge', 'Clagnut', 'Suzette', 'Nobby', 'Piddler',
        'Big Keith', 'Dodgy Phil', 'Beryl', 'Doreen', 'Norman', 'Gareth',
        'Tallulah', 'Vera', 'Trevor', 'Nigel', 'Barry', 'Colin',
        'Derek', 'Cedric', 'Maureen', 'Wurzel', 'Bungle', 'Pikelet',
        'Gladys', 'Ethel', 'Bazzer', 'Winston', 'Fusebox', 'Grubby',
        'Snapper', 'Terry', 'Sheila', 'Bronwyn', 'Chuck', 'Muriel',
        'Damp Patch', 'Wiggler', 'Stumpy', 'Captain Custard', 'Mildred', 'Bert',
        'Aggie', 'Roly', 'Sausage', 'Perkins', 'Nutmeg', 'Squirmy Stan',
    ];

    /**
     * Deal $teams hands of $wormsPerTeam unique names each.
     *
     * @return array<int, array<int, string>> one array of names per team
     */
    public static function deal(int $teams, int $wormsPerTeam): array
    {
        $pool = self::POOL;
        shuffle($pool);

        $hands = [];
        for ($i = 0; $i < $teams; $i++) {
            $hands[] = array_splice($pool, 0, $wormsPerTeam);
        }

        return $hands;
    }
}
