import { IconAlertTriangle, IconCheck, IconCircleCheck, IconX } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Popover } from "react-aria-components";
import { Link } from "react-router-dom";
import { usePlatformHealth } from "../app/PlatformHealthContext";
import { useUser } from "../auth/UserContext";

// How long the popover survives the pointer leaving the icon. Enough to cross
// the gap between the two without the panel disappearing mid-move.
const CLOSE_DELAY_MS = 150;

// The always-on half of the outage story: a single icon in the topbar that says
// whether the platform is whole, and opens the breakdown of what works and what
// does not. It stays lit after the banner is dismissed, so a user who closed the
// banner can still find out what is going on.
//
// It opens on hover and on click, and hovering the panel itself keeps it open -
// pointing at the icon is the natural gesture, but the panel can hold a link
// (the admin's status page), which a tooltip could never let anyone reach.
export function PlatformHealthIndicator() {
  const { capabilities, degraded, unknown } = usePlatformHealth();
  const { user } = useUser();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  }, [cancelClose]);
  useEffect(() => cancelClose, [cancelClose]);

  // Nothing to report yet (first load, or the portal cannot reach its own
  // backend): an empty topbar beats a traffic light of unknown colour.
  if (unknown || capabilities.length === 0) return null;

  const broken = degraded.length > 0;
  const working = capabilities.filter((c) => c.ok);
  const label = broken ? "В работе платформы есть проблемы" : "Платформа работает";

  return (
    <>
      <Button
        ref={triggerRef}
        aria-label={label}
        aria-expanded={open}
        onPress={() => setOpen((o) => !o)}
        onHoverStart={() => {
          cancelClose();
          setOpen(true);
        }}
        onHoverEnd={scheduleClose}
        onFocus={() => setOpen(true)}
        onBlur={scheduleClose}
        className={`rounded-md p-2 outline-none transition-colors duration-300 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-500 motion-reduce:transition-none ${
          broken ? "text-amber-600" : "text-emerald-600"
        }`}
      >
        {/* The two icons cross-fade in place instead of being swapped: a poll
            can land at any moment, and a glyph that pops is read as a glitch,
            not as news. */}
        <span aria-hidden className="relative block h-5 w-5">
          <IconCircleCheck
            size={20}
            stroke={1.7}
            className={`absolute inset-0 transition-opacity duration-300 motion-reduce:transition-none ${
              broken ? "opacity-0" : "opacity-100"
            }`}
          />
          <IconAlertTriangle
            size={20}
            stroke={1.8}
            className={`absolute inset-0 transition-opacity duration-300 motion-reduce:transition-none ${
              broken ? "opacity-100" : "opacity-0"
            }`}
          />
        </span>
      </Button>
      <Popover
        triggerRef={triggerRef}
        isOpen={open}
        onOpenChange={setOpen}
        // Non-modal: the indicator is a status readout, not a task. It must not
        // dim the page or pull focus out of whatever the user was typing.
        isNonModal
        placement="bottom end"
        offset={8}
        aria-label="Состояние платформы"
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
        className="w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-surface p-3 text-sm shadow-lg outline-none entering:animate-in entering:fade-in entering:zoom-in-95"
      >
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Состояние платформы
        </p>

        {broken ? (
          <ul className="flex flex-col gap-2">
            {degraded.map((c) => (
              <li key={c.id} className="flex items-start gap-2">
                <IconX size={16} stroke={2.2} className="mt-0.5 shrink-0 text-amber-600" />
                <span className="min-w-0">
                  <span className="block font-medium text-slate-800">{c.label}</span>
                  <span className="block text-xs text-slate-500">{c.impact}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-slate-600">Все возможности портала доступны.</p>
        )}

        {broken && working.length > 0 && (
          <>
            <div className="my-2.5 border-t border-slate-100" />
            <p className="mb-1.5 text-xs font-medium text-slate-400">Работает как обычно</p>
            <ul className="flex flex-col gap-1">
              {working.map((c) => (
                <li key={c.id} className="flex items-center gap-2 text-slate-600">
                  <IconCheck size={16} stroke={2.2} className="shrink-0 text-emerald-600" />
                  {c.label}
                </li>
              ))}
            </ul>
          </>
        )}

        {user?.role === "admin" && (
          <Link
            to="/admin/status"
            onClick={() => setOpen(false)}
            className="mt-3 block rounded-md text-xs font-medium text-brand-600 outline-none hover:text-brand-700 hover:underline focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            Подробное состояние платформы
          </Link>
        )}
      </Popover>
    </>
  );
}
