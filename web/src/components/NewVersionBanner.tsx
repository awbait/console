import { IconInfoCircle, IconX } from "@tabler/icons-react";
import { useState } from "react";
import { Button as AriaButton } from "react-aria-components";
import { Link } from "react-router-dom";
import { usePortalUpdate } from "../hooks/usePortalUpdate";
import { isRelease, releaseAnchor } from "../lib/release";
import { Button } from "./ui";

// NewVersionBanner tells a page that has outlived its portal to reload (see
// lib/portalVersion.ts). It asks, and never reloads by itself: the person may be
// halfway through an order, and a reload would throw their input away.
//
// Built like PlatformHealthBanner, its neighbour above every page: always
// mounted, opened and closed as a grid row, so it does not shove the page down
// in one jump the moment a check lands.
export function NewVersionBanner() {
  const fresh = usePortalUpdate();
  // Dismissal is per version and lives in the page: closing it says "not now"
  // about this release, and a later one is news again.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const shown = fresh !== null && dismissed !== fresh;

  return (
    <div
      className={`grid shrink-0 transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${
        shown ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
      }`}
    >
      <div className="overflow-hidden">
        <div
          aria-hidden={!shown}
          className={`mb-5 flex items-start gap-3 rounded-lg border border-brand-200 bg-brand-50 p-4 text-sm text-slate-700 transition-opacity motion-reduce:transition-none ${
            shown ? "opacity-100 duration-200 delay-150" : "opacity-0 duration-100"
          }`}
        >
          <IconInfoCircle size={20} stroke={1.8} className="mt-0.5 shrink-0 text-brand-600" />
          <div className="min-w-0 flex-1">
            {/* "status", not "alert": the check can land while the person is
                typing, and they should hear it at the next pause. */}
            <p role="status">
              <span className="font-medium text-slate-900">Доступна новая версия портала.</span> Завершите и
              сохраните работу в формах, затем обновите страницу. При обновлении несохранённые данные будут
              удалены.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <Button variant="primary" excludeFromTabOrder={!shown} onPress={() => window.location.reload()}>
                Обновить страницу
              </Button>
              {fresh && isRelease(fresh) && (
                <Link
                  to={`/about#${releaseAnchor(fresh)}`}
                  tabIndex={shown ? undefined : -1}
                  className="rounded font-medium text-brand-700 underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  Что нового
                </Link>
              )}
            </div>
          </div>
          <AriaButton
            onPress={() => setDismissed(fresh)}
            excludeFromTabOrder={!shown}
            aria-label="Скрыть предупреждение"
            className="-mr-1 -mt-1 shrink-0 rounded-md p-1.5 text-slate-500 outline-none transition-colors hover:bg-brand-100 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-brand-500 motion-reduce:transition-none"
          >
            <IconX size={16} stroke={2} />
          </AriaButton>
        </div>
      </div>
    </div>
  );
}
