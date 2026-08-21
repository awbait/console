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
// anything written here: field-level validation and a name already taken.
const KEEP_SERVER_MESSAGE = new Set(["validation_failed", "conflict"]);

const BY_CODE: Record<string, string> = {
  // Any upstream: the registry, the git server, the delivery system. Which one
  // it was does not change what the user can do, so the text does not name it.
  // What that outage costs is told by the platform banner and the topbar
  // indicator (see app/capabilities.ts); this line only says the request failed.
  upstream_unavailable: "Не удалось выполнить запрос: часть платформы сейчас не отвечает.",
  // The upstream answered and refused: something in the platform's own setup is
  // missing for this team. It looks like an outage from here and is not one, so
  // this is the one failure the portal tells the user not to retry - waiting
  // changes nothing until a person finishes the setup.
  not_configured:
    "Платформа ещё не настроена для вашей команды, поэтому запрос не прошёл. Повторная попытка не поможет, напишите в поддержку платформы.",
  internal: "Что-то пошло не так на нашей стороне. Попробуйте обновить страницу.",
  not_found: "Мы не нашли то, что вы открыли. Возможно, это уже удалили.",
  forbidden: "У вас нет доступа к этому разделу.",
  unauthorized: "Сессия закончилась. Войдите заново.",
  // A change of this service is still on its way (the backend answers 409
  // open_mr). Its own message names the merge request that blocks it, which is
  // how the portal records a change and not something the person asked for.
  open_mr: changeInFlightText(),
};

// A service whose previous change has not landed yet refuses the next one. Every
// screen that runs into it says so in one voice, from here - the banner on the
// order page, the graph that cannot be drawn on, the delete that loses the race.
//
// The wording is the same the graph uses (features/orders/orderGraph.ts): from
// where the person stands they saved their service, and saving is still going
// on. The merge request behind it, and its number, are the portal's own
// bookkeeping - support and admin reach them from the order's history.
export function changeInFlightText(action: "change" | "delete" = "change"): string {
  const tail =
    action === "delete"
      ? "Удалить сервис можно будет, когда оно применится."
      : "Дождитесь, пока оно применится, и повторите.";
  return `Предыдущее изменение этого сервиса ещё сохраняется. ${tail}`;
}

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

// A failure's cost to the user is no longer written here: it belongs to the
// capability that broke, so every screen tells the same story as the platform
// banner. Pass CAPABILITIES.<id>.impact (app/capabilities.ts) as the ErrorBox
// hint - e.g. CAPABILITIES.catalog.impact on the catalog pages.
