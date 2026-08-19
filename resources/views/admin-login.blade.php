@extends('layouts.app')

@section('title', 'Admin — Worms: Armistice')

@section('content')
<div class="lobby">
    <h1>Admin</h1>

    <div class="lobby-card lobby-card--narrow">
        @if ($setup)
            <h2>Set the admin password</h2>
            <p class="lobby-hint">First visit — choose a password (stored hashed, never in the code).</p>
        @endif
        <form class="lobby-form" method="POST" action="{{ $setup ? route('admin.setup') : route('admin.login') }}">
            @csrf
            <div class="lobby-form-row">
                <label class="lobby-form-label" for="admin-code">Password</label>
                <input class="lobby-form-input" type="password" id="admin-code" name="code"
                       autocomplete="{{ $setup ? 'new-password' : 'current-password' }}"
                       minlength="{{ $setup ? 6 : 1 }}" autofocus required>
            </div>
            @error('code')
                <p class="lobby-error">{{ $message }}</p>
            @enderror
            <button class="lobby-form-submit" type="submit">{{ $setup ? 'Set password' : 'Enter' }}</button>
        </form>
    </div>
</div>
@endsection
