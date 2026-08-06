// Product text for API failures.
//
// The backend answers with a code and, for some of them, a message. Those
// messages are written for the domain, not for the person reading the screen:
// they are English, technical, and sometimes just the internal error chain
// ("upstream unavailable: harbor: dial tcp ..."). A code with no message is
// worse - the UI used to print the bare word "internal".
//
// So the wording lives here, next to the code that decides which failure it is,
// and the server message is shown only where it is genuinely addressed to the
// user. The technical detail is not lost: HttpError keeps `code` and `status`
// for logs and for screens that show a debug line.

// Codes whose server message is meant for the user and is more specific than
// anything written here: field-level validation, a name already taken, the open
// merge request blocking a change.
const KEEP_SERVER_MESSAGE = new Set(["validation_failed", "conflict", "open_mr"]);

const BY_CODE: Record<string, string> = {
  // Any upstream: the registry, the git server, the delivery system. Which one
  // it was does not change what the user can do, so the text does not name it.
  upstream_unavailable: "Часть платформы сейчас не отвечает. Попробуйте повторить через минуту.",
  internal: "Что-то пошло не так на нашей стороне. Попробуйте обновить страницу.",
  not_found: "Мы не нашли то, что вы открыли. Возможно, это уже удалили.",
  forbidden: "У вас нет доступа к этому разделу.",
  unauthorized: "Сессия закончилась. Войдите заново.",
};

// apiErrorText turns one API failure into a sentence for the user.
export function apiErrorText(code: string, status: number, serverMessage?: string): string {
  if (serverMessage && KEEP_SERVER_MESSAGE.has(code)) return serverMessage;
  const known = BY_CODE[code];
  if (known) return known;
  // An unknown code with a message: the message is the better guess of the two.
  if (serverMessage) return serverMessage;
  if (status >= 500) return BY_CODE.internal;
  return "Не удалось выполнить запрос. Попробуйте ещё раз.";
}

// Hint explaining what a failure means for the user right here. The message
// above says what happened, the hint says what it costs - together they stop a
// broken catalog from reading as a broken portal.
export const CATALOG_DOWN_HINT =
  "Пока каталог не отвечает, заказать сервис не получится. Уже созданные заказы открываются как обычно.";
