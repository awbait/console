import { beforeEach, describe, expect, test } from "bun:test";
import type { AppNotification } from "@/api/types";
import { notificationLink, notificationText } from "@/features/notifications/text";
import { dropStash, readStash, registerForm, saveOpenForms, writeStash } from "./formStash";
import { fromLocalInput, toLocalInput, when } from "./when";

// A plain in-memory Storage: the test runner has none of its own.
class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}

beforeEach(() => {
  (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
});

describe("form stash", () => {
  test("a saved form comes back once, and is gone when dropped", () => {
    writeStash("order:u1:/catalog/p/n/order", { serviceName: "pg1" });
    expect(readStash<{ serviceName: string }>("order:u1:/catalog/p/n/order")?.data.serviceName).toBe("pg1");
    expect(readStash("order:u2:/catalog/p/n/order")).toBeNull();
    dropStash("order:u1:/catalog/p/n/order");
    expect(readStash("order:u1:/catalog/p/n/order")).toBeNull();
  });

  test("a copy a week old is not offered", () => {
    writeStash("k", { a: 1 });
    expect(readStash("k", Date.now() + 8 * 24 * 60 * 60 * 1000)).toBeNull();
  });

  test("the shell saves every open form and says whether any kept something", () => {
    const off1 = registerForm(() => false);
    expect(saveOpenForms()).toBe(false);
    const off2 = registerForm(() => true);
    // A form that breaks does not stop the others.
    const off3 = registerForm(() => {
      throw new Error("boom");
    });
    expect(saveOpenForms()).toBe(true);
    off1();
    off2();
    off3();
    expect(saveOpenForms()).toBe(false);
  });
});

describe("maintenance times", () => {
  test("the day is always named", () => {
    const iso = new Date(2026, 9, 16, 22, 5).toISOString();
    expect(when(iso, new Date(2026, 9, 15).getTime())).toBe("16 октября в 22:05");
  });

  test("a datetime-local value survives the round trip", () => {
    const iso = new Date(2026, 9, 16, 22, 0).toISOString();
    expect(fromLocalInput(toLocalInput(iso))).toBe(iso);
    expect(fromLocalInput("")).toBeUndefined();
  });
});

function notification(over: Partial<AppNotification>): AppNotification {
  return {
    id: "n1",
    kind: "maintenance_scheduled",
    subject_type: "platform",
    subject_id: "w1",
    level: "attention",
    created_at: new Date().toISOString(),
    read: false,
    payload: { starts_at: new Date(2026, 9, 16, 22, 0).toISOString() },
    ...over,
  } as AppNotification;
}

describe("maintenance notifications", () => {
  const kinds = [
    "maintenance_scheduled",
    "maintenance_started",
    "maintenance_soon",
    "maintenance_changed",
    "maintenance_ended",
    "maintenance_overdue",
  ];

  test("every kind has its own line, a headline without a full stop", () => {
    for (const kind of kinds) {
      const text = notificationText(notification({ kind }));
      expect(text).not.toContain("эта версия портала не знает");
      expect(text).not.toMatch(/\.$/);
      expect(text).not.toContain("NaN");
    }
  });

  test("a called-off window says so", () => {
    expect(notificationText(notification({ kind: "maintenance_ended", payload: { cancelled: true } }))).not.toBe(
      notificationText(notification({ kind: "maintenance_ended", payload: { cancelled: false } })),
    );
  });

  test("only running late leads somewhere: to where it is ended", () => {
    expect(notificationLink(notification({ kind: "maintenance_overdue" }))).toBe("/admin/maintenance");
    expect(notificationLink(notification({ kind: "maintenance_scheduled" }))).toBeNull();
  });
});
