// mulberry32: the state is a 32-bit unsigned integer.
function step(s) {
  s = (s + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [s, ((t ^ (t >>> 14)) >>> 0) / 4294967296];
}

export function createRng(seed) {
  let state = seed >>> 0;
  const rng = {
    next() {
      const [s, value] = step(state);
      state = s;
      return value;
    },
    int(min, max) {
      return min + Math.floor(rng.next() * (max - min + 1));
    },
    percent(chance) {
      const roll = rng.int(1, 100);
      return { roll, success: roll <= chance };
    },
    getState() {
      return state;
    },
    setState(newState) {
      state = newState >>> 0;
    },
  };
  return rng;
}
