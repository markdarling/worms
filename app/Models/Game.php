<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Game extends Model
{
    protected $fillable = [
        'name',
        'seed',
        'config',
        'status',
        'current_turn',
        'snapshot',
        'winner',
    ];

    protected function casts(): array
    {
        return [
            'seed' => 'integer',
            'config' => 'array',
            'current_turn' => 'integer',
            'snapshot' => 'array',
        ];
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
