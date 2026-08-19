<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreGameRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // no auth in v1 (hotseat)
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:100'],
            'teams' => ['required', 'array', 'min:2', 'max:4'],
            'teams.*.name' => ['required', 'string', 'max:50'],
            'teams.*.color' => ['required', 'string', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'worms_per_team' => ['required', 'integer', 'min:1', 'max:8'],
            'sudden_death_round' => ['required', 'integer', 'min:1', 'max:100'],
            'world_size' => ['required', 'in:small,medium,large'],
        ];
    }

    public function messages(): array
    {
        return [
            'teams.min' => 'A game needs at least 2 teams.',
            'teams.max' => 'A game supports at most 4 teams.',
            'teams.*.color.regex' => 'Team colours must be hex values like #e84545.',
        ];
    }
}
