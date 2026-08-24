import type { Role, User } from "../api/types";

// How the portal names a role to a person. One map, because the same words have
// to come out wherever a role is shown: the profile menu, and the owner of a
// service when that owner is a group rather than a team.
export const ROLE_LABELS: Record<string, string> = {
  auditor: "Аудитор",
  member: "Участник",
  support: "Поддержка",
  security: "Информационная безопасность",
  admin: "Администратор платформы",
};

// teamLabel is what to print for an owning team.
//
// Usually the team's own name. But a service can be owned by a group that
// grants a role instead of being a team - the charts the platform team runs
// itself are owned by the admin group - and that group is stored as its path in
// the directory, something like "idp_ecpk_console/admin". Nobody outside the
// platform team has ever seen that string. Those owners are called by their
// role, in the same words the profile menu uses.
//
// The value never changes: what goes back to the server is the group, and only
// its label is human. Cutting the path down to its last segment would not do:
// that gives "admin", and the portal already has a name for that role.
export function teamLabel(team: string, roleGroups?: Record<string, Role>): string {
  const role = roleGroups?.[team];
  return (role && ROLE_LABELS[role]) || team;
}

// labelFor binds teamLabel to a session, so a component that already has the
// user does not thread the map through every call.
export function labelFor(user: User | null): (team: string) => string {
  return (team: string) => teamLabel(team, user?.role_groups);
}
