import { type Dispatch, type SetStateAction, useEffect, useState } from "react";

// Local UI preferences: which parts of the shell the user folded away. They
// belong to the browser, not to the account - nothing here is worth a round
// trip to the server, and losing it on every reload is exactly the annoyance
// this fixes. Keys are namespaced like the ones already in use (idp.activeTeam,
// idp-theme).
const PREFIX = "idp.ui.";

// useStored is useState that survives a reload. Reads once on mount and writes
// on every change; a browser with storage blocked (private mode, quota, a
// corrupted entry) simply does not remember the preference, which is never a
// reason to fail a render.
export function useStored<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      /* storage unavailable - the preference just will not survive a reload */
    }
  }, [key, value]);

  return [value, setValue];
}
