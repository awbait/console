import { useEffect, useState } from "react";

// useMatchMedia follows a media query the way CSS does, so a layout rule can be
// stated once in the classes and once in the arithmetic without the two drifting
// apart as the window changes.
export function useMatchMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const sync = () => setMatches(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [query]);
  return matches;
}
