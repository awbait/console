import { IconAlertTriangle, IconLogin } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { usePlatformHealth } from "../app/PlatformHealthContext";
import { LoginScene } from "./LoginScene";

// A login that did not go through sends the browser back here with a reason.
// The portal knows the technical detail and writes it to its own log; what
// belongs on screen is what happened and what to do about it, which for all of
// these is the same button, right below.
const LOGIN_ERRORS: Record<string, { title: string; text: string }> = {
  start: {
    title: "Не удалось начать вход",
    text: "Попробуйте ещё раз.",
  },
  state: {
    title: "Вход не завершён",
    text: "Страница входа была открыта слишком долго или вы вернулись по старой ссылке. Начните вход заново.",
  },
  provider: {
    title: "Keycloak не пропустил вход",
    text: "Вход отменён или у вашей учётной записи нет доступа к порталу. Если доступ нужен, обратитесь к администратору платформы.",
  },
  exchange: {
    title: "Вход не завершён",
    text: "Keycloak не ответил порталу. Попробуйте ещё раз, а если повторится, сообщите администратору платформы.",
  },
  identity: {
    title: "Вход не подтверждён",
    text: "Ответ Keycloak не прошёл проверку. Начните вход заново.",
  },
  session: {
    title: "Портал не смог сохранить вход",
    text: "Попробуйте ещё раз, а если повторится, сообщите администратору платформы.",
  },
};

const FALLBACK_ERROR = { title: "Вход не завершён", text: "Попробуйте ещё раз." };

// Why the way in is closed right now. Two different situations end in the same
// closed button, and the person can do different things about them: one is on
// the platform's side and being worked on, the other may pass by itself.
const OFFLINE = {
  title: "Вход временно недоступен",
  text: "Портал не отвечает. Попробуйте обновить страницу через несколько минут.",
};

const DEGRADED = {
  title: "Вход временно недоступен",
  text: "В работе платформы есть проблемы, мы уже их устраняем.",
};

const ERROR_PARAM = "auth_error";

// useLoginFailure reads the reason off the address and then takes it off the
// address: it belongs to the attempt that just failed, not to the page. Left
// there, it would come back on a reload, and it would ride along in the
// return-to of the next attempt - the person would land on a fresh session
// still being told the last one failed.
function useLoginFailure() {
  const [reason] = useState(() => new URLSearchParams(window.location.search).get(ERROR_PARAM));
  useEffect(() => {
    if (reason) window.history.replaceState(null, "", returnTo());
  }, [reason]);
  if (!reason) return null;
  return LOGIN_ERRORS[reason] ?? FALLBACK_ERROR;
}

// returnTo is where signing in should land: this page, minus the failure of the
// previous attempt.
function returnTo(): string {
  const params = new URLSearchParams(window.location.search);
  params.delete(ERROR_PARAM);
  const query = params.toString();
  return window.location.pathname + (query ? `?${query}` : "");
}

// The sign-in screen is the only page drawn outside the shell. It splits in
// two: what the portal does (see LoginScene) and the one way in.
export function LoginScreen() {
  // Signing in goes through Keycloak and nothing else, so when Keycloak is down
  // the button leads to a broken page of someone else's making. Better to say so
  // here than to hand the user off to a blank screen.
  //
  // The portal not answering closes the button for the same reason. Elsewhere an
  // unreachable portal leaves the actions open, because a request that fails
  // says so on the spot; here the press leaves the interface for an address that
  // answers nothing, and the person is left on the browser's error page with no
  // way back in.
  const { ok, reachable } = usePlatformHealth();
  const blocked = !reachable ? OFFLINE : ok("sign_in") ? undefined : DEGRADED;
  const canSignIn = !blocked;
  // The explanation folds away rather than disappearing, so it needs something
  // to say while it closes. Keeping the last reason means the box that is going
  // away still shows the one it opened with.
  const lastBlocked = useRef(DEGRADED);
  if (blocked) lastBlocked.current = blocked;
  const shown = blocked ?? lastBlocked.current;
  const failure = useLoginFailure();

  return (
    <div className="flex min-h-screen bg-app">
      {/* The scene is decoration and costs width, so it only appears once there
          is width to spare; below that the panel is the whole page. */}
      <div className="relative hidden flex-1 lg:block">
        <LoginScene />
      </div>

      <div className="flex w-full shrink-0 items-center justify-center border-slate-200 bg-surface px-6 py-12 lg:w-[440px] lg:border-l">
        <div className="w-full max-w-xs">
          {/* The topbar wordmark, set larger: the page has nothing else to
              carry the product's name. */}
          <h1 className="text-4xl font-bold lowercase leading-none tracking-tight text-brand-600">
            console
          </h1>
          <p className="mt-3 text-sm text-slate-500">Заказ и управление сервисами платформы</p>

          {/* A failed attempt is stated above the button, in the order it is
              lived: this is what happened, and here is the way out of it. The
              outage warning stays below the button, because it is about whether
              the button works at all. role=alert, not status: this appeared
              because of something the person just did. */}
          {failure && (
            <div
              role="alert"
              className="mt-8 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
            >
              <IconAlertTriangle size={18} stroke={1.8} className="mt-0.5 shrink-0 text-red-500" />
              <span>
                <span className="block font-medium">{failure.title}</span>
                <span className="mt-0.5 block">{failure.text}</span>
              </span>
            </div>
          )}

          {/* One element in both states rather than two: dropping the href is
              what makes it unclickable and untabbable, and keeping the same
              node lets the colours cross-fade when a poll changes the verdict,
              instead of the button blinking in place. */}
          <a
            href={canSignIn ? api.loginUrl(returnTo()) : undefined}
            aria-disabled={!canSignIn}
            className={`${failure ? "mt-4" : "mt-8"} flex h-11 w-full items-center justify-center gap-2 rounded-md px-4 text-sm font-medium outline-none transition-colors duration-300 focus-visible:ring-2 focus-visible:ring-brand-500 motion-reduce:transition-none ${
              canSignIn
                ? "bg-brand-600 text-on-accent hover:bg-brand-700"
                : "cursor-not-allowed bg-slate-100 text-slate-400"
            }`}
          >
            <IconLogin size={20} stroke={1.7} />
            Войти через Keycloak
          </a>

          {/* The explanation opens and closes with the outage (grid 0fr -> 1fr),
              so the panel never jumps when a poll lands. */}
          <div
            className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${
              canSignIn ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
            }`}
          >
            <div className="overflow-hidden">
              <div
                role="status"
                aria-hidden={canSignIn}
                className={`mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 transition-opacity motion-reduce:transition-none ${
                  canSignIn ? "opacity-0 duration-100" : "opacity-100 delay-150 duration-200"
                }`}
              >
                <IconAlertTriangle
                  size={18}
                  stroke={1.8}
                  className="mt-0.5 shrink-0 text-amber-600"
                />
                <span>
                  <span className="block font-medium">{shown.title}</span>
                  <span className="mt-0.5 block">{shown.text}</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
