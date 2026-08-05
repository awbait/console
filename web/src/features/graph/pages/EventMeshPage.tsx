import { eventMeshDemo } from "../profiles/eventMesh/demoData";
import { eventMeshProfile } from "../profiles/eventMesh/profile";
import { GraphDemoPage } from "./GraphDemoPage";

// EventMeshPage shows the Knative event flow of a namespace: who publishes,
// which broker carries the events and which services a trigger routes them to.
export function EventMeshPage() {
  return (
    <GraphDemoPage
      profile={eventMeshProfile}
      data={eventMeshDemo}
      lead="Кто публикует события, через какой брокер они идут и какие сервисы их получают."
    />
  );
}
