import type { StandMode } from "@/api/types";

// Version options shown in OrderMetaCard. For a new order this is the
// publication's orderable allowlist. For an existing draft whose pinned version
// has since left the allowlist, keep the draft's current version in the list so
// the selector displays the current value and lets the user switch off it even
// when only one orderable version remains.
export function formVersionOptions(orderable: string[], draftVersion?: string): string[] {
  if (!draftVersion || orderable.length === 0 || orderable.includes(draftVersion)) {
    return orderable;
  }
  return [...orderable, draftVersion];
}

// Which platform capability gates submitting or upgrading an order on a stand.
// Console-only stands store orders in the portal database and never write to
// GitLab, so they depend only on Harbor and the store ("catalog"), not GitLab
// ("ordering").
export function orderCapabilityForStand(mode?: StandMode): "ordering" | "catalog" {
  return mode === "console" ? "catalog" : "ordering";
}
