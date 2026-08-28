import { describe, expect, test } from "bun:test";
import { pendingChangeNotice } from "./pendingChange";

describe("pendingChangeNotice", () => {
  test("a change the portal applies itself promises nobody", () => {
    const n = pendingChangeNotice("create", { required: false });
    expect(n.title).toBe("Изменение сервиса сохраняется");
    expect(n.hint).not.toMatch(/человек|проверк/i);
  });

  test("a backend that says nothing about the wait reads as no wait", () => {
    expect(pendingChangeNotice("create")).toEqual(pendingChangeNotice("create", { required: false }));
  });

  test("a change a person reads says so, and says it is not on the reader", () => {
    const n = pendingChangeNotice("update", { required: true, by: "service" });
    expect(n.title).toBe("Изменение ждёт проверки");
    expect(n.hint).toMatch(/Изменения этого сервиса читает человек/);
    expect(n.hint).toMatch(/От вас ничего не нужно/);
  });

  test("who asks for the reading changes the wording, not the promise", () => {
    const service = pendingChangeNotice("create", { required: true, by: "service" });
    const install = pendingChangeNotice("create", { required: true, by: "installation" });
    expect(install.hint).toMatch(/В этом портале каждое изменение читает человек/);
    expect(install.hint).not.toBe(service.hint);
    expect(install.title).toBe(service.title);
  });

  test("the wait is named after what was asked for", () => {
    const review = { required: true, by: "service" } as const;
    expect(pendingChangeNotice("create", review).title).toBe("Заказ ждёт проверки");
    expect(pendingChangeNotice("delete", review).title).toBe("Удаление ждёт проверки");
  });

  test("an action this build has never heard of still gets a title", () => {
    const n = pendingChangeNotice("gitlab_18_invented_this", { required: true, by: "service" });
    expect(n.title).toBe("Изменение ждёт проверки");
  });
});
