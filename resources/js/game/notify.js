// notify.js — "it's your turn" notifications for async games.
//
// Two tiers:
//  1. In-page Notification API — fires while the tab is open but hidden.
//  2. Web push (service worker + VAPID) — fires even with the tab closed.
//     Requires a secure context (HTTPS/localhost) and configured VAPID keys;
//     silently degrades to tier 1 without them.
//
// Permission is requested on the player's first interaction (browsers ignore
// or penalise permission prompts without a user gesture).

let wired = false;
let pushActive = false;

export function initTurnNotifications() {
    if (wired || typeof Notification === 'undefined') return;
    wired = true;
    if (Notification.permission === 'granted') {
        subscribePush();
        return;
    }
    if (Notification.permission !== 'default') return;
    const ask = () => {
        window.removeEventListener('pointerdown', ask);
        window.removeEventListener('keydown', ask);
        Notification.requestPermission()
            .then((perm) => { if (perm === 'granted') subscribePush(); })
            .catch(() => {});
    };
    window.addEventListener('pointerdown', ask);
    window.addEventListener('keydown', ask);
}

export function notifyYourTurn(gameName, teamName) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (!document.hidden) return;
    if (pushActive) return; // the server push covers this seat — avoid doubles
    try {
        const n = new Notification(`🔴 Your turn — ${teamName}`, {
            body: gameName ? `${gameName} is waiting for your move.` : 'The game is waiting for your move.',
            tag: 'worms-your-turn', // one per game state — replaces, never stacks
            icon: '/favicon.ico',
        });
        n.onclick = () => { window.focus(); n.close(); };
    } catch {
        // Notification construction can throw (e.g. Android requires a service
        // worker) — the in-page banner still shows, so fail silently.
    }
}

// ---------------------------------------------------------------------------
// Web push (closed-tab tier)
// ---------------------------------------------------------------------------

async function subscribePush() {
    const vapid = window.VAPID_PUBLIC_KEY;
    const token = window.PLAYER_TOKEN;
    if (!vapid || !token) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !window.isSecureContext) return;
    try {
        const reg = await navigator.serviceWorker.register('/sw.js');
        const sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapid),
        });
        const res = await fetch('/api/push/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ player_token: token, subscription: sub.toJSON() }),
        });
        pushActive = res.ok;
    } catch (e) {
        console.warn('[push] subscribe failed:', e.message);
    }
}

function urlBase64ToUint8Array(base64) {
    const padding = '='.repeat((4 - (base64.length % 4)) % 4);
    const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
}
