import { useEffect, useRef, useState } from "react";
import { dropStash, readStash, registerForm, type Stash, writeStash } from "./formStash";

// useFormStash lets a form survive maintenance (see formStash.ts). The form
// passes what it holds on every render; the hook keeps the latest copy, hands
// it over when the shell asks for it on the way to the lock screen, and offers
// back a copy found for this key when the form opens.
//
// key: the form and the person filling it in, so a shared browser never offers
// somebody else's order. Empty turns the hook off.
// worth: whether the copy holds anything a person typed.
export function useFormStash<T>(
  key: string,
  snapshot: T,
  worth: (s: T) => boolean,
): {
  // The copy waiting to be restored, or null.
  stash: Stash<T> | null;
  // Removes the copy: restored, refused, or the form was saved for real.
  drop: () => void;
} {
  const latest = useRef(snapshot);
  latest.current = snapshot;
  const worthRef = useRef(worth);
  worthRef.current = worth;

  const [stash, setStash] = useState<Stash<T> | null>(() => (key ? readStash<T>(key) : null));
  useEffect(() => {
    setStash(key ? readStash<T>(key) : null);
  }, [key]);

  useEffect(() => {
    if (!key) return;
    return registerForm(() => {
      if (!worthRef.current(latest.current)) return false;
      writeStash(key, latest.current);
      return true;
    });
  }, [key]);

  return {
    stash,
    drop: () => {
      if (key) dropStash(key);
      setStash(null);
    },
  };
}
