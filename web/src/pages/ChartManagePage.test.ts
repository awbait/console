import { describe, expect, test } from "bun:test";
import { deprecationText, isHiddenVersion, versionHint } from "./ChartManagePage";

// A version taken out of use before it was ever published is hidden, not
// withdrawn from support. The page has to tell them apart on the row alone,
// and the only thing that separates them is whether the version ever carried
// an approved document.
const hidden = { deprecated_at: "2020-09-01T10:00:00Z" };
const withdrawn = {
  deprecated_at: "2020-09-01T10:00:00Z",
  deprecation_note: "перешли на 2.x",
  approved_view_json: { views: {} },
};

describe("isHiddenVersion", () => {
  test("nothing was ever approved, so nobody was ever offered it", () => {
    expect(isHiddenVersion(hidden)).toBe(true);
  });

  test("a version that was published is withdrawn from support, not hidden", () => {
    expect(isHiddenVersion(withdrawn)).toBe(false);
  });

  test("a version in work is neither", () => {
    expect(isHiddenVersion({ approved_view_json: { views: {} } })).toBe(false);
    expect(isHiddenVersion(null)).toBe(false);
  });
});

describe("what the page says about it", () => {
  test("a hidden version is not reported as withdrawn from support", () => {
    expect(deprecationText(hidden)).toBe("Скрыта 1 сентября 2020.");
    expect(versionHint("1.0.0", hidden as never, "")).toBe("скрыта");
  });

  test("a withdrawn version carries the date and the owner's reason", () => {
    expect(deprecationText(withdrawn)).toBe("Снята с поддержки 1 сентября 2020. перешли на 2.x");
    expect(versionHint("1.0.0", withdrawn as never, "")).toBe("снята с поддержки");
  });
});
