<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Network multiplayer: each player (team seat) gets an unguessable token that
// doubles as their invite link and their credential for committing turns.
// Games get a share_key protecting the creator's links page, and a mode:
// 'hotseat' (one device, no token enforcement) or 'remote' (token required).
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('players', function (Blueprint $table) {
            $table->string('token', 64)->nullable()->unique()->after('position');
        });

        Schema::table('games', function (Blueprint $table) {
            $table->string('share_key', 64)->nullable()->after('winner');
            $table->string('mode', 16)->default('hotseat')->after('status');
        });

        // Backfill existing rows so every seat is addressable.
        foreach (DB::table('players')->whereNull('token')->pluck('id') as $id) {
            DB::table('players')->where('id', $id)->update(['token' => bin2hex(random_bytes(20))]);
        }
        foreach (DB::table('games')->whereNull('share_key')->pluck('id') as $id) {
            DB::table('games')->where('id', $id)->update(['share_key' => bin2hex(random_bytes(20))]);
        }
    }

    public function down(): void
    {
        Schema::table('players', function (Blueprint $table) {
            $table->dropColumn('token');
        });
        Schema::table('games', function (Blueprint $table) {
            $table->dropColumn(['share_key', 'mode']);
        });
    }
};
