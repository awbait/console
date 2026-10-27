import { Button, Select, TextField } from "@/components/ui";
import { object, type Definition, type GroupCollection } from "./model";

export function GroupsDesigner({
	definition,
	onChange,
	forms,
	readOnly,
}: {
	definition: Definition;
	onChange: (next: Definition) => void;
	forms: { id: string; label: string }[];
	readOnly: boolean;
}) {
	const groups = definition.groups ?? {};
	const change = (kind: string, patch: Partial<GroupCollection>) =>
		onChange({
			...definition,
			groups: { ...groups, [kind]: { ...groups[kind], ...patch } },
		});
	return (
		<section className="flex flex-col gap-3">
			<div className="flex items-center justify-between">
				<h3 className="text-sm font-semibold">Типы областей</h3>
				<Button
					isDisabled={readOnly}
					onPress={() => {
						let n = 1;
						while (groups[`area${n}`]) n++;
						const key = `area${n}`;
						onChange({
							...definition,
							groups: {
								...groups,
								[key]: {
									title: `Область ${n}`,
									collection: `/${key}`,
									key: "/name",
									accepts: Object.keys(definition.nodes),
								},
							},
						});
					}}
				>
					Добавить область
				</Button>
			</div>
			<p className="text-xs text-slate-500">
				Область хранится отдельной записью в values. Её параметры задаются
				схемой коллекции и формой свойств.
			</p>
			<TextField
				label="Название общей области"
				value={typeof definition.ungroupedTitle === "string" ? definition.ungroupedTitle : "Ресурсы"}
				isDisabled={readOnly}
				onChange={(ungroupedTitle) =>
					onChange({ ...definition, ungroupedTitle })
				}
			/>
			{Object.entries(groups).map(([kind, spec]) => {
				if (
					!object(spec) ||
					!Array.isArray(spec.accepts) ||
					["title", "collection", "key", "label", "form", "acceptsField"].some(
						(k) => spec[k] !== undefined && typeof spec[k] !== "string",
					)
				)
					return (
						<p key={kind} role="alert">
							Исправьте область {kind} в View JSON.
						</p>
					);
				return (
					<fieldset
						key={kind}
						disabled={readOnly}
						className="flex min-w-0 flex-col gap-3 rounded-md border border-slate-200 p-3"
					>
						<div className="flex justify-between gap-2">
							<span className="text-xs text-slate-500">{kind}</span>
							<Button
								isDisabled={
									readOnly ||
									Object.values(definition.nodes).some(
										(n) => n?.group?.type === kind,
									)
								}
								onPress={() => {
									const next = { ...groups };
									delete next[kind];
									onChange({ ...definition, groups: next });
								}}
							>
								Удалить
							</Button>
						</div>
						<TextField
							label="Название типа области"
							value={spec.title ?? ""}
							onChange={(title) => change(kind, { title })}
						/>
						<TextField
							label="Коллекция областей"
							description="Например, /namespaces."
							value={spec.collection}
							onChange={(collection) => change(kind, { collection })}
						/>
						<TextField
							label="Ключ области"
							value={spec.key}
							onChange={(key) => change(kind, { key })}
						/>
						<TextField
							label="Поле названия области"
							value={spec.label ?? ""}
							onChange={(label) => change(kind, { label: label || undefined })}
						/>
						<Select
							label="Форма параметров области"
							selectedKey={spec.form ?? ""}
							options={forms}
							onSelectionChange={(form) =>
								change(kind, { form: form || undefined })
							}
						/>
						<fieldset className="flex flex-col gap-2">
							<legend className="mb-2 text-sm font-medium">
								Разрешённые типы узлов
							</legend>
							{Object.entries(definition.nodes).map(([nodeKind, node]) => (
								<label
									key={nodeKind}
									className="flex items-center gap-2 text-sm"
								>
									<input
										type="checkbox"
										checked={spec.accepts.includes(nodeKind)}
										onChange={(e) =>
											change(kind, {
												accepts: e.target.checked
													? [...spec.accepts, nodeKind]
													: spec.accepts.filter((k) => k !== nodeKind),
											})
										}
									/>
									{typeof node?.title === "string" ? node.title : nodeKind}
								</label>
							))}
						</fieldset>
						<TextField
							label="Поле ограничений экземпляра"
							description="Необязательно: путь к массиву ID типов, например /allowedKinds. Отсутствующее поле разрешает все отмеченные выше типы, пустой массив запрещает все."
							value={spec.acceptsField ?? ""}
							onChange={(acceptsField) =>
								change(kind, { acceptsField: acceptsField || undefined })
							}
						/>
					</fieldset>
				);
			})}
		</section>
	);
}
