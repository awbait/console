import { describe, expect, test } from "bun:test";
import { exampleDefinition as def, exampleValues } from "./example";
import {
	definitionIssues,
	execute,
	get,
	project,
	readDefinition,
	set,
} from "./model";
import { valuesEditorFor } from "@/features/orders/valuesEditors";

describe("declarative graph document ownership", () => {
	test("projection does not rewrite unknown fields or defaults", () => {
		const values = structuredClone(exampleValues);
		const before = JSON.stringify(values);
		expect(project(values, def).nodes).toHaveLength(5);
		expect(project(values, def).links).toHaveLength(3);
		expect(JSON.stringify(values)).toBe(before);
		expect(project({}, def).issues).toEqual([]);
	});
	test("editing one subscription preserves other rows and unknown nested fields", () => {
		const row = {
			...exampleValues.subscriptions[0],
			delivery: { future: true },
		};
		const values = {
			...exampleValues,
			subscriptions: [row, ...exampleValues.subscriptions.slice(1)],
		};
		const next = execute(values, def, {
			type: "save",
			relation: true,
			kind: "subscription",
			previous: row.name,
			item: { ...row, retry: 7 },
		});
		expect(next.subscriptions).toEqual([
			{ ...row, retry: 7 },
			...values.subscriptions.slice(1),
		]);
		expect(next.telemetry).toBe(values.telemetry);
		expect(row.retry).toBe(3);
	});
	test("rename updates all references atomically and does not mutate the input", () => {
		const next = execute(exampleValues, def, {
			type: "save",
			relation: false,
			kind: "broker",
			previous: "orders",
			item: { name: "new-orders", class: "Kafka" },
		});
		expect(
			(next.subscriptions as typeof exampleValues.subscriptions).map(
				(s) => s.brokerRef,
			),
		).toEqual(["new-orders", "new-orders", "payments"]);
		expect(exampleValues.subscriptions[0].brokerRef).toBe("orders");
	});
	test("rename does not materialize absent collections", () => {
		const next = execute({ brokers: [{ name: "orders" }] }, def, {
			type: "save",
			relation: false,
			kind: "broker",
			previous: "orders",
			item: { name: "renamed" },
		});
		expect(next).toEqual({ brokers: [{ name: "renamed" }] });
	});
	test("deletion is restricted until references are removed", () => {
		expect(() =>
			execute(exampleValues, def, {
				type: "delete",
				relation: false,
				kind: "broker",
				key: "orders",
			}),
		).toThrow();
		let next = execute(exampleValues, def, {
			type: "delete",
			relation: true,
			kind: "subscription",
			key: "order-created",
		});
		next = execute(next, def, {
			type: "delete",
			relation: true,
			kind: "subscription",
			key: "all-orders",
		});
		expect(
			execute(next, def, {
				type: "delete",
				relation: false,
				kind: "broker",
				key: "orders",
			}).brokers,
		).toEqual([{ name: "payments", class: "Kafka" }]);
	});
	test("parallel edges keep distinct identities", () => {
		const next = execute(exampleValues, def, {
			type: "save",
			relation: true,
			kind: "subscription",
			item: { name: "second", brokerRef: "orders", consumerRef: "checkout" },
		});
		expect(project(next, def).links).toHaveLength(4);
	});
	test("duplicates, dangling references and malformed collections cannot be rewritten", () => {
		expect(() =>
			execute(exampleValues, def, {
				type: "save",
				relation: false,
				kind: "broker",
				item: { name: "orders" },
			}),
		).toThrow();
		expect(() =>
			execute(exampleValues, def, {
				type: "save",
				relation: true,
				kind: "subscription",
				item: { name: "missing", brokerRef: "ghost", consumerRef: "checkout" },
			}),
		).toThrow();
		for (const bad of [null, {}, ["bad"], [{ name: "x" }, { name: "x" }]]) {
			expect(project({ brokers: bad }, def).issues.length).toBeGreaterThan(0);
		}
	});
	test("array reorder does not change graph identity", () => {
		expect(
			project(
				{ ...exampleValues, brokers: [...exampleValues.brokers].reverse() },
				def,
			)
				.nodes.map((n) => n.id)
				.sort(),
		).toEqual(
			project(exampleValues, def)
				.nodes.map((n) => n.id)
				.sort(),
		);
	});
	test("RFC6901 paths and prototype guards", () => {
		expect(get(set({}, "/a~1b/~0key", 42), "/a~1b/~0key")).toBe(42);
		for (const p of [
			"/a/__proto__/x",
			"/constructor/x",
			"/a~2b",
			"relative",
			"/",
		])
			expect(() => set({}, p, 1)).toThrow();
	});
	test("invalid descriptor never activates a writer", () => {
		const bad = {
			...def,
			nodes: {
				broker: { collection: "/brokers", key: "/name" },
				other: { collection: "/brokers/nested", key: "/name" },
			},
		};
		expect(definitionIssues(bad).length).toBeGreaterThan(0);
		expect(readDefinition(bad)).toBeNull();
		expect(valuesEditorFor({ graph: def })?.mapping.definition).toEqual(def);
		expect(valuesEditorFor({ graph: { ...def, enabled: false } })).toBeNull();
		expect(valuesEditorFor({ graph: { ...def, version: 99 } })).toBeNull();
	});
});
