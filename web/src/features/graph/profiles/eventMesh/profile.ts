import type { GraphProfile } from "@/features/graph/core/model";

// Event mesh profile: Knative eventing seen as producers, brokers and the
// services that consume filtered events. Read-only - it shows what a cluster
// already runs, it does not compose it.
export const eventMeshProfile: GraphProfile = {
  id: "event-mesh",
  title: "Event Mesh",
  groupNoun: "namespace",
  kinds: {
    source: { label: "Source", tone: "accent" },
    broker: { label: "Broker", tone: "warn" },
    service: { label: "Service" },
    channel: { label: "Channel", tone: "muted" },
  },
  legend: [
    { tone: "accent", text: "Источник событий" },
    { tone: "warn", text: "Брокер: принимает и раздаёт события" },
    { tone: "neutral", text: "Потребитель: сервис за триггером" },
    { text: "Стрелка: поток событий, подпись - триггер и его фильтр" },
  ],
  emptyHint: "Событийных ресурсов в этом namespace нет.",
  // Events flow left to right - producers, broker, consumers - and consumers
  // usually live in other namespaces, so the boxes follow the same direction.
  layout: { groups: "row", nodes: "flow" },
};
