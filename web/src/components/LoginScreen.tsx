import { IconLogin } from "@tabler/icons-react";
import { api } from "../api/client";
import { LoginScene } from "./LoginScene";

// The sign-in screen is the only page drawn outside the shell. It splits in
// two: what the portal does (see LoginScene) and the one way in.
export function LoginScreen() {
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
          <a
            href={api.loginUrl(window.location.pathname + window.location.search)}
            className="mt-8 flex h-11 w-full items-center justify-center gap-2 rounded-md bg-brand-600 px-4 text-sm font-medium text-on-accent outline-none transition-colors hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 motion-reduce:transition-none"
          >
            <IconLogin size={20} stroke={1.7} />
            Войти через Keycloak
          </a>
        </div>
      </div>
    </div>
  );
}
