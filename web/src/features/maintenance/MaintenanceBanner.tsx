import { IconClock, IconTool, IconX } from "@tabler/icons-react";
import { useRef, useState } from "react";
import { Button as AriaButton } from "react-aria-components";
import { Link } from "react-router-dom";
import { usePlatformHealth } from "../../app/PlatformHealthContext";
import { useUser } from "../../auth/UserContext";
import { maintenanceText as t } from "./text";
import { when, whenOrNull } from "./when";

// MaintenanceBanner is the maintenance line above every page. Before the start
// everybody reads when it begins and can close it for that start; while it is
// on only admins are still here, and they read that it is on and where to end
// it, without a way to close it: an admin who forgets it is on keeps everybody
// else locked out.
//
// Built like its neighbours (PlatformHealthBanner, NewVersionBanner): always
// mounted, opened and closed as a grid row, so a poll that changes it does not
// shove the page.
export function MaintenanceBanner() {
  const { maintenance: m } = usePlatformHealth();
  const { user } = useUser();
  const isAdmin = user?.role === "admin";
  // Dismissal is per start time and lives in the page: a moved start is news.
  const [dismissed, setDismissed] = useState<string | null>(null);

  const scheduled = m?.state === "scheduled" && !!m.starts_at && dismissed !== m.starts_at;
  const adminActive = m?.state === "active" && isAdmin;
  const shown = scheduled || adminActive;

  let body: string | null = null;
  if (m && scheduled && m.starts_at) {
    body = t.bannerScheduled(when(m.starts_at), whenOrNull(m.ends_at));
  } else if (m && adminActive) {
    // A window always has a start; maintenance with none was switched on by the
    // server configuration, which the public answer does not name otherwise.
    body = !m.starts_at ? t.bannerAdminForced : m.overdue ? t.bannerAdminOverdue : t.bannerAdminActive(whenOrNull(m.ends_at));
  }

  // The banner folds away rather than vanishing, so it keeps saying what it
  // opened with while it closes.
  const lastBody = useRef("");
  if (body) lastBody.current = body;

  const tone = adminActive
    ? "border-amber-200 bg-amber-50 text-amber-900"
    : "border-brand-200 bg-brand-50 text-slate-700";

  return (
    <div
      className={`grid shrink-0 transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${
        shown ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
      }`}
    >
      <div className="overflow-hidden">
        <div
          aria-hidden={!shown}
          className={`mb-5 flex items-start gap-3 rounded-lg border p-4 text-sm transition-opacity motion-reduce:transition-none ${tone} ${
            shown ? "opacity-100 duration-200 delay-150" : "opacity-0 duration-100"
          }`}
        >
          {adminActive ? (
            <IconTool size={20} stroke={1.8} className="mt-0.5 shrink-0 text-amber-600" />
          ) : (
            <IconClock size={20} stroke={1.8} className="mt-0.5 shrink-0 text-brand-600" />
          )}
          <div className="min-w-0 flex-1">
            {/* "status", not "alert": the poll can raise this while the person
                is typing, and they should hear it at the next pause. */}
            <p role="status" className="font-medium">
              {body ?? lastBody.current}
            </p>
            {scheduled && <p className="mt-1">{t.bannerScheduledHint}</p>}
            {adminActive && (
              <Link
                to="/admin/maintenance"
                tabIndex={shown ? undefined : -1}
                className="mt-2 inline-block rounded font-medium text-amber-800 underline underline-offset-2 outline-none hover:text-amber-950 focus-visible:ring-2 focus-visible:ring-amber-600"
              >
                {t.bannerAdminLink}
              </Link>
            )}
          </div>
          {scheduled && (
            <AriaButton
              onPress={() => setDismissed(m?.starts_at ?? null)}
              excludeFromTabOrder={!shown}
              aria-label="Скрыть предупреждение"
              className="-mr-1 -mt-1 shrink-0 rounded-md p-1.5 text-slate-500 outline-none transition-colors hover:bg-brand-100 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-brand-500 motion-reduce:transition-none"
            >
              <IconX size={16} stroke={2} />
            </AriaButton>
          )}
        </div>
      </div>
    </div>
  );
}
