import type { GraphData, GraphProfile } from "../core/model";
import { areaId, get, type Definition, type Projection } from "./model";

// Display bindings are a one-way projection. They never create values.
export function presentation(
	projection: Projection,
	def: Definition,
): { data: GraphData; profile: GraphProfile } {
	const text = (value: unknown) =>
		value == null
			? ""
			: typeof value === "object"
				? JSON.stringify(value)
				: String(value);
	const groups = new Map(
		projection.groups.map((group) => [
			group.id,
			{
				id: group.id,
				title: group.title,
				note: def.groups?.[group.kind].title || group.kind,
			},
		]),
	);
	const nodes = projection.nodes.map((entity) => {
		const display = def.nodes[entity.kind].display;
		const group = display?.group ? text(get(entity.item, display.group)) : "";
		const membership = def.nodes[entity.kind].group;
		const targetId = membership
			? areaId(membership.type, String(get(entity.item, membership.field)))
			: undefined;
		const groupId =
			targetId && groups.has(targetId)
				? targetId
				: `group:${encodeURIComponent(group)}`;
		if (!groups.has(groupId))
			groups.set(groupId, {
				id: groupId,
				title: group || def.ungroupedTitle || "Ресурсы",
				note: "",
			});
		return {
			id: entity.id,
			groupId,
			title: entity.title,
			kind: entity.kind,
			subtitle: display?.subtitle
				? text(get(entity.item, display.subtitle))
				: undefined,
			rows: (display?.rows ?? []).map((row) => ({
				id: row.id,
				label: row.label,
				tag: text(get(entity.item, row.field)),
			})),
			emptyRows: "Выберите карточку, чтобы открыть свойства",
		};
	});
	return {
		data: {
			groups: [...groups.values()],
			nodes,
			links: projection.links.map((link) => ({
				id: link.id,
				from: link.source,
				to: link.target,
				label: link.title,
				fromRow: def.relations[link.kind].from.row,
				toRow: def.relations[link.kind].to.row,
			})),
		},
		profile: {
			id: "declarative",
			title: "Граф из values",
			groupNoun: "группа",
			emptyHint: "Добавьте первый узел.",
			kinds: Object.fromEntries(
				Object.entries(def.nodes).map(([kind, spec]) => [
					kind,
					{ label: spec.title || kind, tone: spec.display?.tone },
				]),
			),
			legend: [],
			layout: { groups: "column", nodes: "flow" },
		},
	};
}
