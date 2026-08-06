import { describe, expect, test } from "bun:test";
import { chunk, DAY_H, DAY_SEP, MODAL_PAGE, paginate, pageHeight, ROW_H } from "./timelineLayout";

const M = { rowH: ROW_H, dayH: DAY_H, daySep: DAY_SEP };

// Events are reduced to the only thing the split cares about: which day they
// belong to. `day(...)` builds a list from day labels, one item per row.
const day = (...days: string[]) => days;
const dayOf = (d: string) => d;

describe("paginate", () => {
  test("fills a page to the height and carries the rest over", () => {
    // One day, 36px rows under a 22px heading: 22 + 9*36 = 346 fits in 356,
    // the tenth row would make 382.
    const pages = paginate(day(...Array(12).fill("2 июня")), 356, dayOf, M);
    expect(pages.map((p) => p.length)).toEqual([9, 3]);
  });

  test("no page is taller than the body", () => {
    const events = day("Сегодня", "Сегодня", "Вчера", "Вчера", "Вчера", "1 июня", "31 мая", "31 мая");
    for (const height of [120, 200, 356, 500]) {
      for (const page of paginate(events, height, dayOf, M)) {
        expect(pageHeight(page, dayOf, M)).toBeLessThanOrEqual(height);
      }
    }
  });

  test("keeps every event, in order", () => {
    const events = day("Сегодня", "Сегодня", "Вчера", "1 июня", "1 июня", "31 мая");
    expect(paginate(events, 150, dayOf, M).flat()).toEqual(events);
  });

  test("charges a heading for each day and a gap for the ones below the first", () => {
    // 22 + 36 opens the page, then every further day adds 12 + 22 + 36 = 70.
    // 58 + 70 + 70 = 198 fits in 200; a fourth day would need 268.
    const pages = paginate(day("а", "б", "в", "г"), 200, dayOf, M);
    expect(pages.map((p) => p.length)).toEqual([3, 1]);
  });

  test("a day split across pages is reopened on the next one", () => {
    // Page two starts with its own heading, so it holds one row fewer than the
    // 200px would suggest if headings were free.
    const pages = paginate(day(...Array(8).fill("вторник")), 130, dayOf, M);
    expect(pages.map((p) => p.length)).toEqual([3, 3, 2]);
    expect(pageHeight(pages[1], dayOf, M)).toBe(22 + 3 * 36);
  });

  test("always places at least one event, even in a body too short for it", () => {
    const pages = paginate(day("а", "б", "в"), 10, dayOf, M);
    expect(pages.map((p) => p.length)).toEqual([1, 1, 1]);
  });

  test("falls back to a fixed count while the body is unmeasured", () => {
    const events = day(...Array(MODAL_PAGE + 3).fill("среда"));
    expect(paginate(events, 0, dayOf, M).map((p) => p.length)).toEqual([MODAL_PAGE, 3]);
  });

  test("an empty history is one empty page", () => {
    expect(paginate([], 356, dayOf, M)).toEqual([[]]);
  });
});

describe("chunk", () => {
  test("splits into runs of at most size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
