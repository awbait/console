import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { useTeam } from "../app/TeamContext";
import { Card, ErrorBox, Spinner } from "../components/ui";
import { findCategoryByChart } from "../components/icons";

export function CatalogPage() {
  const { data: charts, error, loading } = useAsync(() => api.listCharts(), []);
  const { team } = useTeam();

  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;

  // Charts available to the active team: no allowlist, or allowlist includes it.
  const visible = (charts ?? []).filter(
    (c) => !team || !c.allowed_teams?.length || c.allowed_teams.includes(team),
  );

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Чарты</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((c) => (
          <Link key={`${c.project}/${c.name}`} to={`/catalog/${c.project}/${c.name}`}>
            <Card className="h-full transition hover:border-brand-400 hover:shadow">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="font-medium text-gray-900">{c.name}</h2>
                {/* Category from the sidebar taxonomy (e.g. "Сеть"); falls back to
                    the raw Harbor project for charts not placed in the taxonomy. */}
                <span className="shrink-0 rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                  {findCategoryByChart(c.project, c.name)?.label ?? c.project}
                </span>
              </div>
              <p className="mt-1 text-sm text-gray-600">{c.description}</p>
              <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
                <span className="rounded bg-gray-100 px-2 py-0.5">v{c.latest_version}</span>
                <span>{c.versions.length} versions</span>
                {c.allowed_teams && c.allowed_teams.length > 0 && (
                  <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-700">
                    teams: {c.allowed_teams.join(", ")}
                  </span>
                )}
              </div>
            </Card>
          </Link>
        ))}
        {visible.length === 0 && (
          <p className="text-sm text-gray-500">Нет доступных чартов{team ? ` для группы ${team}` : ""}.</p>
        )}
      </div>
    </div>
  );
}
