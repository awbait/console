import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { collectErrors, SchemaForm } from "@/form/SchemaForm";
import { itemSchema } from "./schema";

test("element inspectors resolve references against the full chart schema", () => {
	const root = {
		type: "object",
		properties: {
			nodes: { type: "array", items: { $ref: "#/definitions/node" } },
		},
		definitions: {
			name: { type: "string", title: "Node name", minLength: 3 },
			node: {
				type: "object",
				required: ["name"],
				properties: { name: { $ref: "#/definitions/name" } },
			},
		},
	};
	const item = itemSchema(root, "/nodes")!;
	expect(
		collectErrors(item, { name: "x" }, undefined, undefined, root).size,
	).toBe(1);
	expect(
		collectErrors(item, { name: "valid" }, undefined, undefined, root).size,
	).toBe(0);
	const html = renderToStaticMarkup(
		<SchemaForm
			schema={item}
			rootSchema={root}
			value={{ name: "valid" }}
			onChange={() => {}}
		/>,
	);
	expect(html).toContain("Node name");
	expect(html).toContain('value="valid"');
});
