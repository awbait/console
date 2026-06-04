import { createContext, useContext, type ReactNode } from "react";
import { api } from "../api/client";
import { HttpError } from "../api/client";
import type { User } from "../api/types";
import { useAsync } from "../hooks/useAsync";

interface UserCtx {
  user: User | null;
  loading: boolean;
  unauthenticated: boolean;
  reload: () => void;
}

const Ctx = createContext<UserCtx>({
  user: null,
  loading: true,
  unauthenticated: false,
  reload: () => {},
});

export function UserProvider({ children }: { children: ReactNode }) {
  const { data, error, loading, reload } = useAsync(() => api.me(), []);
  const unauthenticated = error instanceof HttpError && error.status === 401;
  return (
    <Ctx.Provider value={{ user: data, loading, unauthenticated, reload }}>
      {children}
    </Ctx.Provider>
  );
}

export function useUser() {
  return useContext(Ctx);
}

export function canModify(user: User | null, team: string): boolean {
  if (!user) return false;
  return user.role === "admin" || user.teams.includes(team);
}
