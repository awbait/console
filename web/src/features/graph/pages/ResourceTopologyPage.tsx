import { resourceTopologyDemo } from "../profiles/resources/demoData";
import { resourceTopologyProfile } from "../profiles/resources/profile";
import { GraphDemoPage } from "./GraphDemoPage";
import { lazy, Suspense, useState } from "react";
import { Button } from "@/components/ui";
const GraphWorkbench = lazy(() => import("../declarative/GraphWorkbench").then(m => ({ default: m.GraphWorkbench })));

// ResourceTopologyPage shows what runs in a namespace and how the objects
// reference each other: ingress to service to workload, plus the config,
// secrets and volumes they mount.
export function ResourceTopologyPage() {
  const [designing, setDesigning] = useState(false);
  if (designing) return <Suspense fallback={<p>Загрузка конструктора…</p>}><GraphWorkbench preset="topology" onClose={() => setDesigning(false)} /></Suspense>;
  return (
    <GraphDemoPage
      profile={resourceTopologyProfile}
      data={resourceTopologyDemo}
      actions={<Button onPress={() => setDesigning(true)}>Открыть в конструкторе</Button>}
      lead="Что развёрнуто в namespace и как ресурсы ссылаются друг на друга."
    />
  );
}
