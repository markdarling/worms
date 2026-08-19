// Deterministic PRNG + seed hashing. The whole async-multiplayer design rests on
// every client deriving identical randomness from (gameSeed, turnNumber).

// mulberry32 — fast, decent-quality 32-bit PRNG. Returns () => float in [0, 1).
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic int hash combiner (murmur3-style finalizers folded together).
// hashSeed(gameSeed, turnNumber) -> turnSeed. Order-sensitive.
export function hashSeed(...ints) {
  let h = 0x9e3779b9;
  for (let i = 0; i < ints.length; i++) {
    let x = ints[i] | 0;
    x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
    x ^= x >>> 16;
    h = (Math.imul(h ^ x, 0x27d4eb2f) + 0x165667b1) | 0;
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

// cyrb53-style string hash -> 16-char hex. Used for stateHash().
export function hashString(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (
    (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0')
  );
}
