import { describe, expect, it } from "bun:test";
import { packEditorState, readEditorState, type SavedGraphState } from "./editorState";

const CHART = "0.3.0";

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
    const packed = JSON.parse(JSON.stringify(packEditorState(state, CHART)));
    expect(readEditorState(packed, CHART)).toEqual(state);
  });

  it("keeps a workload that no arrow touches", () => {
    const back = readEditorState(packEditorState(state, CHART), CHART);
    expect(back?.topology[0].workloads[0].serviceAccount).toBe("shop-api");
    expect(back?.topology[0].workloads[0].ports).toHaveLength(1);
  });

  it("ignores another profile, another version and junk", () => {
    expect(readEditorState({ profile: "event-mesh", version: 1, data: state }, CHART)).toBeNull();
    expect(readEditorState({ profile: "policies", version: 99, data: state }, CHART)).toBeNull();
    expect(
      readEditorState({ profile: "policies", version: 1, data: { orderNs: 1 } }, CHART),
    ).toBeNull();
    expect(readEditorState(null, CHART)).toBeNull();
    expect(readEditorState("nope", CHART)).toBeNull();
  });

  it("tolerates a document without positions", () => {
    const raw = { profile: "policies", version: 1, data: { orderNs: "ns", topology: [] } };
    expect(readEditorState(raw, CHART)).toEqual({ orderNs: "ns", topology: [], positions: {} });
  });

  it("a patch release reads the canvas, another release line does not", () => {
    // A patch cannot reshape the values, so the canvas still describes the same
    // workloads. A different release line can, and a saved service account
    // pinned onto the wrong workload is worse than losing the box positions.
    const packed = packEditorState(state, "0.3.0");
    expect(readEditorState(packed, "0.3.4")).toEqual(state);
    expect(readEditorState(packed, "0.4.0")).toBeNull();
    expect(readEditorState(packed, "1.3.0")).toBeNull();
  });

  it("a pre-release belongs to its own release line", () => {
    const packed = packEditorState(state, "0.3.0");
    expect(readEditorState(packed, "0.3.1-rc1")).toEqual(state);
    expect(readEditorState(packed, "0.4.0-rc1")).toBeNull();
  });

  it("a canvas saved before the field existed is still read", () => {
    // Only one mapping has ever shipped, so there is no other shape such a
    // document could have been drawn against.
    const raw = { profile: "policies", version: 1, data: state };
    expect(readEditorState(raw, CHART)).toEqual(state);
  });
});
