// Merging seeded values into values a person is already editing.
//
// The order form opens, asks the portal what the version's "initial" block says
// it should start with, and the answer arrives a moment later. By then somebody
// may have typed, and what they typed has to win: a seed is a starting point,
// not a correction.

type Values = Record<string, unknown>;

function isObject(v: unknown): v is Values {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// mergeUnder returns `current` with `seed` filled in underneath it: a key the
// current values do not have takes the seeded value, a key they do have keeps
// theirs. Objects are walked, everything else (arrays, scalars) is taken whole -
// a half-merged array is nobody's data.
export function mergeUnder(current: Values, seed: Values): Values {
  const out: Values = { ...current };
  for (const [key, seeded] of Object.entries(seed)) {
    const mine = out[key];
    if (mine === undefined || mine === "" || mine === null) {
      out[key] = seeded;
      continue;
    }
    if (isObject(mine) && isObject(seeded)) {
      out[key] = mergeUnder(mine, seeded);
    }
  }
  return out;
}
