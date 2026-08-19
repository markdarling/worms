<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>@yield('title', 'Worms: Armistice')</title>
    @vite(['resources/css/game.css', 'resources/css/admin.css'])
</head>
<body>
    @yield('content')
    {{-- Admin pages stay usable on a phone; everything game-facing is
         desktop-only (keyboard controls, big battlefield). --}}
    @unless (request()->is('admin*'))
        @include('partials.desktop-only')
    @endunless
</body>
</html>
