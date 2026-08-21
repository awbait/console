import { describe, expect, test } from "bun:test";
import { apiErrorText, changeInFlightText } from "./errorText";

describe("changeInFlightText", () => {
  test("says the service is still being saved, not how it is being saved", () => {
    // The person on the screen saved their service. The merge request carrying
    // the change, its number and its branch are the portal's own bookkeeping.
    for (const text of [changeInFlightText(), changeInFlightText("delete")]) {
      expect(text).not.toMatch(/\bMR\b|слияни|ветк|merge|git|#\d/i);
      expect(text).toMatch(/сохраня/i);
    }
  });

  test("tells the user what to do, and that depends on what they were doing", () => {
    expect(changeInFlightText()).not.toBe(changeInFlightText("delete"));
    expect(changeInFlightText("delete")).toMatch(/удалить/i);
  });
});

describe("apiErrorText", () => {
  test("a blocked change is explained here, never by the server's own words", () => {
    const server = "an open merge request already exists for this order";
    expect(apiErrorText("open_mr", 409, server)).toBe(changeInFlightText());
  });

  test("field validation keeps the server message: it is about the field", () => {
    expect(apiErrorText("validation_failed", 422, "port: must be >= 1")).toBe("port: must be >= 1");
  });

  test("a platform that is not set up is not an outage, and retrying it is not advice", () => {
    // The server message is the internal chain and names GitLab, a group path
    // and an HTTP status. None of that belongs on the screen, and neither does
    // "try again": nothing changes until a person finishes the setup.
    const server = 'platform not configured: gitlab group: gitlab: status 403: {"message":"403 Forbidden"}';
    const text = apiErrorText("not_configured", 409, server);
    expect(text).not.toContain("403");
    expect(text).not.toMatch(/gitlab/i);
    expect(text).not.toMatch(/не отвечает|недоступ/i);
    expect(text).toMatch(/поддержк/i);
  });
});
