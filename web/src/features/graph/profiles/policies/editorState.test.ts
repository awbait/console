import { describe, expect, it } from "bun:test";
import { packEditorState, readEditorState, type SavedGraphState } from "./editorState";

const state: SavedGraphState = {
  orderNs: "shop-core",
  topology: [
    {
      name: "shop-core",
      workloads: [
        {
          id: "shop-core/api",
          name: "api",
          kind: "Deployment",
          serviceAccount: "shop-api",
          selector: { app: "api" },
          ports: [{ port: 8080, protocol: "HTTP" }],
        },
      ],
    },
  ],
  positions: { "shop-core": { x: 10, y: 20 } },
};

describe("policies editor state", () => {
  it("survives the round trip", () => {
    const back = readEditorState(JSON.parse(JSON.stringify(packEditorState(state))));
    expect(back).toEqual(state);
  });

  it("keeps a workload that no arrow touches", () => {
    const back = readEditorState(packEditorState(state));
    expect(back?.topology[0].workloads[0].serviceAccount).toBe("shop-api");
    expect(back?.topology[0].workloads[0].ports).toHaveLength(1);
  });

  it("ignores another profile, another version and junk", () => {
    expect(readEditorState({ profile: "event-mesh", version: 1, data: state })).toBeNull();
    expect(readEditorState({ profile: "policies", version: 99, data: state })).toBeNull();
    expect(readEditorState({ profile: "policies", version: 1, data: { orderNs: 1 } })).toBeNull();
    expect(readEditorState(null)).toBeNull();
    expect(readEditorState("nope")).toBeNull();
  });

  it("tolerates a document without positions", () => {
    const raw = { profile: "policies", version: 1, data: { orderNs: "ns", topology: [] } };
    expect(readEditorState(raw)).toEqual({ orderNs: "ns", topology: [], positions: {} });
  });
});
