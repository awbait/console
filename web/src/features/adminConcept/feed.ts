import { useEffect, useRef, useState } from "react";
import { actionText } from "@/features/users/text";
import { AUDIT, type AuditEvent, LIVE_POOL } from "./data";
import { T } from "./text";

// useAuditFeed is the demo's stand-in for an SSE topic of audit rows: the
// static history plus one pooled row per tick, newest first. `fresh` names the
// rows that arrived while the page was open, so the list can mark them.
export function useAuditFeed(tick: number) {
  const [rows, setRows] = useState<AuditEvent[]>(AUDIT);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const seen = useRef(0);
  useEffect(() => {
    if (tick === 0 || tick === seen.current) return;
    seen.current = tick;
    const base = LIVE_POOL[(tick - 1) % LIVE_POOL.length];
    const id = `live-${tick}`;
    setRows((prev) => [{ ...base, id, min: 0 }, ...prev]);
    setFresh((prev) => new Set(prev).add(id));
  }, [tick]);
  return { rows, fresh };
}

// auditAction words what happened. The two journals the portal keeps today
// already have their wording (features/users/text); the kinds a full trail adds
// are worded by the concept's own table.
export function auditAction(e: Pick<AuditEvent, "source" | "type">): string {
  // The concept's table first: it also covers order events the users page has
  // no wording for yet ("updated" shows there as a raw code).
  if (T.auditAction[e.type]) return T.auditAction[e.type];
  if (e.source === "order" || e.source === "publication") {
    return actionText({ source: e.source, event_type: e.type });
  }
  return e.type;
}

export function actorName(e: Pick<AuditEvent, "actor">): string {
  return e.actor ?? T.audit.system;
}
