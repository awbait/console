import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultAction, defaultListAction } from "./fieldErrors";
import { arrayDefaultItems, nextArrayOnAdd, SchemaForm } from "./SchemaForm";

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

describe("a number field with a default", () => {
  const nums = {
    type: "object",
    properties: {
      replicas: { title: "Реплики", type: "integer", default: 3 },
      ratio: { title: "Доля", type: "number" },
    },
  };
  const render = (value: Record<string, unknown>, chartDefaults?: Record<string, unknown>) =>
    renderToStaticMarkup(<SchemaForm schema={nums} value={value} onChange={() => {}} chartDefaults={chartDefaults} />);

  test("shows the default in grey and offers to take it in", () => {
    const html = render({});
    expect(html).toContain('placeholder="по умолчанию 3"');
    expect(count(html, defaultAction.insert)).toBe(1);
  });

  test("a filled number field offers to let go of its value", () => {
    expect(render({ replicas: 5 })).toContain(defaultAction.reset);
  });

  test("a values.yaml answer counts, and is offered as the number it reads as", () => {
    const html = render({}, { ratio: "0.5" });
    expect(html).toContain('placeholder="по умолчанию 0.5"');
    expect(count(html, defaultAction.insert)).toBe(2);
  });

  test("an answer that is not a number is shown but not offered", () => {
    const html = render({ replicas: 1 }, { ratio: "auto" });
    expect(html).toContain('placeholder="по умолчанию auto"');
    expect(html).not.toContain(defaultAction.insert);
  });
});

describe("a list field with a default", () => {
  const pgHba = {
    type: "object",
    properties: {
      pg_hba: {
        type: "array",
        title: "Правила доступа pg_hba.conf",
        items: { type: "string", minLength: 1 },
        default: [
          "local   all             all                             trust",
          "hostssl all             all          all                md5",
        ],
      },
      tolerations: {
        type: "array",
        title: "Правила допуска",
        items: { type: "string" },
        default: [],
      },
      extraRules: {
        type: "array",
        title: "Дополнительные правила",
        items: { type: "string" },
      },
    },
  };
  const render = (value: Record<string, unknown>, props: { lockedPaths?: string[]; chartDefaults?: Record<string, unknown> } = {}) =>
    renderToStaticMarkup(<SchemaForm schema={pgHba} value={value} onChange={() => {}} {...props} />);

  test("shows default items in preview and offers to copy them without storing them", () => {
    const html = render({});
    expect(html).toContain(defaultListAction.label);
    expect(html).toContain("local   all             all                             trust");
    expect(html).toContain("hostssl all             all          all                md5");
    expect(count(html, defaultAction.insert)).toBe(1);
    expect(html).not.toContain(defaultAction.reset);
  });

  test("offers to reset once the order holds its own list", () => {
    const html = render({ pg_hba: ["hostssl mydb myuser 10.0.0.0/8 md5"] });
    expect(html).toContain(defaultAction.reset);
    expect(html).not.toContain(defaultListAction.label);
  });

  test("reads a non-empty default list from values.yaml too", () => {
    const html = render({}, { chartDefaults: { extraRules: ["host all all 127.0.0.1/32 md5"] } });
    expect(html).toContain("host all all 127.0.0.1/32 md5");
    expect(count(html, defaultAction.insert)).toBe(2);
    expect(arrayDefaultItems(pgHba.properties.tolerations, undefined, "/tolerations")).toBeUndefined();
  });

  test("hides the copy action when the list is locked", () => {
    const html = render({}, { lockedPaths: ["/pg_hba"] });
    expect(html).not.toContain(defaultAction.insert);
    expect(html).toContain("local   all             all                             trust");
  });

  test("adding an entry on top of defaults copies the defaults first so Helm never drops them", () => {
    const defaults = arrayDefaultItems(pgHba.properties.pg_hba, undefined, "/pg_hba");
    const firstAdd = nextArrayOnAdd([], defaults, pgHba.properties.pg_hba, pgHba);
    expect(firstAdd).toEqual([
      "local   all             all                             trust",
      "hostssl all             all          all                md5",
      undefined,
    ]);
    // Once the user has their own list, adding another row only appends one row.
    const secondAdd = nextArrayOnAdd(["custom rule"], defaults, pgHba.properties.pg_hba, pgHba);
    expect(secondAdd).toEqual(["custom rule", undefined]);
  });
});
