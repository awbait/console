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

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// mergeUnder returns `current` with `seed` filled in underneath it: a key the
// current values do not have takes the seeded value, a key they do have keeps
// theirs. Objects are walked, everything else (arrays, scalars) is taken whole -
// a half-merged array is nobody's data.
export function mergeUnder(current: Values, seed: Values): Values {
  return reseed(current, {}, seed);
}

// reseed is mergeUnder for a seed that arrives a second time, rendered for
// another stand: a value the previous seed put there and nobody touched is
// still the portal's, so the new seed replaces it. Anything that differs from
// what was seeded is the person's and stays. `previous` is the seed applied
// before, empty on the first one.
export function reseed(current: Values, previous: Values, seed: Values): Values {
  const out: Values = { ...current };
  for (const [key, seeded] of Object.entries(seed)) {
    const mine = out[key];
    const was = previous[key];
    if (mine === undefined || mine === "" || mine === null || (was !== undefined && same(mine, was))) {
      out[key] = seeded;
      continue;
    }
    if (isObject(mine) && isObject(seeded)) {
      out[key] = reseed(mine, isObject(was) ? was : {}, seeded);
    }
  }
  return out;
}
