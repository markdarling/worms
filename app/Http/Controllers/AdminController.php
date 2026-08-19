<?php

namespace App\Http\Controllers;

use App\Models\Game;
use App\Models\Setting;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\View\View;

class AdminController extends Controller
{
    private const PASSWORD_KEY = 'admin_password_hash';

    public function index(Request $request): View
    {
        // First visit ever: no password exists — set one (stored hashed, never in code).
        if (Setting::get(self::PASSWORD_KEY) === null) {
            return view('admin-login', ['setup' => true]);
        }

        if (! $request->session()->get('is_admin', false)) {
            return view('admin-login', ['setup' => false]);
        }

        return view('admin', [
            // updated_at bumps on every turn commit — "recent activity" order.
            'games' => Game::with('players')->orderByDesc('updated_at')->get(),
        ]);
    }

    /** First-run only: create the password, then log straight in. */
    public function setup(Request $request): RedirectResponse
    {
        abort_if(Setting::get(self::PASSWORD_KEY) !== null, 403);

        $data = $request->validate([
            'code' => ['required', 'string', 'min:6', 'max:64'],
        ]);

        Setting::put(self::PASSWORD_KEY, Hash::make($data['code']));
        $request->session()->put('is_admin', true);

        return redirect()->route('admin');
    }

    public function login(Request $request): RedirectResponse
    {
        $hash = Setting::get(self::PASSWORD_KEY);
        $code = (string) $request->input('code', '');

        if ($hash === null || ! Hash::check($code, $hash)) {
            return redirect()->route('admin')->withErrors(['code' => 'Wrong code.']);
        }

        $request->session()->put('is_admin', true);

        return redirect()->route('admin');
    }

    public function logout(Request $request): RedirectResponse
    {
        $request->session()->forget('is_admin');

        return redirect()->route('admin');
    }
}
