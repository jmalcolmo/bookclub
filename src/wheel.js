// Pure geometry/winner math for the spin-the-wheel picker. No DOM or DB deps, so
// this is the single source of truth for BOTH the view (src/views/picker.js) and
// the Node action test (tests/run.mjs) — the invariant that "the slice under the
// pointer equals the announced winner" is only meaningful if both share this code.

// Rotation (in degrees, clockwise) that brings slice `target`'s CENTER under the
// pointer at the top, after `turns` full spins for drama. Slices are laid out
// clockwise from the top, each `360 / n` wide.
export function spinRotation(target, n, turns) {
  const seg = 360 / n;
  return turns * 360 + (360 - (target * seg + seg / 2));
}

// Which slice ends up under the top pointer for a given final rotation. The
// winner is READ FROM the geometry (not chosen separately), so the announced
// name can never disagree with where the marker points.
export function winnerIndex(rotation, n) {
  const seg = 360 / n;
  const localAtTop = ((-rotation) % 360 + 360) % 360;
  return Math.floor(localAtTop / seg) % n;
}
