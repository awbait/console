import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SchemaForm } from "./SchemaForm";

// A string the view wants typed over several lines: a banner, a message
// template, addresses one per line. The widget picks the control and nothing
// else: the value stays a string with its line breaks, and a string without
// the hint keeps the single-line field it always had.
const schema = {
  type: "object",
  properties: {
    motd: { title: "Сообщение дня", type: "string" },
    note: { title: "Заметка", type: "string" },
  },
};

const markup = (value: Record<string, unknown>, view?: Record<string, unknown>) =>
  renderToStaticMarkup(<SchemaForm schema={schema} value={value} onChange={() => {}} view={view} />);

describe("a string drawn as a textarea", () => {
  test("the view's widget swaps the input for a textarea with the value, line breaks kept", () => {
    const html = markup({ motd: "first\nsecond" }, { overrides: { motd: { "ui:widget": "textarea" } } });
    expect(html).toContain("<textarea");
    expect(html).toContain("first\nsecond");
    // The other string is untouched: one textarea on the page, one input.
    expect(html.match(/<textarea/g)?.length).toBe(1);
    expect(html).toContain("<input");
  });

  test("the hint written in the schema itself works the same", () => {
    const own = {
      type: "object",
      properties: { motd: { title: "Сообщение дня", type: "string", "ui:widget": "textarea" } },
    };
    const html = renderToStaticMarkup(<SchemaForm schema={own} value={{}} onChange={() => {}} />);
    expect(html).toContain("<textarea");
  });

  test("without the hint a string is a single-line field", () => {
    const html = markup({ motd: "x" });
    expect(html).not.toContain("<textarea");
  });
});
