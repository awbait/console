import { expect, test } from "bun:test";
import {
	areaId,
	definitionIssues,
	execute,
	project,
	type Definition,
} from "./model";
import { presentation } from "./presentation";
import { topologyExample } from "./topologyExample";
import { buildGraph } from "../core/GraphView";

test("areas have stable identities, parameters, empty instances and explicit membership", () => {
	const {
		document: { graph },
		values,
	} = topologyExample;
	expect(definitionIssues(graph)).toEqual([]);
	const projection = project(values, graph);
	expect(projection.issues).toEqual([]);
	expect(projection.groups).toHaveLength(3);
	const visual = presentation(projection, graph);
	expect(
		visual.data.nodes.every(
			(n) => n.groupId === areaId("namespace", "shop-core"),
		),
	).toBe(true);
	const built = buildGraph(visual.data, visual.profile, true);
	expect(
		built.nodes
			.filter((n) => n.type === "group")
			.every((n) => Number(n.style?.width) >= 300),
	).toBe(true);
	expect(
		built.nodes
			.filter((n) => n.type === "card")
			.every((n) => n.expandParent && n.extent === undefined),
	).toBe(true);
});

test("move only changes membership and preserves links, parameters and the source document", () => {
	const {
		document: { graph },
		values,
	} = topologyExample;
	const snapshot = JSON.stringify(values);
	const next = execute(values, graph, {
		type: "move",
		kind: "service",
		key: "svc/storefront",
		target: areaId("namespace", "shop-staging"),
	});
	const node = project(next, graph).nodes.find(
		(n) => n.key === "svc/storefront",
	)!;
	expect(node.item.namespace).toBe("shop-staging");
	expect(next.namespaces).toEqual(values.namespaces);
	expect(next.relation1).toEqual(values.relation1);
	expect(JSON.stringify(values)).toBe(snapshot);
	expect(() =>
		execute(values, graph, {
			type: "move",
			kind: "service",
			key: "svc/storefront",
			target: areaId("namespace", "data-only"),
		}),
	).toThrow("запрещают");
	expect(JSON.stringify(values)).toBe(snapshot);
});

test("area rename updates node memberships, deleting occupied areas and narrowing occupied permissions fail atomically", () => {
	const {
		document: { graph },
		values,
	} = topologyExample;
	const first = project(values, graph).groups[0];
	const next = execute(values, graph, {
		type: "save",
		group: true,
		relation: false,
		kind: "namespace",
		previous: "shop-core",
		item: { ...first.item, name: "renamed", owner: "new-owner" },
	});
	expect(
		project(next, graph).nodes.every((n) => n.item.namespace === "renamed"),
	).toBe(true);
	expect(next.relation1).toEqual(values.relation1);
	expect(() =>
		execute(values, graph, {
			type: "delete",
			group: true,
			relation: false,
			kind: "namespace",
			key: "shop-core",
		}),
	).toThrow("Сначала");
	expect(() =>
		execute(values, graph, {
			type: "save",
			group: true,
			relation: false,
			kind: "namespace",
			previous: first.key,
			item: { ...first.item, allowedKinds: [] },
		}),
	).toThrow("запрещают");
	const removed = execute(values, graph, {
		type: "delete",
		group: true,
		relation: false,
		kind: "namespace",
		key: "shop-staging",
	});
	expect(project(removed, graph).groups).toHaveLength(2);
});

test("invalid area descriptions and imported memberships are rejected", () => {
	for (const change of [
		(d: Definition) => {
			d.groups!.namespace.accepts = ["missing"];
		},
		(d: Definition) => {
			d.groups!.namespace.collection = "/service";
		},
		(d: Definition) => {
			d.nodes.service.group!.field = "/id";
		},
		(d: Definition) => {
			d.nodes.service.group!.type = "missing";
		},
		(d: Definition) => {
			d.groups!.namespace.acceptsField = "/__proto__/name";
		},
	]) {
		const graph = structuredClone(topologyExample.document.graph);
		change(graph);
		expect(definitionIssues(graph).length).toBeGreaterThan(0);
	}
	const values = structuredClone(topologyExample.values);
	(values.service as { namespace: string }[])[0].namespace = "missing";
	expect(
		project(values, topologyExample.document.graph).issues.length,
	).toBeGreaterThan(0);
});

test("saved expanded bounds and node positions survive reconstruction", () => {
	const {
		document: { graph },
		values,
	} = topologyExample;
	const visual = presentation(project(values, graph), graph);
	const id = visual.data.nodes[0].id;
	const groupId = visual.data.nodes[0].groupId;
	visual.data.positions = {
		[id]: { x: 2500, y: 800 },
		[groupId]: { x: -100, y: -200 },
	};
	visual.data.groupSizes = { [groupId]: { width: 3000, height: 1200 } };
	const built = buildGraph(visual.data, visual.profile, true);
	expect(built.nodes.find((n) => n.id === id)?.position).toEqual({
		x: 2500,
		y: 800,
	});
	expect(built.nodes.find((n) => n.id === groupId)?.style).toEqual({
		width: 3000,
		height: 1200,
	});
});
