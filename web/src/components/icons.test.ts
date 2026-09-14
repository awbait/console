import { describe, expect, test } from "bun:test";
import { categoryGlyphs } from "./CategoryIcons";
import { CATEGORY_ICON_CHOICES, categoryIcon, categoryIconName } from "./icons";

describe("category icon choices", () => {
  test("preserves every saved picker choice for the built-in category", () => {
    for (const { id, Icon } of CATEGORY_ICON_CHOICES) {
      expect(categoryIconName(id, "uncategorized")).toBe(id);
      expect(categoryIcon(id, "uncategorized")).toBe(Icon);
    }
  });

  test("uses a tag only when the built-in category has no saved icon", () => {
    expect(categoryIcon("", "uncategorized")).toBe(categoryGlyphs.tag);
    expect(categoryIcon("", "custom")).toBe(categoryGlyphs.box);
    expect(categoryIcon("box", "uncategorized")).toBe(categoryGlyphs.box);
  });
});
