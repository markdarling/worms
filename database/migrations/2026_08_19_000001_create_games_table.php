<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('games', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->unsignedInteger('seed');
            $table->json('config');
            $table->enum('status', ['active', 'finished'])->default('active');
            $table->integer('current_turn')->default(1);
            $table->json('snapshot')->nullable();
            $table->string('winner')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('games');
    }
};
