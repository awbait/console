import { IconChevronRight } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { ruPlural } from "@/form/fieldErrors";
import type { ChangelogEntry } from "../api/types";
import { isRelease, releaseAnchor } from "../lib/release";
import { Markdown } from "./Markdown";

// A Keep-a-Changelog category to its colour. Colour is what tells one category
// from the next inside an open release: added is not fixed, and a page of grey
// headings makes the reader check every one of them. It is spent there and
// nowhere else - the folded list above stays plain, so the eye lands on the
// release it opened rather than on the six it did not.
//
// The 800 step carries the name (dark on a light card, light on a dark one, so
// it reads in both themes), the 600 step the bullets. A chart writes its
// changelog in whatever language it likes, so both spellings are known here,
// and only theme-aware families are used - see tailwind.config.js.
const SECTION_TINT: Record<string, { name: string; marker: string }> = {
  added: { name: "text-emerald-800", marker: "marker:text-emerald-600" },
  добавлено: { name: "text-emerald-800", marker: "marker:text-emerald-600" },
  changed: { name: "text-blue-800", marker: "marker:text-blue-600" },
  изменено: { name: "text-blue-800", marker: "marker:text-blue-600" },
  fixed: { name: "text-indigo-800", marker: "marker:text-indigo-600" },
  исправлено: { name: "text-indigo-800", marker: "marker:text-indigo-600" },
  removed: { name: "text-red-800", marker: "marker:text-red-600" },
  удалено: { name: "text-red-800", marker: "marker:text-red-600" },
  deprecated: { name: "text-amber-800", marker: "marker:text-amber-600" },
  устарело: { name: "text-amber-800", marker: "marker:text-amber-600" },
  security: { name: "text-orange-800", marker: "marker:text-orange-600" },
  безопасность: { name: "text-orange-800", marker: "marker:text-orange-600" },
};

const PLAIN_TINT = { name: "text-slate-500", marker: "marker:text-slate-300" };

function sectionTint(title: string) {
  return SECTION_TINT[title.toLowerCase()] ?? PLAIN_TINT;
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

// Changelog renders parsed release notes: the portal's own on the About page
// and a product's on its Changes tab, so both read the same way.
//
// The list is an accordion. Read top to bottom it is a wall of text: a release
// is long, and everything under the newest one is history. So a version opens
// on demand, and folded it is one line and three things: which version, when,
// and whether it is the one running. A folded release is an item in a list, and
// a list scans only while its items are one line the same height - anything
// else the header could carry is a summary of a text that is one click away.
//
// `highlight` is a link arriving at a version (see releaseAnchor): the section
// it names opens and stays lit until the reader looks away, because a page that
// silently jumped is a page that looks like it opened in the wrong place. The
// opening comes before the scroll on purpose - the caller scrolls once this has
// rendered, and a folded panel would leave the anchor short of the notes the
// reader was sent to.
//
// `current` is the build the portal is running: the one version that gets a
// mark of its own. It is the About page's question - which of these am I on -
// and a chart's history has no equivalent, since the catalog offers versions
// rather than runs one. `pageSize` cuts a long history down to the newest N
// with the rest behind a button, and `stickyHeaders` pins the open version's
// header inside a scroll box, so a long release still says whose it is halfway
// down.
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
                    Сейчас в проде
                  </span>
                )}
                {e.date && (
                  <span className="ml-auto shrink-0 pl-2 text-xs text-slate-400">{e.date}</span>
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
                  {/* A release reads as an article: the category is a heading
                      in its own colour over its own list, everything on one
                      left edge, the line inside a readable measure instead of
                      running the whole width of the card. */}
                  <div className="mt-4 flex max-w-prose flex-col gap-5">
                    {sections.map((s) => {
                      const tint = sectionTint(s.title);
                      return (
                        <div key={s.title}>
                          <div
                            className={`text-[11px] font-semibold uppercase tracking-wider ${tint.name}`}
                          >
                            {s.title}
                          </div>
                          <ul
                            className={`ml-4 mt-2 list-disc space-y-2 text-sm text-slate-700 ${tint.marker}`}
                          >
                            {s.items.map((it) => (
                              <li key={it} className="pl-1 leading-relaxed">
                                <Markdown inline>{it}</Markdown>
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
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
