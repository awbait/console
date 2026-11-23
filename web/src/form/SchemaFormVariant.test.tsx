import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { collectErrors, newArrayItem, SchemaForm } from "./SchemaForm";

// A list whose entries come in two shapes. A chart writes it as a oneOf, and a
// product tab hands one entry to the form as the whole schema - so the form's
// root is the variant itself, not an object with properties.
const certificate = {
  title: "Сертификат",
  oneOf: [
    {
      title: "Из хранилища",
      type: "object",
      properties: {
        name: { title: "Короткое имя", type: "string", minLength: 2 },
        domain: { title: "Домен", type: "string", minLength: 1 },
        source: { const: "vault", "ui:widget": "hidden" },
        path: { title: "Путь", type: "string", minLength: 1 },
      },
      required: ["name", "domain", "path"],
    },
    {
      title: "Готовый секрет",
      type: "object",
      properties: {
        domain: { title: "Домен", type: "string", minLength: 1 },
        source: { const: "existing", "ui:widget": "hidden" },
        secretName: { title: "Имя секрета", type: "string", minLength: 1 },
      },
      required: ["domain", "source", "secretName"],
    },
  ],
};

const markup = (value: Record<string, unknown>) =>
  renderToStaticMarkup(
    <SchemaForm schema={certificate} value={value} onChange={() => {}} />,
  );

describe("SchemaForm with a variant at the root", () => {
  test("builds the form instead of sending the reader to the YAML editor", () => {
    const html = markup({});
    expect(html).not.toContain("Нет структурной схемы");
    expect(html).toContain("Вариант");
  });

  test("shows the fields of the variant the value matches", () => {
    expect(markup({ source: "vault" })).toContain("Путь");
    expect(markup({ source: "vault" })).not.toContain("Имя секрета");
    expect(markup({ source: "existing" })).toContain("Имя секрета");
    expect(markup({ source: "existing" })).not.toContain("Путь");
  });

  test("an entry written before the discriminator existed still opens as one", () => {
    // No "source" at all: matchVariant falls back to the required keys, which
    // is what keeps orders made before the field was added editable.
    expect(markup({ name: "web", domain: "*.example.ru", path: "certs/web" })).toContain("Путь");
  });

  test("the discriminator itself stays out of the form", () => {
    expect(markup({ source: "vault" })).not.toContain("ui:widget");
    expect(markup({ source: "vault" })).not.toContain(">source<");
  });

  // The form renders the chosen variant; validation has always walked it. Both
  // halves have to agree on which variant the value is, or a form with every
  // field filled in would refuse to save.
  test("validation answers for the same variant the form drew", () => {
    expect(collectErrors(certificate, { source: "existing", domain: "a.test" }).has("/secretName")).toBe(
      true,
    );
    expect(
      collectErrors(certificate, { source: "existing", domain: "a.test", secretName: "tls" }).size,
    ).toBe(0);
    expect(collectErrors(certificate, { source: "vault", name: "web", domain: "a.test" }).has("/path")).toBe(
      true,
    );
  });
});

// RabbitMQ vhosts: a bare name or an object with the name and its settings. The
// chart writes the choice as an anyOf, and the branches cannot both fit one
// value, so the form reads it as a variant the same as a oneOf.
const vhost = {
  title: "Виртуальный хост",
  anyOf: [
    { type: "string", title: "Только имя", minLength: 1 },
    {
      type: "object",
      title: "Имя и параметры",
      required: ["name"],
      properties: {
        name: { type: "string", title: "Имя виртуального хоста", minLength: 1 },
        deletionPolicy: { type: "string", title: "Политика удаления", enum: ["delete", "retain"] },
      },
    },
  ],
};

const vhostMarkup = (schema: Record<string, unknown>, value: unknown) =>
  renderToStaticMarkup(
    <SchemaForm schema={schema} value={value as Record<string, unknown>} onChange={() => {}} />,
  );

describe("SchemaForm with an anyOf at the root", () => {
  test("builds the form instead of sending the reader to the YAML editor", () => {
    const html = vhostMarkup(vhost, {});
    expect(html).not.toContain("Нет структурной схемы");
    expect(html).toContain("Вариант");
  });

  test("an object value opens the branch with fields", () => {
    expect(vhostMarkup(vhost, { name: "billing" })).toContain("Политика удаления");
  });

  test("a bare name opens the string branch, wherever it stands in the list", () => {
    expect(vhostMarkup(vhost, "billing")).not.toContain("Политика удаления");
    const reversed = { ...vhost, anyOf: [...vhost.anyOf].reverse() };
    expect(vhostMarkup(reversed, "billing")).not.toContain("Политика удаления");
    expect(vhostMarkup(reversed, { name: "billing" })).toContain("Политика удаления");
  });

  test("validation follows the branch the value is", () => {
    expect(collectErrors(vhost, {}).has("/name")).toBe(true);
    expect(collectErrors(vhost, { name: "billing" }).size).toBe(0);
    expect(collectErrors(vhost, "" as unknown as Record<string, unknown>).has("")).toBe(true);
    expect(collectErrors(vhost, "billing" as unknown as Record<string, unknown>).size).toBe(0);
  });

  test("a new row of such a list starts as the branch with fields", () => {
    expect(newArrayItem({ type: "array", items: vhost }, {})).toEqual({});
  });
});
