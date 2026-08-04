import { resourceTopologyDemo } from "../profiles/resources/demoData";
import { resourceTopologyProfile } from "../profiles/resources/profile";
import { GraphDemoPage } from "./GraphDemoPage";

// ResourceTopologyPage shows what runs in a namespace and how the objects
// reference each other: ingress to service to workload, plus the config,
// secrets and volumes they mount.
export function ResourceTopologyPage() {
  return (
    <GraphDemoPage
      profile={resourceTopologyProfile}
      data={resourceTopologyDemo}
      lead="Что развёрнуто в namespace и как ресурсы ссылаются друг на друга."
    />
  );
}
