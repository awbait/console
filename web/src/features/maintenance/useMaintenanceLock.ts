import { useEffect, useRef, useState } from "react";
import type { MaintenancePublic, User } from "../../api/types";
import { usePlatformHealth } from "../../app/PlatformHealthContext";
import { saveOpenForms } from "./formStash";

// useMaintenanceLock decides whether the shell gives way to the lock screen.
//
// The swap waits one step on purpose. When the poll says maintenance is on, the
// page is still mounted: the effect below asks every open form to put itself in
// the browser first, and only then does the lock screen replace the page. A swap
// in the same render would unmount the form before anybody could ask it.
export function useMaintenanceLock(user: User | null | undefined): {
  locked: boolean;
  formSaved: boolean;
  maintenance: MaintenancePublic | null;
} {
  const { maintenance } = usePlatformHealth();
  const due = maintenance?.state === "active" && !!user && user.role !== "admin";
  const [locked, setLocked] = useState(false);
  const [formSaved, setFormSaved] = useState(false);
  // The screen keeps what it opened with while the poll that ends it lands.
  const last = useRef<MaintenancePublic | null>(null);
  if (maintenance) last.current = maintenance;

  useEffect(() => {
    if (due && !locked) {
      setFormSaved(saveOpenForms());
      setLocked(true);
    } else if (!due && locked) {
      setLocked(false);
    }
  }, [due, locked]);

  return { locked, formSaved, maintenance: maintenance ?? last.current };
}
