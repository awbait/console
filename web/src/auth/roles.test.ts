import { describe, expect, test } from "bun:test";
import { teamLabel } from "./roles";

describe("teamLabel", () => {
  test("a team is called by its own name", () => {
    expect(teamLabel("core", { "idp_ecpk_console/admin": "admin" })).toBe("core");
  });

  test("a group that grants a role is called by the role", () => {
    expect(teamLabel("idp_ecpk_console/admin", { "idp_ecpk_console/admin": "admin" })).toBe(
      "Администратор платформы",
    );
  });

  test("support and security read the same way as in the profile menu", () => {
    const groups = { "console/support": "support", "console/security": "security" } as const;
    expect(teamLabel("console/support", groups)).toBe("Поддержка");
    expect(teamLabel("console/security", groups)).toBe("Информационная безопасность");
  });

  test("with nothing configured the group is printed as it is", () => {
    expect(teamLabel("idp_ecpk_console/admin")).toBe("idp_ecpk_console/admin");
    expect(teamLabel("core", {})).toBe("core");
  });
});
