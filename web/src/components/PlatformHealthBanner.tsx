import { IconAlertTriangle, IconX } from "@tabler/icons-react";
import { Button } from "react-aria-components";
import { usePlatformHealth } from "../app/PlatformHealthContext";
import { useStored } from "../hooks/useStored";

// The banner is the loud half of the outage story: it sits above the page the
// user is working on and says, in the portal's own terms, what stopped working
// and what still does. The quiet half is the topbar indicator, which stays lit
// after the banner is dismissed (see PlatformHealthIndicator).
//
// Dismissal is keyed by *what* is broken, not by "the user closed a banner": if
// the registry recovers and the git server goes down instead, that is news
// again and the banner comes back on its own.
export function PlatformHealthBanner() {
  const { degraded } = usePlatformHealth();
  const [dismissed, setDismissed] = useStored("platform-health.dismissed", "");

  const key = degraded
    .map((c) => c.id)
    .sort()
    .join(",");
  if (degraded.length === 0 || dismissed === key) return null;

  return (
    <div
      // Not role="alert": the poll can raise this while the user is typing, and
      // an assertive live region would interrupt them mid-field. "status" is
      // announced politely, at the next pause.
      role="status"
      className="mb-5 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 animate-in fade-in slide-in-from-top-1 duration-300 motion-reduce:animate-none"
    >
      <IconAlertTriangle size={20} stroke={1.8} className="mt-0.5 shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">В работе платформы есть проблемы</p>
        <ul className="mt-1.5 flex flex-col gap-1">
          {degraded.map((c) => (
            <li key={c.id}>
              <span className="font-medium">{c.label}.</span> {c.impact}
            </li>
          ))}
        </ul>
      </div>
      <Button
        onPress={() => setDismissed(key)}
        aria-label="Скрыть предупреждение"
        className="-mr-1 -mt-1 shrink-0 rounded-md p-1.5 text-amber-600 outline-none transition-colors hover:bg-amber-100 hover:text-amber-800 focus-visible:ring-2 focus-visible:ring-amber-600 motion-reduce:transition-none"
      >
        <IconX size={16} stroke={2} />
      </Button>
    </div>
  );
}
