import { useMonaco } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { useEffect, useRef } from "react";
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

const VIEW_MODEL_SUFFIX = "view-document.json";

// useViewDocumentHints teaches the editor this document and this chart. Both
// arrive over the network, so both may be null for a moment; until they do, the
// editor behaves as it always has.
export function useViewDocumentHints(format: object | null, chart: object | null): void {
  const monaco = useMonaco();
  // The chart changes with the version switcher, the providers do not: reading
  // it through a ref keeps a switch from tearing down and re-registering them.
  const chartRef = useRef(chart);
  chartRef.current = chart;

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
        const hints = hintsAt(model.getValue(), model.getOffsetAt(position), chartRef.current);
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
