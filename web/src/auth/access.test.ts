import { describe, expect, test } from "bun:test";
import type { Role, User } from "@/api/types";
import { canOrder, noTeamNotice } from "./access";

function user(role: Role, teams: string[]): User {
  return { sub: "u1", email: "", preferred_username: "u1", name: "U", role, teams } as User;
}

describe("who may order a service", () => {
  test("somebody in a team may", () => {
    expect(canOrder(user("member", ["core"]))).toBe(true);
    expect(noTeamNotice(user("member", ["core"]))).toBeNull();
  });

  // The silent failure this is all about: a person Keycloak let in whose groups
  // the portal recognised none of. They used to get an ordinary-looking empty
  // portal and a refusal after the order form was filled in.
  test("somebody the portal put in no team is told so, and pointed at an administrator", () => {
    const notice = noTeamNotice(user("auditor", []));
    expect(canOrder(user("auditor", []))).toBe(false);
    expect(notice?.short).toContain("ни в одной команде");
    expect(notice?.orders).toContain("администратора платформы");
    expect(notice?.ordering).toContain("администратора платформы");
  });

  // Support and security hold their access through the role and never through a
  // team, so "ask to be added to a team" would be wrong advice for them.
  test("a platform role is told its own reason instead", () => {
    for (const role of ["support", "security", "admin"] as Role[]) {
      const notice = noTeamNotice(user(role, []));
      expect(canOrder(user(role, []))).toBe(false);
      expect(notice?.ordering).toContain("ваша роль в портале другая");
      expect(notice?.ordering).not.toContain("администратора платформы");
    }
  });

  // Every screen calls this before the session has loaded.
  test("nobody at all cannot order", () => {
    expect(canOrder(null)).toBe(false);
    expect(noTeamNotice(null)).not.toBeNull();
  });
});
