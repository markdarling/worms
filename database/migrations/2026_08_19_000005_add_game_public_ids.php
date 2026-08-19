<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Games become link-addressed: an unguessable public_id replaces the numeric
// id in every URL (pages and API), so knowing a game exists requires having
// been handed its link. The numeric id stays as the internal primary key.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('games', function (Blueprint $table) {
            $table->string('public_id', 64)->nullable()->unique()->after('id');
        });

        foreach (DB::table('games')->whereNull('public_id')->pluck('id') as $id) {
            DB::table('games')->where('id', $id)->update(['public_id' => bin2hex(random_bytes(20))]);
        }
    }

    public function down(): void
    {
        Schema::table('games', function (Blueprint $table) {
            $table->dropColumn('public_id');
        });
    }
};
