import { IconChevronRight } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangelogEntry } from "../api/types";
import { isRelease, releaseAnchor } from "../lib/release";
import { Markdown } from "./Markdown";

// A Keep-a-Changelog category to its colour. Colour is what tells one category
// from the next inside an open release: added is not fixed, and a page of grey
// headings makes the reader check every one of them. It is spent there and
// nowhere else - the folded list above stays plain, so the eye lands on the
// release it opened rather than on the six it did not.
//
// A small name in colour is not a heading yet: at eleven pixels it weighs the
// same as the text under it and the eye walks past it. What makes it one is the
// rule that runs from the name to the end of the measure - the category starts
// on a line across the page, the way a section starts in print, and the colour
// arrives as a band rather than as six letters.
//
// The 800 step carries the name (dark on a light card, light on a dark one, so
// it reads in both themes), the 600 step the bullets and, thinned out, the
// rule: a band has to stay behind the words it belongs to, not compete. A
// chart writes its changelog in whatever language it likes, so both spellings
// are known here, and only theme-aware families are used - see
// tailwind.config.js.
type Tint = { name: string; marker: string; rule: string };

const SECTION_TINT: Record<string, Tint> = {
  added: { name: "text-emerald-800", marker: "marker:text-emerald-600", rule: "bg-emerald-600/40" },
  добавлено: {
    name: "text-emerald-800",
    marker: "marker:text-emerald-600",
    rule: "bg-emerald-600/40",
  },
  changed: { name: "text-blue-800", marker: "marker:text-blue-600", rule: "bg-blue-600/40" },
  изменено: { name: "text-blue-800", marker: "marker:text-blue-600", rule: "bg-blue-600/40" },
  fixed: { name: "text-indigo-800", marker: "marker:text-indigo-600", rule: "bg-indigo-600/40" },
  исправлено: { name: "text-indigo-800", marker: "marker:text-indigo-600", rule: "bg-indigo-600/40" },
  removed: { name: "text-red-800", marker: "marker:text-red-600", rule: "bg-red-600/40" },
  удалено: { name: "text-red-800", marker: "marker:text-red-600", rule: "bg-red-600/40" },
  deprecated: { name: "text-amber-800", marker: "marker:text-amber-600", rule: "bg-amber-600/40" },
  устарело: { name: "text-amber-800", marker: "marker:text-amber-600", rule: "bg-amber-600/40" },
  security: { name: "text-orange-800", marker: "marker:text-orange-600", rule: "bg-orange-600/40" },
  безопасность: {
    name: "text-orange-800",
    marker: "marker:text-orange-600",
    rule: "bg-orange-600/40",
  },
};

const PLAIN_TINT: Tint = {
  name: "text-slate-500",
  marker: "marker:text-slate-300",
  rule: "bg-slate-200",
};

function sectionTint(title: string) {
  return SECTION_TINT[title.toLowerCase()] ?? PLAIN_TINT;
}

// How long a version stays lit after a link brought the reader to it: long
// enough to be seen once the smooth scroll has finished, short enough that
// nobody starts reading the tint as a meaning of its own.
const FLASH_MS = 2000;

// Opening a version moves the page under the reader: the release that was open
// folds away, and everything below it climbs by however tall it was. The header
// just pressed can end up above the top edge, leaving the middle of a text
// nobody has started reading.
//
// So the list is brought back to that header - but only once whatever moves it
// has stopped, because a scroll aimed into a moving layout lands where the
// layout happened to be. Two things had to be got right here.
//
// A release above the header folding away is what drags it up, and the release
// being opened is what makes room to scroll into: while its notes are still
// unfolding there is not enough page under the header for it to reach the top,
// and the scroll stops short. So the wait is for every panel in the list to be
// where its header says it should be - shut at nothing, open at the full height
// of its notes. Asked this way, a second press while the first fold is still
// running waits for both, which listening to one panel's transitionend does not
// (that event also arrives from the notes fading inside it, in less time than
// the fold takes).
//
// And only the last press counts: a reader who opens one release and another
// straight after would otherwise be carried to the version they moved on from.
//
// The last releases in a list have nowhere to scroll to: the list ends before
// the header can reach the top, the scroll stops against the bottom, and the
// version lands at a different height every time depending on how long it is.
// So the list is given exactly the run-up it lacks, and no more - the room is
// measured for the release being opened and goes back to nothing for one that
// has the page under it anyway. Only inside a scrolling card: on a page that
// scrolls as a whole, empty height below the card is worse than a header that
// stops short of the top.
//
// The scroll runs with the fold rather than after it. Waiting for the fold to
// finish and then scrolling is two movements with a pause between them, and the
// pause is the part that reads as broken. Instead the list is pulled towards the
// header a share of the remaining distance every frame - as the fold moves the
// header, the distance is simply recomputed, and the two motions arrive
// together. SCROLL_CAP ends it if the distance never closes.
const SCROLL_GAP = 16;
const SCROLL_EASE = 0.22;
const SCROLL_CAP = 150;
let scrollJob = 0;

// scrollBox is the thing that scrolls around a release: the card on the Changes
// tab, the card on the About page, or the page itself.
function scrollBox(el: HTMLElement): HTMLElement | null {
  let p = el.parentElement;
  while (p) {
    const overflow = getComputedStyle(p).overflowY;
    if (overflow === "auto" || overflow === "scroll") return p;
    p = p.parentElement;
  }
  return null;
}

// moving reports whether any release in the list is still folding or unfolding.
function moving(): boolean {
  for (const panel of document.querySelectorAll<HTMLElement>('[id$="-notes"]')) {
    const header = document.getElementById(panel.id.replace(/-notes$/, "-title"));
    const open = header?.getAttribute("aria-expanded") === "true";
    const notes = panel.firstElementChild?.firstElementChild;
    const target = open && notes ? notes.getBoundingClientRect().height : 0;
    const now = Number.parseFloat(getComputedStyle(panel).gridTemplateRows);
    if (Math.abs((Number.isFinite(now) ? now : 0) - target) > 0.5) return true;
  }
  return false;
}

function scrollToRelease(anchor: string, list: HTMLElement | null, spacer: HTMLElement | null) {
  const el = document.getElementById(anchor);
  const page = document.scrollingElement as HTMLElement | null;
  const box = (el && scrollBox(el)) ?? page;
  if (!el || !box || !list) return;
  const job = ++scrollJob;
  const quick = !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  // Room is only ever made inside a card: on a page that scrolls as a whole it
  // would be empty height under everything, not a run-up for a list.
  const room = spacer && box !== page ? spacer : null;

  const edge = () => (box === page ? 0 : box.getBoundingClientRect().top);
  const missing = () => {
    if (!room) return 0;
    const end = list.getBoundingClientRect().bottom - room.offsetHeight;
    const below = end - el.getBoundingClientRect().top;
    // Rounded up: a run-up a pixel short of what the header needs is a header
    // that stops a pixel short of the top.
    return Math.max(0, Math.ceil(box.clientHeight - SCROLL_GAP - below));
  };

  let frames = 0;
  const step = () => {
    if (job !== scrollJob) return;
    // The run-up grows while the fold is still running and is trimmed to the
    // height actually needed once it is over: more than that is empty page.
    const need = missing();
    if (room && need > room.offsetHeight) room.style.height = `${need}px`;
    const away = el.getBoundingClientRect().top - edge() - SCROLL_GAP;
    if ((!moving() && Math.abs(away) < 0.5) || frames++ > SCROLL_CAP) {
      if (room) {
        room.style.height = `${missing()}px`;
        // Trimming the run-up can pull the list back by a pixel or two; the
        // header takes them back without an animation nobody would see.
        const rest = el.getBoundingClientRect().top - edge() - SCROLL_GAP;
        if (Math.abs(rest) > 0.5) box.scrollTop += rest;
      }
      return;
    }
    // A step under a pixel is a step the browser rounds away, and the list
    // would spend the rest of the animation two pixels short of the top. The
    // last stretch is taken whole.
    const pull = away * SCROLL_EASE;
    box.scrollTop += quick || Math.abs(pull) < 1 ? away : pull;
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// The version that has no number yet: everything merged since the last release,
// waiting for one. Shown as words, not as the file's marker.
const UNRELEASED = /^unreleased$/i;
const UNRELEASED_LABEL = "Готовится к выпуску";

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
// One version is open at a time. Two open releases push the rest of the list
// off the screen and read as one long text with a number in the middle, which
// is the wall the folding was for.
//
// `highlight` is a link arriving at a version (see releaseAnchor): the section
// it names opens and is lit for a moment, because a page that silently jumped
// is a page that looks like it opened in the wrong place. The
// opening comes before the scroll on purpose - the caller scrolls once this has
// rendered, and a folded panel would leave the anchor short of the notes the
// reader was sent to.
//
// `current` is the build the portal is running: the one version that gets a
// mark of its own. It is the About page's question - which of these am I on -
// and a chart's history has no equivalent, since the catalog offers versions
// rather than runs one.
//
// The whole history is drawn. A folded release is one line, so a long list
// costs a screen of lines and a scrollbar, and a button that offers "one more
// version" is a control that asks for a press to do nothing worth pressing for.
export function Changelog({
  entries,
  highlight,
  current,
}: {
  entries: ChangelogEntry[];
  highlight?: string;
  current?: string;
}) {
  const shown = useMemo(() => withContent(entries), [entries]);
  const newest = shown[0]?.version;

  // The version the reader opened, remembered together with the list it was
  // opened in: a component that stays mounted while its entries change (another
  // chart's history) would otherwise hold a version that is no longer there and
  // show everything folded. Until they touch anything, the choice is made here:
  // the version a link points at, the newest one otherwise.
  const opened = shown.find((e) => releaseAnchor(e.version) === highlight)?.version ?? newest;
  const [chosen, setChosen] = useState<{ of?: string; version: string | null } | null>(null);
  const open = chosen && chosen.of === newest ? chosen.version : (opened ?? null);
  // The list and the empty height under its last release, both written to
  // directly: the run-up is measured frame by frame while a version unfolds,
  // and a state update per frame would re-render the whole history for a number
  // that is only ever a height.
  const list = useRef<HTMLDivElement>(null);
  const spacer = useRef<HTMLDivElement>(null);

  const choose = (version: string | null) => {
    setChosen({ of: newest, version });
    // Only on opening: folding the one being read is a place the reader is
    // already looking at. Closing gives the run-up back, so the list does not
    // end in empty page.
    if (version) scrollToRelease(releaseAnchor(version), list.current, spacer.current);
    else if (spacer.current) spacer.current.style.height = "0px";
  };

  // A link that names a version wins over a fold: without this, a version the
  // reader closed earlier would swallow the next link pointing at it. The state
  // is only rewritten when it actually differs - `shown` is a fresh array on
  // every render, and an unconditional write here would loop.
  useEffect(() => {
    if (!highlight) return;
    const i = shown.findIndex((e) => releaseAnchor(e.version) === highlight);
    if (i < 0) return;
    const v = shown[i].version;
    const top = shown[0]?.version;
    setChosen((c) => (c && c.of === top && c.version === v ? c : { of: top, version: v }));
  }, [highlight, shown]);

  // The arrival mark: the page has just jumped somewhere, and the tint says
  // where it landed. It is an event, not a state - left on, it reads as a
  // version selected for good, and the reader keeps looking for what selected
  // it. So it fades on its own once the jump is over.
  const [landed, setLanded] = useState(highlight);
  useEffect(() => {
    if (!highlight) return;
    setLanded(highlight);
    const t = setTimeout(() => setLanded(undefined), FLASH_MS);
    return () => clearTimeout(t);
  }, [highlight]);

  // A link that names a version is followed here rather than by the page around
  // the list: whatever scrolls - the card on the About page, the card on a
  // chart's Changes tab, the window on a narrow screen - is the same thing the
  // list scrolls when a version is opened by hand, and the arrival looks the
  // same either way. It waits for the notes: until they have rendered there is
  // nothing at that anchor to arrive at.
  const ready = shown.length > 0;
  useEffect(() => {
    if (!highlight || !ready) return;
    scrollToRelease(highlight, list.current, spacer.current);
  }, [highlight, ready]);

  return (
    // Rows are told apart by the space between them, not by a rule under each
    // one: a line every 40 pixels turns a short list into a grid, and the
    // rounded hover behind a row would end short of a full-width rule anyway,
    // as if the row had been cut.
    <div ref={list} className="flex flex-col gap-1">
      {shown.map((e) => {
        const anchor = releaseAnchor(e.version);
        return (
          <Release
            key={e.version}
            entry={e}
            isOpen={open === e.version}
            onToggle={(next) => choose(next ? e.version : null)}
            highlighted={landed === anchor}
            inProd={!!current && isRelease(current) && releaseAnchor(current) === anchor}
          />
        );
      })}

      {/* The run-up under the last release: nothing until a version that ends
          the list needs page under it to reach the top edge. */}
      <div ref={spacer} aria-hidden />
    </div>
  );
}

// How long the fold takes, from the height of the notes inside it. A fixed
// duration cannot serve both: what is calm for five lines is a jump for a
// release of a thousand pixels, because the same time buys ten times the speed.
// So the time grows with the text and stops growing at PACE_MAX, past which
// nobody is watching an animation any more, they are waiting for one.
const PACE_BASE = 240;
const PACE_PER_PX = 0.28;
const PACE_MAX = 700;

function paceOf(height: number): number {
  return Math.round(Math.min(PACE_BASE + height * PACE_PER_PX, PACE_MAX));
}

// Release is one version in the list: the header that folds it and the notes
// under it. It is a component of its own because it measures itself - the notes
// keep their natural height inside the folded row, so the panel can be timed by
// what it is about to show.
function Release({
  entry: e,
  isOpen,
  onToggle,
  highlighted,
  inProd,
}: {
  entry: ChangelogEntry;
  isOpen: boolean;
  onToggle: (open: boolean) => void;
  highlighted: boolean;
  inProd: boolean;
}) {
  const anchor = releaseAnchor(e.version);
  const sections = (e.sections ?? []).filter((s) => s.items.length > 0);

  // Measured once the notes are laid out, and again if they reflow (a window
  // resize rewraps every line, and a release can lose or gain a screenful).
  const notes = useRef<HTMLDivElement>(null);
  const [pace, setPace] = useState(PACE_BASE);
  useEffect(() => {
    const el = notes.current;
    if (!el) return;
    const measure = () => setPace(paceOf(el.getBoundingClientRect().height));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      id={anchor}
      // The open release stands on a ground of its own, header included: with
      // one version open at a time and the folded ones a plain line each, the
      // reader should not have to work out where the notes they are reading
      // began. Scrolled-to sections stop below the top edge of the scroller
      // rather than flush against it.
      className={`scroll-mt-4 rounded-xl transition-colors duration-500 ${
        highlighted ? "bg-brand-50/60" : isOpen ? "bg-slate-50" : ""
      }`}
    >
      <h3>
        <button
          type="button"
          id={`${anchor}-title`}
          aria-expanded={isOpen}
          aria-controls={`${anchor}-notes`}
          onClick={() => onToggle(!isOpen)}
          className={`flex w-full cursor-pointer items-center gap-2.5 px-3 py-3.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 ${
            isOpen ? "rounded-t-xl hover:bg-slate-100/60" : "rounded-lg hover:bg-slate-100/70"
          }`}
        >
          <IconChevronRight
            size={16}
            stroke={2}
            style={{ transitionDuration: `${Math.min(pace, 300)}ms` }}
            className={`shrink-0 text-slate-400 transition-transform ease-in-out motion-reduce:transition-none ${
              isOpen ? "rotate-90" : ""
            }`}
          />
          {UNRELEASED.test(e.version) ? (
            <span className="shrink-0 rounded-full bg-brand-50 px-2.5 py-0.5 text-sm font-semibold text-brand-700">
              {UNRELEASED_LABEL}
            </span>
          ) : (
            <span className="shrink-0 font-mono text-base font-bold text-slate-900">{e.version}</span>
          )}
          {inProd && (
            <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
              Сейчас в проде
            </span>
          )}
          {e.date && <span className="ml-auto shrink-0 pl-2 text-xs text-slate-400">{e.date}</span>}
        </button>
      </h3>

      {/* The panel opens on a grid row going 0fr -> 1fr: a height nobody has to
          measure in advance. react-aria's DisclosurePanel is out for this one -
          it hides the panel with the `hidden` attribute, and display: none is
          not something a transition can touch. visibility rides the same
          transition, so a folded release is out of the tab order without
          cutting the closing short. */}
      <section
        id={`${anchor}-notes`}
        aria-labelledby={`${anchor}-title`}
        style={{ transitionDuration: `${pace}ms` }}
        className={`grid transition-[grid-template-rows,visibility] ease-in-out motion-reduce:transition-none ${
          isOpen ? "visible grid-rows-[1fr]" : "invisible grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          {/* The notes start where the version number starts: past the chevron,
              on the same left edge as the header they belong to. They fade with
              the fold: a release that only changes height is a text being
              sheared, and the same text arriving as the room for it opens is
              one movement. The fade trails the opening and leads the closing,
              so the notes are never left standing in a row half their size. */}
          <div
            ref={notes}
            style={{ transitionDuration: `${Math.round(pace * 0.6)}ms` }}
            className={`pb-5 pl-[2.4rem] pr-3 transition-opacity ease-in-out motion-reduce:transition-none ${
              isOpen ? "opacity-100 delay-100" : "opacity-0"
            }`}
          >
            {e.intro && (
              <p className="max-w-prose text-sm leading-relaxed text-slate-600">
                <Markdown inline>{e.intro}</Markdown>
              </p>
            )}
            {/* A release reads as an article: the category is a heading in its
                own colour over its own list, everything on one left edge, the
                line inside a readable measure instead of running the whole
                width of the card. */}
            <div className="mt-5 flex max-w-prose flex-col gap-6">
              {sections.map((s) => {
                const tint = sectionTint(s.title);
                return (
                  <div key={s.title}>
                    <h4
                      className={`flex items-center gap-3 text-[11px] font-bold uppercase tracking-[0.12em] ${tint.name}`}
                    >
                      {s.title}
                      <span className={`h-px flex-1 rounded-full ${tint.rule}`} />
                    </h4>
                    <ul
                      className={`ml-4 mt-2.5 list-disc space-y-2 text-sm text-slate-700 ${tint.marker}`}
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
}
