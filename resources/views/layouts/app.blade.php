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
</body>
</html>
