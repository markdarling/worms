<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // The /api/* endpoints are same-origin JSON consumed by the game
        // client (resources/js/game/api.js), which does not send the CSRF
        // token. There is no auth in v1 (hotseat), so CSRF adds no protection
        // here; excluding api/* keeps the fetch wrappers header-free.
        $middleware->validateCsrfTokens(except: ['api/*']);

        // In production the app sits behind a reverse proxy (Caddy) that
        // terminates TLS; trust its X-Forwarded-* headers so url()/asset()
        // emit https and the client IP is the real one. The container only
        // listens on loopback, so trusting every proxy is safe here.
        $middleware->trustProxies(at: '*');
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
    })->create();
