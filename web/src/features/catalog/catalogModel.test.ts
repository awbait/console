import { describe, expect, test } from "bun:test";
import type { CatalogChart, PublicationSummary, User } from "../../api/types";
import {
  canManageChart,
  catalogDescription,
  catalogVersion,
  isOrderableChart,
  publicationState,
} from "./catalogModel";

const publication: PublicationSummary = {
  id: "pub",
  category_id: "network",
  owner_team: "platform",
  created_by: "alice",
  created_by_name: "Alice",
  status: "APPROVED",
  adoptable: false,
  published: true,
  has_order_view: true,
  recommended_version: "1.1.0",
  orderable_versions: ["1.2.0", "1.1.0"],
  approved_view_version: "1.2.0",
  approved_description: "Approved description",
};
const chart: CatalogChart = {
  project: "platform",
  name: "gateway",
  description: "Unreviewed description",
  latest_version: "2.0.0",
  versions: ["2.0.0", "1.2.0", "1.1.0"],
  publication,
};
const member: User = {
  sub: "alice",
  email: "",
  preferred_username: "alice",
  name: "Alice",
  teams: ["platform"],
  role: "member",
};

describe("catalog publication presentation", () => {
  test("keeps the recommended snapshot separate from a newer registry release", () => {
    expect(catalogVersion(chart)).toBe("1.1.0");
    expect(catalogDescription(chart)).toBe("Approved description");
    expect(
      catalogVersion({ ...chart, publication: { ...publication, recommended_version: undefined } }),
    ).toBe("1.2.0");
  });
  test("supports both the version allowlist and legacy approved order forms", () => {
    expect(isOrderableChart({ ...chart, publication: { ...publication, has_order_view: false } })).toBe(true);
    expect(
      isOrderableChart({ ...chart, publication: { ...publication, orderable_versions: undefined } }),
    ).toBe(true);
    expect(isOrderableChart({ ...chart, publication: { ...publication, published: false } })).toBe(false);
    expect(
      isOrderableChart({
        ...chart,
        publication: { ...publication, orderable_versions: [], has_order_view: false },
      }),
    ).toBe(false);
  });
  test("a missing or retired service never offers an order", () => {
    const missing = { ...chart, missing: true };
    const retired = {
      ...chart,
      publication: { ...publication, published: false, deprecated_versions: [{ version: "1.1.0" }] },
    };
    expect(isOrderableChart(missing)).toBe(false);
    expect(publicationState(missing).label).toBe("Нет в Harbor");
    expect(isOrderableChart(retired)).toBe(false);
    expect(publicationState(retired).label).toBe("Снят с поддержки");
  });
  test("drafts show live data and the actual review state", () => {
    const draft = { ...chart, publication: { ...publication, published: false, status: "PENDING" as const } };
    expect(catalogVersion(draft)).toBe("2.0.0");
    expect(catalogDescription(draft)).toBe("Unreviewed description");
    expect(publicationState(draft).label).toBe("На согласовании");
  });
});

describe("unpublished catalog access", () => {
  test("keeps management with the owner or platform admin", () => {
    expect(canManageChart(chart, member)).toBe(true);
    expect(canManageChart(chart, { ...member, teams: ["other"] })).toBe(false);
    expect(canManageChart(chart, { ...member, teams: [], role: "admin" })).toBe(true);
    expect(canManageChart(chart, null)).toBe(false);
  });
  test("adoption uses the server flag, not the identity of the discovery process", () => {
    const other = { ...member, teams: ["other"] };
    expect(
      canManageChart({ ...chart, publication: { ...publication, created_by: "auto-discovery" } }, other),
    ).toBe(false);
    expect(canManageChart({ ...chart, publication: { ...publication, adoptable: true } }, other)).toBe(true);
    expect(canManageChart({ ...chart, publication: null }, other)).toBe(true);
    expect(canManageChart({ ...chart, publication: null }, { ...member, role: "auditor", teams: [] })).toBe(
      false,
    );
  });
});
