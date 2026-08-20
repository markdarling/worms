<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Async meta layer: turn taunts, whose-turn-is-next denormalised on games
// (the PHP server never simulates — the committing client reports it), and
// web-push subscriptions per seat.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('turns', function (Blueprint $table) {
            $table->string('taunt', 160)->nullable()->after('state_hash');
        });

        Schema::table('games', function (Blueprint $table) {
            $table->unsignedTinyInteger('next_position')->nullable()->after('current_turn');
        });

        Schema::create('push_subscriptions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('player_id')->constrained()->cascadeOnDelete();
            $table->text('endpoint');
            $table->string('endpoint_hash', 64); // sha256(endpoint) — for upserts
            $table->string('p256dh', 255);
            $table->string('auth', 255);
            $table->timestamps();
            $table->unique(['player_id', 'endpoint_hash']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('push_subscriptions');
        Schema::table('games', function (Blueprint $table) {
            $table->dropColumn('next_position');
        });
        Schema::table('turns', function (Blueprint $table) {
            $table->dropColumn('taunt');
        });
    }
};
