// What keeps an unfinished form alive through maintenance.
//
// While maintenance is on the server refuses everything, a draft included, so
// the only place left to put a half-filled order is the browser. The shell asks
// every open form to save itself the moment before it swaps the page for the
// lock screen (saveOpenForms), and the form offers the copy back when it is
// opened again (readStash). Nothing is saved at any other time: a copy that
// appeared after an ordinary reload would be a surprise, not a rescue.

const PREFIX = "console.formStash:";
// A copy older than this is not offered: whoever left it has moved on.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface Stash<T> {
  saved_at: string;
  data: T;
}

export function writeStash<T>(key: string, data: T): void {
  try {
    const s: Stash<T> = { saved_at: new Date().toISOString(), data };
    localStorage.setItem(PREFIX + key, JSON.stringify(s));
  } catch {
    // Storage full or switched off: there is nowhere else to put it.
  }
}

export function readStash<T>(key: string, now: number = Date.now()): Stash<T> | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const s = JSON.parse(raw) as Stash<T>;
    if (!s?.saved_at || now - new Date(s.saved_at).getTime() > MAX_AGE_MS) {
      localStorage.removeItem(PREFIX + key);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function dropStash(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // Nothing to do: a copy that cannot be removed cannot be read either.
  }
}

// The forms open right now, each with the function that saves it.
const savers = new Set<() => boolean>();

// registerForm adds an open form; the returned function takes it off again. The
// saver returns whether it had anything worth keeping.
export function registerForm(save: () => boolean): () => void {
  savers.add(save);
  return () => {
    savers.delete(save);
  };
}

// saveOpenForms saves every open form and reports whether any of them kept
// something, so the lock screen can say so.
export function saveOpenForms(): boolean {
  let any = false;
  for (const save of savers) {
    try {
      if (save()) any = true;
    } catch {
      // One form failing to save must not keep the others from it.
    }
  }
  return any;
}
