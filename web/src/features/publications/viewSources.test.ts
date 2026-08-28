import { describe, expect, test } from "bun:test";
import type { PublicationVersion, ViewDocument } from "@/api/types";
import { VIEW_TEMPLATE, viewSources } from "./viewSources";

const doc = (name: string) => ({ views: { [name]: {} } }) as unknown as ViewDocument;
const template = JSON.parse(VIEW_TEMPLATE) as ViewDocument;

// row is a stored version carrying whichever of the two documents it has.
function row(
  chart_version: string,
  docs: { approved?: ViewDocument | null; draft?: ViewDocument | null } = {},
): PublicationVersion {
  return {
    chart_version,
    approved_view_json: docs.approved ?? null,
    view_json: docs.draft ?? null,
  } as PublicationVersion;
}

describe("viewSources", () => {
  test("lists the other versions newest first", () => {
    const got = viewSources(
      [
        row("1.0.0", { approved: doc("old") }),
        row("2.0.0", { approved: doc("new") }),
        row("1.4.0", { approved: doc("mid") }),
      ],
      "1.5.0",
    );
    expect(got.map((s) => s.version)).toEqual(["2.0.0", "1.4.0", "1.0.0"]);
  });

  test("leaves out the version being edited", () => {
    expect(viewSources([row("1.5.0", { approved: doc("self") })], "1.5.0")).toEqual([]);
  });

  test("offers the approved document, never the draft beside it", () => {
    const got = viewSources([row("1.4.0", { approved: doc("approved"), draft: doc("draft") })], "1.5.0");
    expect(Object.keys(got[0].doc.views ?? {})).toEqual(["approved"]);
  });

  test("offers nothing from a version whose document is only a draft", () => {
    expect(viewSources([row("1.4.0", { draft: doc("draft") })], "1.5.0")).toEqual([]);
  });

  test("offers nothing from a version that never got past the template", () => {
    expect(viewSources([row("1.4.0", { approved: template })], "1.5.0")).toEqual([]);
    // Key order is how it was typed, not what the document says.
    const shuffled = { views: { order: { overrides: {}, include: [] } } } as unknown as ViewDocument;
    expect(viewSources([row("1.4.0", { approved: shuffled })], "1.5.0")).toEqual([]);
  });

  test("offers nothing when there is nothing to offer", () => {
    expect(viewSources([row("1.4.0")], "1.5.0")).toEqual([]);
    expect(viewSources([], "1.5.0")).toEqual([]);
    expect(viewSources(null, "1.5.0")).toEqual([]);
  });
});
