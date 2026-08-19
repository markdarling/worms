// Per-tick input encoding. One tick input is a plain object (contract shape):
// { left, right, jump, backflip, aimUp, aimDown, charge, fire,
//   weapon: string|null, fuse: 1-8|null, target: {x,y}|null }
// fuse 1-5 = grenade-family timer; 1-8 = girder placement angle (expansion
// contract). target is reused by teleport/airstrike/homing/girder/donkey/
// napalm/minestrike/carpetbomb/selectworm.
// encodeCommands RLE-compresses runs of identical inputs; round-trip is
// lossless with respect to the normalized form.

const BOOLS = ['left', 'right', 'jump', 'backflip', 'aimUp', 'aimDown', 'charge', 'fire'];

export function normalizeInput(raw) {
  const r = raw || {};
  const o = {
    left: !!r.left, right: !!r.right, jump: !!r.jump, backflip: !!r.backflip,
    aimUp: !!r.aimUp, aimDown: !!r.aimDown, charge: !!r.charge, fire: !!r.fire,
    weapon: typeof r.weapon === 'string' ? r.weapon : null,
    fuse: Number.isInteger(r.fuse) && r.fuse >= 1 && r.fuse <= 8 ? r.fuse : null,
    target: null,
  };
  if (r.target && typeof r.target.x === 'number' && typeof r.target.y === 'number') {
    o.target = { x: r.target.x, y: r.target.y };
  }
  return o;
}

function boolMask(o) {
  let m = 0;
  for (let i = 0; i < BOOLS.length; i++) if (o[BOOLS[i]]) m |= 1 << i;
  return m;
}

function sameInput(a, b) {
  if (boolMask(a) !== boolMask(b)) return false;
  if (a.weapon !== b.weapon || a.fuse !== b.fuse) return false;
  const at = a.target, bt = b.target;
  if (!at !== !bt) return false;
  if (at && (at.x !== bt.x || at.y !== bt.y)) return false;
  return true;
}

// -> { v: 1, n: totalTicks, runs: [[count, boolMask, weapon|0, fuse|0, [x,y]|0], ...] }
export function encodeCommands(tickInputs) {
  const runs = [];
  let prev = null;
  for (let i = 0; i < tickInputs.length; i++) {
    const cur = normalizeInput(tickInputs[i]);
    if (prev && sameInput(prev, cur)) {
      runs[runs.length - 1][0]++;
    } else {
      runs.push([
        1,
        boolMask(cur),
        cur.weapon === null ? 0 : cur.weapon,
        cur.fuse === null ? 0 : cur.fuse,
        cur.target === null ? 0 : [cur.target.x, cur.target.y],
      ]);
    }
    prev = cur;
  }
  return { v: 1, n: tickInputs.length, runs };
}

export function decodeCommands(encoded) {
  const out = [];
  const runs = encoded.runs || [];
  for (let i = 0; i < runs.length; i++) {
    const [count, mask, weapon, fuse, target] = runs[i];
    for (let k = 0; k < count; k++) {
      const o = {
        left: !!(mask & 1), right: !!(mask & 2), jump: !!(mask & 4), backflip: !!(mask & 8),
        aimUp: !!(mask & 16), aimDown: !!(mask & 32), charge: !!(mask & 64), fire: !!(mask & 128),
        weapon: weapon === 0 ? null : weapon,
        fuse: fuse === 0 ? null : fuse,
        target: target === 0 ? null : { x: target[0], y: target[1] },
      };
      out.push(o);
    }
  }
  return out;
}
