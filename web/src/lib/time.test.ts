import { describe, expect, test } from "bun:test";
import { dateInWords, dayLabel, fmtRecent, fmtRelative } from "./time";

const NOW = new Date("2026-08-19T12:00:00").getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("fmtRecent", () => {
  test("counts the time while it is still worth counting", () => {
    expect(fmtRecent(ago(30_000), NOW)).toBe("30 сек назад");
    expect(fmtRecent(ago(5 * MINUTE), NOW)).toBe("5 мин назад");
    expect(fmtRecent(ago(3 * HOUR), NOW)).toBe("3 ч назад");
  });

  test("past a day it says when, because nobody counts in days", () => {
    // "2 дн назад" makes the reader do arithmetic the portal already did.
    expect(fmtRecent(ago(2 * DAY), NOW)).toMatch(/^\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}$/);
    expect(fmtRecent(ago(30 * DAY), NOW)).toMatch(/^\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}$/);
  });

  test("the switch is one day, not one calendar date", () => {
    // 23 hours ago can be yesterday by the calendar and is still "23 ч назад".
    expect(fmtRecent(ago(23 * HOUR), NOW)).toBe("23 ч назад");
    expect(fmtRecent(ago(25 * HOUR), NOW)).not.toMatch(/назад/);
  });
});

describe("dayLabel", () => {
  test("names today and yesterday, dates the rest", () => {
    expect(dayLabel(ago(1 * HOUR), NOW)).toBe("Сегодня");
    expect(dayLabel(ago(20 * HOUR), NOW)).toBe("Вчера");
    expect(dayLabel(ago(3 * DAY), NOW)).toBe("16 августа");
  });

  test("a date from another year carries the year", () => {
    expect(dayLabel(new Date("2025-12-31T10:00:00").toISOString(), NOW)).toBe("31 декабря 2025");
  });
});

describe("dateInWords", () => {
  test("names the day inside a sentence, never \"today\"", () => {
    expect(dateInWords(ago(1 * HOUR), NOW)).toBe("19 августа");
    expect(dateInWords(ago(3 * DAY), NOW)).toBe("16 августа");
  });

  test("a date from another year carries the year", () => {
    expect(dateInWords(new Date("2025-12-31T10:00:00").toISOString(), NOW)).toBe(
      "31 декабря 2025",
    );
  });
});

describe("fmtRelative", () => {
  test("stays relative up to a week, then gives the date", () => {
    expect(fmtRelative(ago(3 * DAY), NOW)).toBe("3 дн назад");
    expect(fmtRelative(ago(8 * DAY), NOW)).toMatch(/^\d{2}\.\d{2}\.\d{4}, /);
  });
});
