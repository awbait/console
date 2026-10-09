// User-facing wording of a variable's values per stand on the admin page.
// Kept apart from the page so the same words meet the admin wherever a value
// of a stand is named.
export const variableText = {
  pageIntroStands:
    "Задайте общее значение или отдельные значения для стендов. Если общее значение пустое, для каждого стенда без своего значения заказ не сохранится.",
  sharedPlaceholder: "общее значение",
  sharedAria: (name: string) => `Общее значение переменной ${name}`,
  standsToggle: (set: number, total: number) => `Стенды: ${set} из ${total}`,
  standsToggleAria: (name: string) => `Значения переменной ${name} на стендах`,
  overridesHint: "Пустое поле использует общее значение. Своё значение действует только на этом стенде.",
  overridePlaceholder: (shared: string) => `Пустое поле использует общее значение: ${shared}`,
  overrideMissing: "Задайте значение для стенда, иначе заказы не сохранятся.",
  overrideAria: (name: string, stand: string) => `Значение переменной ${name} на стенде ${stand}`,
  clearAria: (name: string, stand: string) => `Удалить значение переменной ${name} для стенда ${stand}`,
  toastOverrideSaved: (name: string, stand: string) => `Значение переменной ${name} для стенда ${stand} сохранено`,
  toastOverrideCleared: (name: string, stand: string) => `Значение переменной ${name} для стенда ${stand} удалено`,
} as const;
