import type { ChangelogEntry } from "../api/types";
import { releaseAnchor } from "../lib/release";
import { Markdown } from "./Markdown";

// A Keep-a-Changelog section title to a chip style. Each category gets its own
// soft tint so the list is scannable, but the palette stays low-saturation
// rather than a loud semantic green-vs-red. A chart writes its changelog in
// whatever language it likes, so both spellings are known here.
const SECTION_CLASS: Record<string, string> = {
  added: "bg-emerald-50 text-emerald-700",
  добавлено: "bg-emerald-50 text-emerald-700",
  changed: "bg-blue-50 text-blue-700",
  изменено: "bg-blue-50 text-blue-700",
  fixed: "bg-violet-50 text-violet-700",
  исправлено: "bg-violet-50 text-violet-700",
  removed: "bg-rose-50 text-rose-700",
  удалено: "bg-rose-50 text-rose-700",
  deprecated: "bg-amber-50 text-amber-700",
  устарело: "bg-amber-50 text-amber-700",
  security: "bg-orange-50 text-orange-700",
  безопасность: "bg-orange-50 text-orange-700",
};

function sectionClass(title: string): string {
  return SECTION_CLASS[title.toLowerCase()] ?? "bg-slate-100 text-slate-600";
}

// The changelog vocabulary for a version that has no number yet: everything
// merged since the last release. Shown as words, not as the file's marker.
const UNRELEASED = /^unreleased$/i;

// Changelog renders parsed release notes: the portal's own on the About page
// and a product's on its Changes tab, so both read the same way.
//
// Every version carries the id of its section, so something elsewhere can link
// to a version rather than to the page. `highlight` is that version arriving:
// the section it names is lit until the reader looks away, because a page that
// silently jumped is a page that looks like it opened in the wrong place.
export function Changelog({
  entries,
  highlight,
}: {
  entries: ChangelogEntry[];
  highlight?: string;
}) {
  return (
    <div className="flex flex-col gap-9">
      {entries.map((e) => (
        <section
          key={e.version}
          id={releaseAnchor(e.version)}
          // Scrolled-to sections stop below the top edge of the scroller rather
          // than flush against it.
          className={`scroll-mt-4 rounded-lg transition-colors duration-500 ${
            highlight === releaseAnchor(e.version) ? "bg-brand-50/60 p-3 -m-3" : ""
          }`}
        >
          {/* The version opens its release: a line of its own, above a rule that
              runs the full width, so a long list stays divided by version and
              not just by category. */}
          <div className="flex items-baseline gap-3 border-b border-slate-200 pb-2">
            {UNRELEASED.test(e.version) ? (
              <h3 className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-brand-700">
                Ещё не выпущено
              </h3>
            ) : (
              <h3 className="font-mono text-lg font-bold leading-none text-slate-900">
                {e.version}
              </h3>
            )}
            {e.date && <span className="ml-auto text-xs text-slate-400">{e.date}</span>}
          </div>
          {e.intro && (
            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              <Markdown inline>{e.intro}</Markdown>
            </p>
          )}
          <div className="mt-3 flex flex-col gap-3">
            {(e.sections ?? []).map((s) => (
              <div key={s.title}>
                <span
                  className={`inline-block rounded px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${sectionClass(s.title)}`}
                >
                  {s.title}
                </span>
                <ul className="mt-1.5 ml-4 list-disc space-y-1 text-sm text-slate-700 marker:text-slate-300">
                  {s.items.map((it) => (
                    <li key={it} className="leading-relaxed">
                      <Markdown inline>{it}</Markdown>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
