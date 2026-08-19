<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('turns', function (Blueprint $table) {
            $table->id();
            $table->foreignId('game_id')->constrained()->cascadeOnDelete();
            $table->integer('number');
            $table->integer('player_position');
            $table->json('commands');
            $table->json('snapshot_after');
            $table->string('state_hash');
            $table->timestamp('created_at')->nullable();

            $table->unique(['game_id', 'number']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('turns');
    }
};
