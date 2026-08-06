import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { api, errorMessage, HttpError } from "./client";

describe("errorMessage", () => {
  test("unwraps Error and HttpError messages", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    // A 5xx with no body still reads as a sentence, not as "HTTP 500".
    expect(errorMessage(new HttpError(500, null))).toContain("Что-то пошло не так");
  });
  test("stringifies non-Error values", () => {
    expect(errorMessage("plain")).toBe("plain");
    expect(errorMessage(42)).toBe("42");
  });
});

describe("HttpError text", () => {
  // A down upstream used to surface as the bare code "internal": the backend
  // sent no message and the UI printed whatever it got.
  test("an unreachable upstream reads as a product sentence", () => {
    const e = new HttpError(502, { error: "upstream_unavailable" });
    expect(e.message).toContain("не отвечает");
    expect(e.code).toBe("upstream_unavailable");
  });
  test("a bare internal code never reaches the user", () => {
    expect(new HttpError(500, { error: "internal" }).message).not.toContain("internal");
  });
  // Validation and conflicts speak for themselves - that text is written for
  // the user and is more specific than anything generic.
  test("keeps the server message where it is addressed to the user", () => {
    const e = new HttpError(422, { error: "validation_failed", message: "Имя «gw» уже занято." });
    expect(e.message).toBe("Имя «gw» уже занято.");
  });
});

describe("request timeout handling", () => {
  const realFetch = globalThis.fetch;
  const realTimeout = AbortSignal.timeout;

  beforeEach(() => {
    // Stub the default-timeout signal so the test never schedules a real 30s timer.
    AbortSignal.timeout = (() => new AbortController().signal) as typeof AbortSignal.timeout;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    AbortSignal.timeout = realTimeout;
  });

  test("maps a fetch TimeoutError to a friendly message", async () => {
    globalThis.fetch = (() =>
      Promise.reject(new DOMException("timed out", "TimeoutError"))) as unknown as typeof fetch;
    await expect(api.listCharts()).rejects.toThrow("Превышено время ожидания ответа сервера");
  });

  test("rethrows a caller-initiated abort unchanged", async () => {
    globalThis.fetch = (() =>
      Promise.reject(new DOMException("aborted", "AbortError"))) as unknown as typeof fetch;
    await expect(api.listCharts()).rejects.toMatchObject({ name: "AbortError" });
  });
});
