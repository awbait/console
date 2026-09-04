import { deref } from "@/form/SchemaForm";
import { createScanner, getLocation, parse as parseJsonc } from "jsonc-parser";
import type { TemplateRef } from "@/api/types";
import { type ChartField, chartFields, nodeAt, properties, rowOf } from "./chartFields";

// What to offer where the cursor stands in a view document.
//
// The keys and their meanings come from the format schema, which the editor
// reads on its own. What it cannot know is the chart: that "items" wants a
// pointer to a list that exists in THIS version, that a column path is written
// against one row of that list, that "include" names a top-level field. This
// module answers that, and it answers it from the text rather than from a parsed
// document: while somebody is typing, the JSON does not parse, and that is
// exactly when the help is wanted.

type Schema = Record<string, any>;

export type Suggestion = {
  value: string;
  // Shown to the right of the suggestion: what the field is called in the chart,
  // or what kind of thing it is when it has no title.
  detail?: string;
  doc?: string;
};

export type Hints = {
  items: Suggestion[];
  // The text being replaced, as offsets into the document.
  from: number;
  to: number;
  // Whether the value has to bring its own quotes: true when the cursor is not
  // inside a string yet.
  quote: boolean;
};

const KIND_LABEL: Record<ChartField["kind"], string> = {
  array: "список",
  object: "объект",
  map: "набор ключей",
  scalar: "значение",
};

// hintsAt returns what belongs at this offset, or null where the chart has
// nothing to say and the format schema is answer enough.
export function hintsAt(
  text: string,
  offset: number,
  chart: Schema | null,
  refs?: TemplateRef[] | null,
): Hints | null {
  const loc = getLocation(text, offset);
  const doc = (parseJsonc(text, [], { allowTrailingComma: true }) ?? {}) as Schema;
  const items = suggest(loc.path, !!loc.isAtPropertyKey, doc, chart, refs ?? null);
  if (items.length === 0) return null;

  // Inside a string the value replaces what is between the quotes; anywhere else
  // it is inserted whole, quotes included.
  const inside = stringAt(text, offset);
  if (inside) return { items, ...inside, quote: false };
  return { items, from: offset, to: offset, quote: true };
}

// stringAt returns what stands between the quotes of the string the cursor is
// in, or null when it is not in one. The answer is read off the text with the
// scanner rather than off the parsed document: a value being typed is a node
// there, but a key being typed is not, and both are strings that must not be
// quoted a second time.
function stringAt(text: string, offset: number): { from: number; to: number } | null {
  const scanner = createScanner(text, true);
  for (scanner.scan(); scanner.getTokenOffset() < offset; scanner.scan()) {
    const start = scanner.getTokenOffset();
    if (text[start] !== '"') continue;
    // A string the scanner could not close ends where it stopped, and the
    // replacement runs to there: that is the half-typed pointer.
    const raw = text.slice(start, start + scanner.getTokenLength());
    const end = start + raw.length - (raw.length > 1 && raw.endsWith('"') ? 1 : 0);
    if (offset <= end) return { from: start + 1, to: end };
  }
  return null;
}

function suggest(
  path: (string | number)[],
  atKey: boolean,
  doc: Schema,
  chart: Schema | null,
  refs: TemplateRef[] | null,
): Suggestion[] {
  const [head, index, key] = path;
  const tail = path[path.length - 2];

  // A key, not a value: the two places where the name itself comes from the
  // chart. Everywhere else the format schema already lists the keys.
  if (atKey) {
    if ((head === "defaults" || head === "initial") && path.length === 2) {
      return fields(chart, chart, { arrays: "index", absolute: true }, "scalar");
    }
    if (head === "views" && tail === "overrides") {
      return names(viewNode(path.slice(0, -2), doc, chart), chart);
    }
    return [];
  }

  // The value of a default or a starting value: what the portal can put there.
  // "initial" is rendered while the order form is still being filled in, so it
  // only takes references the form can already answer.
  if ((head === "defaults" || head === "initial") && path.length === 2) {
    return references(refs, head === "initial");
  }
  if (head === "views" && typeof index === "string") {
    return viewSuggestions(path, doc, chart);
  }
  if (head === "tabs" && typeof index === "number") {
    return tabSuggestions(path, doc, chart);
  }
  if (head === "actions" && typeof index === "number") {
    if (key === "view") return viewNames(doc);
    if (key === "in") return places(doc);
    return [];
  }
  if (head === "graph" && index === "entries") {
    return fields(chart, chart, { arrays: "index", absolute: true }, "array");
  }
  return [];
}

// references offers "{{.Team}}" and the rest of what the portal knows, straight
// from the list the portal itself resolves against (GET /view-refs), so the
// editor cannot offer a reference the order would then refuse.
function references(refs: TemplateRef[] | null, formTimeOnly: boolean): Suggestion[] {
  if (!refs) return [];
  return refs
    .filter((r) => !formTimeOnly || r.at_order_form)
    .map((r) => ({ value: `{{${r.ref}}}`, detail: r.desc }));
}

// A view names fields of the schema node it projects: the root of the chart, or
// one row of a list when the view is a tab's element form. A nested "ui:view"
// steps one field deeper, which is why the whole path is walked, not just read.
function viewSuggestions(path: (string | number)[], doc: Schema, chart: Schema | null): Suggestion[] {
  const last = path[path.length - 1];
  const tail = path[path.length - 2];

  // Pointers into the whole chart: these name a field of the order, not of the
  // node this view happens to project.
  if (last === "identity" || last === "namespace" || (last === "pointer" && tail === "namespace")) {
    return fields(chart, chart, { arrays: "index", absolute: true }, "scalar");
  }

  // "include": ["|"] and the other field lists.
  if (typeof last === "number" && (tail === "include" || tail === "exclude" || tail === "required")) {
    return names(viewNode(path.slice(0, -2), doc, chart), chart);
  }
  return [];
}

function tabSuggestions(path: (string | number)[], doc: Schema, chart: Schema | null): Suggestion[] {
  const tab = (doc.tabs ?? [])[path[1] as number] ?? {};
  const row = () => rowOf(nodeAt(String(tab.items ?? ""), chart ?? {}), chart ?? {});

  switch (path[2]) {
    case "items":
      return fields(chart, chart, { arrays: "index", absolute: true }, "array");
    case "form":
      return viewNames(doc);
    case "ui:table": {
      const column = (tab["ui:table"] ?? [])[path[3] as number] ?? {};
      if (path[4] === "path") return fields(row(), chart, { arrays: "star", absolute: false });
      if (path[4] !== "lookup") return [];
      switch (path[5]) {
        case "keys":
          return fields(row(), chart, { arrays: "star", absolute: true });
        case "in":
          return fields(chart, chart, { arrays: "index", absolute: true }, "array");
        case "match":
        case "get":
          return names(rowOf(nodeAt(String(column.lookup?.in ?? ""), chart ?? {}), chart ?? {}), chart);
        default:
          return [];
      }
    }
    case "enums": {
      const rule = (tab.enums ?? [])[path[3] as number] ?? {};
      switch (path[4]) {
        case "at":
          return fields(row(), chart, { arrays: "index", absolute: true });
        case "from":
          return fields(chart, chart, { arrays: "index", absolute: true }, "array");
        case "value":
          return names(rowOf(nodeAt(String(rule.from ?? ""), chart ?? {}), chart ?? {}), chart);
        default:
          return [];
      }
    }
    default:
      return [];
  }
}

// viewNode resolves the schema node a view projects, following the path down
// through nested "ui:view" blocks.
function viewNode(path: (string | number)[], doc: Schema, chart: Schema | null): Schema | undefined {
  if (!chart) return undefined;
  const name = String(path[1]);
  let node: Schema | undefined = chart;

  // A view a tab names as its form describes one row of that tab's list, not the
  // order as a whole, so its field names come from the row.
  const tab = (doc.tabs ?? []).find((t: Schema) => t?.form === name);
  if (tab?.items) node = rowOf(nodeAt(String(tab.items), chart), chart);

  for (let i = 2; i + 2 < path.length && node; i++) {
    if (path[i] !== "overrides" || path[i + 2] !== "ui:view") continue;
    const field = properties(node, chart)[String(path[i + 1])];
    node = field ? (rowOf(field, chart) ?? deref(field, chart)) : undefined;
    i += 2;
  }
  return node;
}

function fields(
  node: Schema | null | undefined,
  chart: Schema | null,
  opts: { arrays: "index" | "star"; absolute: boolean },
  kind?: ChartField["kind"],
): Suggestion[] {
  if (!node || !chart) return [];
  return chartFields(node, chart, opts)
    .filter((f) => !kind || f.kind === kind)
    .map((f) => ({ value: f.path, detail: f.title ?? KIND_LABEL[f.kind], doc: f.description }));
}

// names lists the fields of one node by name: what include/exclude/overrides and
// the match/get of a lookup are written with.
function names(node: Schema | null | undefined, chart: Schema | null): Suggestion[] {
  if (!node || !chart) return [];
  return Object.entries(properties(node, chart)).map(([key, raw]) => {
    const s = deref(raw, chart);
    return {
      value: key,
      detail: typeof s.title === "string" ? s.title : undefined,
      doc: typeof s.description === "string" ? s.description : undefined,
    };
  });
}

// viewNames lists the forms this document declares. "order" is the order form,
// and neither a tab nor an action can borrow it.
function viewNames(doc: Schema): Suggestion[] {
  return Object.keys(doc.views ?? {})
    .filter((name) => name !== "order")
    .map((name) => ({ value: name, detail: "форма из «views»" }));
}

// places lists where an action can sit: the general info screen, or one of the
// tabs this document declares.
function places(doc: Schema): Suggestion[] {
  const tabs = ((doc.tabs ?? []) as Schema[])
    .map((t) => t?.id)
    .filter((id): id is string => typeof id === "string" && id !== "")
    .map((id) => ({ value: `tab:${id}`, detail: "вкладка" }));
  return [{ value: "info", detail: "общая информация" }, ...tabs];
}
