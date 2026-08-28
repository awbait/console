import { IconAlertTriangle } from "@tabler/icons-react";
import { HttpError } from "../api/client";
import type { FieldError } from "../api/types";
import { schemaViolationText } from "../form/fieldErrors";
import { fieldBreadcrumb, nodeAt, type Schema } from "../form/fieldPath";
import { fieldAnchorId } from "../form/SchemaForm";

// SubmitError is a normalized submission failure: the human message plus the
// server's per-field breakdown when the failure was a validation 422.
export interface SubmitError {
  message: string;
  details?: FieldError[];
}

// toSubmitError normalizes any thrown value for FormErrors, keeping the
// per-field details an HttpError carries instead of flattening to a string.
export function toSubmitError(e: unknown): SubmitError {
  if (e instanceof HttpError) return { message: e.message, details: e.details };
  return { message: e instanceof Error ? e.message : String(e) };
}

// revealField scrolls the offending field into view and focuses its first control,
// so clicking a summary row jumps straight to it. Errored disclosure sections are
// auto-expanded on a submit attempt, so the target is laid out by the time we run.
function revealField(path: string) {
  const el = document.getElementById(fieldAnchorId(path));
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  const focusable = el.querySelector<HTMLElement>(
    'input, select, textarea, button, [tabindex], [role="combobox"]',
  );
  focusable?.focus({ preventScroll: true });
}

// afterLabel is a canonical message put behind a field name: "Порт: не меньше
// 1." The messages themselves are written to stand alone (fieldErrors.ts), and
// the rows here always name the field first, whichever side found the problem.
function afterLabel(msg: string): string {
  return msg.charAt(0).toLowerCase() + msg.slice(1);
}

// expand turns one field error into a display row.
//
// The row is worded here, from the rule the value broke and from the schema the
// form already has - never from the validator's own message, which is written
// in English and in the vocabulary of JSON Schema. That way a complaint after
// sending the order reads exactly like the hint that stood in the field while
// it was being filled in (see form/fieldErrors.ts).
// A failure that names neither a field nor a rule has nothing to add to the
// headline the server already sent, and a row saying "значения: значение не
// подходит." would only push that headline out of the way.
function expand(d: FieldError, root?: Schema, view?: Schema): { field: string; message: string }[] {
  if (!d.path && !d.keyword) return [];
  const base = fieldBreadcrumb(d.path, root, view);
  const node = root ? nodeAt(d.path, root) : undefined;
  return [{ field: base || "значения", message: afterLabel(schemaViolationText(d.keyword, node)) }];
}

// FormErrors renders a submission error: a headline plus, when present, a tidy
// per-field breakdown of schema validation failures (field titles from schema).
export function FormErrors({
  message,
  details,
  fieldErrors,
  schema,
  view,
}: {
  message: string;
  details?: FieldError[];
  // Client-side validation errors (JSON pointer -> message), rendered as the same
  // per-field summary as server details. Used by the in-form error summaries.
  fieldErrors?: Map<string, string>;
  schema?: Schema;
  view?: Schema;
}) {
  // Server-detail rows are static; client rows carry the field's pointer path so
  // the row becomes a button that scrolls to and focuses the field.
  const serverRows: { field: string; message: string; path?: string }[] = (details ?? []).flatMap((d) =>
    expand(d, schema, view),
  );
  const clientRows: { field: string; message: string; path?: string }[] = fieldErrors
    ? [...fieldErrors].map(([path, msg]) => ({
        field: fieldBreadcrumb(path, schema, view) || "значения",
        message: afterLabel(msg),
        path,
      }))
    : [];
  const rows = [...serverRows, ...clientRows];
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      <div className="flex items-center gap-2 font-medium">
        <IconAlertTriangle size={16} stroke={1.8} className="shrink-0" />
        {rows.length > 0 ? "Проверьте поля формы" : message}
      </div>
      {rows.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 text-xs">
          {rows.map((r, i) =>
            r.path ? (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => revealField(r.path as string)}
                  className="group flex w-full cursor-pointer flex-wrap gap-x-2 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                >
                  <span className="font-medium text-red-700 group-hover:text-red-900">{r.field}:</span>
                  <span className="text-red-600 group-hover:text-red-800">{r.message}</span>
                </button>
              </li>
            ) : (
              <li key={i} className="flex flex-wrap gap-x-2">
                <span className="font-medium text-red-700">{r.field}:</span>
                <span className="text-red-600">{r.message}</span>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}
