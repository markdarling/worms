<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PushSubscription extends Model
{
    protected $fillable = [
        'player_id',
        'endpoint',
        'endpoint_hash',
        'p256dh',
        'auth',
    ];

    public function player(): BelongsTo
    {
        return $this->belongsTo(Player::class);
    }
}
