import { expect, test } from "bun:test";
import { buildGraph } from "../core/GraphView";
import { bodyHandle, sourceRowHandleId, rowHandleId } from "../core/CardNode";
import { topologyExample } from "./topologyExample";
import { definitionIssues, project, type Definition } from "./model";
import { presentation } from "./presentation";

test("topology fixture projects to shared cards, groups and row anchors without changing values", () => {
	const {
		document: { graph },
		values,
	} = topologyExample;
	const before = JSON.stringify(values);
	expect(definitionIssues(graph)).toEqual([]);
	const projection = project(values, graph);
	expect(projection.issues).toEqual([]);
	const visual = presentation(projection, graph);
	expect(visual.data.nodes).toHaveLength(8);
	expect(visual.data.links).toHaveLength(7);
	expect(visual.data.groups.map((g) => g.title)).toEqual(["shop-core"]);
	const built = buildGraph(visual.data, visual.profile, true);
	const link = visual.data.links[0];
	expect(built.edges[0].sourceHandle).toBe(sourceRowHandleId(link.fromRow!));
	expect(built.edges[0].targetHandle).toBe(rowHandleId(link.toRow!));
	expect(
		built.nodes.filter((n) => n.type === "card").every((n) => n.data.editable),
	).toBe(true);
	expect(JSON.stringify(values)).toBe(before);
	const readonly = buildGraph(visual.data, visual.profile);
	expect(
		readonly.nodes
			.filter((n) => n.type === "card")
			.every((n) => !n.data.editable),
	).toBe(true);
});

test("missing display keeps ordinary cards and body connections; group identity cannot collide with nodes", () => {
	const def: Definition = {
		profile: "declarative",
		version: 1,
		nodes: { node: { collection: "/nodes", key: "/name" } },
		relations: {
			link: {
				collection: "/links",
				key: "/name",
				from: { node: "node", field: "/source" },
				to: { node: "node", field: "/target" },
			},
		},
	};
	const visual = presentation(
		project(
			{
				nodes: [{ name: "a" }, { name: "b" }],
				links: [{ name: "ab", source: "a", target: "b" }],
			},
			def,
		),
		def,
	);
	const built = buildGraph(visual.data, visual.profile);
	expect(built.edges[0].sourceHandle).toBe(bodyHandle);
	expect(visual.data.nodes[0].rows).toEqual([]);
	expect(new Set(built.nodes.map((n) => n.id)).size).toBe(built.nodes.length);
});

test("invalid display pointers, duplicate row ids and dangling row references are rejected", () => {
	for (const change of [
		(d: Definition) => {
			d.nodes.ingress.display!.group = "/__proto__/x";
		},
		(d: Definition) => {
			d.nodes.ingress.display!.rows!.push(d.nodes.ingress.display!.rows![0]);
		},
		(d: Definition) => {
			d.relations.relation1.from.row = "missing";
		},
	]) {
		const def = structuredClone(topologyExample.document.graph);
		change(def);
		expect(definitionIssues(def).length).toBeGreaterThan(0);
	}
});
