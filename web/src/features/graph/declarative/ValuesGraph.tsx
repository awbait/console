import {
	Background,
	Controls,
	Handle,
	MarkerType,
	Position,
	ReactFlow,
	useNodesInitialized,
	useReactFlow,
	useStore,
	type Connection,
	type NodeProps,
} from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import { Button, Select } from "@/components/ui";
import { collectErrors, SchemaForm, seedDefaults } from "@/form/SchemaForm";
import type { ValuesEditorProps } from "@/features/orders/valuesEditors";
import {
	execute,
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

function ValueNode({ data, selected, isConnectable }: NodeProps) {
	return (
		<div
			className={`rf-card ${selected ? "ring-2 ring-brand-500" : ""}`}
			style={{ width: 200 }}
		>
			<Handle
				type="target"
				position={Position.Left}
				isConnectable={isConnectable}
				className="!h-3 !w-3 !border-2 !border-surface !bg-brand-500"
			/>
			<div className="rf-card__head">
				<div className="rf-card__title">
					<span className="rf-card__name">{String(data.label)}</span>
				</div>
				<div className="rf-card__sub">{String(data.kindLabel)}</div>
			</div>
			<Handle
				type="source"
				position={Position.Right}
				isConnectable={isConnectable}
				className="!h-3 !w-3 !border-2 !border-surface !bg-brand-500"
			/>
		</div>
	);
}
const nodeTypes = { value: ValueNode };
function FitCanvas({ count }: { count: number }) {
	const { fitView } = useReactFlow();
	const ready = useNodesInitialized();
	const width = useStore((state) => state.width);
	const height = useStore((state) => state.height);
	useEffect(() => {
		if (ready && width && height && count) void fitView({ padding: 0.2 });
	}, [ready, width, height, count, fitView]);
	return null;
}
type Edit = {
	kind: string;
	relation: boolean;
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
		editorState.version === 1 &&
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
	const [layout, setLayout] = useState({ fingerprint, positions: saved });
	const positions = layout.fingerprint === fingerprint ? layout.positions : {};
	const [edit, setEdit] = useState<Edit | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [relationKind, setRelationKind] = useState("");
	const [measurements, setMeasurements] = useState<
		Record<string, { width: number; height: number }>
	>({});
	const projection = useMemo(
		() => (def ? project(values, def) : { nodes: [], links: [], issues: [] }),
		[values, def],
	);
	if (!def) return <p>Настройте граф в конструкторе версии.</p>;
	const kinds = Object.keys(def.nodes);
	const relations = Object.keys(def.relations);
	const activeRelation = relations.includes(relationKind)
		? relationKind
		: relations[0];
	const blocked = readOnly || !!inputError || projection.issues.length > 0;
	const spec = edit
		? (edit.relation ? def.relations : def.nodes)[edit.kind]
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
		? (edit.relation ? projection.links : projection.nodes).find(
				(item) => item.kind === edit.kind && item.key === edit.previous,
			)
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
	) {
		if (!def) return;
		const collection = (relation ? def.relations : def.nodes)[kind];
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
		start(
			activeRelation,
			true,
			undefined,
			set(set({}, rel.from.field, source.key), rel.to.field, target.key),
		);
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
							key: edit.previous,
						}
					: {
							type: "save",
							kind: edit.kind,
							relation: edit.relation,
							previous: edit.previous,
							item: edit.item,
						},
			);
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
			onValues(next);
			setEdit(null);
			setError(null);
		} catch (e) {
			setError((e as Error).message);
		}
	}
	const nodes = projection.nodes.map((n) => ({
		id: n.id,
		type: "value",
		data: { label: n.title, kindLabel: def.nodes[n.kind].title || n.kind },
		position: positions[n.id] ?? {
			x: kinds.indexOf(n.kind) * 280 + 30,
			y: n.index * 130 + 40,
		},
		measured: measurements[n.id],
		selected:
			!edit?.relation && edit?.kind === n.kind && edit.previous === n.key,
	}));
	const edges = projection.links.map((l) => ({
		id: l.id,
		source: l.source,
		target: l.target,
		label: l.title,
		labelStyle: { fill: "rgb(var(--c-neutral-800))" },
		labelBgStyle: { fill: "rgb(var(--c-surface))" },
		markerEnd: { type: MarkerType.ArrowClosed },
		selected: edit?.relation && edit.previous === l.key && edit.kind === l.kind,
	}));
	return (
		<div className={`flex flex-col gap-3 ${fill ? "h-full" : "min-h-[540px]"}`}>
			<div className="flex flex-wrap items-end gap-2">
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
					Узлы: {nodes.length} · связи: {edges.length}
				</span>
			</div>
			<p className="text-xs text-slate-500">
				Выберите карточку или стрелку, чтобы открыть свойства. Соедините точки
				на карточках, чтобы добавить связь.
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
						<ReactFlow
							className="rf-wrap"
							proOptions={{ hideAttribution: true }}
							key={fingerprint}
							nodes={nodes}
							edges={edges}
							nodeTypes={nodeTypes}
							fitView
							nodesConnectable={!blocked}
							deleteKeyCode={null}
							onConnect={connect}
							onNodeClick={(_, node) => {
								const entity = projection.nodes.find((n) => n.id === node.id);
								if (entity) start(entity.kind, false, entity);
							}}
							onEdgeClick={(_, edge) => {
								const entity = projection.links.find((l) => l.id === edge.id);
								if (entity) start(entity.kind, true, entity);
							}}
							onNodesChange={(changes) => {
								const resized = changes.filter((c) => c.type === "dimensions");
								if (resized.length)
									setMeasurements((old) => {
										const next = { ...old };
										for (const change of resized)
											if (change.dimensions)
												next[change.id] = change.dimensions;
										return next;
									});
								const moved = changes.filter((c) => c.type === "position");
								if (!moved.length) return;
								setLayout((old) => {
									const next = {
										...(old.fingerprint === fingerprint ? old.positions : {}),
									};
									for (const change of moved)
										if (change.position) next[change.id] = change.position;
									return { fingerprint, positions: next };
								});
							}}
							onNodeDragStop={(_, node) =>
								onEditorState?.({
									profile: "declarative",
									version: 1,
									definition: fingerprint,
									chartVersion,
									positions: { ...positions, [node.id]: node.position },
								})
							}
						>
							<FitCanvas count={nodes.length} />
							<Background />
							<Controls showInteractive={false} />
						</ReactFlow>
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
						{edit.relation && (
							<p className="text-xs text-slate-500">
								Связь хранится отдельной записью. Её удаление не удаляет узлы.
							</p>
						)}
						{!edit.relation && edit.previous && (
							<p className="text-xs text-slate-500">
								Переименование обновит ссылки. Перед удалением узла удалите его
								связи.
							</p>
						)}
					</aside>
				)}
			</div>
		</div>
	);
}
