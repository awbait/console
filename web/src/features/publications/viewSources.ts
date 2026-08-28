// Where a new version's view document comes from when it is not written from
// scratch. A chart's new version usually differs from the last one by a field
// or two, while the document around that field - views, tabs, actions - is the
// same, and it was being carried over through the clipboard.

import type { PublicationVersion, ViewDocument } from "@/api/types";
import { compareSemver } from "@/lib/semver";

// What an unwritten version starts from: the shape of a document and nothing
// in it. It lives here because two things need the same answer - the editor,
// which opens on it, and the offer below, which has nothing to give from a
// version that never got past it.
export const VIEW_TEMPLATE = `{
  "views": {
    "order": {
      "include": [],
      "overrides": {}
    }
  }
}
`;

const EMPTY_DOC = canonical(JSON.parse(VIEW_TEMPLATE));

// A document to take, and the version it belongs to.
export interface ViewSource {
  version: string;
  doc: ViewDocument;
}

// canonical renders a value with its object keys in order, so two documents
// that differ only in the order they were typed in compare equal.
function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const obj = v as Record<string, unknown>;
  const body = Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
    .join(",");
  return `{${body}}`;
}

// written reports whether a document says anything at all: an empty one is the
// template every version opens on, and offering it is offering nothing.
function written(doc: ViewDocument | null | undefined): doc is ViewDocument {
  return !!doc && canonical(doc) !== EMPTY_DOC;
}

// viewSources lists the versions this one can take a document from, newest
// first - the same order the version switcher uses, so the version just below
// is the first thing under the cursor.
//
// Only approved documents are offered. An approved document is the one its
// version actually serves, and it was read by somebody before it got there; a
// draft is unfinished by definition, and carrying it forward would spread the
// unfinished work rather than the working document.
//
// Versions above are offered too: which document fits is a question about the
// chart's fields, and the complaints under the editor answer it the moment the
// document lands there.
export function viewSources(versions: PublicationVersion[] | null, current: string): ViewSource[] {
  return (versions ?? [])
    .filter((v) => v.chart_version !== current && written(v.approved_view_json))
    .map((v) => ({ version: v.chart_version, doc: v.approved_view_json as ViewDocument }))
    .sort((a, b) => compareSemver(b.version, a.version));
}
