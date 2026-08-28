// What an order's status allows, as opposed to how it looks - the look is
// StatusBadge's business, this is the lifecycle.
//
// It exists because the same five states were written out in four places: the
// orders table (offering an upgrade), the order page (the same), the support
// overview (counting real services) and the order graph (deciding whether it
// can be drawn on). A sixth state would have had to be remembered in all four,
// and nothing would have reminded anyone.

import type { RequestStatus } from "./types";

// A live order is one whose create merge request is merged: its manifests are
// in Git and the cluster is being kept to them. That single fact is what all
// four questions were really asking - such an order can be edited, upgraded and
// deleted, and it counts as a service that exists. The backend enforces the
// same rule from the other side, as the states that may advance to MR_CREATED
// (internal/provisioning/state_machine.go).
export const LIVE_STATUSES: RequestStatus[] = [
  "MR_MERGED",
  "DEPLOYING",
  "HEALTHY",
  "DEGRADED",
  "ARGO_MISSING",
];

// isLive reports whether the order stands for a service that exists. Takes a
// plain string too: a backend ahead of this build can send a state the union
// does not know, and an unknown state is not live.
export function isLive(status: RequestStatus | string): boolean {
  return (LIVE_STATUSES as string[]).includes(status);
}
