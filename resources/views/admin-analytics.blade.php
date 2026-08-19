@extends('layouts.app')

@section('title', 'Analytics — Worms: Armistice')

@php
    // Chart geometry: thin rounded bars on a recessive baseline, one hue per
    // chart (validated vs the cream surface), tooltips via native <title>.
    $chart = function (array $series, string $key, string $color) {
        $w = 900; $h = 180; $pad = 24;
        $n = count($series);
        $max = max(1, max(array_column($series, $key)));
        $slot = ($w - $pad * 2) / $n;
        $barW = max(4, min(18, $slot - 2));
        $out = '';
        $peakIdx = array_search($max, array_column($series, $key));
        foreach ($series as $i => $row) {
            $v = $row[$key];
            $bh = $v > 0 ? max(3, ($h - $pad * 2) * $v / $max) : 0;
            $x = $pad + $i * $slot + ($slot - $barW) / 2;
            $y = $h - $pad - $bh;
            if ($v > 0) {
                $out .= sprintf(
                    '<g class="bar"><rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="4" ry="4" fill="%s"><title>%s — %d</title></rect>',
                    $x, $y, $barW, $bh + 4, $color, $row['label'], $v
                );
                // Direct label on the peak only.
                if ($i === $peakIdx) {
                    $out .= sprintf('<text x="%.1f" y="%.1f" class="bar-label" text-anchor="middle">%d</text>', $x + $barW / 2, $y - 6, $v);
                }
                $out .= '</g>';
            }
            // Sparse x labels: first, last, and every 7th.
            if ($i === 0 || $i === $n - 1 || $i % 7 === 0) {
                $out .= sprintf('<text x="%.1f" y="%.1f" class="axis-label" text-anchor="middle">%s</text>', $x + $barW / 2, $h - 6, $row['label']);
            }
        }
        $base = sprintf('<line x1="%d" y1="%d" x2="%d" y2="%d" class="baseline"/>', $pad, $h - $pad, $w - $pad, $h - $pad);
        return sprintf('<svg viewBox="0 0 %d %d" role="img" preserveAspectRatio="xMidYMid meet">%s%s</svg>', $w, $h, $base, $out);
    };
@endphp

@section('content')
<div class="lobby">
    <h1>Analytics</h1>

    <nav class="admin-tabs">
        <a href="{{ route('admin') }}">Games</a>
        <a href="{{ route('admin.analytics') }}" class="is-active">Analytics</a>
    </nav>

    <div class="lobby-card">
        <div class="admin-stats">
            <div class="admin-stat"><strong>{{ $totals['games'] }}</strong><span>games</span></div>
            <div class="admin-stat"><strong>{{ $totals['active'] }}</strong><span>active</span></div>
            <div class="admin-stat"><strong>{{ $totals['finished'] }}</strong><span>finished</span></div>
            <div class="admin-stat"><strong>{{ $totals['turns'] }}</strong><span>turns played</span></div>
            <div class="admin-stat"><strong>{{ $totals['avgTurns'] }}</strong><span>avg turns / game</span></div>
        </div>

        <h2>Games created per day <small>(last 30 days)</small></h2>
        <div class="admin-chart">{!! $chart($series, 'games', '#3f9628') !!}</div>

        <h2>Turns played per day <small>(last 30 days)</small></h2>
        <div class="admin-chart">{!! $chart($series, 'turns', '#2f6fc0') !!}</div>

        <details class="admin-table">
            <summary>Data table</summary>
            <table>
                <thead><tr><th>Date</th><th>Games created</th><th>Turns played</th></tr></thead>
                <tbody>
                    @foreach (array_reverse($series) as $row)
                        <tr><td>{{ $row['label'] }}</td><td>{{ $row['games'] }}</td><td>{{ $row['turns'] }}</td></tr>
                    @endforeach
                </tbody>
            </table>
        </details>
    </div>
</div>
@endsection
