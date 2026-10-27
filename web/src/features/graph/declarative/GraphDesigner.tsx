import type { ViewDocument } from "@/api/types";
import { Button, Select, TextField } from "@/components/ui";
import { CardDesigner } from "./CardDesigner";
import { GroupsDesigner } from "./GroupsDesigner";
import {
	definitionIssues,
	object,
	type Collection,
	type Definition,
	type Relation,
} from "./model";

const empty = (): Definition => ({
	profile: "declarative",
	version: 1,
	nodes: {},
	relations: {},
});

export function GraphDesigner({
	document,
	onChange,
	readOnly = false,
}: {
	document: ViewDocument;
	onChange: (doc: ViewDocument) => void;
	readOnly?: boolean;
}) {
	const raw = document.graph;
	if (!object(raw) || raw.profile !== "declarative")
		return (
			<div className="flex flex-col items-start gap-3 p-3">
				<h2 className="text-base font-semibold">Граф из values</h2>
				<p className="text-sm text-slate-500">
					Укажите, какие коллекции становятся узлами, а какие записи связывают
					их. Свойства будут открываться в формах из этого документа.
				</p>
				{raw ? (
					<p className="text-sm text-slate-500">
						Здесь уже настроен другой профиль. Его настройки доступны во вкладке
						view.schema.json. Для перехода удалите прежний блок graph в
						документе.
					</p>
				) : (
					<Button
						variant="primary"
						isDisabled={readOnly}
						onPress={() => onChange({ ...document, graph: empty() })}
					>
						Настроить граф
					</Button>
				)}
			</div>
		);
	if (
		!object(raw.nodes) ||
		!object(raw.relations) ||
		(raw.groups !== undefined && !object(raw.groups))
	)
		return (
			<p role="alert">
				Исправьте nodes и relations в документе: оба должны быть объектами.
			</p>
		);
	const def = raw as unknown as Definition;
	const issues = definitionIssues(raw);
	const write = (next: Definition) => onChange({ ...document, graph: next });
	function change(
		group: "nodes" | "relations",
		key: string,
		patch: Partial<Relation>,
	) {
		write({
			...def,
			[group]: { ...def[group], [key]: { ...def[group][key], ...patch } },
		});
	}
	function add(group: "nodes" | "relations") {
		let n = 1;
		while (def[group][`${group === "nodes" ? "node" : "link"}${n}`]) n++;
		const key = `${group === "nodes" ? "node" : "link"}${n}`;
		const first = Object.keys(def.nodes)[0] ?? "";
		const item: Collection | Relation =
			group === "nodes"
				? { collection: `/${key}`, key: "/name", title: key }
				: {
						collection: `/${key}`,
						key: "/name",
						title: key,
						from: { node: first, field: "/source" },
						to: { node: first, field: "/target" },
					};
		write({ ...def, [group]: { ...def[group], [key]: item } });
	}
	function remove(group: "nodes" | "relations", key: string) {
		const next = { ...def[group] };
		delete next[key];
		write({ ...def, [group]: next });
	}
	const forms = [
		{ id: "", label: "Все поля схемы" },
		...Object.keys(document.views ?? {})
			.filter((key) => key !== "order")
			.map((key) => ({ id: key, label: key })),
	];
	const nodeOptions = Object.entries(def.nodes).map(([key, spec]) => ({
		id: key,
		label: object(spec) && typeof spec.title === "string" ? spec.title : key,
	}));
	return (
		<div className="flex flex-col gap-4 overflow-y-auto p-1">
			<div className="flex items-start justify-between gap-2">
				<div>
					<h2 className="text-base font-semibold">Граф из values</h2>
					<p className="mt-1 text-xs text-slate-500">
						Списки объектов со строковым ключом. Каждая связь хранится отдельной
						записью.
					</p>
				</div>
				<Button
					isDisabled={readOnly}
					onPress={() => write({ ...def, enabled: def.enabled === false })}
				>
					{def.enabled === false ? "Включить" : "Выключить"}
				</Button>
			</div>
			{issues.length > 0 && (
				<p
					role="status"
					className="rounded-md bg-amber-50 p-2 text-xs text-amber-800"
				>
					{issues[0]}
				</p>
			)}
			<GroupsDesigner
				definition={def}
				onChange={write}
				forms={forms}
				readOnly={readOnly}
			/>
			{(["nodes", "relations"] as const).map((group) => (
				<section key={group} className="flex flex-col gap-3">
					<div className="flex items-center justify-between">
						<h3 className="text-sm font-semibold">
							{group === "nodes" ? "Типы узлов" : "Типы связей"}
						</h3>
						<Button
							isDisabled={
								readOnly || (group === "relations" && !nodeOptions.length)
							}
							onPress={() => add(group)}
						>
							Добавить
						</Button>
					</div>
					{Object.entries(def[group]).map(([key, item]) => {
						if (
							!object(item) ||
							(item.group !== undefined && (!object(item.group) || typeof item.group.type !== "string" || typeof item.group.field !== "string")) ||
							["collection", "key", "title", "label", "form"].some(
								(field) =>
									item[field] !== undefined && typeof item[field] !== "string",
							)
						)
							return <p key={key}>Исправьте описание {key} в JSON.</p>;
						const spec = item as unknown as Collection;
						const linked =
							group === "nodes" &&
							(Object.values(def.relations).some(
								(r) => r?.from?.node === key || r?.to?.node === key,
							) ||
								Object.values(def.groups ?? {}).some(
									(g) => Array.isArray(g?.accepts) && g.accepts.includes(key),
								));
						return (
							<fieldset
								key={key}
								disabled={readOnly}
								className="flex min-w-0 flex-col gap-3 rounded-md border border-slate-200 p-3"
							>
								<div className="flex items-center justify-between">
									<span className="text-xs font-medium text-slate-500">
										{key}
									</span>
									<Button
										isDisabled={readOnly || linked}
										onPress={() => remove(group, key)}
									>
										Удалить
									</Button>
								</div>
								{linked && (
									<p className="text-xs text-slate-500">
										Тип используется связями или областями. Сначала измените их
										настройки.
									</p>
								)}
								<TextField
									label="Название"
									value={spec.title ?? ""}
									onChange={(title) => change(group, key, { title })}
								/>
								<TextField
									label="Коллекция в values"
									description="Например, /brokers или /mesh/subscriptions."
									value={spec.collection ?? ""}
									onChange={(collection) => change(group, key, { collection })}
								/>
								<TextField
									label="Ключ записи"
									description="Путь внутри записи, например /name."
									value={spec.key ?? ""}
									onChange={(identity) => change(group, key, { key: identity })}
								/>
								<TextField
									label="Поле подписи"
									description="Если не указано, используется ключ записи."
									value={spec.label ?? ""}
									onChange={(label) =>
										change(group, key, { label: label || undefined })
									}
								/>
								<Select
									label="Форма свойств"
									selectedKey={spec.form ?? ""}
									options={forms}
									onSelectionChange={(form) =>
										change(group, key, { form: form || undefined })
									}
								/>
								{group === "nodes" && (
									<>
										<Select
											label="Тип области узла"
											selectedKey={spec.group?.type ?? ""}
											options={[
												{ id: "", label: "Без отдельной записи области" },
												...Object.entries(def.groups ?? {}).map(([id, g]) => ({
													id,
													label: typeof g?.title === "string" ? g.title : id,
												})),
											]}
											onSelectionChange={(type) =>
												change(group, key, {
													group: type
														? { type, field: spec.group?.field ?? "/namespace" }
														: undefined,
													display: { ...spec.display, group: undefined },
												})
											}
										/>
										{spec.group && (
											<TextField
												label="Поле ссылки на область"
												value={spec.group.field}
												onChange={(field) =>
													change(group, key, {
														group: { ...spec.group!, field },
													})
												}
											/>
										)}
										<CardDesigner
											readOnly={readOnly}
											value={object(spec.display) ? spec.display : undefined}
											grouped={!!spec.group}
											onChange={(display) => change(group, key, { display })}
										/>
									</>
								)}
								{group === "relations" &&
									(["from", "to"] as const).map((side) => {
										const endpoint = (item as unknown as Relation)[side] ?? {
											node: "",
											field: "",
										};
										return (
											<div
												key={side}
												className="flex flex-col gap-2 rounded-md bg-app p-2"
											>
												<Select
													label={side === "from" ? "Откуда" : "Куда"}
													selectedKey={endpoint.node}
													options={nodeOptions}
													onSelectionChange={(node) =>
														change(group, key, {
															[side]: { ...endpoint, node, row: undefined },
														})
													}
												/>
												<TextField
													label="Поле ссылки"
													value={endpoint.field}
													onChange={(field) =>
														change(group, key, {
															[side]: { ...endpoint, field },
														})
													}
												/>
												<Select
													label="Точка подключения"
													selectedKey={endpoint.row ?? ""}
													options={[
														{ id: "", label: "Карточка целиком" },
														...(Array.isArray(
															def.nodes[endpoint.node]?.display?.rows,
														)
															? def.nodes[endpoint.node].display!.rows!
															: []
														)
															.filter(
																(row) =>
																	object(row) &&
																	typeof row.id === "string" &&
																	typeof row.label === "string",
															)
															.map((row) => ({
																id: row.id,
																label: row.label || row.id,
															})),
													]}
													onSelectionChange={(row) =>
														change(group, key, {
															[side]: { ...endpoint, row: row || undefined },
														})
													}
												/>
											</div>
										);
									})}
							</fieldset>
						);
					})}
				</section>
			))}
			<p className="text-xs text-slate-500">
				Настройки сохраняются в graph этого документа. В предпросмотре выберите
				«Граф», чтобы проверить узлы, связи и формы.
			</p>
		</div>
	);
}
