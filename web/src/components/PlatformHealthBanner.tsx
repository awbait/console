import { IconAlertTriangle, IconX } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Button } from "react-aria-components";
import { usePlatformHealth } from "../app/PlatformHealthContext";

// The banner is the loud half of the outage story, and it says one thing: the
// platform is not whole right now and someone is on it. What exactly stopped
// working belongs to the topbar indicator, which lists it capability by
// capability - a banner that recites the whole list is a wall of text above
// every page, and the user still has to guess what to do with it.
//
// Dismissal is keyed by *what* is broken, not by "the user closed a banner": if
// the registry recovers and the git server goes down instead, that is news
// again and the banner comes back on its own. It is also forgotten when the
// platform recovers and when the page is reloaded - see below.
export function PlatformHealthBanner() {
  const { degraded } = usePlatformHealth();
  // Dismissal lives in the page, not in storage: "I have seen this" is true for
  // as long as the user keeps working, not forever. Stored, it silenced every
  // later outage with the same set of broken capabilities - the second time the
  // registry went down the banner never came back, even though it was news
  // again.
  const [dismissedKey, setDismissedKey] = useState("");

  const key = degraded
    .map((c) => c.id)
    .sort()
    .join(",");
  const shown = degraded.length > 0 && dismissedKey !== key;

  // A recovery clears the dismissal, so the next outage speaks up even if it
  // breaks exactly the same things.
  useEffect(() => {
    if (degraded.length === 0) setDismissedKey("");
  }, [degraded.length]);

  // The banner stays mounted and opens/closes as a grid row (0fr -> 1fr): a
  // conditional render would make the page jump the moment a poll lands under
  // the user's hands. Same trick the sidebar uses for its collapsing card.
  return (
    <div
      className={`grid shrink-0 transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${
        shown ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
      }`}
    >
      <div className="overflow-hidden">
        <div
          aria-hidden={!shown}
          className={`mb-5 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 transition-opacity motion-reduce:transition-none ${
            shown ? "opacity-100 duration-200 delay-150" : "opacity-0 duration-100"
          }`}
        >
          <IconAlertTriangle size={20} stroke={1.8} className="mt-0.5 shrink-0 text-amber-600" />
          {/* Not role="alert": the poll can raise this while the user is typing,
              and an assertive live region would interrupt them mid-field.
              "status" is announced politely, at the next pause. */}
          <p role="status" className="min-w-0 flex-1">
            <span className="font-medium">В работе платформы есть проблемы,</span> мы уже их
            устраняем. Подробности - по значку в верхней панели.
          </p>
          <Button
            onPress={() => setDismissedKey(key)}
            excludeFromTabOrder={!shown}
            aria-label="Скрыть предупреждение"
            className="-mr-1 -mt-1 shrink-0 rounded-md p-1.5 text-amber-600 outline-none transition-colors hover:bg-amber-100 hover:text-amber-800 focus-visible:ring-2 focus-visible:ring-amber-600 motion-reduce:transition-none"
          >
            <IconX size={16} stroke={2} />
          </Button>
        </div>
      </div>
    </div>
  );
}
