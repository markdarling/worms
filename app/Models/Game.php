<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Game extends Model
{
    protected $fillable = [
        'public_id',
        'name',
        'seed',
        'config',
        'status',
        'mode',
        'current_turn',
        'next_position',
        'snapshot',
        'winner',
        'share_key',
    ];

    protected function casts(): array
    {
        return [
            'seed' => 'integer',
            'config' => 'array',
            'current_turn' => 'integer',
            'next_position' => 'integer',
            'snapshot' => 'array',
        ];
    }

    /** All routes (pages and API) address games by their unguessable public_id. */
    public function getRouteKeyName(): string
    {
        return 'public_id';
    }

    protected static function booted(): void
    {
        static::creating(function (Game $game) {
            $game->public_id ??= bin2hex(random_bytes(20));
            $game->share_key ??= bin2hex(random_bytes(20));
        });
    }

    public function players(): HasMany
    {
        return $this->hasMany(Player::class)->orderBy('position');
    }

    public function turns(): HasMany
    {
        return $this->hasMany(Turn::class)->orderBy('number');
    }

    public function isFinished(): bool
    {
        return $this->status === 'finished';
    }
}
