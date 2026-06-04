import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useUser } from "../auth/UserContext";

// Active team (= team-* group). Drives the topbar selector and filters the
// Resources table / catalog. Persisted to localStorage; reconciled against the
// user's actual teams whenever they load or change.
const KEY = "idp.activeTeam";

interface TeamCtx {
  team: string | null;
  teams: string[];
  setTeam: (t: string) => void;
}

const Ctx = createContext<TeamCtx>({ team: null, teams: [], setTeam: () => {} });

export function TeamProvider({ children }: { children: ReactNode }) {
  const { user } = useUser();
  const teams = user?.teams ?? [];
  const [team, setTeamState] = useState<string | null>(null);

  useEffect(() => {
    if (teams.length === 0) {
      setTeamState(null);
      return;
    }
    setTeamState((cur) => {
      if (cur && teams.includes(cur)) return cur;
      const stored = localStorage.getItem(KEY);
      return stored && teams.includes(stored) ? stored : teams[0];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teams.join(",")]);

  function setTeam(t: string) {
    localStorage.setItem(KEY, t);
    setTeamState(t);
  }

  return <Ctx.Provider value={{ team, teams, setTeam }}>{children}</Ctx.Provider>;
}

export function useTeam() {
  return useContext(Ctx);
}
