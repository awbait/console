import { describe, expect, test } from "bun:test";
import type { AppNotification } from "@/api/types";
import { notificationLink, notificationText } from "./text";

function notification(over: Partial<AppNotification>): AppNotification {
  return {
    id: "n1",
    kind: "order_healthy",
    subject_type: "order",
    subject_id: "order-1",
    level: "info",
    created_at: "2026-08-18T10:00:00Z",
    read: false,
    ...over,
  };
}

describe("notificationText", () => {
  test("says what happened to the service, by name", () => {
    const text = notificationText(
      notification({ kind: "order_healthy", payload: { service_name: "payments" } }),
    );
    expect(text).toBe("Сервис payments развёрнут и работает");
  });

  test("coming back after a failure is different news from coming up", () => {
    const recovered = notificationText(
      notification({ kind: "order_healthy", payload: { service_name: "payments", recovered: true } }),
    );
    expect(recovered).toBe("Сервис payments снова работает");
  });

  test("a rejected version carries the reviewer's comment: that is the message", () => {
    const text = notificationText(
      notification({
        kind: "version_rejected",
        subject_type: "version",
        payload: { chart_name: "ingress-gateway", chart_version: "1.2.0", comment: "Уберите hpa из формы." },
      }),
    );
    expect(text).toContain("1.2.0");
    expect(text).toContain("Уберите hpa из формы.");
  });

  test("a release nobody has published yet says what to do about it", () => {
    const text = notificationText(
      notification({
        kind: "chart_version_available",
        subject_type: "version",
        payload: { chart_project: "platform", chart_name: "ingress-gateway", chart_version: "1.3.0" },
      }),
    );
    expect(text).toContain("ingress-gateway");
    expect(text).toContain("1.3.0");
    expect(text).toMatch(/согласовани/i);
  });

  test("a payload that lost a field still reads as a sentence", () => {
    expect(notificationText(notification({ kind: "order_degraded" }))).toBe("Сервис сервис не работает");
  });

  test("a kind from a newer portal says so instead of rendering blank", () => {
    const text = notificationText(notification({ kind: "chat_message_from_the_future" }));
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain("chat_message");
  });

  test("no notification speaks the portal's own machinery", () => {
    const kinds = [
      "order_healthy",
      "order_degraded",
      "order_change_blocked",
      "version_approved",
      "version_rejected",
      "chart_version_available",
      "portal_updated",
    ];
    for (const kind of kinds) {
      const text = notificationText(notification({ kind, payload: { service_name: "svc", version: "1.0.0" } }));
      expect(text).not.toMatch(/\bMR\b|слияни|ветк|merge|git|argo|reconcil/i);
      // A headline, not a sentence: no full stop at the end of any of them.
      expect(text).not.toMatch(/\.$/);
    }
  });
});

describe("notificationLink", () => {
  test("an order notification opens the order", () => {
    expect(notificationLink(notification({}))).toBe("/requests/order-1");
  });

  test("a version notification opens that version of its service", () => {
    const to = notificationLink(
      notification({
        subject_type: "version",
        subject_id: "pub-1/1.2.0",
        payload: { chart_project: "platform", chart_name: "ingress-gateway", chart_version: "1.2.0" },
      }),
    );
    expect(to).toBe("/catalog/platform/ingress-gateway/manage/1.2.0");
  });

  test("a notification with nothing to point at leads nowhere", () => {
    expect(notificationLink(notification({ subject_type: "platform", subject_id: "" }))).toBeNull();
  });

  test("a version notification with nothing to address is not a broken link", () => {
    expect(notificationLink(notification({ subject_type: "version", subject_id: "pub-1/1.0.0" }))).toBeNull();
  });
});

describe("the portal's own update", () => {
  const updated = (version: string) =>
    notification({ kind: "portal_updated", subject_type: "platform", subject_id: "", payload: { version } });

  test("a release opens its own section of the changelog", () => {
    expect(notificationLink(updated("v0.5.0"))).toBe("/about#release-0.5.0");
    expect(notificationLink(updated("0.5.0"))).toBe("/about#release-0.5.0");
  });

  test("a build between releases opens what is not released yet", () => {
    // That is exactly what such a build is: everything merged since 0.4.0.
    expect(notificationLink(updated("v0.4.0-10-g2574d9b"))).toBe("/about#release-unreleased");
  });

  test("the version is named as it is stamped", () => {
    expect(notificationText(updated("v0.4.0-10-g2574d9b"))).toBe(
      "Портал обновлён до версии v0.4.0-10-g2574d9b",
    );
  });
});
