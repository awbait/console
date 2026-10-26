// Entry of the playground (playground.html): the portal's providers that the
// editor and the preview read, and none of the ones that need a session.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import "../lib/monaco";
import { qk } from "@/api/queryKeys";
import type { Stand } from "@/api/types";
import { ThemeProvider } from "@/app/ThemeContext";
import { ToastProvider } from "@/app/ToastContext";
import { Playground } from "./Playground";

// The preview asks for the stands and the platform variables the way the
// order form does, through the query cache. Seeding the cache with a stand
// and no variables, and never letting an entry go stale, answers both without
// a request: there is no portal at the other end of one.
const STAND: Stand = {
  id: "dev",
  name: "dev",
  default_cluster: "in-cluster",
  default: true,
  layout: "group",
  git_path: "managed-services/dev",
  mode: "deploy",
  chart_registry: "",
  git_url: "",
  argocd_namespace: "",
  argocd_git_path: "",
  argocd_project: "",
  argo_connected: true,
  locked: false,
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: Infinity, gcTime: Infinity, retry: false, refetchOnWindowFocus: false },
  },
});
queryClient.setQueryData(qk.stands(), [STAND]);
queryClient.setQueryData(qk.variables(), []);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <Playground />
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
