import { resourceTopologyDemo } from "../profiles/resources/demoData";
import { resourceTopologyProfile } from "../profiles/resources/profile";
import type { Definition, Values } from "./model";

// Adapt the existing topology fixture to editable records. These are local
// example values, not Kubernetes manifests or a connection to a cluster.
const graph: Definition = {
	profile: "declarative",
	version: 1,
	nodes: {},
	relations: {},
};
const values: Values = {};
const properties: Record<string, unknown> = {};
const views: Record<string, unknown> = { order: {} };
const string = { type: "string" };
const pointerToken = (s: string) => s.replace(/~/g, "~0").replace(/\//g, "~1");
const rowIds = new Map<string, Map<string, string>>();
for (const [kind, style] of Object.entries(resourceTopologyProfile.kinds)) {
	const nodes = resourceTopologyDemo.nodes.filter((n) => n.kind === kind);
	const rows = [...new Set(nodes.flatMap((n) => n.rows.map((r) => r.id)))];
	const ids = new Map(rows.map((id, i) => [id, `row${i + 1}`]));
	rowIds.set(kind, ids);
	graph.nodes[kind] = {
		collection: `/${kind}`,
		key: "/id",
		label: "/name",
		title: style.label,
		form: kind,
		display: {
			tone: style.tone,
			group: "/namespace",
			subtitle: "/detail",
			rows: rows.map((id) => ({
				id: ids.get(id)!,
				label: nodes.flatMap((n) => n.rows).find((r) => r.id === id)!.label,
				field: `/attributes/${pointerToken(id)}`,
			})),
		},
	};
	values[kind] = nodes.map((n) => ({
		id: n.id,
		name: n.title,
		namespace: "shop-core",
		detail: n.subtitle ?? "",
		attributes: Object.fromEntries(n.rows.map((r) => [r.id, r.tag ?? r.label])),
	}));
	properties[kind] = {
		type: "array",
		items: {
			type: "object",
			required: ["id", "name", "namespace"],
			properties: {
				id: { ...string, title: "Ключ" },
				name: { ...string, title: "Название" },
				namespace: { ...string, title: "Namespace" },
				detail: { ...string, title: "Подзаголовок" },
				attributes: {
					type: "object",
					title: "Поля карточки",
					properties: Object.fromEntries(
						rows.map((id) => [id, { ...string, title: id }]),
					),
				},
			},
		},
	};
	views[kind] = {};
}
resourceTopologyDemo.links.forEach((link, index) => {
	const from = resourceTopologyDemo.nodes.find((n) => n.id === link.from)!;
	const to = resourceTopologyDemo.nodes.find((n) => n.id === link.to)!;
	const kind = `relation${index + 1}`;
	const title = `${resourceTopologyProfile.kinds[from.kind].label} → ${resourceTopologyProfile.kinds[to.kind].label}${link.label ? ` (${link.label})` : ""}`;
	graph.relations[kind] = {
		collection: `/${kind}`,
		key: "/id",
		label: "/label",
		title,
		from: {
			node: from.kind,
			field: "/source",
			row: link.fromRow ? rowIds.get(from.kind)!.get(link.fromRow) : undefined,
		},
		to: {
			node: to.kind,
			field: "/target",
			row: link.toRow ? rowIds.get(to.kind)!.get(link.toRow) : undefined,
		},
	};
	values[kind] = [
		{
			id: link.id,
			source: link.from,
			target: link.to,
			label: link.label ?? "",
		},
	];
	properties[kind] = {
		type: "array",
		items: {
			type: "object",
			required: ["id", "source", "target"],
			properties: {
				id: { ...string, title: "Ключ" },
				source: { ...string, title: "Источник" },
				target: { ...string, title: "Назначение" },
				label: { ...string, title: "Подпись" },
			},
		},
	};
});
export const topologyExample = {
	document: { views, graph },
	schema: { type: "object", properties },
	values,
};
