import { dateInWords } from "../../lib/time";

// when writes a maintenance time the way the texts insert it: the day in words
// (dateInWords) and the clock time, HH:MM. The day is always named: "at ten"
// is ambiguous on a banner that may be read the evening before.
export function when(iso: string, now: number = Date.now()): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dateInWords(iso, now)} в ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// whenOrNull is when for an optional time.
export function whenOrNull(iso: string | undefined, now: number = Date.now()): string | null {
  return iso ? when(iso, now) : null;
}

// toLocalInput turns a time into the value a datetime-local input takes, in the
// browser's own zone; fromLocalInput turns such a value back into an instant.
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fromLocalInput(v: string): string | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
