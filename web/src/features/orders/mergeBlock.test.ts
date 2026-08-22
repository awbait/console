import { describe, expect, test } from "bun:test";
import { mergeBlockReason } from "./mergeBlock";

describe("mergeBlockReason", () => {
  test("a known cause is said in the reader's language", () => {
    expect(mergeBlockReason("not_approved")).toBe("оно ждёт согласования");
    expect(mergeBlockReason("conflict")).toMatch(/другим изменением/);
  });

  test("causes that mean the same thing read the same", () => {
    expect(mergeBlockReason("need_rebase")).toBe(mergeBlockReason("conflict"));
    expect(mergeBlockReason("policies_denied")).toBe(mergeBlockReason("security_policy_violations"));
  });

  test("a cause this build has never heard of is shown as it came", () => {
    // Not a nicety: without it the person is told the change could not be
    // applied and nothing else, and nobody can find out why afterwards.
    expect(mergeBlockReason("gitlab_18_invented_this")).toBe("gitlab_18_invented_this");
  });

  test("no cause is no phrase, not an empty one", () => {
    expect(mergeBlockReason("")).toBe("");
  });
});
