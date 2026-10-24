/** Adds the given deltas to the numeric story variables (missing ones start at 0). */
export function addVar(state, changes) {
  state.vars ??= {};
  for (const [name, delta] of Object.entries(changes)) {
    state.vars[name] = (state.vars[name] ?? 0) + delta;
  }
}
