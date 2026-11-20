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
  dependencies: (project: string, name: string, version: string): QueryKey => [
    "dependencies",
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
  viewRefs: (): QueryKey => ["view-refs"],
  changelog: (project: string, name: string): QueryKey => ["changelog", project, name],
  teams: (): QueryKey => ["teams"],
  // Platform variables: the admin page and the version constructor both read
  // them, so a switch between the two hits the cache instead of the network.
  variables: (): QueryKey => ["variables"],
  // Stands: the order form, the orders list and the admin page all read them.
  stands: (): QueryKey => ["stands"],
  stand: (id: string): QueryKey => ["stands", id],
  requests: (): QueryKey => ["requests"],
  // The admin's publications page: the registry rows and the queue of versions
  // waiting for a decision. Keyed so a return from a decision page renders
  // from cache and revalidates, instead of blanking to a spinner.
  registry: (): QueryKey => ["admin-publications"],
  pendingVersions: (): QueryKey => ["pending-versions"],
  platformHealth: (): QueryKey => ["platform-health"],
};
