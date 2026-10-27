import { useEffect, useMemo, useState } from "react";
import yaml from "js-yaml";
import { Button, Card } from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ThemeMenu } from "@/components/ThemeMenu";
import { GraphDesigner } from "./GraphDesigner";
import { ValuesGraph } from "./ValuesGraph";
import { exampleDocument, exampleSchema, exampleValues } from "./example";
import { object, type Values } from "./model";
import { readGraphMapping } from "../mapping";
import { topologyExample } from "./topologyExample";

const storageKey = "console-graph-workbench-v1";
const initial = (preset = "mesh") => ({
	document: JSON.stringify(
		preset === "topology" ? topologyExample.document : exampleDocument,
		null,
		2,
	),
	schema: JSON.stringify(
		preset === "topology" ? topologyExample.schema : exampleSchema,
		null,
		2,
	),
	values: yaml.dump(
		preset === "topology" ? topologyExample.values : exampleValues,
	),
});
function load(preset: string) {
	try {
		const value = JSON.parse(
			localStorage.getItem(`${storageKey}-${preset}`) ??
				(preset === "mesh" ? localStorage.getItem(storageKey) : null) ??
				"null",
		);
		if (
			object(value) &&
			["document", "schema", "values"].every(
				(key) => typeof value[key] === "string",
			)
		)
			return value as ReturnType<typeof initial>;
	} catch {
		/* Unavailable storage must not prevent the local example opening. */
	}
	return initial(preset);
}
function parse(text: string, format: "json" | "yaml") {
	try {
		const value = format === "json" ? JSON.parse(text) : yaml.load(text);
		if (!object(value)) throw new Error("Документ должен быть объектом.");
		return { value, error: null };
	} catch (e) {
		return { value: null, error: (e as Error).message };
	}
}

export function GraphWorkbench({
	preset = "mesh",
	onClose,
}: {
	preset?: "mesh" | "topology";
	onClose?: () => void;
}) {
	const [state, setState] = useState(() => load(preset));
	const [tab, setTab] = useState("graph");
	const [reset, setReset] = useState<"mesh" | "topology" | null>(null);
	const [layout, setLayout] = useState<unknown>(null);
	const [showDesigner, setShowDesigner] = useState(true);
	useEffect(() => {
		try {
			localStorage.setItem(`${storageKey}-${preset}`, JSON.stringify(state));
		} catch {
			/* Work remains available in this tab. */
		}
	}, [state, preset]);
	const doc = useMemo(() => parse(state.document, "json"), [state.document]);
	const schema = useMemo(() => parse(state.schema, "json"), [state.schema]);
	const values = useMemo(() => parse(state.values, "yaml"), [state.values]);
	const mapping = readGraphMapping(doc.value);
	const updateValues = (next: Values) =>
		setState((old) => ({ ...old, values: yaml.dump(next, { lineWidth: -1 }) }));
	const tabs = [
		{ id: "graph", label: "Граф" },
		{ id: "values", label: "Values YAML" },
		{ id: "schema", label: "Схема" },
		{ id: "document", label: "View JSON" },
	];
	return (
		<div className="min-h-screen bg-app text-slate-800">
			<header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-surface px-5 py-3">
				<a
					className="text-xl font-bold text-brand-600"
					href={location.pathname}
				>
					console
				</a>
				<h1 className="mr-auto text-base font-semibold">Конструктор графа</h1>
				<Button onPress={() => setShowDesigner(!showDesigner)}>
					{showDesigner ? "Скрыть настройки" : "Показать настройки"}
				</Button>
				{onClose && <Button onPress={onClose}>Вернуться к топологии</Button>}
				<Button onPress={() => setReset("mesh")}>
					Загрузить пример Event Mesh
				</Button>
				<Button onPress={() => setReset("topology")}>
					Загрузить пример Kubernetes
				</Button>
				<ThemeMenu />
			</header>
			<main className="mx-auto flex max-w-[1800px] flex-col gap-4 p-4">
				<p className="text-sm text-slate-500">
					Локальная песочница. Настройте коллекции слева, соедините узлы справа
					и проверьте результат во вкладке Values YAML. Данные сохраняются
					только в этом браузере.
				</p>
				<div
					className={`grid gap-4 ${showDesigner ? "lg:grid-cols-[320px_minmax(0,1fr)]" : ""}`}
				>
					{showDesigner && (
						<Card className="max-h-[78vh] overflow-y-auto">
							{doc.value ? (
								<GraphDesigner
									document={doc.value}
									onChange={(document) =>
										setState((old) => ({
											...old,
											document: JSON.stringify(document, null, 2),
										}))
									}
								/>
							) : (
								<p role="alert">Исправьте View JSON: {doc.error}</p>
							)}
						</Card>
					)}
					<Card className="min-w-0">
						<div
							className="mb-4 flex flex-wrap gap-2"
							aria-label="Представление документа"
						>
							{tabs.map((item) => (
								<Button
									key={item.id}
									variant={tab === item.id ? "primary" : "secondary"}
									onPress={() => setTab(item.id)}
								>
									{item.label}
								</Button>
							))}
						</div>
						{tab === "graph" ? (
							mapping?.definition ? (
								<ValuesGraph
									values={values.value ?? {}}
									onValues={updateValues}
									mapping={mapping}
									document={doc.value ?? undefined}
									schema={schema.value}
									inputError={values.error ?? schema.error}
									namespace="demo"
									chartVersion="1.0.0"
									editorState={layout}
									onEditorState={setLayout}
								/>
							) : (
								<p role="status">
									Завершите настройку типов узлов и связей. Граф появится, когда
									описание станет корректным.
								</p>
							)
						) : (
							<label className="flex flex-col gap-2 text-sm">
								{tabs.find((item) => item.id === tab)?.label}
								<textarea
									spellCheck={false}
									className="min-h-[580px] w-full resize-y rounded-md border border-slate-300 bg-app p-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
									value={state[tab as keyof typeof state]}
									onChange={(e) =>
										setState((old) => ({ ...old, [tab]: e.target.value }))
									}
								/>
								{(tab === "values"
									? values.error
									: tab === "schema"
										? schema.error
										: doc.error) && (
									<span role="alert" className="text-red-600">
										{tab === "values"
											? values.error
											: tab === "schema"
												? schema.error
												: doc.error}
									</span>
								)}
							</label>
						)}
					</Card>
				</div>
			</main>
			<ConfirmDialog
				isOpen={reset !== null}
				onOpenChange={(open) => {
					if (!open) setReset(null);
				}}
				title="Загрузить пример?"
				message={`Текущие настройки и values в песочнице будут заменены примером ${reset === "topology" ? "Kubernetes" : "Event Mesh"}.`}
				confirmLabel="Загрузить"
				onConfirm={() => {
					setState(initial(reset ?? preset));
					setLayout(null);
					setTab("graph");
				}}
			/>
		</div>
	);
}
