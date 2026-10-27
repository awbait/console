import { Button, Select, TextField } from "@/components/ui";
import { object, type CardDisplay } from "./model";

export function CardDesigner({
	value: input = {},
	onChange,
	readOnly,
	grouped = false,
}: {
	value?: CardDisplay;
	onChange: (display: CardDisplay) => void;
	readOnly: boolean;
	grouped?: boolean;
}) {
	if (
		!object(input) ||
		["tone", "subtitle", "group"].some(
			(key) => input[key] !== undefined && typeof input[key] !== "string",
		) ||
		(input.rows !== undefined &&
			(!Array.isArray(input.rows) ||
				input.rows.some(
					(row) =>
						!object(row) ||
						["id", "label", "field"].some(
							(key) => typeof row[key] !== "string",
						),
				)))
	) {
		return <p role="alert">Исправьте формат display в View JSON.</p>;
	}
	const value = input as CardDisplay;
	const rows = Array.isArray(value.rows) ? value.rows : [];
	return (
		<details className="rounded-md border border-slate-200 p-2">
			<summary className="cursor-pointer text-sm font-medium">
				Карточка и группировка
			</summary>
			<div className="mt-3 flex flex-col gap-3">
				<Select
					label="Акцент типа"
					selectedKey={value.tone ?? "neutral"}
					options={[
						{ id: "neutral", label: "Обычный" },
						{ id: "accent", label: "Акцентный" },
						{ id: "muted", label: "Приглушённый" },
						{ id: "warn", label: "Предупреждение" },
					]}
					onSelectionChange={(tone) =>
						onChange({ ...value, tone: tone as CardDisplay["tone"] })
					}
				/>
				<TextField
					label="Поле подзаголовка"
					description="Например, /image."
					value={value.subtitle ?? ""}
					onChange={(subtitle) =>
						onChange({ ...value, subtitle: subtitle || undefined })
					}
				/>
				{!grouped && (
					<TextField
						label="Поле группы"
						description="Одинаковые значения, например /namespace, объединяют узлы в рамку."
						value={value.group ?? ""}
						onChange={(group) =>
							onChange({ ...value, group: group || undefined })
						}
					/>
				)}
				<p className="text-xs text-slate-500">
					Строки показывают поля записи. К каждой строке можно подключить связь.
				</p>
				{rows.map((row, index) => {
					const change = (patch: Partial<typeof row>) =>
						onChange({
							...value,
							rows: rows.map((r, i) => (i === index ? { ...r, ...patch } : r)),
						});
					return (
						<fieldset
							key={index}
							className="flex flex-col gap-2 rounded-md bg-app p-2"
						>
							<TextField
								label="ID строки"
								value={row.id}
								onChange={(id) => change({ id })}
							/>
							<TextField
								label="Подпись строки"
								value={row.label}
								onChange={(label) => change({ label })}
							/>
							<TextField
								label="Поле значения"
								value={row.field}
								onChange={(field) => change({ field })}
							/>
							<Button
								isDisabled={readOnly}
								onPress={() =>
									onChange({
										...value,
										rows: rows.filter((_, i) => i !== index),
									})
								}
							>
								Удалить строку
							</Button>
						</fieldset>
					);
				})}
				<Button
					isDisabled={readOnly}
					onPress={() => {
						let n = 1;
						while (rows.some((r) => r.id === `row${n}`)) n++;
						onChange({
							...value,
							rows: [
								...rows,
								{ id: `row${n}`, label: `Поле ${n}`, field: "/name" },
							],
						});
					}}
				>
					Добавить строку
				</Button>
			</div>
		</details>
	);
}
