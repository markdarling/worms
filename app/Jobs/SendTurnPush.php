<?php

namespace App\Jobs;

use App\Models\Player;
use App\Models\PushSubscription;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Support\Facades\Log;
use Minishlink\WebPush\Subscription;
use Minishlink\WebPush\WebPush;

/**
 * Web-push "it's your turn" to every subscription a seat has registered.
 *
 * Plain dispatchable (NOT ShouldQueue) — dispatched with dispatchAfterResponse
 * so it runs in-process after the turn-commit response is sent, needing no
 * queue worker. Dead subscriptions (410/404) are pruned as we go.
 */
class SendTurnPush
{
    use Dispatchable;

    public function __construct(
        private readonly int $playerId,
        private readonly string $gameName,
        private readonly string $teamName,
    ) {
    }

    public function handle(): void
    {
        $publicKey = config('services.webpush.public_key');
        $privateKey = config('services.webpush.private_key');
        if (! $publicKey || ! $privateKey) {
            return; // push not configured — in-page notifications still work
        }

        $player = Player::with('pushSubscriptions')->find($this->playerId);
        if ($player === null || $player->pushSubscriptions->isEmpty()) {
            return;
        }

        try {
            $webPush = new WebPush([
                'VAPID' => [
                    'subject' => config('services.webpush.subject', config('app.url')),
                    'publicKey' => $publicKey,
                    'privateKey' => $privateKey,
                ],
            ]);

            $payload = json_encode([
                'title' => "\u{1F534} Your turn — {$this->teamName}",
                'body' => "{$this->gameName} is waiting for your move.",
                'url' => url('/play/'.$player->token),
                'tag' => 'worms-your-turn-'.$player->game_id,
            ]);

            foreach ($player->pushSubscriptions as $sub) {
                $webPush->queueNotification(Subscription::create([
                    'endpoint' => $sub->endpoint,
                    'keys' => ['p256dh' => $sub->p256dh, 'auth' => $sub->auth],
                ]), $payload);
            }

            foreach ($webPush->flush() as $report) {
                if ($report->isSubscriptionExpired()) {
                    PushSubscription::where('endpoint_hash', hash('sha256', $report->getEndpoint()))
                        ->where('player_id', $player->id)
                        ->delete();
                }
            }
        } catch (\Throwable $e) {
            Log::warning('web-push send failed: '.$e->getMessage());
        }
    }
}
