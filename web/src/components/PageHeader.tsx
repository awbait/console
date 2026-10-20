import type { ReactNode } from "react";
import { Breadcrumbs, type Crumb } from "./Breadcrumbs";

// PageHeader is the one top block every page starts with: where you are, what
// this is, what state it is in and what you can do here. Pages used to lay it
// out themselves, about thirty times over, so the title jumped by a few pixels
// between screens and the actions sat on the right on one page and under the
// text on the next. One layout, slots filled by the page:
//
//   breadcrumbs (nested pages only)
//   [icon] Title [status chips]                      [actions]
//          subtitle
//   description, a sentence or two
//   meta chips
//
// The title row is never shorter than a button, so a page without actions puts
// its title exactly where a page with them does. Status is a chip or two that
// names the state of the thing on the page; it is not the place for the
// section's name (the sidebar switcher already says it) or for counters.
export function PageHeader({
  title,
  heading,
  subtitle,
  icon,
  status,
  breadcrumbs,
  description,
  meta,
  actions,
  className = "",
}: {
  title?: ReactNode;
  // Replaces the <h1> itself, for a title being edited in place.
  heading?: ReactNode;
  // One muted line under the title, e.g. the chart's project/name.
  subtitle?: ReactNode;
  // A product or object icon, set in a tile next to the title.
  icon?: ReactNode;
  status?: ReactNode;
  breadcrumbs?: Crumb[];
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={`flex shrink-0 flex-col gap-1 ${className}`}>
      {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className={`flex min-w-0 flex-1 gap-3 ${icon ? "items-center" : "items-start"}`}>
          {icon && (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
              {icon}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1">
              {heading ?? <h1 className="min-w-0 break-words text-xl font-semibold text-slate-900">{title}</h1>}
              {status}
            </div>
            {subtitle && <p className="truncate text-xs text-slate-400">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {description && <div className="max-w-3xl text-sm leading-relaxed text-slate-500">{description}</div>}
      {meta && <div className="mt-2 flex flex-wrap items-center gap-1.5">{meta}</div>}
    </header>
  );
}
