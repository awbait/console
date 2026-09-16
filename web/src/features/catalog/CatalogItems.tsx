import { IconArrowRight, IconLock } from "@tabler/icons-react";
import { Button as AriaButton } from "react-aria-components";
import { Link } from "react-router-dom";
import type { CatalogChart, Category } from "../../api/types";
import { isUnclaimed, publisherLabel } from "../../api/types";
import { useTeamLabel } from "../../auth/UserContext";
import { categoryIcon, ProductIcon } from "../../components/icons";
import { ProjectsIcon } from "../../components/ProjectsIcon";
import { Hint } from "../../components/ui";
import { catalogDescription, catalogVersion, isOrderableChart, publicationState } from "./catalogModel";

const detailPath = (chart: CatalogChart) =>
  `/catalog/${encodeURIComponent(chart.project)}/${encodeURIComponent(chart.name)}`;

function ChartAction({ chart, disabledReason }: { chart: CatalogChart; disabledReason?: string }) {
  const orderable = isOrderableChart(chart);
  const label = orderable ? "Заказать" : "Управление";
  if (orderable && disabledReason) {
    return (
      <Hint text={disabledReason}>
        <AriaButton
          aria-disabled="true"
          aria-label={`Заказать ${chart.name}`}
          className="catalog-action catalog-order-action catalog-action-disabled"
        >
          Заказать
        </AriaButton>
      </Hint>
    );
  }
  return (
    <Link
      className={`catalog-action${orderable ? " catalog-order-action" : ""}`}
      aria-label={`${label}: ${chart.name}`}
      to={`${detailPath(chart)}/${orderable ? "order" : "manage"}`}
    >
      {label} {!orderable && <IconArrowRight size={15} aria-hidden />}
    </Link>
  );
}

function CategoryBadge({ category }: { category?: Category }) {
  const label = category?.label || "Без категории";
  const Icon = categoryIcon(category?.icon || "", category?.id);
  return (
    <span className="catalog-badge" title={label}>
      <Icon size={12} aria-hidden />
      <span>{label}</span>
    </span>
  );
}

function VersionBadge({ chart }: { chart: CatalogChart }) {
  const version = catalogVersion(chart);
  const extra = (chart.publication?.orderable_versions ?? []).filter((v) => v !== version);
  return (
    <span className="catalog-version-group">
      <span
        className="catalog-badge catalog-version"
        title={isOrderableChart(chart) ? "Рекомендуемая версия" : "Последняя версия в Harbor"}
      >
        {version ? `v${version}` : "Нет версии"}
      </span>
      {isOrderableChart(chart) && extra.length > 0 && (
        <span className="catalog-badge" title={`Другие доступные версии: ${extra.join(", ")}`}>
          +{extra.length}
        </span>
      )}
    </span>
  );
}

function OwnerBadge({ chart }: { chart: CatalogChart }) {
  const teamLabel = useTeamLabel();
  const pub = chart.publication;
  if (!pub || isUnclaimed(pub)) return <span className="catalog-unassigned">Не назначен</span>;
  return (
    <span
      className="catalog-badge catalog-owner"
      title={`Владелец: ${teamLabel(pub.owner_team)}${pub.created_by_name ? ` · ${publisherLabel(pub.created_by)}: ${pub.created_by_name}` : ""}`}
    >
      <ProjectsIcon size={12} stroke={1.8} aria-hidden />
      <span>{teamLabel(pub.owner_team)}</span>
    </span>
  );
}

function StateBadge({ chart }: { chart: CatalogChart }) {
  const state = publicationState(chart);
  return <span className={`catalog-badge catalog-state-${state.tone}`}>{state.label}</span>;
}

function AccessBadge({ chart }: { chart: CatalogChart }) {
  const teamLabel = useTeamLabel();
  if (!chart.allowed_teams?.length) return null;
  const text = `Доступно командам: ${chart.allowed_teams.map(teamLabel).join(", ")}`;
  return (
    <span className="catalog-badge catalog-access" title={text}>
      <IconLock size={12} aria-label={text} />
      По доступу
    </span>
  );
}

interface ItemsProps {
  charts: CatalogChart[];
  categories: Category[];
  showCategory: boolean;
  unpublished: boolean;
  disabledReason?: string;
}

export function CatalogCards({ charts, categories, showCategory, unpublished, disabledReason }: ItemsProps) {
  return (
    <div className="catalog-grid">
      {charts.map((chart) => (
        <article key={`${chart.project}/${chart.name}`} className="catalog-card">
          <div className="catalog-card-heading">
            <span className="catalog-product-icon">
              <ProductIcon project={chart.project} name={chart.name} size={22} />
            </span>
            <h2>
              <Link className="catalog-name" title={`${chart.project}/${chart.name}`} to={detailPath(chart)}>
                {chart.name}
              </Link>
            </h2>
            <ChartAction chart={chart} disabledReason={disabledReason} />
          </div>
          <p className="catalog-description" title={catalogDescription(chart)}>
            {catalogDescription(chart) || "Описание пока не добавлено."}
          </p>
          <div className="catalog-metadata">
            {showCategory && (
              <CategoryBadge category={categories.find((c) => c.id === chart.publication?.category_id)} />
            )}
            <VersionBadge chart={chart} />
            {chart.publication && !isUnclaimed(chart.publication) && <OwnerBadge chart={chart} />}
            <AccessBadge chart={chart} />
            {unpublished && <StateBadge chart={chart} />}
          </div>
        </article>
      ))}
    </div>
  );
}

export function CatalogList({ charts, categories, showCategory, unpublished, disabledReason }: ItemsProps) {
  return (
    <table
      className="catalog-table"
      aria-label={unpublished ? "Неопубликованные сервисы" : "Доступные сервисы"}
    >
      <thead>
        <tr>
          <th scope="col" className="catalog-service-column">
            Сервис
          </th>
          {showCategory && <th scope="col">Категория</th>}
          <th scope="col">Версия</th>
          <th scope="col">Владелец</th>
          {unpublished && <th scope="col">Состояние</th>}
          <th scope="col" className="catalog-action-cell">
            <span className="sr-only">Действия</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {charts.map((chart) => (
          <tr key={`${chart.project}/${chart.name}`}>
            <td>
              <div className="catalog-list-service">
                <span className="catalog-product-icon">
                  <ProductIcon project={chart.project} name={chart.name} size={22} />
                </span>
                <div>
                  <Link
                    className="catalog-name"
                    title={`${chart.project}/${chart.name}`}
                    to={detailPath(chart)}
                  >
                    {chart.name}
                  </Link>
                  <p className="catalog-description" title={catalogDescription(chart)}>
                    {catalogDescription(chart) || "Описание пока не добавлено."}
                  </p>
                  <AccessBadge chart={chart} />
                </div>
              </div>
            </td>
            {showCategory && (
              <td>
                <CategoryBadge category={categories.find((c) => c.id === chart.publication?.category_id)} />
              </td>
            )}
            <td>
              <VersionBadge chart={chart} />
            </td>
            <td>
              <OwnerBadge chart={chart} />
            </td>
            {unpublished && (
              <td>
                <StateBadge chart={chart} />
              </td>
            )}
            <td className="catalog-action-cell">
              <ChartAction chart={chart} disabledReason={disabledReason} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
