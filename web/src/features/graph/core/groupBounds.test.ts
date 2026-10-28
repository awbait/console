import { expect, test } from "bun:test";
import type { Node } from "@xyflow/react";
import { fitGroups } from "./GraphView";

const nodes = (): Node[] => [
	{
		id: "area",
		type: "group",
		position: { x: 100, y: 100 },
		data: {},
		style: { width: 2000, height: 2000 },
	},
	{
		id: "a",
		parentId: "area",
		position: { x: -100, y: -50 },
		data: {},
		measured: { width: 230, height: 70 },
	},
	{
		id: "b",
		parentId: "area",
		position: { x: 500, y: 250 },
		data: {},
		measured: { width: 230, height: 90 },
	},
];
test("areas fit all four bounds and preserve absolute child positions", () => {
	const before = nodes();
	const after = fitGroups(before);
	expect(after[0].style).toEqual({ width: 858, height: 444 });
	expect(after[0].position).toEqual({ x: -14, y: 10 });
	for (let i = 1; i < after.length; i++) {
		expect(after[0].position.x + after[i].position.x).toBe(
			before[0].position.x + before[i].position.x,
		);
		expect(after[0].position.y + after[i].position.y).toBe(
			before[0].position.y + before[i].position.y,
		);
	}
	expect(before).toEqual(nodes());
	expect(fitGroups(after)).toEqual(after);
});
test("area shrinks when an extreme child moves inwards", () => {
	const expanded = fitGroups(nodes());
	expanded[2].position = { x: 260, y: 40 };
	const shrunk = fitGroups(expanded);
	expect(shrunk[0].width).toBe(504);
	expect(shrunk[0].height).toBe(144);
	expect(shrunk[1].position).toEqual(expanded[1].position);
});
