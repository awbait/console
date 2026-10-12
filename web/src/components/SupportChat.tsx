// The support chat button in the bottom right corner of every page, the way
// live chats sit on a site. It is only a link: the chat itself lives in a
// messenger (SUPPORT_CHAT_URL), the portal never talks to it.
//
// Now and then a short hint slides out next to the button and hides again, the
// phrases taking turns. Closing the hint keeps it closed in this browser; the
// button stays.

import { IconMessageCircle, IconX } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useUser } from "@/auth/UserContext";
import { safeHref } from "@/lib/href";

const HINTS = [
  "Есть вопросы? Спросите в чате поддержки.",
  "Что-то не работает? Напишите в чат поддержки.",
  "Нужна помощь? Команда платформы ответит в чате.",
];
const BUTTON_LABEL = "Открыть чат поддержки в новой вкладке";
const DISMISS_LABEL = "Скрыть подсказки о чате поддержки";

// First hint shortly after the page opens, then one every couple of minutes:
// often enough to be noticed, rare enough not to nag.
const FIRST_DELAY_MS = 5_000;
const SHOW_MS = 7_000;
const PERIOD_MS = 120_000;

const DISMISSED_KEY = "console.supportChat.hintDismissed";

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function SupportChat() {
  const { user } = useUser();
  const href = safeHref(user?.support_chat_url);
  const [dismissed, setDismissed] = useState(readDismissed);
  const [visible, setVisible] = useState(false);
  const [hint, setHint] = useState(0);

  // Toasts live outside the session and cannot ask it whether the button is
  // there, so the button says so on the body (see ToastRegion).
  useEffect(() => {
    if (!href) return;
    document.body.classList.add("has-support-chat");
    return () => document.body.classList.remove("has-support-chat");
  }, [href]);

  useEffect(() => {
    if (!href || dismissed) return;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    let n = 0;
    const show = () => {
      setHint(n++ % HINTS.length);
      setVisible(true);
      hideTimer = setTimeout(() => setVisible(false), SHOW_MS);
    };
    let interval: ReturnType<typeof setInterval> | undefined;
    const first = setTimeout(() => {
      show();
      interval = setInterval(show, PERIOD_MS);
    }, FIRST_DELAY_MS);
    return () => {
      clearTimeout(first);
      clearTimeout(hideTimer);
      clearInterval(interval);
    };
  }, [href, dismissed]);

  if (!href) return null;

  const dismiss = () => {
    setVisible(false);
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Private mode or blocked storage: the hint just comes back next time.
    }
  };

  return (
    // Same gutters as the shell around the sidebar (px-4 lg:px-6, py-8).
    <div className="pointer-events-none fixed right-4 bottom-8 z-40 flex items-center gap-3 lg:right-6">
      {/* Kept mounted so it can slide out as well as in; invisible takes it
          out of the tab order once hidden. */}
      <div
        className={`flex max-w-72 items-start gap-2 rounded-lg border border-slate-200 bg-surface py-2.5 pr-2 pl-3.5 text-sm text-slate-700 shadow-lg transition-all duration-500 ease-out motion-reduce:translate-x-0 motion-reduce:transition-opacity ${
          visible && !dismissed
            ? "pointer-events-auto visible translate-x-0 opacity-100"
            : "invisible translate-x-4 opacity-0"
        }`}
      >
        <a href={href} target="_blank" rel="noopener noreferrer" className="outline-none">
          {HINTS[hint]}
        </a>
        <button
          type="button"
          onClick={dismiss}
          aria-label={DISMISS_LABEL}
          className="-mt-0.5 shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-2 focus-visible:outline-brand-600"
        >
          <IconX size={14} />
        </button>
      </div>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={BUTTON_LABEL}
        className="pointer-events-auto flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-600 text-on-accent shadow-lg transition-[background-color,box-shadow] duration-200 hover:bg-brand-700 hover:shadow-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 motion-reduce:transition-none"
      >
        <IconMessageCircle size={24} stroke={1.75} />
      </a>
    </div>
  );
}
