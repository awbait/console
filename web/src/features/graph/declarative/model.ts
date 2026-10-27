// The graph is a projection of the document. Commands edit original records;
// opening or arranging the canvas never serializes values back to the caller.
export type Values = Record<string, unknown>;
export interface CardDisplay {
	tone?: "neutral" | "accent" | "warn" | "muted";
	subtitle?: string;
	group?: string;
	rows?: { id: string; label: string; field: string }[];
}
export interface Collection {
	collection: string;
	key: string;
	title?: string;
	label?: string;
	form?: string;
	display?: CardDisplay;
}
export interface Relation extends Collection {
	from: { node: string; field: string; row?: string };
	to: { node: string; field: string; row?: string };
}
export interface Definition {
	profile: "declarative";
	version: 1;
	enabled?: boolean;
	nodes: Record<string, Collection>;
	relations: Record<string, Relation>;
}
export interface Entity {
	id: string;
	kind: string;
	key: string;
	index: number;
	item: Values;
	title: string;
}
export interface Link extends Entity {
	source: string;
	target: string;
}
export interface Projection {
	nodes: Entity[];
	links: Link[];
	issues: string[];
}

export const object = (v: unknown): v is Values =>
	v !== null && typeof v === "object" && !Array.isArray(v);
const forbidden = new Set(["__proto__", "constructor", "prototype"]);
export function tokens(path: string): string[] {
	if (!path.startsWith("/") || /~(?![01])/.test(path))
		throw new Error(`Invalid pointer: ${path}`);
	const parts = path
		.slice(1)
		.split("/")
		.map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
	if (parts.some((p) => !p || forbidden.has(p)))
		throw new Error(`Unsafe pointer: ${path}`);
	return parts;
}
export function get(value: unknown, path: string): unknown {
	let current = value;
	for (const part of tokens(path)) {
		if (!object(current) || !Object.hasOwn(current, part)) return undefined;
		current = current[part];
	}
	return current;
}
export function set(value: Values, path: string, next: unknown): Values {
	const parts = tokens(path);
	const copy = { ...value };
	let cursor = copy;
	for (const part of parts.slice(0, -1)) {
		const old = cursor[part];
		if (old !== undefined && !object(old))
			throw new Error(`Not an object: ${path}`);
		cursor[part] = { ...(old as Values | undefined) };
		cursor = cursor[part] as Values;
	}
	cursor[parts[parts.length - 1]] = next;
	return copy;
}
const overlaps = (a: string, b: string) =>
	a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

export function definitionIssues(raw: unknown): string[] {
	if (
		!object(raw) ||
		raw.profile !== "declarative" ||
		raw.version !== 1 ||
		!object(raw.nodes) ||
		!object(raw.relations)
	) {
		return ["Укажите профиль declarative, версию 1, типы узлов и связей."];
	}
	const issues: string[] = [];
	if (raw.enabled !== undefined && typeof raw.enabled !== "boolean")
		issues.push("Поле enabled должно быть true или false.");
	const allowed = new Set([
		"profile",
		"version",
		"enabled",
		"nodes",
		"relations",
		"$comment",
	]);
	if (Object.keys(raw).some((key) => !allowed.has(key)))
		issues.push("В описании графа есть неизвестные поля.");
	if (!Object.keys(raw.nodes).length)
		issues.push("Добавьте хотя бы один тип узла.");
	const paths: string[] = [];
	for (const [group, entries] of [
		["nodes", raw.nodes],
		["relations", raw.relations],
	] as const) {
		for (const [kind, item] of Object.entries(entries)) {
			if (!/^[a-z][a-z0-9-]*$/.test(kind) || forbidden.has(kind))
				issues.push(`Исправьте идентификатор типа ${kind}.`);
			if (!object(item)) {
				issues.push(`Настройте тип ${kind}.`);
				continue;
			}
			const fields = new Set([
				"collection",
				"key",
				"title",
				"label",
				"form",
				...(group === "nodes" ? ["display"] : []),
				...(group === "relations" ? ["from", "to"] : []),
			]);
			if (Object.keys(item).some((key) => !fields.has(key)))
				issues.push(`У типа ${kind} есть неизвестные поля.`);
			try {
				if (typeof item.collection !== "string" || typeof item.key !== "string")
					throw new Error();
				tokens(item.collection);
				tokens(item.key);
				if (paths.some((p) => overlaps(p, item.collection as string)))
					issues.push(
						`Коллекция ${item.collection} используется несколько раз или пересекается с другой.`,
					);
				paths.push(item.collection);
				for (const field of ["title", "form", "label"]) {
					if (item[field] !== undefined && typeof item[field] !== "string")
						throw new Error();
				}
				if (item.label !== undefined) tokens(item.label as string);
				if (item.form !== undefined && !item.form) throw new Error();
				if (item.display !== undefined) {
					const display = item.display;
					if (
						!object(display) ||
						Object.keys(display).some(
							(k) => !["tone", "subtitle", "group", "rows"].includes(k),
						)
					)
						throw new Error();
					if (
						display.tone !== undefined &&
						(typeof display.tone !== "string" ||
							!["neutral", "accent", "warn", "muted"].includes(display.tone))
					)
						throw new Error();
					for (const field of ["subtitle", "group"]) {
						if (display[field] !== undefined) {
							if (typeof display[field] !== "string") throw new Error();
							tokens(display[field]);
						}
					}
					if (display.rows !== undefined) {
						if (!Array.isArray(display.rows)) throw new Error();
						const ids = new Set<string>();
						for (const row of display.rows) {
							if (
								!object(row) ||
								Object.keys(row).some(
									(k) => !["id", "label", "field"].includes(k),
								) ||
								typeof row.id !== "string" ||
								!/^[a-z][a-z0-9-]*$/.test(row.id) ||
								ids.has(row.id) ||
								typeof row.label !== "string" ||
								typeof row.field !== "string"
							)
								throw new Error();
							ids.add(row.id);
							tokens(row.field);
						}
					}
				}
				if (group === "relations") {
					for (const side of ["from", "to"]) {
						const ref = item[side];
						if (
							!object(ref) ||
							typeof ref.node !== "string" ||
							!Object.hasOwn(raw.nodes, ref.node) ||
							typeof ref.field !== "string"
						)
							throw new Error();
						if (
							Object.keys(ref).some(
								(key) => !["node", "field", "row"].includes(key),
							)
						)
							throw new Error();
						tokens(ref.field);
						if (ref.row !== undefined) {
							const node = raw.nodes[ref.node] as Collection;
							if (
								typeof ref.row !== "string" ||
								!Array.isArray(node?.display?.rows) ||
								!node.display.rows.some((r) => r?.id === ref.row)
							)
								throw new Error();
						}
						if (overlaps(item.key, ref.field)) throw new Error();
					}
					if (
						overlaps(
							(item.from as Values).field as string,
							(item.to as Values).field as string,
						)
					)
						throw new Error();
				}
			} catch {
				issues.push(`Проверьте пути, ключ и концы связи у типа ${kind}.`);
			}
		}
	}
	return issues;
}
export function readDefinition(raw: unknown): Definition | null {
	return definitionIssues(raw).length === 0
		? (raw as unknown as Definition)
		: null;
}
// React Flow interpolates ids in attribute selectors while connecting handles.
export const entityId = (kind: string, key: string) =>
	encodeURIComponent(JSON.stringify([kind, key]));
function records(values: Values, spec: Collection): Values[] {
	const list = get(values, spec.collection);
	if (list === undefined) return [];
	if (!Array.isArray(list) || list.some((v) => !object(v)))
		throw new Error(`В ${spec.collection} ожидается список объектов.`);
	return list as Values[];
}
export function project(values: Values, def: Definition): Projection {
	const result: Projection = {
		nodes: [],
		links: [],
		issues: definitionIssues(def),
	};
	if (!object(values)) result.issues.push("Values должны быть объектом.");
	if (result.issues.length) return result;
	const scan = (kind: string, spec: Collection): Entity[] => {
		try {
			const seen = new Set<string>();
			return records(values, spec).flatMap((item, index) => {
				const key = get(item, spec.key);
				if (typeof key !== "string" || !key || seen.has(key)) {
					result.issues.push(
						`${spec.collection}/${index}: нужен уникальный непустой строковый ключ ${spec.key}.`,
					);
					return [];
				}
				seen.add(key);
				const label = spec.label ? get(item, spec.label) : key;
				return [
					{
						id: entityId(kind, key),
						kind,
						key,
						index,
						item,
						title: typeof label === "string" ? label : key,
					},
				];
			});
		} catch (e) {
			result.issues.push((e as Error).message);
			return [];
		}
	};
	for (const [kind, spec] of Object.entries(def.nodes))
		result.nodes.push(...scan(kind, spec));
	const ids = new Set(result.nodes.map((n) => n.id));
	for (const [kind, spec] of Object.entries(def.relations)) {
		for (const entity of scan(kind, spec)) {
			const from = get(entity.item, spec.from.field);
			const to = get(entity.item, spec.to.field);
			const source = entityId(spec.from.node, String(from));
			const target = entityId(spec.to.node, String(to));
			if (
				typeof from !== "string" ||
				typeof to !== "string" ||
				!ids.has(source) ||
				!ids.has(target)
			) {
				result.issues.push(
					`${spec.collection}/${entity.index}: ссылка ведёт к отсутствующему узлу.`,
				);
				continue;
			}
			result.links.push({ ...entity, id: `edge:${entity.id}`, source, target });
		}
	}
	return result;
}

export type Command =
	| {
			type: "save";
			kind: string;
			relation: boolean;
			previous?: string;
			item: Values;
	  }
	| { type: "delete"; kind: string; relation: boolean; key: string };

export function execute(
	values: Values,
	def: Definition,
	command: Command,
): Values {
	const before = project(values, def);
	if (before.issues.length) throw new Error(before.issues[0]);
	const spec = (command.relation ? def.relations : def.nodes)[command.kind];
	if (!spec) throw new Error("Тип не найден. Проверьте настройку графа.");
	const list = records(values, spec);
	const oldKey = command.type === "delete" ? command.key : command.previous;
	const index =
		oldKey === undefined
			? -1
			: list.findIndex((v) => get(v, spec.key) === oldKey);
	if (oldKey !== undefined && index < 0)
		throw new Error("Запись изменилась. Выберите её снова.");
	let next = values;
	if (command.type === "delete") {
		if (
			!command.relation &&
			before.links.some(
				(l) =>
					l.source === entityId(command.kind, command.key) ||
					l.target === entityId(command.kind, command.key),
			)
		) {
			throw new Error("Сначала удалите связи этого узла.");
		}
		next = set(
			next,
			spec.collection,
			list.filter((_, i) => i !== index),
		);
	} else {
		const key = get(command.item, spec.key);
		if (typeof key !== "string" || !key)
			throw new Error("Укажите непустой строковый ключ.");
		if (list.some((item, i) => i !== index && get(item, spec.key) === key))
			throw new Error(`Ключ ${key} уже занят.`);
		next = set(
			next,
			spec.collection,
			index < 0
				? [...list, command.item]
				: list.map((item, i) => (i === index ? command.item : item)),
		);
		if (!command.relation && oldKey !== undefined && oldKey !== key) {
			for (const relation of Object.values(def.relations)) {
				let changed = false;
				const updated = records(next, relation).map((item) => {
					let record = item;
					for (const side of [relation.from, relation.to]) {
						if (
							side.node === command.kind &&
							get(record, side.field) === oldKey
						) {
							record = set(record, side.field, key);
							changed = true;
						}
					}
					return record;
				});
				if (changed) next = set(next, relation.collection, updated);
			}
		}
	}
	const after = project(next, def);
	if (after.issues.length) throw new Error(after.issues[0]);
	return next;
}
