// Known platform environments and their identity tags for the policies chart
// (resource names follow {instance}-{cluster}-{kindShort}-{project}-{name}).
// The list is hardcoded for now; later it should come from the chart view
// document or a platform API so the map stays chart-driven.

export interface PlatformEnvironment {
  name: string;
  cluster: string;
  instance: string;
}

export const ENVIRONMENTS: PlatformEnvironment[] = [
  { name: "Infra-dev-ecpk", cluster: "inf", instance: "in" },
  { name: "dev-ecpk", cluster: "dev", instance: "id" },
  { name: "techsec-dev", cluster: "tco", instance: "ed" },
  { name: "dev-common", cluster: "dev", instance: "ed" },
  { name: "test-common", cluster: "tst", instance: "ed" },
  { name: "global", cluster: "gl", instance: "pr" },
  { name: "observability", cluster: "obs", instance: "pr" },
  { name: "techsec", cluster: "tcc", instance: "pr" },
  { name: "int-common", cluster: "cmi", instance: "pr" },
  { name: "ML", cluster: "ml", instance: "pr" },
  { name: "ext-common", cluster: "cme", instance: "pr" },
];

// Distinct instance tags in list order.
export function instanceTags(): string[] {
  return [...new Set(ENVIRONMENTS.map((e) => e.instance))];
}

// Environments reachable under an instance tag; their cluster tags are the
// valid identity.cluster options for it (unique within one instance).
export function environmentsForInstance(instance: string): PlatformEnvironment[] {
  return ENVIRONMENTS.filter((e) => e.instance === instance);
}
