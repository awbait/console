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

  test("a deletion that did not finish says where to go and look", () => {
    const text = notificationText(
      notification({ kind: "order_delete_stalled", payload: { service_name: "payments" } }),
    );
    expect(text).toContain("payments");
    expect(text).toMatch(/кластере/);
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
      "order_delete_stalled",
      "version_approved",
      "version_rejected",
      "chart_version_available",
      "version_submitted",
      "chart_discovered",
      "chart_version_missing",
      "version_deprecated",
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

describe("what the platform team is told", () => {
  test("a version waiting for approval opens the page where it is decided", () => {
    const n = notification({
      kind: "version_submitted",
      subject_type: "version",
      subject_id: "pub-1/1.4.0",
      payload: { chart_project: "platform", chart_name: "policies", chart_version: "1.4.0" },
    });
    expect(notificationText(n)).toBe("Версия 1.4.0 сервиса policies ждёт согласования");
    // Not the page where the version is written: this one is for admins.
    expect(notificationLink(n)).toBe("/admin/approvals/platform/policies/1.4.0");
  });

  test("a chart found in the registry opens the service to adopt", () => {
    const n = notification({
      kind: "chart_discovered",
      subject_type: "publication",
      subject_id: "pub-2",
      payload: { chart_project: "platform", chart_name: "waypoint" },
    });
    expect(notificationText(n)).toContain("waypoint");
    expect(notificationText(n)).toMatch(/владельц/i);
    expect(notificationLink(n)).toBe("/catalog/platform/waypoint/manage");
  });
});

describe("a version taken out of support", () => {
  const deprecated = (payload: Record<string, unknown>) =>
    notification({
      kind: "version_deprecated",
      subject_type: "version",
      subject_id: "pub-1/1.4.2",
      level: "attention",
      payload: {
        chart_project: "platform",
        chart_name: "ingress-gateway",
        chart_version: "1.4.2",
        ...payload,
      },
    });

  test("says what happened, why, and where to go", () => {
    expect(notificationText(deprecated({ move_to: "1.6.0", note: "не держим 1.x" }))).toBe(
      "Версия 1.4.2 сервиса ingress-gateway снята с поддержки, перейдите на 1.6.0: не держим 1.x",
    );
  });

  test("drops the halves it has nothing to say for", () => {
    expect(notificationText(deprecated({}))).toBe(
      "Версия 1.4.2 сервиса ingress-gateway снята с поддержки",
    );
    expect(notificationText(deprecated({ move_to: "1.6.0" }))).toBe(
      "Версия 1.4.2 сервиса ingress-gateway снята с поддержки, перейдите на 1.6.0",
    );
  });

  // It is addressed to the teams running the version, who do not manage the
  // service: the page where its document is written is not theirs to open.
  test("opens the service in the catalog, not its editor", () => {
    expect(notificationLink(deprecated({}))).toBe("/catalog/platform/ingress-gateway");
  });
});

describe("a version that vanished from the registry", () => {
  const missing = notification({
    kind: "chart_version_missing",
    subject_type: "version",
    subject_id: "pub-1/1.2.0",
    level: "attention",
    payload: { chart_project: "platform", chart_name: "ingress-gateway", chart_version: "1.2.0" },
  });

  test("says what it means, not just that it happened", () => {
    // The service keeps running; what changed is that nobody can order it.
    expect(notificationText(missing)).toBe(
      "Версия 1.2.0 сервиса ingress-gateway пропала из реестра, заказать её больше нельзя",
    );
  });

  test("opens the version it is about", () => {
    expect(notificationLink(missing)).toBe("/catalog/platform/ingress-gateway/manage/1.2.0");
  });
});

describe("configuration that broke by itself", () => {
  const check = (payload: Record<string, unknown>, kind = "config_check_failed") =>
    notification({ kind, subject_type: "platform", subject_id: "config:gitlab_token", payload });

  test("names what broke, not the check that noticed", () => {
    expect(notificationText(check({ check: "gitlab_token", reason: "expired" }))).toBe(
      "Токен GitLab истёк",
    );
    expect(
      notificationText(check({ check: "gitlab_webhook", reason: "hook_disabled" })),
    ).toBe("GitLab отключил вебхук портала");
  });

  test("a token expiry says how long is left, so the two warnings differ", () => {
    expect(
      notificationText(check({ check: "gitlab_token", reason: "expires_soon", days_left: 21 })),
    ).toBe("Токен GitLab истекает через 21 день");
    expect(
      notificationText(check({ check: "gitlab_token", reason: "expires_soon", days_left: 5 })),
    ).toBe("Токен GitLab истекает через 5 дней");
  });

  test("the all-clear names the same thing in the same words", () => {
    const text = notificationText(
      check({ check: "gitlab_token" }, "config_check_recovered"),
    );
    expect(text).toBe("Токен GitLab снова в порядке");
  });

  test("both lead to the page where the detail and the fix are", () => {
    expect(notificationLink(check({ check: "argocd_cluster", reason: "cluster_missing" }))).toBe(
      "/admin/config",
    );
    expect(notificationLink(check({ check: "argocd_cluster" }, "config_check_recovered"))).toBe(
      "/admin/config",
    );
  });

  test("a check this build has never heard of still reads as a sentence", () => {
    const text = notificationText(check({ check: "vault_token", reason: "sealed" }));
    expect(text).toBe("Что-то в настройке портала перестало работать");
  });
});
