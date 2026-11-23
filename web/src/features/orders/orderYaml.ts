// Decisions and parsing behind the order card's YAML configuration editor:
// whether the order can be edited as YAML right now, how raw YAML is parsed
// and normalized for comparison, and which portal-stamped fields the user
// touched. Kept separate from the dialog so every check is unit-testable
// without a DOM.

import yaml from "js-yaml";
import { isLive } from "@/api/orderStatus";
import type { OrderRequest, RequestMR, ViewDocument } from "@/api/types";
import { getAt } from "@/components/products/genericView";
import { sameValues } from "@/form/SchemaForm";

export type Values = Record<string, unknown>;

export const yamlText = {
  tabEditor: "Редактор",
  tabDiff: "Изменения",
  check: "Проверить",
  checking: "Проверяем…",
  checkOk: "Проверка прошла. Изменения можно сохранить.",
  checkNoChanges: "Этот текст не меняет настройки сервиса.",
  syntaxError: (line: number, column: number, reason: string) =>
    `Ошибка синтаксиса YAML. Строка ${line}, столбец ${column}. ${reason}`,
  notObject: "На верхнем уровне YAML укажите пары «ключ: значение».",
  emptyDoc: "Пустой YAML нельзя сохранить. Укажите настройки сервиса.",
  staleTitle: "Конфигурация сервиса изменилась",
  staleHint: "Если загрузите актуальную версию, она заменит ваши правки в редакторе.",
  staleAction: "Загрузить актуальную версию",
  stampedNote: "При сохранении портал подставит свои значения в следующие поля:",
  normalizedNote: "Комментарии и порядок ключей не сохраняются.",
  diffEmpty: "Пока нет изменений.",
  lockForbidden: "У вас нет прав менять этот сервис. Конфигурация открыта для просмотра.",
  lockDraft: "Это черновик. Измените конфигурацию в форме заказа.",
  lockOpenMR:
    "Предыдущее изменение сервиса ещё применяется. Конфигурацию можно будет изменить, когда оно применится.",
  lockDrifted:
    "Сервис изменили в обход портала. Нажмите «Подтянуть из Git» на странице заказа, чтобы обновить конфигурацию перед правкой.",
  lockStatus:
    "Сервис ещё разворачивается. Конфигурацию можно будет изменить, когда сервис заработает.",
} as const;

export type YamlLock =
  | null
  | { reason: "forbidden"; text: string }
  | { reason: "draft"; text: string }
  | { reason: "open_mr"; text: string }
  | { reason: "drifted"; text: string }
  | { reason: "status"; text: string };

// yamlLock decides whether the YAML dialog is editable or read-only, mirroring
// graphLock so every editor on the order card enforces the same lifecycle rules.
export function yamlLock(
  r: Pick<OrderRequest, "status" | "drifted">,
  modifiable: boolean,
  openMR: RequestMR | null | undefined,
): YamlLock {
  if (!modifiable) {
    return { reason: "forbidden", text: yamlText.lockForbidden };
  }
  if (r.status === "DRAFT") {
    return { reason: "draft", text: yamlText.lockDraft };
  }
  if (openMR) {
    return { reason: "open_mr", text: yamlText.lockOpenMR };
  }
  if (r.drifted) {
    return { reason: "drifted", text: yamlText.lockDrifted };
  }
  if (!isLive(r.status)) {
    return { reason: "status", text: yamlText.lockStatus };
  }
  return null;
}

export type YamlParseResult =
  | { ok: true; values: Values; normalized: string }
  | { ok: false; kind: "empty" | "not_object" | "syntax"; message: string; line?: number; column?: number };

// dumpNormalized serializes values deterministically so key reordering or
// whitespace edits do not look like a real change.
export function dumpNormalized(values: Values): string {
  return yaml.dump(values, { sortKeys: true, lineWidth: -1 });
}

// parseYamlDocument parses edited YAML with JSON_SCHEMA so ISO-like dates stay
// strings instead of turning into JS Date objects that JSON.stringify rewrites.
export function parseYamlDocument(text: string): YamlParseResult {
  if (text.trim() === "") {
    return { ok: false, kind: "empty", message: yamlText.emptyDoc };
  }
  let parsed: unknown;
  try {
    parsed = yaml.load(text, { schema: yaml.JSON_SCHEMA });
  } catch (e) {
    if (e instanceof yaml.YAMLException) {
      const line = (e.mark?.line ?? 0) + 1;
      const column = (e.mark?.column ?? 0) + 1;
      const reason = e.reason || e.message;
      return {
        ok: false,
        kind: "syntax",
        line,
        column,
        message: yamlText.syntaxError(line, column, reason),
      };
    }
    return {
      ok: false,
      kind: "syntax",
      line: 1,
      column: 1,
      message: yamlText.syntaxError(1, 1, e instanceof Error ? e.message : String(e)),
    };
  }
  if (parsed === null || parsed === undefined) {
    return { ok: false, kind: "empty", message: yamlText.emptyDoc };
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, kind: "not_object", message: yamlText.notObject };
  }
  const values = parsed as Values;
  return { ok: true, values, normalized: dumpNormalized(values) };
}

// parseSavedValues decodes the order's stored YAML into a plain object.
export function parseSavedValues(text: string): Values {
  try {
    const parsed = yaml.load(text, { schema: yaml.JSON_SCHEMA });
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Values) : {};
  } catch {
    return {};
  }
}

// parseYamlValues parses user-edited YAML with JSON_SCHEMA (so ISO dates stay
// strings). Empty YAML yields {}; non-object roots throw yamlText.notObject so
// callers surface the error instead of spreading a scalar or array into keys.
export function parseYamlValues(text: string): Values {
  const parsed = yaml.load(text, { schema: yaml.JSON_SCHEMA });
  if (parsed === null || parsed === undefined) return {};
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(yamlText.notObject);
  }
  return parsed as Values;
}

// normalizeSavedYaml returns the canonical YAML of the stored order values for
// semantic diffing, falling back to the raw string if it cannot be parsed.
export function normalizeSavedYaml(text: string): string {
  try {
    const parsed = yaml.load(text, { schema: yaml.JSON_SCHEMA });
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return dumpNormalized(parsed as Values);
    }
  } catch {
    /* keep raw text */
  }
  return text;
}

// hasYamlChanges reports whether draftText diverges from savedYaml semantically.
// Broken or non-object YAML counts as dirty whenever the text itself changed,
// so the user can always discard their broken edit.
export function hasYamlChanges(savedYaml: string, draftText: string): boolean {
  const parsed = parseYamlDocument(draftText);
  if (!parsed.ok) {
    return draftText !== savedYaml;
  }
  return parsed.normalized !== normalizeSavedYaml(savedYaml);
}

// stampedPointers collects JSON pointers the backend overwrites on every save:
// the view document's "defaults" block and the legacy string form of
// views.order.namespace (which mirrors the destination namespace into values).
export function stampedPointers(doc: ViewDocument | null | undefined): string[] {
  const out = new Set<string>();
  const defaults = doc?.defaults;
  if (defaults && typeof defaults === "object") {
    for (const ptr of Object.keys(defaults)) {
      if (ptr.startsWith("/")) out.add(ptr);
    }
  }
  const ns = (doc?.views?.order as { namespace?: unknown } | undefined)?.namespace;
  if (typeof ns === "string" && ns.startsWith("/")) {
    out.add(ns);
  }
  return [...out].sort();
}

// touchedStampedFields returns dotted names of portal-stamped fields whose
// value in nextValues differs from savedValues.
export function touchedStampedFields(
  doc: ViewDocument | null | undefined,
  savedValues: Values,
  nextValues: Values,
): string[] {
  const touched: string[] = [];
  for (const ptr of stampedPointers(doc)) {
    const before = getAt(savedValues, ptr);
    const after = getAt(nextValues, ptr);
    if (!sameValues(before, after)) {
      touched.push(
        ptr
          .slice(1)
          .split("/")
          .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"))
          .join("."),
      );
    }
  }
  return touched;
}
