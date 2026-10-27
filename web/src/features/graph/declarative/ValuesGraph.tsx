import type { Connection } from "@xyflow/react";
import { useMemo, useState } from "react";
import { GraphView } from "../core/GraphView";
import { bodyHandle, rowHandleId, sourceRowHandleId } from "../core/CardNode";
import { presentation } from "./presentation";
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
	const [layout, setLayout] = useState({ fingerprint, positions: saved });
	const positions = layout.fingerprint === fingerprint ? layout.positions : {};
	const [edit, setEdit] = useState<Edit | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [relationKind, setRelationKind] = useState("");
	const projection = useMemo(
		() => (def ? project(values, def) : { nodes: [], links: [], issues: [] }),
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
					Узлы: {projection.nodes.length} · связи: {projection.links.length}
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
						{visual && (
							<GraphView
								data={{ ...visual.data, positions }}
								profile={visual.profile}
								editable={!blocked}
								selectedId={selectedEntity?.id}
								onConnect={connect}
								onNodeClick={(id) => {
									const entity = projection.nodes.find((n) => n.id === id);
									if (entity) start(entity.kind, false, entity);
								}}
								onLinkClick={(id) => {
									const entity = projection.links.find((n) => n.id === id);
									if (entity) start(entity.kind, true, entity);
								}}
								onPositions={(next) => {
									setLayout({ fingerprint, positions: next });
									onEditorState?.({
										profile: "declarative",
										version: 2,
										definition: fingerprint,
										chartVersion,
										positions: next,
									});
								}}
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
