import { IconChevronRight } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { ruPlural } from "@/form/fieldErrors";
import type { ChangelogEntry } from "../api/types";
import { isRelease, releaseAnchor } from "../lib/release";
import { Markdown } from "./Markdown";

// Colour here is spent on one thing only: the version in use. The categories
// are the release's own table of contents, and a changelog is read, not
// operated - painting every one of them turns a page of text into a control
// panel, which is what a coloured plaque per category made of it.
//
// summary lists what a folded release contains: "Добавлено 3 · Изменено 2".
// The category names are the file's own, in whatever language the chart wrote
// them, so nothing has to be recognised for the line to be right.
function summary(sections: ChangelogEntry["sections"]): string {
  return sections.map((s) => `${s.title} ${s.items.length}`).join(" · ");
}

// The changelog vocabulary for a version that has no number yet: everything
// merged since the last release. Shown as words, not as the file's marker.
const UNRELEASED = /^unreleased$/i;

// A version heading with nothing under it is not a release anybody can read
// about: the parser keeps it because the file has it (a fresh [Unreleased] is
// what every release leaves behind), and the decision to show it belongs here.
// The same rule covers a chart whose CHANGELOG carries an empty heading of its
// own.
function filled(e: ChangelogEntry): boolean {
  return !!e.intro?.trim() || (e.sections ?? []).some((s) => s.items.length > 0);
}

// withContent drops the versions that would render as an empty block. Exported
// so a page can tell "no changelog at all" from "a changelog of empty headings"
// before it draws a card around either.
export function withContent(entries: ChangelogEntry[]): ChangelogEntry[] {
  return entries.filter(filled);
}

// The teaser under a folded version is plain text: the intro is markdown, and a
// link inside the header button would be an interactive element inside another
// one. Only the inline marks the changelog actually uses are undone, which is
// enough to keep asterisks and brackets out of a one-line summary.
export function plain(md: string): string {
  return md
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .trim();
}

// Changelog renders parsed release notes: the portal's own on the About page
// and a product's on its Changes tab, so both read the same way.
//
// The list is an accordion. Read top to bottom it is a wall of text: a release
// is long, and everything under the newest one is history. So a version opens
// on demand, and its folded header carries enough to decide whether to open it:
// what the release touched, how much of it, how it starts, and whether it is
// the version in use.
//
// All of that on one line. A folded version is an item in a list, and a list
// scans only while its items are the same height: a two-line header turns six
// releases into a page of its own, which is what the accordion was for.
//
// `highlight` is a link arriving at a version (see releaseAnchor): the section
// it names opens and stays lit until the reader looks away, because a page that
// silently jumped is a page that looks like it opened in the wrong place. The
// opening comes before the scroll on purpose - the caller scrolls once this has
// rendered, and a folded panel would leave the anchor short of the notes the
// reader was sent to.
//
// `current` is the version in use - the build the portal runs, the version of
// the chart the catalog offers - and it is the one entry that gets a mark of
// its own, worded by `currentLabel`. `pageSize` cuts a long history down to the
// newest N with the rest behind a button, and `stickyHeaders` pins the open
// version's header inside a scroll box, so a long release still says whose it
// is halfway down.
export function Changelog({
  entries,
  highlight,
  current,
  currentLabel = "Сейчас в проде",
  pageSize,
  stickyHeaders = false,
}: {
  entries: ChangelogEntry[];
  highlight?: string;
  current?: string;
  currentLabel?: string;
  pageSize?: number;
  stickyHeaders?: boolean;
}) {
  const shown = useMemo(() => withContent(entries), [entries]);
  const newest = shown[0]?.version;

  // What the reader has folded or unfolded by hand. A version nobody has
  // touched falls back to the default, so the newest release is open on arrival
  // without that having to be written into state first.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const isOpen = (e: ChangelogEntry) =>
    toggled[e.version] ?? (e.version === newest || releaseAnchor(e.version) === highlight);

  const [limit, setLimit] = useState(pageSize ?? 0);
  const paged = pageSize ? shown.slice(0, limit) : shown;
  const rest = shown.length - paged.length;

  // A link that names a version wins over a fold: without this, a version the
  // reader closed earlier would swallow the next link pointing at it, and one
  // still behind "показать ещё" would have nothing to scroll to.
  useEffect(() => {
    if (!highlight) return;
    const i = shown.findIndex((e) => releaseAnchor(e.version) === highlight);
    if (i < 0) return;
    const v = shown[i].version;
    setToggled((t) => (t[v] ? t : { ...t, [v]: true }));
    setLimit((l) => (l > i ? l : i + 1));
  }, [highlight, shown]);

  return (
    <div className="flex flex-col">
      {paged.map((e) => {
        const anchor = releaseAnchor(e.version);
        const open = isOpen(e);
        const sections = (e.sections ?? []).filter((s) => s.items.length > 0);
        const inProd = !!current && isRelease(current) && releaseAnchor(current) === anchor;
        return (
          <div
            key={e.version}
            id={anchor}
            // Scrolled-to sections stop below the top edge of the scroller
            // rather than flush against it.
            className={`scroll-mt-4 border-b border-slate-100 transition-colors duration-500 last:border-b-0 ${
              highlight === anchor ? "rounded-lg bg-brand-50/60" : ""
            }`}
          >
            {/* Pinned, the header needs an edge of its own: without it the line
                sliding under it looks clipped rather than covered. */}
            <h3
              className={
                stickyHeaders && open
                  ? "sticky top-0 z-10 border-b border-slate-100 bg-surface"
                  : undefined
              }
            >
              <button
                type="button"
                id={`${anchor}-title`}
                aria-expanded={open}
                aria-controls={`${anchor}-notes`}
                onClick={() => setToggled((t) => ({ ...t, [e.version]: !open }))}
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2.5 text-left outline-none transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
              >
                <IconChevronRight
                  size={16}
                  stroke={2}
                  className={`shrink-0 text-slate-400 transition-transform duration-200 motion-reduce:transition-none ${
                    open ? "rotate-90" : ""
                  }`}
                />
                {UNRELEASED.test(e.version) ? (
                  <span className="shrink-0 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-brand-700">
                    Ещё не выпущено
                  </span>
                ) : (
                  <span className="shrink-0 font-mono text-base font-bold text-slate-900">
                    {e.version}
                  </span>
                )}
                {inProd && (
                  <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                    {currentLabel}
                  </span>
                )}

                {/* Folded, this line is all the reader gets, so it says what the
                    release contains and how it starts. Unfolded, both sit right
                    below, and repeating them only pushes the notes down. */}
                {!open && sections.length > 0 && (
                  <span className="hidden shrink-0 text-xs text-slate-400 sm:block">
                    {summary(sections)}
                  </span>
                )}
                {!open && e.intro && (
                  // Whatever is left of the line after the summary. On a narrow
                  // screen there is nothing left, so the teaser steps aside
                  // rather than pushing the date off the row.
                  <span className="hidden min-w-0 flex-1 truncate text-sm text-slate-500 lg:block">
                    {plain(e.intro)}
                  </span>
                )}
                {e.date && (
                  <span className="ml-auto shrink-0 pl-1 text-xs text-slate-400">{e.date}</span>
                )}
              </button>
            </h3>

            {/* The panel opens on a grid row going 0fr -> 1fr: a height nobody
                has to measure in advance. react-aria's DisclosurePanel is out
                for this one - it hides the panel with the `hidden` attribute,
                and display: none is not something a transition can touch.
                visibility rides the same transition, so a folded release is out
                of the tab order without cutting the closing short. */}
            <section
              id={`${anchor}-notes`}
              aria-labelledby={`${anchor}-title`}
              className={`grid transition-[grid-template-rows,visibility] duration-200 ease-out motion-reduce:transition-none ${
                open ? "visible grid-rows-[1fr]" : "invisible grid-rows-[0fr]"
              }`}
            >
              <div className="overflow-hidden">
                <div className="px-2 pb-6 pt-1">
                  {e.intro && (
                    <p className="max-w-prose text-sm leading-relaxed text-slate-600">
                      <Markdown inline>{e.intro}</Markdown>
                    </p>
                  )}
                  {/* A release reads as an article: the category is a small
                      heading over its own list, everything on one left edge.
                      The line stays inside a readable measure instead of
                      running the whole width of the card. */}
                  <div className="mt-4 flex max-w-prose flex-col gap-4">
                    {sections.map((s) => (
                      <div key={s.title}>
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                          {s.title}
                        </div>
                        <ul className="ml-4 mt-1.5 list-disc space-y-1.5 text-sm text-slate-700 marker:text-slate-300">
                          {s.items.map((it) => (
                            <li key={it} className="leading-relaxed">
                              <Markdown inline>{it}</Markdown>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          </div>
        );
      })}

      {rest > 0 && (
        <button
          type="button"
          onClick={() => setLimit(shown.length)}
          className="mt-3 self-start cursor-pointer rounded-md px-2 py-1.5 text-sm font-medium text-brand-700 outline-none transition-colors hover:bg-brand-50 focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          Показать ещё {rest} {ruPlural(rest, "версию", "версии", "версий")}
        </button>
      )}
    </div>
  );
}
