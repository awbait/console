import { useMonaco } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { useEffect, useRef } from "react";
import type { TemplateRef } from "@/api/types";
import { refAt, refName } from "./schemaRefs";
import { hintsAt } from "./viewHints";

// The editor side of the version constructor: what Monaco has to be told before
// a view document becomes something you can write rather than recite.
//
// Two halves. The format of the document comes from the portal as a JSON Schema
// and is handed to Monaco's own JSON language service, which then completes
// keys, offers the values an enum allows, shows the description on hover and
// underlines a broken document in place. The chart is the other half, and no
// static schema can hold it: which pointers exist in THIS version. That is what
// the two providers below answer.

// The model path the hints attach to. Unique per version, so two charts open one
// after the other never share a model, and recognizable by its last segment, so
// the format schema can be bound to it and to nothing else.
export function viewModelPath(publicationId: string, version: string): string {
  return `inmemory://view/${publicationId}/${version}/view-document.json`;
}

export function chartModelPath(project: string, name: string, version: string): string {
  return `inmemory://chart/${project}/${name}/${version}/values.schema.json`;
}

// One model per dependency of a version, for the same reason: two schemas shown
// in the same editor must not share a model, or the second one opens holding the
// text of the first.
export function dependencyModelPath(
  project: string,
  name: string,
  version: string,
  key: string,
): string {
  return `inmemory://chart/${project}/${name}/${version}/charts/${key}/values.schema.json`;
}

const VIEW_MODEL_SUFFIX = "view-document.json";
const SCHEMA_MODEL_SUFFIX = "values.schema.json";

// useSchemaRefNavigation makes a "$ref" in a chart schema a place to jump to.
// The schemas are shown read-only and written by somebody else, so a reader
// follows "#/definitions/tls" by scrolling and searching for the name; with
// this, Ctrl+click or F12 on the pointer lands on the definition, and hovering
// it says so, or says that the definition is not there. Monaco's own JSON
// service does not do this here: it resolves $ref for validation only.
export function useSchemaRefNavigation(): void {
  const monaco = useMonaco();
  useEffect(() => {
    if (!monaco) return;
    const isSchema = (model: Monaco.editor.ITextModel) => model.uri.path.endsWith(SCHEMA_MODEL_SUFFIX);
    const range = (model: Monaco.editor.ITextModel, from: number, to: number) =>
      monaco.Range.fromPositions(model.getPositionAt(from), model.getPositionAt(to));

    const definition = monaco.languages.registerDefinitionProvider("json", {
      provideDefinition(model, position) {
        if (!isSchema(model)) return null;
        const ref = refAt(model.getValue(), model.getOffsetAt(position));
        if (!ref?.target) return null;
        return [
          {
            uri: model.uri,
            range: range(model, ref.target.offset, ref.target.offset + ref.target.length),
            // The whole pointer is underlined, not the word under the cursor.
            originSelectionRange: range(model, ref.from, ref.to),
          },
        ];
      },
    });

    const hover = monaco.languages.registerHoverProvider("json", {
      provideHover(model, position) {
        if (!isSchema(model)) return null;
        const ref = refAt(model.getValue(), model.getOffsetAt(position));
        if (!ref) return null;
        const name = refName(ref.pointer);
        const text = ref.target
          ? `Определение **${name}**. Перейти к нему: Ctrl+клик или F12.`
          : `Определения **${name}** в этой схеме нет.`;
        return { range: range(model, ref.from, ref.to), contents: [{ value: text }] };
      },
    });

    return () => {
      definition.dispose();
      hover.dispose();
    };
  }, [monaco]);
}

// useViewDocumentHints teaches the editor this document and this chart. Both
// arrive over the network, so both may be null for a moment; until they do, the
// editor behaves as it always has.
export function useViewDocumentHints(
  format: object | null,
  chart: object | null,
  refs: TemplateRef[] | null = null,
): void {
  const monaco = useMonaco();
  // The chart changes with the version switcher, the providers do not: reading
  // it through a ref keeps a switch from tearing down and re-registering them.
  const chartRef = useRef(chart);
  chartRef.current = chart;
  // What a document may reference in defaults/initial, read the same way: it
  // arrives from the portal and grows when an admin adds a variable.
  const refsRef = useRef(refs);
  refsRef.current = refs;

  useEffect(() => {
    if (!monaco || !format) return;
    monaco.json.jsonDefaults.setDiagnosticsOptions({
      validate: true,
      // A closed network has no schema store to reach, and a chart's own
      // values.schema.json declares a $schema that would be fetched otherwise.
      enableSchemaRequest: false,
      schemas: [
        {
          uri: "https://console/view-document.schema.json",
          fileMatch: [`*${VIEW_MODEL_SUFFIX}`],
          schema: format,
        },
      ],
    });
  }, [monaco, format]);

  useEffect(() => {
    if (!monaco) return;
    const isView = (model: Monaco.editor.ITextModel) => model.uri.path.endsWith(VIEW_MODEL_SUFFIX);

    // The list: everything that fits, with what the chart calls it. Opens on
    // Ctrl+Space and on the characters a pointer is written with.
    const list = monaco.languages.registerCompletionItemProvider("json", {
      triggerCharacters: ['"', "/"],
      provideCompletionItems(model, position) {
        if (!isView(model)) return { suggestions: [] };
        const hints = hintsAt(
          model.getValue(),
          model.getOffsetAt(position),
          chartRef.current,
          refsRef.current,
        );
        if (!hints) return { suggestions: [] };
        const range = monaco.Range.fromPositions(
          model.getPositionAt(hints.from),
          model.getPositionAt(hints.to),
        );
        return {
          suggestions: hints.items.map((item) => ({
            label: item.value,
            kind: monaco.languages.CompletionItemKind.Value,
            insertText: hints.quote ? JSON.stringify(item.value) : item.value,
            detail: item.detail,
            documentation: item.doc,
            range,
            // Above what the JSON service offers for the same spot: these are
            // this chart's own fields, and they are what was being looked for.
            sortText: "0",
          })),
        };
      },
    });

    // The ghost: one greyed-out continuation after the cursor, taken by Tab.
    // Only when what has been typed leaves exactly one path, which is when a
    // list of one would be in the way rather than a help.
    const ghost = monaco.languages.registerInlineCompletionsProvider("json", {
      provideInlineCompletions(model, position) {
        if (!isView(model)) return { items: [] };
        const text = model.getValue();
        const offset = model.getOffsetAt(position);
        const hints = hintsAt(text, offset, chartRef.current);
        // Inside a string and at its end: appending in the middle of what
        // somebody already wrote would read as the editor rewriting it.
        if (!hints || hints.quote || offset !== hints.to) return { items: [] };
        const typed = text.slice(hints.from, offset);
        const rest = hints.items.filter((i) => i.value.startsWith(typed) && i.value !== typed);
        if (rest.length !== 1) return { items: [] };
        return {
          items: [
            {
              insertText: rest[0].value.slice(typed.length),
              range: monaco.Range.fromPositions(position, position),
            },
          ],
        };
      },
      disposeInlineCompletions() {},
    });

    return () => {
      list.dispose();
      ghost.dispose();
    };
  }, [monaco]);
}
