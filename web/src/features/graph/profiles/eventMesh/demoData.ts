import type { GraphData } from "../../core/model";

// Hand-written sample of a Knative mesh for one shop namespace: a payment
// gateway and a scheduler publish into the broker, three services consume
// filtered event types. It exists to show the core canvas rendering a second
// domain; a real provider (cluster API or collector) replaces it later.
export const eventMeshDemo: GraphData = {
  groups: [
    { id: "shop-events", title: "shop-events", accent: "primary", note: "мок" },
    { id: "shop-core", title: "shop-core" },
    { id: "shop-analytics", title: "shop-analytics" },
  ],
  nodes: [
    {
      id: "shop-events/payments-source",
      groupId: "shop-events",
      title: "payments-source",
      kind: "source",
      subtitleLabel: "sink",
      subtitle: "shop-events/orders",
      rows: [
        { id: "payment.captured", label: "payment.captured", tag: "v1" },
        { id: "payment.refunded", label: "payment.refunded", tag: "v1" },
      ],
    },
    {
      id: "shop-events/cron-source",
      groupId: "shop-events",
      title: "nightly-ping",
      kind: "source",
      subtitleLabel: "schedule",
      subtitle: "0 2 * * *",
      rows: [{ id: "cron.tick", label: "cron.tick", tag: "v1" }],
    },
    {
      id: "shop-events/orders",
      groupId: "shop-events",
      title: "orders",
      kind: "broker",
      subtitleLabel: "class",
      subtitle: "Kafka",
      rows: [
        { id: "order.created", label: "order.created" },
        { id: "payment.captured", label: "payment.captured" },
        { id: "payment.refunded", label: "payment.refunded" },
        { id: "cron.tick", label: "cron.tick" },
      ],
    },
    {
      id: "shop-core/checkout",
      groupId: "shop-core",
      title: "checkout",
      kind: "service",
      subtitleLabel: "sa",
      subtitle: "shop-checkout",
      rows: [{ id: "http", label: "8080", tag: "HTTP" }],
    },
    {
      id: "shop-core/invoicing",
      groupId: "shop-core",
      title: "invoicing",
      kind: "service",
      subtitleLabel: "sa",
      subtitle: "shop-invoicing",
      rows: [{ id: "http", label: "8080", tag: "HTTP" }],
    },
    {
      id: "shop-analytics/ingest",
      groupId: "shop-analytics",
      title: "events-ingest",
      kind: "service",
      subtitleLabel: "sa",
      subtitle: "analytics-ingest",
      rows: [{ id: "http", label: "8080", tag: "HTTP" }],
      invalid: null,
    },
  ],
  links: [
    {
      id: "payments->broker",
      from: "shop-events/payments-source",
      to: "shop-events/orders",
      toRow: "payment.captured",
    },
    {
      id: "cron->broker",
      from: "shop-events/cron-source",
      to: "shop-events/orders",
      toRow: "cron.tick",
    },
    {
      id: "broker->checkout",
      from: "shop-events/orders",
      to: "shop-core/checkout",
      toRow: "http",
      label: "on-order · type=order.created",
    },
    {
      id: "broker->invoicing",
      from: "shop-events/orders",
      to: "shop-core/invoicing",
      toRow: "http",
      label: "on-payment · type=payment.captured",
    },
    {
      id: "broker->analytics",
      from: "shop-events/orders",
      to: "shop-analytics/ingest",
      toRow: "http",
      label: "mirror-all · без фильтра",
    },
  ],
};
