import { IconArrowNarrowRight, IconCheck } from "@tabler/icons-react";
import { useMemo } from "react";
import { Radio, RadioGroup } from "react-aria-components";
import { fieldBreadcrumb, pointerOf } from "./fieldPath";
import { pruneEmpty } from "./SchemaForm";
import { diffValues, formatValue, isBlock, type ValuesDiffRow } from "./valuesDiff";

type Values = Record<string, unknown>;

// Two values of one field, side by side.
//
// The portal asks a person about a field's value in exactly two situations, and
// they are the same picture: before a change is sent ("this is what you are
// about to move"), and after two changes moved one field apart ("these are the
// two values, pick one"). The second one adds the choice and nothing else, so
// it is the same component - a diff nobody can act on is what a diff is when
// the decision has already been taken.

export type DiffSide = "before" | "after";

type Schema = Record<string, any>;

// rowLabel names the field the way the order form named it, falling back to the
// dotted path when there is no schema to ask.
function rowLabel(row: ValuesDiffRow, schema?: Schema, view?: Schema): string {
  if (row.label) return row.label;
  return fieldBreadcrumb(pointerOf(row.field), schema, view) || row.path;
}

function ValueCell({ value }: { value: unknown }) {
  if (value === undefined) {
    return <span className="text-slate-400">нет значения</span>;
  }
  if (isBlock(value)) {
    return (
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
        {formatValue(value)}
      </pre>
    );
  }
  return <span className="break-words font-mono text-xs">{formatValue(value)}</span>;
}

// Mark is the dot that says a panel is one of two answers, and which one is
// given. Only where there is a choice: the same two panels shown after the fact
// are not asking anything, and a dot there would say they are.
function Mark({ chosen }: { chosen: boolean }) {
  return (
    <span
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
        chosen ? "border-brand-500 bg-brand-500 text-white" : "border-slate-300 bg-surface"
      }`}
    >
      {chosen && <IconCheck size={11} stroke={3} />}
    </span>
  );
}

// sideBody is what a side shows either way: the label of the side and the value
// under it. chosen is null outside a choice, where there is nothing to mark.
function sideBody(label: string, value: unknown, chosen: boolean | null) {
  return (
    <>
      <span className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
        {chosen !== null && <Mark chosen={chosen} />}
        {label}
      </span>
      <span className="mt-1 block text-slate-700">
        <ValueCell value={value} />
      </span>
    </>
  );
}

const SIDE_BASE = "min-w-0 flex-1 rounded-md border px-3 py-2 text-left";

// ChoiceCard is one side when the reader is being asked to pick. Built on the
// library's Radio so the pair behaves like a radio group without this file
// reinventing arrow keys and focus: two panels are still a choice of one.
function ChoiceCard({ label, value, side }: { label: string; value: unknown; side: DiffSide }) {
  return (
    <Radio
      value={side}
      className={({ isSelected }) =>
        `${SIDE_BASE} cursor-pointer outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-brand-500 ${
          isSelected
            ? "border-brand-400 bg-brand-50 ring-1 ring-brand-200"
            : "border-slate-200 bg-surface hover:bg-slate-50"
        }`
      }
    >
      {({ isSelected }) => sideBody(label, value, isSelected)}
    </Radio>
  );
}

// Arrow is the "from this, to that" between the two panels, and only that: it
// says nothing a screen reader has not already been told by the two labels.
function Arrow() {
  return (
    <span aria-hidden className="hidden shrink-0 items-center text-slate-300 sm:flex">
      <IconArrowNarrowRight size={18} stroke={1.8} />
    </span>
  );
}

// FieldDiff renders the rows. With `chosen`/`onChoose` each row becomes a
// choice between its two values; without them it is a list of what a change
// moves, which is the same thing said after the fact.
export function FieldDiff({
  rows,
  beforeLabel,
  afterLabel,
  schema,
  view,
  chosen,
  onChoose,
}: {
  rows: ValuesDiffRow[];
  beforeLabel: string;
  afterLabel: string;
  schema?: Schema;
  view?: Schema;
  chosen?: Record<string, DiffSide>;
  onChoose?: (path: string, side: DiffSide) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => {
        const label = rowLabel(row, schema, view);
        return (
          <li key={row.path}>
            <p className="text-xs font-medium text-slate-600">{label}</p>
            {onChoose ? (
              <RadioGroup
                aria-label={label}
                value={chosen?.[row.path] ?? null}
                onChange={(v) => onChoose(row.path, v as DiffSide)}
                className="mt-1.5 flex flex-col gap-2 text-sm sm:flex-row sm:items-stretch"
              >
                <ChoiceCard label={beforeLabel} value={row.before} side="before" />
                <Arrow />
                <ChoiceCard label={afterLabel} value={row.after} side="after" />
              </RadioGroup>
            ) : (
              <div className="mt-1.5 flex flex-col gap-2 text-sm sm:flex-row sm:items-stretch">
                <div className={`${SIDE_BASE} border-slate-200 bg-slate-50`}>
                  {sideBody(beforeLabel, row.before, null)}
                </div>
                <Arrow />
                <div className={`${SIDE_BASE} border-brand-200 bg-brand-50/60`}>
                  {sideBody(afterLabel, row.after, null)}
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ChangeSummary is what a form owes the person about to send it: the settings
// this edit moves, and what they move from and to.
//
// It stands in the form itself rather than behind a confirmation step. A change
// to a running service is written a field at a time, and the useful moment to
// see what is being changed is while it is still being typed - by the time
// somebody has reached for the save button they have already decided.
//
// Nothing to show is the ordinary case (the form was opened and not touched),
// and then it renders nothing at all rather than an empty box.
export function ChangeSummary({
  before,
  after,
  schema,
  view,
}: {
  before: unknown;
  after: unknown;
  schema?: Schema;
  view?: Schema;
}) {
  // Both sides are pruned before they are compared, the same way the form
  // decides whether there is anything to save at all: a field that was blank
  // and is now gone was never a change, and a row saying so would be the panel
  // inventing one.
  const rows = useMemo(
    () => diffValues(pruneEmpty(before as Values), pruneEmpty(after as Values)),
    [before, after],
  );
  if (rows.length === 0) return null;
  return (
    <section className="mt-5 rounded-md border border-slate-200 bg-slate-50/60 p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Что изменится</h3>
      <div className="mt-2.5">
        <FieldDiff rows={rows} beforeLabel="Сейчас" afterLabel="Станет" schema={schema} view={view} />
      </div>
    </section>
  );
}
