import type { QueryKey } from "@tanstack/react-query";

// Shared cache keys. Two pages that ask for the same thing must pass the same
// key, otherwise each of them fetches (and flashes a spinner) on its own: the
// version list and the version editor both need the publication and its stored
// versions, so navigating between them should hit the cache, not the network.
export const qk = {
  catalog: (): QueryKey => ["catalog"],
  chart: (project: string, name: string): QueryKey => ["chart", project, name],
  publication: (project: string, name: string): QueryKey => ["publication", project, name],
  versions: (publicationId: string): QueryKey => ["versions", publicationId],
  schema: (project: string, name: string, version: string): QueryKey => [
    "schema",
    project,
    name,
    version,
  ],
  readme: (project: string, name: string, version: string): QueryKey => [
    "readme",
    project,
    name,
    version,
  ],
  viewSchema: (): QueryKey => ["view-schema"],
  changelog: (project: string, name: string): QueryKey => ["changelog", project, name],
  teams: (): QueryKey => ["teams"],
  requests: (): QueryKey => ["requests"],
  platformHealth: (): QueryKey => ["platform-health"],
};
