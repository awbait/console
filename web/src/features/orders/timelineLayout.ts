// How many events fit on one page of the history dialog. Split out of the
// component because it is arithmetic, not markup: the dialog has a fixed height
// and no scroll inside it, so this is the only thing standing between the
// reader and a page that either spills out of the body or stops short of it.

// Starting guesses only. The real heights are measured off the rendered rows
// (useBodyMetrics) because the exact line height depends on the font the
// browser ended up using; guessing low costs an overflow, guessing high leaves
// a gap the reader can see is free.
export const ROW_H = 36; // py-1.5 around a 24px circle
export const DAY_H = 22; // heading line plus the mb-1.5 under it
export const DAY_SEP = 12; // mt-3 above a day that is not the first on the page

// Fallback page size for the measuring pass, before the body has a height.
export const MODAL_PAGE = 12;

export type Metrics = { rowH: number; dayH: number; daySep: number };

// paginate fills each page to the height it actually has, and what does not fit
// moves to the next page. A row is a fixed height, but a day heading costs
// extra on top of the row it opens, and the day that opens a page costs less
// than the ones below it - it has no gap above. That is why the split is walked
// item by item instead of dividing by a constant: the same events pack
// differently depending on where the days fall.
//
// A page is closed only once the next item would exceed the height, so the
// first item always lands on the page even in the pathological case where the
// body is shorter than a single row - better one clipped row than an empty page
// and an endless list of them.
export function paginate<T>(
  items: T[],
  height: number,
  dayOf: (item: T) => string,
  m: Metrics,
): T[][] {
  if (items.length === 0) return [[]];
  if (height <= 0) return chunk(items, MODAL_PAGE);
  const pages: T[][] = [];
  let page: T[] = [];
  let used = 0;
  let day = "";
  for (const item of items) {
    const d = dayOf(item);
    // Opening a page: the heading has no gap above it. Opening a day further
    // down the page: it does. Same day as the row above: just the row.
    const cost =
      page.length === 0 ? m.rowH + m.dayH : m.rowH + (d === day ? 0 : m.dayH + m.daySep);
    if (page.length > 0 && used + cost > height) {
      pages.push(page);
      page = [item];
      used = m.rowH + m.dayH; // the new page reopens with its own heading
    } else {
      used += cost;
      page.push(item);
    }
    day = d;
  }
  if (page.length > 0) pages.push(page);
  return pages;
}

// pageHeight is what one page occupies once rendered - the same arithmetic
// paginate splits by, kept beside it so the two cannot drift apart.
export function pageHeight<T>(page: T[], dayOf: (item: T) => string, m: Metrics): number {
  let day = "";
  let total = 0;
  page.forEach((item, i) => {
    const d = dayOf(item);
    total += i === 0 ? m.rowH + m.dayH : m.rowH + (d === day ? 0 : m.dayH + m.daySep);
    day = d;
  });
  return total;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
