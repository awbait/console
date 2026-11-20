import type { PublicationEvent } from "@/api/types";
import { adminPublicationText as t } from "./adminPublicationText";

// The publication's journal, put into words. The server records what happened
// as an event type and a payload; this is the one place that turns them into
// a sentence, so the page and its tests agree on every kind of row.

// The actor the discovery reconciler writes events under (models.ActorAutoDiscovery).
export const SYSTEM_ACTOR = "auto-discovery";

export interface JournalLabels {
  category: (id: string) => string;
  team: (id: string) => string;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" ? v : 0);

// describeEvent is the sentence for one journal row. The actor and the time are
// shown beside it, so the sentence names neither. An event type this build
// does not know is shown by its code rather than dropped.
export function describeEvent(e: PublicationEvent, labels: JournalLabels): string {
  const p = e.payload ?? {};
  const v = str(p.chart_version);
  const ev = t.event;
  switch (e.event_type) {
    case "created":
      return ev.created(labels.category(str(p.category_id)), labels.team(str(p.owner_team)));
    case "discovered":
      return ev.discovered;
    case "updated": {
      // A proposal: the draft fields it set, or cleared (an empty value is
      // the proposal taken back).
      const cat = p.draft_category_id;
      const owner = p.draft_owner_team;
      if (typeof cat === "string" && cat !== "") return ev.proposedCategory(labels.category(cat));
      if (typeof owner === "string" && owner !== "") return ev.proposedOwner(labels.team(owner));
      return ev.proposalReverted;
    }
    case "submitted":
      return ev.submitted;
    case "withdrawn":
      return ev.withdrawn;
    case "approved": {
      // Approved with values applied (or applied outright by an admin): one
      // sentence per value, else the plain approval.
      const parts: string[] = [];
      if (str(p.category_id)) parts.push(ev.appliedCategory(labels.category(str(p.category_id))));
      if (str(p.owner_team)) parts.push(ev.appliedOwner(labels.team(str(p.owner_team))));
      return parts.length ? parts.join(" ") : ev.approved;
    }
    case "rejected":
      return ev.rejected(str(p.comment));
    case "refreshed":
      return ev.refreshed(num(p.versions));
    case "adopted":
      return ev.adopted(labels.team(str(p.owner_team)), labels.category(str(p.category_id)));
    case "version_updated":
      return ev.versionUpdated(v);
    case "version_submitted":
      return ev.versionSubmitted(v);
    case "version_withdrawn":
      return ev.versionWithdrawn(v);
    case "version_approved":
      return ev.versionApproved(v);
    case "version_rejected":
      return ev.versionRejected(v, str(p.comment));
    case "version_orderable":
      return p.orderable === false ? ev.versionNotOrderable(v) : ev.versionOrderable(v);
    case "version_recommended":
      return ev.versionRecommended(v);
    case "version_deprecated":
      return str(p.note) ? ev.versionDeprecatedNote(v, str(p.note)) : ev.versionDeprecated(v);
    case "version_hidden":
      return ev.versionHidden(v);
    case "version_undeprecated":
      return ev.versionUndeprecated(v);
    case "version_unhidden":
      return ev.versionUnhidden(v);
    default:
      return ev.unknown(e.event_type);
  }
}

// actorLabel names who did it: the directory's name when the server found
// one, the reconciler by its own name, otherwise the subject as it is.
export function actorLabel(e: Pick<PublicationEvent, "actor" | "actor_name">): string {
  if (e.actor === SYSTEM_ACTOR) return t.journalSystemActor;
  return e.actor_name || e.actor;
}
