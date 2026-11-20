import { IconCheck, IconChevronDown, IconSearch, IconX } from "@tabler/icons-react";
import { useState } from "react";
import { Button, Dialog, DialogTrigger, Popover } from "react-aria-components";

// SearchFilter is a chip that opens a popover with a search box and a checkbox
// list - for facets with many values (teams, products) where typing to narrow
// down is faster than scanning. Empty selection means "no filter" (show all).
// The orders lists and the publications registry filter with the same chip, so
// a facet looks the same wherever it is.
export function SearchFilter({
  label,
  searchPlaceholder,
  options,
  selected,
  onChange,
  // Shown in place of the list when the search matches nothing.
  emptyText = "Ничего не найдено",
  // The reset row at the foot of an active filter, given the selected count.
  resetText = (n: number) => `Сбросить (${n})`,
}: {
  label: string;
  searchPlaceholder: string;
  options: string[];
  selected: Set<string>;
  onChange: (s: Set<string>) => void;
  emptyText?: string;
  resetText?: (n: number) => string;
}) {
  const [q, setQ] = useState("");
  const filtered = q ? options.filter((o) => o.toLowerCase().includes(q.toLowerCase())) : options;
  const toggle = (v: string) => {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(next);
  };
  const active = selected.size > 0;
  return (
    <DialogTrigger>
      <Button
        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
          active
            ? "border-brand-200 bg-brand-50 text-brand-700"
            : "border-slate-200 text-slate-600 hover:bg-slate-50"
        }`}
      >
        {label}
        {active && <span className="text-brand-500">{selected.size}</span>}
        <IconChevronDown size={13} stroke={1.8} className={active ? "text-brand-400" : "text-slate-400"} />
      </Button>
      <Popover className="w-60 rounded-md border border-slate-200 bg-surface shadow-lg outline-none entering:animate-in entering:fade-in">
        <Dialog className="outline-none">
          <div className="border-b border-slate-100 p-2">
            <div className="relative">
              <IconSearch size={14} stroke={1.8} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full rounded-md border border-slate-200 bg-surface py-1 pl-7 pr-2 text-sm outline-none focus:border-brand-300 focus:ring-2 focus:ring-brand-100"
              />
            </div>
          </div>
          <ul className="max-h-64 overflow-auto p-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-xs text-slate-400">{emptyText}</li>
            ) : (
              filtered.map((o) => {
                const isSelected = selected.has(o);
                return (
                  <li key={o}>
                    <button
                      type="button"
                      onClick={() => toggle(o)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-slate-50 focus-visible:bg-slate-50"
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          isSelected ? "border-brand-600 bg-brand-600 text-on-accent" : "border-slate-300"
                        }`}
                      >
                        {isSelected && <IconCheck size={12} stroke={3} />}
                      </span>
                      <span className="truncate text-slate-700">{o}</span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          {active && (
            <div className="border-t border-slate-100 p-1">
              <button
                type="button"
                onClick={() => onChange(new Set())}
                className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-xs font-medium text-slate-500 outline-none hover:bg-slate-100 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <IconX size={13} stroke={2} />
                {resetText(selected.size)}
              </button>
            </div>
          )}
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}
