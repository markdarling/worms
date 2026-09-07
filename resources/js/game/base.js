// The app may be mounted under a sub-path (e.g. https://host/worms). Laravel
// knows the base from the request and hands it to us via window.APP_BASE
// (see game.blade.php); everything that builds a root-relative URL in the
// client goes through here so it works at "/" and under a prefix alike.
export const BASE = (window.APP_BASE || '').replace(/\/$/, '');

export function withBase(path) {
    return BASE + (path.startsWith('/') ? path : '/' + path);
}
