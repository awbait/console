import { useEffect, useMemo, useState } from "react";
import yaml from "js-yaml";
import type { ViewDocument } from "@/api/types";
import { Button, Card } from "@/components/ui";
import { ThemeMenu } from "@/components/ThemeMenu";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { applyEnums, resolveTab } from "@/components/products/genericView";
import {
	collectErrors,
	SchemaForm,
	seedDefaults,
	type View,
} from "@/form/SchemaForm";
import { GraphView } from "../core/GraphView";
import { sourceRowHandleId } from "../core/CardNode";
import type { GraphData } from "../core/model";
import { object, type Values } from "../declarative/model";
import {
	backendId,
	gatewayId,
	ingressProfile,
	ingressProjection,
	ingressValues,
	records,
	replaceBackend,
	saveGateway,
} from "./model";
import chartSchema from "./values.schema.json";
import chartDocument from "./view.schema.json";

const storageKey = "console-graph-ingress-v1";
const initial = () => ({
	values: structuredClone(ingressValues),
	namespace: "shop",
	areas: [] as string[],
	drafts: [] as Values[],
});
function load(): ReturnType<typeof initial> {
	try {
		const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
		if (
			object(saved) &&
			object(saved.values) &&
			typeof saved.namespace === "string" &&
			Array.isArray(saved.areas) &&
			saved.areas.every((area) => typeof area === "string") &&
			Array.isArray(saved.drafts) &&
			saved.drafts.every(object)
		)
			return saved as ReturnType<typeof initial>;
	} catch {
		/* Storage is optional in the local sandbox. */
	}
	return initial();
}
type Edit = {
	kind: "gateway" | "route" | "backend" | "namespace";
	index: number;
	item: Values;
	previous?: Values;
};
const doc = chartDocument as unknown as ViewDocument;
const routeTab = resolveTab(
	chartSchema,
	doc.tabs!.find((tab) => tab.id === "routes")!,
	doc,
)!;
const namespaceSchema = {
	type: "object",
	required: ["name"],
	properties: {
		name: { ...chartSchema.definitions.k8sName, title: "Namespace" },
	},
};

export function IngressWorkbench({
	onClose,
	onExample,
}: {
	onClose?: () => void;
	onExample: (preset: "mesh" | "topology") => void;
}) {
	const [state, setState] = useState(load);
	const [releaseNamespace, setReleaseNamespace] = useState(state.namespace);
	const [layout, setLayout] = useState<
		Pick<GraphData, "positions" | "groupSizes">
	>({});
	const [edit, setEdit] = useState<Edit | null>(null);
	const [error, setError] = useState("");
	const [tab, setTab] = useState("graph");
	const [raw, setRaw] = useState("");
	const [reset, setReset] = useState(false);
	useEffect(() => {
		try {
			localStorage.setItem(storageKey, JSON.stringify(state));
		} catch {
			/* Keep the session usable. */
		}
	}, [state]);
	const projection = useMemo(
		() =>
			ingressProjection(
				state.values,
				state.namespace,
				state.areas,
				state.drafts,
			),
		[state],
	);
	const data = useMemo(
		() => ({ ...projection.data, ...layout }),
		[projection, layout],
	);
	const gateways = records(state.values.gateways);
	const routes = records(state.values.xroutes);
	const schema = useMemo(() => {
		if (edit?.kind === "namespace") return namespaceSchema;
		if (edit?.kind === "backend")
			return {
				...chartSchema.definitions.backendRef,
				properties: Object.fromEntries(
					Object.entries(chartSchema.definitions.backendRef.properties).filter(
						([key]) => ["name", "namespace", "port"].includes(key),
					),
				),
				definitions: chartSchema.definitions,
			};
		if (edit?.kind === "gateway")
			return {
				...chartSchema.definitions.gateway,
				definitions: chartSchema.definitions,
			};
		// Use the product tab's schema and enum rules. Multiple parents can use
		// listeners from different gateways; check each pairing again on save.
		return applyEnums(routeTab.itemSchema, routeTab.enums, {
			...state.values,
			gateways: [
				{
					listeners: records(state.values.gateways).flatMap((gateway) =>
						records(gateway.listeners),
					),
				},
			],
		});
	}, [edit?.kind, state.values]);
	const view: View | undefined =
		edit?.kind === "route" ? routeTab.form : undefined;
	const errors = edit
		? collectErrors(schema, edit.item, view)
		: new Map<string, string>();
	function open(
		kind: Edit["kind"],
		index: number,
		item: Values,
		previous?: Values,
	) {
		setError("");
		setEdit({ kind, index, item: structuredClone(item), previous });
	}
	function openRoute(index: number) {
		if (routes[index]) open("route", index, routes[index]);
	}
	function newRoute(
		gateway = gateways[0],
		backend?: Values,
		listener?: string,
	) {
		if (!gateway) {
			setError("Сначала добавьте Gateway.");
			return;
		}
		open("route", -1, {
			...(seedDefaults(routeTab.itemSchema, routeTab.itemSchema) as Values),
			name: "",
			enabled: true,
			parentRefs: [
				{
					gateway: gateway.name,
					sectionName: listener ?? records(gateway.listeners)[0]?.name,
				},
			],
			rules: [
				{
					matches: [{ path: { type: "PathPrefix", value: "/" } }],
					...(backend
						? {
								backendRefs: [
									{
										name: backend.name,
										port: backend.port,
										...(backend.namespace
											? { namespace: backend.namespace }
											: {}),
									},
								],
							}
						: {}),
				},
			],
		});
	}
	function save() {
		if (!edit) return;
		if (errors.size) {
			setError("Проверьте отмеченные поля формы.");
			return;
		}
		try {
			const item = edit.item;
			if (edit.kind === "namespace") {
				const name = String(item.name);
				if (projection.data.groups.some((group) => group.title === name))
					throw new Error("Такая область уже существует.");
				setState({ ...state, areas: [...state.areas, name] });
			} else if (edit.kind === "gateway") {
				setState({
					...state,
					values: saveGateway(state.values, edit.index, item),
				});
			} else if (edit.kind === "backend") {
				const id = backendId(item, state.namespace);
				if (
					projection.backends.has(id) &&
					(!edit.previous || backendId(edit.previous, state.namespace) !== id)
				)
					throw new Error("Такой backendRef уже есть в графе.");
				const drafts = state.drafts.filter(
					(ref) =>
						!edit.previous ||
						backendId(ref, state.namespace) !==
							backendId(edit.previous, state.namespace),
				);
				setState({
					...state,
					values: edit.previous
						? replaceBackend(state.values, edit.previous, item, state.namespace)
						: state.values,
					drafts: [...drafts, item],
				});
			} else {
				if (
					routes.some(
						(route, index) => index !== edit.index && route.name === item.name,
					)
				)
					throw new Error("Имя маршрута уже занято.");
				const parents = records(item.parentRefs);
				const currentParents = records(routes[edit.index]?.parentRefs);
				const fallback =
					parents[0]?.gateway ||
					currentParents[0]?.gateway ||
					gateways[0]?.name;
				const next = {
					...item,
					parentRefs: parents.map((parent) => ({
						...parent,
						gateway: parent.gateway || fallback,
					})),
				};
				const nextRoutes = [...routes];
				if (edit.index < 0) nextRoutes.push(next);
				else nextRoutes[edit.index] = next;
				const values = { ...state.values, xroutes: nextRoutes };
				const issues = ingressProjection(
					{ ...values, xroutes: [next] },
					state.namespace,
					[],
					[],
				).issues;
				if (issues.length) throw new Error(issues.join(" "));
				setState({ ...state, values });
			}
			setEdit(null);
			setError("");
		} catch (e) {
			setError((e as Error).message);
		}
	}
	return (
		<div className="min-h-screen bg-app text-slate-800">
			<header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-surface px-5 py-3">
				<h1 className="mr-auto text-base font-semibold">
					Конструктор графа · Ingress Gateway
				</h1>
				<Button onPress={() => onExample("topology")}>Kubernetes</Button>
				<Button onPress={() => onExample("mesh")}>Event Mesh</Button>
				{onClose && <Button onPress={onClose}>Вернуться к топологии</Button>}
				<Button onPress={() => setReset(true)}>Сбросить пример</Button>
				<ThemeMenu />
			</header>
			<main className="mx-auto flex max-w-[1800px] flex-col gap-4 p-4">
				<p className="text-sm text-slate-500">
					ingress-gateway 11.0.0. Gateway → xroute → backendRef. Нажмите на
					подпись связи, чтобы открыть обычную форму маршрута. Несколько линий
					одного xroute редактируют один маршрут.
				</p>
				<div className="flex flex-wrap gap-2">
					{[
						["graph", "Граф"],
						["values", "Values YAML"],
						["form", "Обычная форма"],
					].map(([id, label]) => (
						<Button
							key={id}
							variant={tab === id ? "primary" : "secondary"}
							onPress={() => {
								setTab(id);
								setRaw(yaml.dump(state.values, { lineWidth: -1 }));
								setEdit(null);
								setError("");
							}}
						>
							{label}
						</Button>
					))}
				</div>
				{error && (
					<p role="alert" className="text-sm text-red-600">
						{error}
					</p>
				)}
				<div className={tab === "graph" ? "" : "hidden"}>
					<div className="mb-3 flex flex-wrap gap-2">
						<Button onPress={() => open("namespace", -1, { name: "" })}>
							+ Namespace
						</Button>
						<Button
							onPress={() =>
								open("gateway", -1, {
									name: "",
									enabled: true,
									listeners: [{ name: "http", protocol: "HTTP", port: 80 }],
								})
							}
						>
							+ Gateway
						</Button>
						<Button
							onPress={() =>
								open("backend", -1, {
									name: "",
									namespace: state.namespace,
									port: 80,
								})
							}
						>
							+ backendRef
						</Button>
						<Button onPress={() => newRoute()}>+ xroute</Button>
					</div>
					<div
						className={`grid gap-4 ${edit ? "lg:grid-cols-[minmax(0,1fr)_440px]" : ""}`}
					>
						<div className="h-[70vh] min-h-[440px] overflow-hidden rounded-lg border border-slate-200 bg-surface">
							<GraphView
								data={data}
								profile={ingressProfile}
								editable
								onPositions={(positions, groupSizes) =>
									setLayout({ positions, groupSizes })
								}
								onNodeClick={(id) => {
									const index = gateways.findIndex(
										(gateway) => gatewayId(gateway.name) === id,
									);
									if (index >= 0) open("gateway", index, gateways[index]);
									else {
										const ref = projection.backends.get(id);
										if (ref)
											open(
												"backend",
												-1,
												{
													name: ref.name,
													port: ref.port,
													...(ref.namespace
														? { namespace: ref.namespace }
														: {}),
												},
												ref,
											);
									}
								}}
								onLinkClick={(id) => {
									const index = projection.routes.get(id);
									if (index !== undefined) openRoute(index);
								}}
								onConnect={(connection) => {
									const gateway = gateways.find(
										(item) => gatewayId(item.name) === connection.source,
									);
									const ref = projection.backends.get(connection.target);
									if (!gateway || !ref) {
										setError("Соедините выход Gateway со входом backendRef.");
										return;
									}
									const listener = records(gateway.listeners).find(
										(item) =>
											sourceRowHandleId(String(item.name)) ===
											connection.sourceHandle,
									);
									newRoute(
										gateway,
										ref,
										listener ? String(listener.name) : undefined,
									);
								}}
							/>
						</div>
						{edit && (
							<aside className="max-h-[70vh] overflow-y-auto rounded-lg border border-slate-200 bg-surface p-4">
								<h2 className="mb-3 text-base font-semibold">
									{
										{
											gateway: "Gateway",
											route: "xroute",
											backend: "backendRef",
											namespace: "Namespace",
										}[edit.kind]
									}
								</h2>
								{edit.kind === "backend" && (
									<p className="mb-3 text-sm text-slate-500">
										Адрес сервиса общий для его связей. Вес, sessionAffinity и
										остальные параметры backendRefs настраиваются в форме
										каждого xroute.
									</p>
								)}
								{edit.kind === "namespace" && (
									<p className="mb-3 text-sm text-slate-500">
										Область для ссылок на сервисы. Создание области не создаёт
										Namespace в кластере.
									</p>
								)}
								<SchemaForm
									schema={schema}
									value={edit.item}
									onChange={(item) => setEdit({ ...edit, item })}
									view={view}
									errors={errors}
									showErrors
								/>
								<div className="mt-4 flex flex-wrap gap-2">
									<Button variant="primary" onPress={save}>
										Применить
									</Button>
									<Button
										onPress={() => {
											setEdit(null);
											setError("");
										}}
									>
										Закрыть
									</Button>
								</div>
							</aside>
						)}
					</div>
					{projection.issues.map((issue) => (
						<p key={issue} role="alert" className="mt-2 text-sm text-red-600">
							{issue}
						</p>
					))}
					<div className="mt-3 flex flex-wrap items-center gap-2">
						<span className="text-sm">Маршруты:</span>
						{routes.map((route, i) => (
							<Button key={`${i}:${route.name}`} onPress={() => openRoute(i)}>
								{String(route.name)}
							</Button>
						))}
					</div>
				</div>
				{tab === "values" && (
					<Card>
						<label className="flex flex-col gap-2 text-sm">
							Values YAML
							<textarea
								className="min-h-[500px] w-full rounded border border-slate-300 bg-app p-3 font-mono text-sm"
								value={raw}
								onChange={(e) => setRaw(e.target.value)}
								spellCheck={false}
							/>
						</label>
						<Button
							variant="primary"
							onPress={() => {
								try {
									const values = yaml.load(raw);
									if (!object(values))
										throw new Error("Values должны быть объектом.");
									const errors = collectErrors(chartSchema, values);
									if (errors.size)
										throw new Error(
											[...errors]
												.map(([path, message]) => `${path}: ${message}`)
												.join("; "),
										);
									setState({ ...state, values });
									setError("");
								} catch (e) {
									setError((e as Error).message);
								}
							}}
						>
							Применить YAML
						</Button>
					</Card>
				)}
				{tab === "form" && (
					<Card>
						<SchemaForm
							schema={chartSchema}
							value={state.values}
							onChange={(values) => setState({ ...state, values })}
							view={doc.views?.order as View}
						/>
					</Card>
				)}
				<details className="text-sm text-slate-500">
					<summary className="cursor-pointer">Как устроен маппинг</summary>
					<ul className="mt-2 list-disc space-y-1 pl-5">
						<li>
							Область Gateway: Namespace установки Helm ({state.namespace}),
							отдельно от values.
						</li>
						<li>Узлы Gateway: /gateways; строки карточки: listeners.</li>
						<li>
							Узлы backendRef: {"/xroutes/*/rules/*/backendRefs"}, объединены по
							namespace, name и port.
						</li>
						<li>
							Связь: каждый parentRefs × backendRefs одного xroute; форма routes
							из view.schema.json.
						</li>
						<li>
							Неподключённые backendRefs и пустые области хранятся только в
							браузере. В Helm values попадают ссылки подключённых маршрутов.
						</li>
					</ul>
					<label className="mt-3 flex max-w-sm flex-col gap-1">
						Namespace установки Helm
						<input
							className="rounded border border-slate-300 bg-surface p-2 text-slate-800"
							value={releaseNamespace}
							onChange={(e) => setReleaseNamespace(e.target.value)}
						/>
					</label>
					<Button
						onPress={() => {
							if (
								!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(releaseNamespace) ||
								releaseNamespace.length > 63
							) {
								setError(
									"Namespace: от 1 до 63 символов, строчные латинские буквы, цифры и дефис между ними.",
								);
								return;
							}
							setState({ ...state, namespace: releaseNamespace });
							setLayout({});
							setEdit(null);
							setError("");
						}}
					>
						Применить namespace
					</Button>
				</details>
			</main>
			<ConfirmDialog
				isOpen={reset}
				onOpenChange={setReset}
				title="Сбросить пример?"
				message="Локальные изменения ingress gateway будут заменены исходным примером."
				confirmLabel="Сбросить"
				onConfirm={() => {
					setState(initial());
					setReleaseNamespace(initial().namespace);
					setLayout({});
					setEdit(null);
					setError("");
					setTab("graph");
				}}
			/>
		</div>
	);
}
