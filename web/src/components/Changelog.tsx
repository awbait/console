import { IconChevronRight } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { ruPlural } from "@/form/fieldErrors";
import type { ChangelogEntry } from "../api/types";
import { isRelease, releaseAnchor } from "../lib/release";
import { Markdown } from "./Markdown";

// A Keep-a-Changelog section title to a chip style. Each category gets its own
// soft tint so the list is scannable, but the palette stays low-saturation
// rather than a loud semantic green-vs-red. A chart writes its changelog in
// whatever language it likes, so both spellings are known here.
//
// Only theme-aware families are used (see tailwind.config.js): a raw Tailwind
// hue would keep its light fill on a black card.
const SECTION_CLASS: Record<string, string> = {
  added: "bg-emerald-50 text-emerald-700",
  добавлено: "bg-emerald-50 text-emerald-700",
  changed: "bg-blue-50 text-blue-700",
  изменено: "bg-blue-50 text-blue-700",
  fixed: "bg-indigo-100 text-indigo-600",
  исправлено: "bg-indigo-100 text-indigo-600",
  removed: "bg-red-50 text-red-700",
  удалено: "bg-red-50 text-red-700",
  deprecated: "bg-amber-50 text-amber-700",
  устарело: "bg-amber-50 text-amber-700",
  security: "bg-orange-100 text-orange-600",
  безопасность: "bg-orange-100 text-orange-600",
};

function sectionClass(title: string): string {
  return SECTION_CLASS[title.toLowerCase()] ?? "bg-slate-100 text-slate-600";
}

const CHIP = "rounded px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide";

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
// what the release touched, how much of it, and whether it is the build running
// right now.
//
// `highlight` is a link arriving at a version (see releaseAnchor): the section
// it names opens and stays lit until the reader looks away, because a page that
// silently jumped is a page that looks like it opened in the wrong place. The
// opening comes before the scroll on purpose - the caller scrolls once this has
// rendered, and a folded panel would leave the anchor short of the notes the
// reader was sent to.
//
// `current` is the version in production: the one entry that gets a mark of its
// own. `pageSize` cuts a long history down to the newest N with the rest behind
// a button, and `stickyHeaders` pins the open version's header inside a scroll
// box, so a long release still says whose it is halfway down.
export function Changelog({
  entries,
  highlight,
  current,
  pageSize,
  stickyHeaders = false,
}: {
  entries: ChangelogEntry[];
  highlight?: string;
  current?: string;
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
                className="flex w-full cursor-pointer gap-2.5 rounded-lg px-2 py-3 text-left outline-none transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
              >
                <IconChevronRight
                  size={16}
                  stroke={2}
                  className={`mt-1 shrink-0 text-slate-400 transition-transform duration-200 motion-reduce:transition-none ${
                    open ? "rotate-90" : ""
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                    {UNRELEASED.test(e.version) ? (
                      <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-brand-700">
                        Ещё не выпущено
                      </span>
                    ) : (
                      <span className="font-mono text-lg font-bold leading-none text-slate-900">
                        {e.version}
                      </span>
                    )}
                    {inProd && (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                        Сейчас в проде
                      </span>
                    )}
                    {e.date && <span className="ml-auto text-xs text-slate-400">{e.date}</span>}
                  </span>

                  {/* Folded, the header is all the reader gets, so it says what
                      the release touched and how much of it - the same chips
                      that head the categories inside, with their counts - and
                      the opening lines of the intro. Unfolded, all of that sits
                      right below, and repeating it only pushes the notes down. */}
                  {!open && (sections.length > 0 || e.intro) && (
                    <span className="mt-2 block">
                      {sections.length > 0 && (
                        <span className="flex flex-wrap gap-1.5">
                          {sections.map((s) => (
                            <span key={s.title} className={`${CHIP} ${sectionClass(s.title)}`}>
                              {s.title} {s.items.length}
                            </span>
                          ))}
                        </span>
                      )}
                      {/* No `block` next to the clamp: line-clamp brings its own
                          display (-webkit-box), and a display utility beside it
                          wins and quietly unclamps the line. */}
                      {e.intro && (
                        <span className="mt-1.5 line-clamp-2 max-w-prose text-sm leading-relaxed text-slate-500">
                          {plain(e.intro)}
                        </span>
                      )}
                    </span>
                  )}
                </span>
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
                  {/* Wide enough, the category name steps out into a caption
                      column and the items line up in one edge to the right of
                      it: the eye stops zig-zagging between chip and list, and
                      a line stays inside a readable measure instead of running
                      the whole width of the card. */}
                  <div className="mt-3 flex flex-col gap-3.5">
                    {sections.map((s) => (
                      <div
                        key={s.title}
                        className="md:grid md:grid-cols-[6.5rem_minmax(0,1fr)] md:gap-4"
                      >
                        <div className="md:pt-px md:text-right">
                          <span className={`inline-block ${CHIP} ${sectionClass(s.title)}`}>
                            {s.title}
                          </span>
                        </div>
                        <ul className="ml-4 mt-1.5 max-w-prose list-disc space-y-1.5 text-sm text-slate-700 marker:text-slate-300 md:mt-0">
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
