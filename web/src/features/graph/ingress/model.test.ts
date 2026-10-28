import { describe, expect, test } from "bun:test";
import { collectErrors } from "@/form/SchemaForm";
import schema from "./values.schema.json";
import {
	backendId,
	ingressProjection,
	ingressValues,
	records,
	replaceBackend,
	saveGateway,
} from "./model";

describe("ingress chart projection", () => {
	test("example conforms to the real chart schema and projects every backend", () => {
		expect([...collectErrors(schema, ingressValues)]).toEqual([]);
		const result = ingressProjection(ingressValues, "shop", [], []);
		expect(result.issues).toEqual([]);
		expect(result.data.nodes).toHaveLength(4);
		expect(result.data.links).toHaveLength(3);
		expect([...result.routes.values()]).toEqual([0, 0, 1]);
	});
	test("backend edits preserve rule filters, weights, other refs and unrelated values", () => {
		const before = structuredClone(ingressValues);
		const old = { name: "shop", port: 8080 };
		const next = replaceBackend(
			before,
			old,
			{ name: "store", namespace: "apps", port: 9090 },
			"shop",
		);
		const route = records(next.xroutes)[0];
		const rule = records(route.rules)[0];
		expect(records(rule.backendRefs)[0]).toEqual({
			name: "store",
			namespace: "apps",
			port: 9090,
			weight: 90,
		});
		expect(records(rule.backendRefs)[1]).toEqual({
			name: "shop-canary",
			port: 8080,
			weight: 10,
		});
		expect(rule.matches).toEqual(
			records(records(before.xroutes)[0].rules)[0].matches,
		);
		expect(records(next.xroutes)[1]).toEqual(records(before.xroutes)[1]);
		expect(next.identity).toEqual(before.identity);
		expect(before).toEqual(ingressValues);
		expect(
			ingressProjection(next, "shop", [], []).data.groups.map(
				(group) => group.title,
			),
		).toEqual(["shop", "apps"]);
	});
	test("gateway rename updates all explicit parents without rewriting rules", () => {
		const gateway = { ...records(ingressValues.gateways)[0], name: "edge" };
		const next = saveGateway(ingressValues, 0, gateway);
		expect(records(records(next.xroutes)[0].parentRefs)[0].gateway).toBe(
			"edge",
		);
		expect(records(next.xroutes)[0].rules).toEqual(
			records(ingressValues.xroutes)[0].rules,
		);
		expect(ingressProjection(next, "shop", [], []).issues).toEqual([]);
	});
	test("shared endpoints merge but keep every route/rule/parent link", () => {
		const values = structuredClone(ingressValues);
		const route = records(values.xroutes)[0];
		route.rules = [
			...records(route.rules),
			{
				backendRefs: [
					{ name: "shop", namespace: "shop", port: 8080, weight: 3 },
				],
			},
		];
		route.parentRefs = [
			...records(route.parentRefs),
			...records(route.parentRefs),
		];
		const result = ingressProjection(values, "shop", ["empty"], []);
		expect(result.backends.size).toBe(3);
		expect(result.data.links).toHaveLength(7);
		expect(result.data.groups.some((group) => group.title === "empty")).toBe(
			true,
		);
		expect(backendId({ name: "shop", port: 8080 }, "shop")).toBe(
			backendId({ name: "shop", namespace: "shop", port: 8080 }, "shop"),
		);
	});
	test("redirect-only route stays editable and missing parents are reported", () => {
		const values = structuredClone(ingressValues);
		records(values.xroutes)[0].rules = [
			{
				filters: [
					{ type: "RequestRedirect", requestRedirect: { scheme: "https" } },
				],
			},
		];
		expect(ingressProjection(values, "shop", [], []).routes.size).toBe(2);
		records(records(values.xroutes)[0].parentRefs)[0].gateway = "missing";
		expect(ingressProjection(values, "shop", [], []).issues).toHaveLength(1);
	});
});
