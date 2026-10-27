import type { Connection } from "@xyflow/react";
import { useMemo, useState } from "react";
import { GraphView } from "../core/GraphView";
import { bodyHandle, rowHandleId, sourceRowHandleId } from "../core/CardNode";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ContextMenu } from "../core/ContextMenu";
import type { GraphData } from "../core/model";
import { presentation } from "./presentation";
import { Button, Select } from "@/components/ui";
import { collectErrors, SchemaForm, seedDefaults } from "@/form/SchemaForm";
import type { ValuesEditorProps } from "@/features/orders/valuesEditors";
import {
	execute,
	areaId,
	entityId,
	get,
	object,
	project,
	set,
	tokens,
	type Entity,
	type Values,
} from "./model";
import { itemSchema } from "./schema";
import "@xyflow/react/dist/style.css";
import "../core/graph.css";

type Edit = {
	kind: string;
	relation: boolean;
	group?: boolean;
	previous?: string;
	item: Values;
	base: Values;
	definition: string;
};
type Positions = Record<string, { x: number; y: number }>;

export function ValuesGraph({
	values,
	onValues,
	mapping,
	schema,
	document,
	readOnly = false,
	lockReadOnly = false,
	lockedPaths = [],
	inputError,
	editorState,
	onEditorState,
	chartVersion,
	fill,
}: ValuesEditorProps) {
	const def = mapping.definition;
	const fingerprint = JSON.stringify(def);
	const saved =
		object(editorState) &&
		editorState.profile === "declarative" &&
		editorState.version === 2 &&
		editorState.definition === fingerprint &&
		editorState.chartVersion === chartVersion &&
		object(editorState.positions)
			? (Object.fromEntries(
					Object.entries(editorState.positions).filter(
						([, p]) =>
							object(p) &&
							typeof p.x === "number" &&
							Number.isFinite(p.x) &&
							typeof p.y === "number" &&
							Number.isFinite(p.y),
					),
				) as Positions)
			: {};
	const savedSizes =
		object(editorState) &&
		editorState.definition === fingerprint &&
		editorState.chartVersion === chartVersion &&
		editorState.profile === "declarative" &&
		editorState.version === 2 &&
		object(editorState.groupSizes)
			? (Object.fromEntries(
					Object.entries(editorState.groupSizes).filter(
						([, s]) =>
							object(s) &&
							typeof s.width === "number" &&
							Number.isFinite(s.width) &&
							s.width > 0 &&
							typeof s.height === "number" &&
							Number.isFinite(s.height) &&
							s.height > 0,
					),
				) as NonNullable<GraphData["groupSizes"]>)
			: {};
	const [layout, setLayout] = useState({
		fingerprint,
		positions: saved,
		groupSizes: savedSizes,
	});
	const positions = layout.fingerprint === fingerprint ? layout.positions : {};
	const [edit, setEdit] = useState<Edit | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(
		null,
	);
	const [moving, setMoving] = useState<{
		node: Entity;
		base: Values;
		definition: string;
	} | null>(null);
	const [target, setTarget] = useState("");
	const [relationKind, setRelationKind] = useState("");
	const projection = useMemo(
		() =>
			def
				? project(values, def)
				: { groups: [], nodes: [], links: [], issues: [] },
		[values, def],
	);
	const visual = useMemo(
		() => (def ? presentation(projection, def) : null),
		[projection, def],
	);
	if (!def) return <p>Настройте граф в конструкторе версии.</p>;
	const kinds = Object.keys(def.nodes);
	const relations = Object.keys(def.relations);
	const activeRelation = relations.includes(relationKind)
		? relationKind
		: relations[0];
	const blocked = readOnly || !!inputError || projection.issues.length > 0;
	const spec = edit
		? (edit.group
				? (def.groups ?? {})
				: edit.relation
					? def.relations
					: def.nodes)[edit.kind]
		: null;
	const formSchema = spec ? itemSchema(schema, spec.collection) : null;
	const formView = spec?.form ? document?.views?.[spec.form] : undefined;
	const errors =
		edit && formSchema
			? collectErrors(
					formSchema,
					edit.item,
					formView,
					undefined,
					schema ?? undefined,
				)
			: new Map<string, string>();
	const selectedEntity = edit
		? (edit.group
				? projection.groups
				: edit.relation
					? projection.links
					: projection.nodes
			).find((item) => item.kind === edit.kind && item.key === edit.previous)
		: undefined;
	const prefix =
		spec && selectedEntity ? `${spec.collection}/${selectedEntity.index}` : "";
	const itemLocks = prefix
		? lockedPaths
				.filter((path) => path.startsWith(`${prefix}/`))
				.map((path) => path.slice(prefix.length))
		: [];

	function start(
		kind: string,
		relation: boolean,
		entity?: Entity,
		fields?: Values,
		group = false,
	) {
		if (!def) return;
		const collection = (
			group ? (def.groups ?? {}) : relation ? def.relations : def.nodes
		)[kind];
		const item = itemSchema(schema, collection.collection);
		const defaults = item ? seedDefaults(item, schema ?? item) : {};
		setError(null);
		let draft = entity
			? structuredClone(entity.item)
			: object(defaults)
				? defaults
				: {};
		if (relation && fields) {
			const relationSpec = def.relations[kind];
			for (const side of [relationSpec.from, relationSpec.to])
				draft = set(draft, side.field, get(fields, side.field));
		}
		setEdit({
			kind,
			relation,
			group,
			previous: entity?.key,
			item: draft,
			base: values,
			definition: fingerprint,
		});
	}
	function connect(connection: Connection) {
		if (blocked || !def || !activeRelation) return;
		const rel = def.relations[activeRelation];
		const source = projection.nodes.find((n) => n.id === connection.source);
		const target = projection.nodes.find((n) => n.id === connection.target);
		if (
			!source ||
			!target ||
			source.kind !== rel.from.node ||
			target.kind !== rel.to.node
		) {
			setError("Для выбранного типа связи нужны другие типы узлов.");
			return;
		}
		const sourceHandle = rel.from.row
			? sourceRowHandleId(rel.from.row)
			: bodyHandle;
		const targetHandle = rel.to.row
			? rowHandleId(rel.to.row)
			: `${bodyHandle}-in`;
		if (
			connection.sourceHandle !== sourceHandle ||
			connection.targetHandle !== targetHandle
		) {
			setError(
				"Соедините точки, указанные в настройках выбранного типа связи.",
			);
			return;
		}
		start(
			activeRelation,
			true,
			undefined,
			set(set({}, rel.from.field, source.key), rel.to.field, target.key),
		);
	}
	function checkLocks(next: Values) {
		const at = (root: Values, path: string) =>
			tokens(path).reduce<unknown>(
				(current, key) =>
					object(current) || Array.isArray(current)
						? (current as Values)[key]
						: undefined,
				root,
			);
		if (
			lockedPaths.some(
				(path) =>
					JSON.stringify(at(values, path)) !== JSON.stringify(at(next, path)),
			)
		)
			throw new Error(
				"Изменение затрагивает поле, которое нельзя менять у этого заказа.",
			);
	}
	function saveLayout(next: Positions, groupSizes = layout.groupSizes) {
		setLayout({ fingerprint, positions: next, groupSizes });
		onEditorState?.({
			profile: "declarative",
			version: 2,
			definition: fingerprint,
			chartVersion,
			positions: next,
			groupSizes,
		});
	}
	function openMove(node: Entity) {
		setMoving({ node, base: values, definition: fingerprint });
		setTarget("");
	}
	function move() {
		if (!target) throw new Error("Выберите область назначения.");
		if (blocked || !def || !moving)
			throw new Error("Редактирование сейчас недоступно.");
		if (moving.base !== values || moving.definition !== fingerprint)
			throw new Error(
				"Данные изменились. Закройте окно и выберите узел снова.",
			);
		const next = execute(values, def, {
			type: "move",
			kind: moving.node.kind,
			key: moving.node.key,
			target,
		});
		checkLocks(next);
		const nodeSpec = def.nodes[moving.node.kind];
		const nextEntity = project(next, def).nodes.find(
			(n) => n.id === moving.node.id,
		)!;
		const nodeSchema = itemSchema(schema, nodeSpec.collection);
		if (
			nodeSchema &&
			collectErrors(
				nodeSchema,
				nextEntity.item,
				nodeSpec.form ? document?.views?.[nodeSpec.form] : undefined,
				undefined,
				schema ?? undefined,
			).size
		)
			throw new Error(
				"Параметры узла не соответствуют схеме в выбранной области.",
			);
		const nextPositions = { ...positions };
		delete nextPositions[moving.node.id];
		saveLayout(nextPositions);
		onValues(next);
		setEdit(null);
		setError(null);
	}
	function save(remove = false) {
		if (blocked || !edit || !def) return;
		if (edit.base !== values || edit.definition !== fingerprint) {
			setError(
				"Данные или настройки графа изменились. Закройте свойства и выберите запись снова.",
			);
			return;
		}
		if (!remove && errors.size) {
			setError("Проверьте поля формы.");
			return;
		}
		try {
			const next = execute(
				values,
				def,
				remove && edit.previous !== undefined
					? {
							type: "delete",
							kind: edit.kind,
							relation: edit.relation,
							group: edit.group,
							key: edit.previous,
						}
					: {
							type: "save",
							kind: edit.kind,
							relation: edit.relation,
							group: edit.group,
							previous: edit.previous,
							item: edit.item,
						},
			);
			checkLocks(next);
			if (selectedEntity && !edit.relation) {
				const nextKey = remove ? undefined : get(edit.item, spec!.key);
				const nextId =
					typeof nextKey === "string"
						? edit.group
							? areaId(edit.kind, nextKey)
							: entityId(edit.kind, nextKey)
						: undefined;
				const nextPositions = { ...positions };
				const nextSizes = { ...layout.groupSizes };
				if (nextId && nextId !== selectedEntity.id) {
					if (nextPositions[selectedEntity.id])
						nextPositions[nextId] = nextPositions[selectedEntity.id];
					if (nextSizes[selectedEntity.id])
						nextSizes[nextId] = nextSizes[selectedEntity.id];
				}
				if (nextId !== selectedEntity.id) {
					delete nextPositions[selectedEntity.id];
					delete nextSizes[selectedEntity.id];
				}
				if (
					!edit.group &&
					spec?.group &&
					nextId &&
					get(selectedEntity.item, spec.group.field) !==
						get(edit.item, spec.group.field)
				)
					delete nextPositions[nextId];
				saveLayout(nextPositions, nextSizes);
			}
			onValues(next);
			setEdit(null);
			setError(null);
		} catch (e) {
			setError((e as Error).message);
		}
	}
	return (
		<div className={`flex flex-col gap-3 ${fill ? "h-full" : "min-h-[540px]"}`}>
			<div className="flex flex-wrap items-end gap-2">
				{Object.entries(def.groups ?? {}).map(([kind, area]) => (
					<Button
						key={`group:${kind}`}
						isDisabled={blocked}
						onPress={() => start(kind, false, undefined, undefined, true)}
					>
						+ {area.title || kind}
					</Button>
				))}
				{kinds.map((kind) => (
					<Button
						key={kind}
						isDisabled={blocked}
						onPress={() => start(kind, false)}
					>
						+ {def.nodes[kind].title || kind}
					</Button>
				))}
				{relations.length > 0 && (
					<Select
						label="Тип связи"
						selectedKey={activeRelation}
						onSelectionChange={setRelationKind}
						options={relations.map((kind) => ({
							id: kind,
							label: def.relations[kind].title || kind,
						}))}
					/>
				)}
				{activeRelation && (
					<Button
						isDisabled={blocked}
						onPress={() => start(activeRelation, true)}
					>
						Добавить связь
					</Button>
				)}
				<span className="ml-auto text-xs text-slate-500">
					Узлы: {projection.nodes.length} · связи: {projection.links.length}
				</span>
			</div>
			<p className="text-xs text-slate-500">
				Выберите область, карточку или подпись связи, чтобы открыть свойства.
				Перетаскивание узла расширяет область. Для переноса в другую область
				нажмите ПКМ → «Переместить в…».
			</p>
			{(inputError || projection.issues.length > 0 || error) && (
				<div
					role="alert"
					className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
				>
					{inputError || projection.issues[0] || error}
				</div>
			)}
			<div
				className={`flex flex-col gap-3 xl:flex-row ${fill ? "min-h-0 flex-1" : ""}`}
			>
				<div
					className="relative min-h-[380px] min-w-0 flex-1 rounded-md border border-slate-200 bg-app"
					style={{ height: fill ? "100%" : 440 }}
				>
					<div className="absolute inset-0">
						{visual && (
							<GraphView
								data={{
									...visual.data,
									positions,
									groupSizes:
										layout.fingerprint === fingerprint ? layout.groupSizes : {},
								}}
								profile={visual.profile}
								editable={!blocked}
								selectedId={selectedEntity?.id}
								onConnect={connect}
								onGroupClick={(id) => {
									const entity = projection.groups.find((g) => g.id === id);
									if (entity)
										start(entity.kind, false, entity, undefined, true);
								}}
								onNodeContextMenu={
									!blocked
										? (id, point) => setMenu({ id, ...point })
										: undefined
								}
								onNodeClick={(id) => {
									const entity = projection.nodes.find((n) => n.id === id);
									if (entity) start(entity.kind, false, entity);
								}}
								onLinkClick={(id) => {
									const entity = projection.links.find((n) => n.id === id);
									if (entity) start(entity.kind, true, entity);
								}}
								onPositions={saveLayout}
							/>
						)}
					</div>
				</div>
				{edit && spec && (
					<aside
						className="flex max-h-[540px] flex-col gap-3 overflow-y-auto rounded-md border border-slate-200 bg-surface p-3 xl:w-80 xl:shrink-0"
						aria-label="Свойства элемента"
					>
						<div className="flex items-center justify-between gap-2">
							<h3 className="text-sm font-semibold">
								{spec.title || edit.kind}
							</h3>
							<Button
								onPress={() => {
									setEdit(null);
									setError(null);
								}}
							>
								Закрыть
							</Button>
						</div>
						<p className="text-xs text-slate-500">
							{spec.collection}
							{edit.previous ? ` · ${edit.previous}` : " · новая запись"}
						</p>
						<fieldset disabled={blocked} className="min-w-0">
							{formSchema ? (
								<SchemaForm
									schema={formSchema}
									rootSchema={schema ?? undefined}
									value={edit.item}
									onChange={(item) => setEdit({ ...edit, item })}
									view={formView}
									errors={errors}
									showErrors
									lockReadOnly={lockReadOnly}
									lockedPaths={itemLocks}
								/>
							) : (
								<p className="text-sm text-slate-500">
									Для редактирования свойств добавьте схему коллекции в
									values.schema.json.
								</p>
							)}
						</fieldset>
						{!blocked && (
							<div className="flex flex-wrap gap-2">
								<Button
									variant="primary"
									isDisabled={!formSchema}
									onPress={() => save()}
								>
									Применить
								</Button>
								{edit.previous !== undefined && (
									<Button variant="danger" onPress={() => save(true)}>
										Удалить
									</Button>
								)}
							</div>
						)}
						{edit.group && (
							<p className="text-xs text-slate-500">
								Переименование обновит ссылки узлов. Область можно удалить,
								когда в ней нет узлов.
							</p>
						)}
						{!blocked && !edit.group && !edit.relation && selectedEntity && (
							<Button onPress={() => openMove(selectedEntity)}>
								Переместить в…
							</Button>
						)}
						{edit.relation && (
							<p className="text-xs text-slate-500">
								Связь хранится отдельной записью. Её удаление не удаляет узлы.
							</p>
						)}
						{!edit.group && !edit.relation && edit.previous && (
							<p className="text-xs text-slate-500">
								Переименование обновит ссылки. Перед удалением узла удалите его
								связи.
							</p>
						)}
					</aside>
				)}
			</div>
			{menu && (
				<ContextMenu
					x={menu.x}
					y={menu.y}
					title="Действия с узлом"
					onClose={() => setMenu(null)}
					entries={[
						{
							label: "Переместить в…",
							onAction: () => {
								const node = projection.nodes.find((n) => n.id === menu.id);
								if (node) openMove(node);
							},
						},
					]}
				/>
			)}
			<ConfirmDialog
				isOpen={!!moving}
				onOpenChange={(open) => {
					if (!open) setMoving(null);
				}}
				title="Переместить узел"
				confirmLabel="Переместить"
				onConfirm={move}
				message={
					<div className="flex flex-col gap-3">
						<p>{moving?.node.title}</p>
						<Select
							label="Область назначения"
							selectedKey={target}
							onSelectionChange={setTarget}
							options={[
								{ id: "", label: "Выберите область" },
								...projection.groups.map((g) => ({
									id: g.id,
									label: `${g.title} (${def.groups?.[g.kind].title || g.kind})`,
								})),
							]}
						/>
						{!projection.groups.length && (
							<p>Добавьте тип области в конструкторе и создайте её запись.</p>
						)}
					</div>
				}
			/>
		</div>
	);
}
