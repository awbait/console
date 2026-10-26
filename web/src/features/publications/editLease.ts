import { useCallback, useEffect, useReducer, useRef } from "react";
import { api, HttpError } from "@/api/client";
import type { Editor } from "@/api/types";
import { subscribe } from "@/lib/sse";

// The edit lease on a version document, from the page's side.
//
// One person edits a version document at a time (the server holds the lease,
// see the lock routes). This page takes the lease when it opens, renews it
// while it is open, and gives it back on the way out. When somebody else holds
// it, the page reads instead: it follows their saves through the version's
// event stream and offers the document the moment they let go.
//
// What the page is in is a small state machine, kept pure so it can be tested
// without a browser: nextLease decides, useEditLease talks to the server and
// the clock.

// How often a held lease is renewed. The server lets a lease lapse after a
// minute without renewal, so this leaves two misses before a sleeping laptop
// loses its document.
export const RENEW_MS = 20_000;
// How often a reader asks who holds the document, in case the event stream is
// down. The stream is the primary signal; this is the floor.
export const POLL_MS = 20_000;

export type LeaseState =
  // The page does not want the lease: a reader without rights to edit, a
  // version on approval, a version out of use.
  | { kind: "off" }
  // The first request is in flight; the editor is read-only until it answers.
  | { kind: "pending" }
  // This page holds the document. editor is null when the server could not be
  // asked (a network error on the way in): the page edits on, and the next
  // renewal or save settles it.
  | { kind: "mine"; editor: Editor | null }
  // Somebody else holds it; the page reads and follows their saves.
  | { kind: "locked"; holder: Editor }
  // Nobody holds it any more; the reader may take it with one press.
  | { kind: "free" }
  // This page held it and it was taken away (an administrator, or a lapse
  // somebody else used). The editor keeps what was typed, so it can be copied.
  // holder is who has it now, null when nobody does.
  | { kind: "lost"; holder: Editor | null };

export type LeaseEvent =
  // The page starts wanting the lease, or stops.
  | { type: "start" }
  | { type: "stop" }
  // The server gave this page the lease.
  | { type: "acquired"; editor: Editor }
  // The server refused: a take, a renewal or a save met somebody else's lease.
  | { type: "refused"; holder: Editor }
  // A look at who holds the document, by the reader.
  | { type: "observed"; holder: Editor | null }
  // The take could not be asked at all; the page edits on and tries again.
  | { type: "failed" }
  // The person let go of what they had typed after losing the lease: back to
  // reading, as whoever holds it now or as a free document.
  | { type: "resign" };

// nextLease is the whole rulebook: what the page is in after an event.
export function nextLease(state: LeaseState, event: LeaseEvent): LeaseState {
  switch (event.type) {
    case "start":
      return state.kind === "off" ? { kind: "pending" } : state;
    case "stop":
      return { kind: "off" };
    case "acquired":
      return state.kind === "off" ? state : { kind: "mine", editor: event.editor };
    case "refused":
      if (state.kind === "off") return state;
      // Losing a held lease is a different thing from meeting one: the person
      // may have unsaved text on the screen.
      if (state.kind === "mine") return { kind: "lost", holder: event.holder };
      if (state.kind === "lost") return { kind: "lost", holder: event.holder };
      return { kind: "locked", holder: event.holder };
    case "observed":
      switch (state.kind) {
        case "locked":
        case "free":
          return event.holder ? { kind: "locked", holder: event.holder } : { kind: "free" };
        case "lost":
          return { kind: "lost", holder: event.holder };
        default:
          // The holder does not poll; a stale answer must not demote it.
          return state;
      }
    case "failed":
      return state.kind === "pending" ? { kind: "mine", editor: null } : state;
    case "resign":
      if (state.kind !== "lost") return state;
      return state.holder ? { kind: "locked", holder: state.holder } : { kind: "free" };
  }
}

// reading reports whether the page follows the document from outside rather
// than writing it: the text in the editor is then the server's, not the
// person's. A lost lease with unsaved text is the exception: the text stays
// until the person lets go of it (resign).
export function readsAlong(state: LeaseState, dirty: boolean): boolean {
  switch (state.kind) {
    case "locked":
    case "free":
      return true;
    case "lost":
      return !dirty;
    default:
      return false;
  }
}

// lockedBy reads the holder out of an API failure, when that is what it was.
export function lockedBy(e: unknown): Editor | null {
  return e instanceof HttpError && e.code === "edit_locked" && e.editor ? e.editor : null;
}

export interface EditLease {
  state: LeaseState;
  // take asks for the lease (force: the administrator's take-over). Resolves
  // to whether the page holds it afterwards.
  take: (force?: boolean) => Promise<boolean>;
  // release gives the lease back if the page holds it. Fire-and-forget on the
  // way out; keepalive lets it outlive the tab.
  release: (opts?: { keepalive?: boolean }) => Promise<void>;
  // refused is for the page's own requests that met somebody else's lease (a
  // save, a submit): the state follows what the server said.
  refused: (holder: Editor) => void;
  // resign lets go of unsaved text after a lost lease: back to reading.
  resign: () => void;
}

// useEditLease runs the lease for one version document. wanted says whether
// the page would edit at all; onRemoteSave is called when the holder saves,
// so the reading page can fetch the new document.
export function useEditLease(
  pubId: string,
  version: string,
  wanted: boolean,
  onRemoteSave: () => void,
): EditLease {
  const [state, dispatch] = useReducer(nextLease, wanted ? { kind: "pending" } : { kind: "off" });
  // The latest state for callbacks that outlive a render (timers, cleanup).
  const stateRef = useRef(state);
  stateRef.current = state;
  const remoteSave = useRef(onRemoteSave);
  remoteSave.current = onRemoteSave;

  const take = useCallback(
    async (force = false): Promise<boolean> => {
      try {
        const editor = await api.acquireEditLock(pubId, version, force);
        dispatch({ type: "acquired", editor });
        return true;
      } catch (e) {
        const holder = lockedBy(e);
        if (holder) {
          dispatch({ type: "refused", holder });
        } else {
          dispatch({ type: "failed" });
        }
        return false;
      }
    },
    [pubId, version],
  );

  const release = useCallback(
    async (opts?: { keepalive?: boolean }) => {
      if (stateRef.current.kind !== "mine") return;
      try {
        await api.releaseEditLock(pubId, version, opts);
      } catch {
        // The lease lapses on its own within the minute; nothing to tell.
      }
    },
    [pubId, version],
  );

  // Wanting the lease is decided by data that arrives after the first render
  // (who the person is, what state the version is in), so it is an event.
  useEffect(() => {
    dispatch({ type: wanted ? "start" : "stop" });
  }, [wanted]);

  // Pending: ask once.
  useEffect(() => {
    if (state.kind !== "pending") return;
    void take();
  }, [state.kind, take]);

  // Mine: renew on a timer. A refusal here is the lease taken away.
  useEffect(() => {
    if (state.kind !== "mine") return;
    const id = setInterval(() => void take(), RENEW_MS);
    return () => clearInterval(id);
  }, [state.kind, take]);

  // Reading: follow the document through its stream, and ask who holds it on
  // every change there and on a slow timer besides. The stream carries only
  // signals, so the answer is always fetched.
  const reading = state.kind === "locked" || state.kind === "free" || state.kind === "lost";
  useEffect(() => {
    if (!reading) return;
    let gone = false;
    const check = () => {
      api
        .getEditLock(pubId, version)
        .then((r) => {
          if (!gone) dispatch({ type: "observed", holder: r.editing });
        })
        .catch(() => {});
    };
    const stop = subscribe(
      `/api/v1/publications/${encodeURIComponent(pubId)}/versions/${encodeURIComponent(version)}/events`,
      {
        edit_acquired: check,
        edit_released: check,
        view_saved: () => {
          remoteSave.current();
          check();
        },
      },
      "version",
    );
    const id = setInterval(check, POLL_MS);
    return () => {
      gone = true;
      stop();
      clearInterval(id);
    };
  }, [reading, pubId, version]);

  // Closing the tab is the one exit the cleanup below does not see. The lease
  // would lapse on its own within the minute; saying so now spares the next
  // person the wait.
  useEffect(() => {
    const bye = () => void release({ keepalive: true });
    window.addEventListener("pagehide", bye);
    return () => window.removeEventListener("pagehide", bye);
  }, [release]);

  const refused = useCallback((holder: Editor) => dispatch({ type: "refused", holder }), []);
  const resign = useCallback(() => dispatch({ type: "resign" }), []);

  return { state, take, release, refused, resign };
}
