// Interface strings of the edit lease on a version document: the banners the
// constructor shows while somebody else holds the document, the hand-over, and
// the label in the versions list.
export const editLeaseText = {
  // Banner over the editor while somebody else holds the document. The page is
  // read-only and follows their saves.
  locked: (name: string) => `Сейчас редактирует ${name}. Текст обновляется автоматически.`,
  // Banner once they let go: the reader may take the document now.
  freed: "Документ свободен. Вы можете начать редактирование.",
  // Button in the "freed" banner.
  takeButton: "Начать редактирование",
  // Banner when the document was taken from this person while they were typing.
  // Their latest changes are not saved and the editor still shows them.
  lost: (name: string) =>
    `Редактирование перешло к ${name}. Последние изменения не сохранены. Скопируйте их, затем покажите текущий текст.`,
  // Same situation, but nobody holds the document now.
  lostNobody:
    "Последние изменения не сохранены. Скопируйте их, затем покажите текущий текст. После этого вы сможете начать редактирование.",
  // Button in the "lost" banners: replace the editor text with the current
  // document.
  showCurrentButton: "Показать текущий текст",
  // Button for an administrator in the "locked" banner.
  takeOverButton: "Забрать редактирование",
  // Confirmation dialog of the take-over: title, body, confirm button.
  takeOverTitle: (name: string) => `Забрать редактирование у ${name}?`,
  takeOverMessage: (name: string) =>
    `После подтверждения у ${name} останется только просмотр. Вы сможете редактировать документ.`,
  takeOverConfirm: "Забрать редактирование",
  // Label on a version in the versions list, and its tooltip.
  editingChip: (name: string) => `Редактирует ${name}`,
  editingTitle: (name: string) => `Сейчас редактирует ${name}.`,
};
