import { deref } from "@/form/SchemaForm";
import { tokens } from "./model";

type Schema = Record<string, any>;
export function itemSchema(
	root: Schema | null | undefined,
	pointer: string,
): Schema | null {
	if (!root) return null;
	let node = deref(root, root);
	for (const key of tokens(pointer)) {
		if (!node.properties?.[key]) return null;
		node = deref(node.properties[key], root);
	}
	if (node.type !== "array" || !node.items) return null;
	return deref(node.items, root);
}
