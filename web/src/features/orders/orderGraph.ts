// Decisions the graph of an order page makes before it renders anything: whether
// this chart version has a graph at all, whether the person may draw on it, and
// whether what they drew is a change to the service or only to the picture.
//
// Kept apart from the component so each of those can be checked on its own - the
// canvas itself needs a DOM, these do not.

import yaml from "js-yaml";
import type { OrderRequest, RequestMR, ViewDocument } from "../../api/types";
import { productTabs } from "../../components/products/genericView";
import { type GraphMapping, readEntries } from "../graph/mapping";
import { type ActiveValuesEditor, valuesEditorFor } from "./valuesEditors";

type Values = Record<string, unknown>;

// graphFor is what the order page asks: does this version declare a graph, and
// which editor draws it. Same answer the order form gets, from the same block of
// the same document, so the two screens can never disagree about it.
export function graphFor(doc: ViewDocument | null | undefined): ActiveValuesEditor | null {
  return valuesEditorFor(doc);
}

// Why the canvas is read-only, in the user's words. null means it is not.
export type GraphLock =
  | null
  | { reason: "draft"; text: string }
  | { reason: "open_mr"; text: string }
  | { reason: "drifted"; text: string }
  | { reason: "status"; text: string }
  | { reason: "forbidden"; text: string };

// Statuses an update can be opened from: the create merge request has to be
// merged first, which is the same rule the backend enforces (CanTransition into
// MR_CREATED, see internal/provisioning/service.go).
const EDITABLE_STATUSES = new Set([
  "MR_MERGED",
  "DEPLOYING",
  "HEALTHY",
  "DEGRADED",
  "ARGO_MISSING",
]);

// graphLock decides whether the graph is a drawing surface or a picture. Every
// case that says "picture" says why, because a canvas that silently refuses to
// be dragged reads as broken.
//
// None of these reasons mentions a merge request, a branch or Git: how the portal
// records a change is its own business, and the person on this screen is saving
// their service. So an unfinished change is "still being saved" - which is what
// it is from where they stand - and the one place that names the machinery is the
// banner on the order page, addressed to whoever has to go and review it.
//
// The draft case is not a restriction so much as a redirect: a draft is edited on
// the order form, where the graph sits beside the form and the YAML, and two
// places to change one value would drift apart.
export function graphLock(
  r: Pick<OrderRequest, "status" | "drifted">,
  modifiable: boolean,
  openMR: RequestMR | null | undefined,
): GraphLock {
  if (!modifiable) {
    return { reason: "forbidden", text: "У вас нет прав менять этот сервис, граф открыт для просмотра." };
  }
  if (r.status === "DRAFT") {
    return {
      reason: "draft",
      text: "Это черновик: продолжите его оформление, чтобы рисовать граф.",
    };
  }
  if (openMR) {
    return {
      reason: "open_mr",
      text: "Предыдущее изменение сервиса ещё сохраняется. Граф можно будет править, когда оно применится.",
    };
  }
  if (r.drifted) {
    return {
      reason: "drifted",
      text: "Сервис изменили в обход портала. Сначала подтяните его текущее состояние, иначе правки лягут поверх чужих.",
    };
  }
  if (!EDITABLE_STATUSES.has(r.status)) {
    return {
      reason: "status",
      text: "Сервис ещё разворачивается. Граф можно будет менять, когда он заработает.",
    };
  }
  return null;
}

// Whether two sets of values say the same thing. Compared as YAML rather than
// field by field, because that is what the backend compares to decide if there is
// a change worth a merge request at all: a key order or a value respelled into
// the same YAML is not a change (see internal/provisioning/service.go).
export function sameValues(a: Values, b: Values): boolean {
  try {
    return yaml.dump(a, { sortKeys: true }) === yaml.dump(b, { sortKeys: true });
  } catch {
    return false;
  }
}

// The tabs of this chart may look at one entry by index ("/policies/0/ingress"),
// while the graph writes an entry per owner workload: draw an arrow from a second
// workload and its rules land in an entry those tabs never show. The graph is the
// only screen that can see this coming, so it says so.
//
// It is a property of the document, not of the portal: a chart whose tabs iterate
// the whole array never triggers it.
export function entriesHiddenFromTabs(
  doc: ViewDocument | null | undefined,
  mapping: GraphMapping,
  entryCount: number,
): boolean {
  if (entryCount <= 1) return false;
  const firstOnly = `${mapping.entries}/0/`;
  return productTabs(doc).some((t) => t.items?.startsWith(firstOnly));
}

// How many entries the graph's section currently holds. Anything that is not an
// array reads as none - the graph will generate the section from scratch.
export function entryCount(values: Values, mapping: GraphMapping): number {
  const list = readEntries(values, mapping.entries);
  return Array.isArray(list) ? list.length : 0;
}
