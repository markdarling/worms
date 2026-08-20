// Thin fetch wrappers over the game API. Same endpoints a remote client
// will use later — hotseat commits through here so networking is additive.

async function request(url, options = {}) {
    const res = await fetch(url, {
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        ...options,
    });
    if (!res.ok) {
        const err = new Error(`API ${res.status} for ${url}`);
        err.status = res.status;
        try { err.body = await res.json(); } catch { /* ignore */ }
        throw err;
    }
    return res.json();
}

export function fetchGame(id) {
    return request(`/api/games/${id}`);
}

export function fetchTurnsAfter(id, after) {
    return request(`/api/games/${id}/turns?after=${after}`);
}

export function postTurn(id, payload) {
    return request(`/api/games/${id}/turns`, {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

export function postRematch(id, playerToken) {
    return request(`/api/games/${id}/rematch`, {
        method: 'POST',
        body: JSON.stringify({ player_token: playerToken }),
    });
}

export function fetchGameStatus(id) {
    return request(`/api/games/${id}/status`);
}
