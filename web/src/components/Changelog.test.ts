import { describe, expect, test } from "bun:test";
import type { ChangelogEntry } from "@/api/types";
import { plain, withContent } from "./Changelog";

function entry(e: Partial<ChangelogEntry>): ChangelogEntry {
  return { version: "1.0.0", sections: [], ...e };
}

describe("withContent", () => {
  test("a heading with nothing under it is not a release to read", () => {
    // What every release leaves behind in the file until the next change lands.
    expect(withContent([entry({ version: "Unreleased" })])).toEqual([]);
  });

  test("a category with no items counts as nothing", () => {
    expect(withContent([entry({ sections: [{ title: "Добавлено", items: [] }] })])).toEqual([]);
  });

  test("an intro alone is enough", () => {
    const e = entry({ intro: "Релиз про конструктор версии." });
    expect(withContent([e])).toEqual([e]);
  });

  test("the empty heading goes, the versions under it stay", () => {
    const unreleased = entry({ version: "Unreleased" });
    const released = entry({
      version: "0.6.0",
      sections: [{ title: "Добавлено", items: ["Конструктор версии."] }],
    });
    expect(withContent([unreleased, released])).toEqual([released]);
  });
});

describe("plain", () => {
  test("the teaser keeps the words of a link, not its markup", () => {
    expect(plain("Смотрите [каталог](/catalog) целиком")).toBe("Смотрите каталог целиком");
  });

  test("emphasis and code marks do not reach the header", () => {
    expect(plain("**Важно**: поле `values` теперь _обязательное_")).toBe(
      "Важно: поле values теперь обязательное",
    );
  });
});
