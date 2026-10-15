import { IconDeviceFloppy, IconLogout, IconMessageCircle, IconTool } from "@tabler/icons-react";
import { api } from "../../api/client";
import type { MaintenancePublic } from "../../api/types";
import { safeHref } from "../../lib/href";
import { maintenanceText as t } from "./text";
import { when } from "./when";

// MaintenanceLock is the portal for everybody but platform admins while
// maintenance is on: one screen in place of the shell, like the sign-in screen.
// The menu and the pages behind it would only lead to more refusals.
//
// It needs no button to leave: the poll that brought it takes it away, and the
// address underneath never changed, so the person is back where they were.
export function MaintenanceLock({
  maintenance: m,
  formSaved,
  supportChatUrl,
}: {
  maintenance: MaintenancePublic | null;
  // An unfinished order form was put in this browser on the way here.
  formSaved: boolean;
  supportChatUrl?: string;
}) {
  const chat = safeHref(supportChatUrl);
  const end = m?.overdue ? t.lockOverdue : m?.ends_at ? t.lockUntil(when(m.ends_at)) : t.lockNoEnd;
  return (
    <main className="flex min-h-screen items-center justify-center bg-app px-6 py-12">
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-surface p-8 shadow-sm">
        <p className="text-2xl font-bold lowercase leading-none tracking-tight text-brand-600">console</p>
        <div className="mt-8 flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
            <IconTool size={22} stroke={1.8} />
          </span>
          <h1 className="text-xl font-semibold text-slate-900">{t.lockTitle}</h1>
        </div>
        {/* "status": the screen arrives on its own, under whatever the person
            was doing, and is read out at the next pause. */}
        <div role="status" className="mt-5 space-y-3 text-sm leading-relaxed text-slate-700">
          {m?.message && (
            <p className="whitespace-pre-line rounded-lg border border-slate-200 bg-slate-50 p-4 text-slate-800">
              {m.message}
            </p>
          )}
          <p className="font-medium text-slate-900">{end}</p>
          <p>{t.lockReturn}</p>
        </div>
        {formSaved && (
          <p className="mt-4 flex items-start gap-2 rounded-lg border border-brand-200 bg-brand-50 p-3 text-sm text-slate-700">
            <IconDeviceFloppy size={18} stroke={1.8} className="mt-0.5 shrink-0 text-brand-600" />
            <span>{t.lockFormSaved}</span>
          </p>
        )}
        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-100 pt-4 text-sm">
          {chat && (
            <a
              href={chat}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded font-medium text-brand-700 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <IconMessageCircle size={16} stroke={1.8} />
              {t.lockSupport}
            </a>
          )}
          <a
            href={api.logoutUrl()}
            className="inline-flex items-center gap-1.5 rounded text-slate-500 outline-none hover:text-slate-800 hover:underline focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <IconLogout size={16} stroke={1.8} />
            {t.lockSignOut}
          </a>
        </div>
      </div>
    </main>
  );
}
