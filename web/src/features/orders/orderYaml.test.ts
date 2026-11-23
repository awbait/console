import { describe, expect, it } from "bun:test";
import type { ViewDocument } from "@/api/types";
import { pruneEmpty } from "@/form/SchemaForm";
import {
  hasYamlChanges,
  parseSavedValues,
  parseYamlDocument,
  parseYamlValues,
  touchedStampedFields,
  yamlLock,
  yamlText,
} from "./orderYaml";

describe("yamlLock", () => {
  it("allows editing a live, non-drifted order with no open MR", () => {
    expect(yamlLock({ status: "HEALTHY", drifted: false }, true, null)).toBeNull();
    expect(yamlLock({ status: "CONSOLE_SAVED", drifted: false }, true, null)).toBeNull();
    expect(yamlLock({ status: "GIT_SAVED", drifted: false }, true, null)).toBeNull();
  });

  it("blocks each disallowed state with its specific reason", () => {
    expect(yamlLock({ status: "HEALTHY", drifted: false }, false, null)?.reason).toBe("forbidden");
    expect(yamlLock({ status: "DRAFT", drifted: false }, true, null)?.reason).toBe("draft");
    expect(
      yamlLock({ status: "HEALTHY", drifted: false }, true, {
        id: "1",
        request_id: "req-1",
        gitlab_project_id: 1,
        mr_iid: 2,
        mr_url: "https://gl/mr/2",
        mr_status: "opened",
        action: "update",
        created_at: "",
      })?.reason,
    ).toBe("open_mr");
    expect(yamlLock({ status: "HEALTHY", drifted: true }, true, null)?.reason).toBe("drifted");
    expect(yamlLock({ status: "MR_CREATED", drifted: false }, true, null)?.reason).toBe("status");
  });
});

describe("parseYamlDocument", () => {
  it("parses valid mapping YAML and keeps ISO dates as strings", () => {
    const res = parseYamlDocument("auth:\n  database: app\n  date: 2026-01-01\n  replicas: 2\n  enabled: true\n");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.values).toEqual({
        auth: { database: "app", date: "2026-01-01", replicas: 2, enabled: true },
      });
    }
  });

  it("rejects empty and comment-only documents", () => {
    const empty = parseYamlDocument("   \n\n");
    expect(empty).toEqual({ ok: false, kind: "empty", message: yamlText.emptyDoc });

    const comments = parseYamlDocument("# just a comment\n");
    expect(comments).toEqual({ ok: false, kind: "empty", message: yamlText.emptyDoc });
  });

  it("rejects non-object roots (array or scalar)", () => {
    expect(parseYamlDocument("- one\n- two\n")).toEqual({
      ok: false,
      kind: "not_object",
      message: yamlText.notObject,
    });
    expect(parseYamlDocument("just-a-string")).toEqual({
      ok: false,
      kind: "not_object",
      message: yamlText.notObject,
    });
  });

  it("reports line and column on syntax errors and duplicate keys", () => {
    const bad = parseYamlDocument("auth:\n  database: [\n");
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.kind).toBe("syntax");
      expect(bad.line).toBeGreaterThanOrEqual(2);
      expect(bad.column).toBeGreaterThanOrEqual(1);
    }

    const dup = parseYamlDocument("a: 1\na: 2\n");
    expect(dup.ok).toBe(false);
    if (!dup.ok) {
      expect(dup.kind).toBe("syntax");
    }
  });
});

describe("hasYamlChanges", () => {
  it("ignores key order, comments and trailing whitespace", () => {
    const saved = "a: 1\nb: 2\n";
    expect(hasYamlChanges(saved, "# note\nb: 2\na: 1\n")).toBe(false);
  });

  it("detects real value edits and explicit empty collections", () => {
    const saved = "a: 1\nitems:\n  - x\n";
    expect(hasYamlChanges(saved, "a: 2\nitems:\n  - x\n")).toBe(true);
    expect(hasYamlChanges(saved, "a: 1\nitems: []\n")).toBe(true);
  });

  it("treats broken syntax edits as dirty so Discard stays available", () => {
    expect(hasYamlChanges("a: 1\n", "a: [")).toBe(true);
  });
});

describe("touchedStampedFields", () => {
  it("reports defaults and legacy namespace mirror fields modified by the user", () => {
    const doc: ViewDocument = {
      views: { order: { namespace: "/namespace/namespaceName" } },
      defaults: { "/auth/creator": "console", "/auth/team": "{{.Team}}" },
    };
    const saved = {
      namespace: { namespaceName: "team-a" },
      auth: { creator: "console", team: "core", database: "app" },
    };
    const next = {
      namespace: { namespaceName: "team-b" },
      auth: { creator: "manual", team: "core", database: "app" },
    };
    expect(touchedStampedFields(doc, saved, next)).toEqual([
      "auth.creator",
      "namespace.namespaceName",
    ]);
  });

  it("returns empty when only regular fields changed", () => {
    const doc: ViewDocument = {
      views: { order: {} },
      defaults: { "/auth/creator": "console" },
    };
    const saved = { auth: { creator: "console", replicas: 1 } };
    const next = { auth: { creator: "console", replicas: 3 } };
    expect(touchedStampedFields(doc, saved, next)).toEqual([]);
  });
});

describe("parseYamlValues and parseSavedValues", () => {
  it("keeps unquoted ISO dates as strings so pruneEmpty never drops them", () => {
    const raw = "releaseDate: 2026-12-31\nupdatedAt: 2026-01-15T10:00:00Z\n";
    const parsed = parseYamlValues(raw);
    expect(parsed).toEqual({
      releaseDate: "2026-12-31",
      updatedAt: "2026-01-15T10:00:00Z",
    });
    expect(pruneEmpty(parsed)).toEqual(parsed);
    expect(parseSavedValues(raw)).toEqual(parsed);
  });

  it("returns empty object on blank YAML and rejects scalar or array roots", () => {
    expect(parseYamlValues("")).toEqual({});
    expect(parseYamlValues("   \n")).toEqual({});
    expect(() => parseYamlValues("hello")).toThrow(yamlText.notObject);
    expect(() => parseYamlValues("- a\n- b\n")).toThrow(yamlText.notObject);
    expect(parseSavedValues("- a\n- b\n")).toEqual({});
  });
});
