import type { GraphData } from "../../core/model";

// Hand-written sample of one namespace: an ingress in front of two services,
// their workloads and the config, secret and volume those workloads mount. One
// card is deliberately broken (a service whose selector matches nothing) to
// show how the canvas reports a problem.
export const resourceTopologyDemo: GraphData = {
  groups: [{ id: "shop-core", title: "shop-core", accent: "primary", note: "мок" }],
  nodes: [
    {
      id: "ing/shop",
      groupId: "shop-core",
      title: "shop",
      kind: "ingress",
      subtitleLabel: "host",
      subtitle: "shop.example.com",
      rows: [
        { id: "/", label: "/", tag: "→ storefront" },
        { id: "/api", label: "/api", tag: "→ api" },
      ],
    },
    {
      id: "svc/storefront",
      groupId: "shop-core",
      title: "storefront",
      kind: "service",
      subtitleLabel: "type",
      subtitle: "ClusterIP",
      rows: [{ id: "80", label: "80", tag: "→ 3000" }],
    },
    {
      id: "svc/api",
      groupId: "shop-core",
      title: "api",
      kind: "service",
      subtitleLabel: "type",
      subtitle: "ClusterIP",
      rows: [{ id: "80", label: "80", tag: "→ 8080" }],
      invalid: "Селектор app=api не выбирает ни один под.",
    },
    {
      id: "deploy/storefront",
      groupId: "shop-core",
      title: "storefront",
      kind: "deployment",
      subtitleLabel: "образ",
      subtitle: "shop/storefront:2.4.1",
      rows: [
        { id: "3000", label: "3000", tag: "HTTP" },
        { id: "replicas", label: "реплики", tag: "3/3" },
      ],
    },
    {
      id: "sts/postgres",
      groupId: "shop-core",
      title: "postgres",
      kind: "statefulset",
      subtitleLabel: "образ",
      subtitle: "postgres:16.2",
      rows: [
        { id: "5432", label: "5432", tag: "TCP" },
        { id: "replicas", label: "реплики", tag: "1/1" },
      ],
    },
    {
      id: "cm/storefront",
      groupId: "shop-core",
      title: "storefront-config",
      kind: "configmap",
      rows: [{ id: "app.yaml", label: "app.yaml" }],
      emptyRows: "нет ключей",
    },
    {
      id: "secret/postgres",
      groupId: "shop-core",
      title: "postgres-credentials",
      kind: "secret",
      rows: [{ id: "password", label: "password" }],
    },
    {
      id: "pvc/postgres",
      groupId: "shop-core",
      title: "postgres-data",
      kind: "pvc",
      subtitleLabel: "размер",
      subtitle: "20Gi",
      rows: [],
      emptyRows: "смонтирован в /var/lib/postgresql",
    },
  ],
  links: [
    { id: "ing->storefront", from: "ing/shop", to: "svc/storefront", fromRow: "/", toRow: "80" },
    { id: "ing->api", from: "ing/shop", to: "svc/api", fromRow: "/api", toRow: "80" },
    {
      id: "storefront-svc->deploy",
      from: "svc/storefront",
      to: "deploy/storefront",
      fromRow: "80",
      toRow: "3000",
      label: "app=storefront",
    },
    {
      id: "storefront->cm",
      from: "deploy/storefront",
      to: "cm/storefront",
      toRow: "app.yaml",
      label: "том",
    },
    {
      id: "storefront->postgres",
      from: "deploy/storefront",
      to: "sts/postgres",
      toRow: "5432",
    },
    {
      id: "postgres->secret",
      from: "sts/postgres",
      to: "secret/postgres",
      toRow: "password",
      label: "env",
    },
    { id: "postgres->pvc", from: "sts/postgres", to: "pvc/postgres", label: "том" },
  ],
};
