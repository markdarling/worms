<?php

/**
 * Vercel Serverless Function Entry Point
 * 
 * This file forwards all requests to Laravel's public/index.php
 * when running on Vercel Serverless Functions.
 */

// Ensure SQLite database exists in /tmp for serverless environment
$dbPath = '/tmp/database.sqlite';
if (!file_exists($dbPath)) {
    touch($dbPath);
    
    // Run migrations on first request
    require __DIR__ . '/../vendor/autoload.php';
    $app = require_once __DIR__ . '/../bootstrap/app.php';
    
    $kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
    $kernel->call('migrate', ['--force' => true]);
}

require __DIR__ . '/../public/index.php';
