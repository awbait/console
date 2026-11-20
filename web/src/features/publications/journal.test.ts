import { describe, expect, test } from "bun:test";
import type { PublicationEvent } from "@/api/types";
import { actorLabel, describeEvent, SYSTEM_ACTOR } from "./journal";

const labels = {
  category: (id: string) => ({ network: "Сеть", databases: "Базы" })[id] ?? id,
  team: (id: string) => ({ core: "Core", dbaas: "DBaaS" })[id] ?? id,
};

const ev = (event_type: string, payload?: Record<string, unknown>): PublicationEvent => ({
  id: 1,
  publication_id: "p",
  actor: "u-1",
  event_type,
  payload,
  created_at: "2026-10-26T10:00:00Z",
});

describe("describeEvent", () => {
  test("names categories and teams by their labels", () => {
    expect(describeEvent(ev("created", { category_id: "network", owner_team: "core" }), labels)).toBe(
      "Публикация создана. Категория: Сеть. Владелец: Core.",
    );
    expect(describeEvent(ev("adopted", { category_id: "databases", owner_team: "dbaas" }), labels)).toBe(
      "Сервис принят командой DBaaS. Категория: Базы.",
    );
  });

  test("a proposal says what was proposed, an empty one that it was taken back", () => {
    expect(describeEvent(ev("updated", { draft_category_id: "databases" }), labels)).toContain("Базы");
    expect(describeEvent(ev("updated", { draft_owner_team: "dbaas" }), labels)).toContain("DBaaS");
    expect(describeEvent(ev("updated", { draft_category_id: "" }), labels)).toBe(
      "Предложение по категории или владельцу отменено. Действуют согласованные значения.",
    );
  });

  test("an approval lists the values it applied, else is the plain approval", () => {
    expect(describeEvent(ev("approved"), labels)).toBe("Категория и владелец согласованы.");
    expect(describeEvent(ev("approved", { category_id: "databases", owner_team: "dbaas" }), labels)).toBe(
      "Категория изменена на Базы. Сервис передан команде DBaaS.",
    );
  });

  test("version events carry the version and the direction of the change", () => {
    expect(describeEvent(ev("version_orderable", { chart_version: "1.2.0", orderable: true }), labels)).toBe(
      "Версия 1.2.0 открыта для заказа в каталоге.",
    );
    expect(describeEvent(ev("version_orderable", { chart_version: "1.2.0", orderable: false }), labels)).toBe(
      "Версия 1.2.0 убрана из каталога.",
    );
    expect(describeEvent(ev("version_deprecated", { chart_version: "1.0.0", note: "старая" }), labels)).toBe(
      "Версия 1.0.0 снята с поддержки. Причина: старая.",
    );
    expect(describeEvent(ev("version_deprecated", { chart_version: "1.0.0" }), labels)).toBe(
      "Версия 1.0.0 снята с поддержки.",
    );
  });

  test("an unknown event is shown by its code", () => {
    expect(describeEvent(ev("something_new"), labels)).toBe("Неизвестное событие: something_new.");
  });
});

describe("actorLabel", () => {
  test("prefers the directory name, names the reconciler, falls back to the subject", () => {
    expect(actorLabel({ actor: "u-1", actor_name: "Иван Петров" })).toBe("Иван Петров");
    expect(actorLabel({ actor: SYSTEM_ACTOR })).toBe("Проверка реестра чартов");
    expect(actorLabel({ actor: "u-2" })).toBe("u-2");
  });
});
