<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Turn extends Model
{
    /** Turns are immutable records — no updated_at column. */
    public const UPDATED_AT = null;

    protected $fillable = [
        'game_id',
        'number',
        'player_position',
        'commands',
        'snapshot_after',
        'state_hash',
    ];

    protected function casts(): array
    {
        return [
            'number' => 'integer',
            'player_position' => 'integer',
            'commands' => 'array',
            'snapshot_after' => 'array',
        ];
    }

    public function game(): BelongsTo
    {
        return $this->belongsTo(Game::class);
    }
}
