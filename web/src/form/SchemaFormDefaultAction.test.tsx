import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultAction } from "./fieldErrors";
import { SchemaForm } from "./SchemaForm";

// A text field the chart has a default for: empty, it shows the default in grey
// and stores nothing; the action beside its label takes the default in as text
// to edit, or, once the field holds a value, lets go of it again.
const schema = {
  type: "object",
  properties: {
    config: { title: "Конфигурация", type: "string", default: "a = 1\nb = 2", "ui:widget": "textarea" },
    host: { title: "Хост", type: "string", default: "localhost" },
    note: { title: "Заметка", type: "string" },
    tags: { title: "Теги", type: "array", items: { type: "string", default: "x" } },
  },
};

const markup = (value: Record<string, unknown>, props: { lockedPaths?: string[]; chartDefaults?: Record<string, unknown> } = {}) =>
  renderToStaticMarkup(<SchemaForm schema={schema} value={value} onChange={() => {}} {...props} />);

const count = (html: string, s: string) => html.split(s).length - 1;

describe("the default-value action of a text field", () => {
  test("an empty field with a default offers to take it in", () => {
    const html = markup({});
    // One per field with a default: the multi-line config and the host.
    expect(count(html, defaultAction.insert)).toBe(2);
    expect(html).not.toContain(defaultAction.reset);
  });

  test("a filled field offers to let go of its value instead", () => {
    const html = markup({ config: "a = 5" });
    expect(count(html, defaultAction.reset)).toBe(1);
    expect(count(html, defaultAction.insert)).toBe(1);
  });

  test("a field without a default has no action", () => {
    const only = { type: "object", properties: { note: schema.properties.note } };
    const html = renderToStaticMarkup(<SchemaForm schema={only} value={{ note: "x" }} onChange={() => {}} />);
    expect(html).not.toContain(defaultAction.insert);
    expect(html).not.toContain(defaultAction.reset);
  });

  test("the chart's values.yaml answer counts as a default too", () => {
    const only = { type: "object", properties: { note: schema.properties.note } };
    const html = renderToStaticMarkup(
      <SchemaForm schema={only} value={{}} onChange={() => {}} chartDefaults={{ note: "from values" }} />,
    );
    expect(html).toContain(defaultAction.insert);
  });

  test("a locked field has no action", () => {
    expect(markup({}, { lockedPaths: ["/config", "/host"] })).not.toContain(defaultAction.insert);
  });

  test("a list row has no label line, so no action", () => {
    const only = { type: "object", properties: { tags: schema.properties.tags } };
    const html = renderToStaticMarkup(<SchemaForm schema={only} value={{ tags: [""] }} onChange={() => {}} />);
    expect(html).not.toContain(defaultAction.insert);
  });
});
