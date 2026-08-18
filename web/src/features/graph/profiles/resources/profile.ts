import type { GraphProfile } from "@/features/graph/core/model";

// Resource topology profile: what actually runs in a namespace and how the
// objects reference each other. Read-only by nature - the portal shows the
// cluster here, it does not edit it.
export const resourceTopologyProfile: GraphProfile = {
  id: "resource-topology",
  title: "Топология ресурсов",
  groupNoun: "namespace",
  kinds: {
    ingress: { label: "Ingress", tone: "accent" },
    service: { label: "Service", tone: "accent" },
    deployment: { label: "Deployment" },
    statefulset: { label: "StatefulSet" },
    configmap: { label: "ConfigMap", tone: "muted" },
    secret: { label: "Secret", tone: "warn" },
    pvc: { label: "PVC", tone: "muted" },
  },
  legend: [
    { tone: "accent", text: "Точка входа: ingress и service" },
    { tone: "neutral", text: "Рабочая нагрузка" },
    { tone: "muted", text: "Данные и конфигурация" },
    { text: "Стрелка: ссылка на ресурс (селектор, том, переменные)" },
  ],
  emptyHint: "В namespace нет ресурсов или они ещё не собраны.",
  // Inside a namespace the story runs left to right: ingress, service, workload,
  // the data it mounts. Namespaces stack downwards, so the arrows between them
  // stay short and readable.
  layout: { groups: "column", nodes: "flow" },
};
