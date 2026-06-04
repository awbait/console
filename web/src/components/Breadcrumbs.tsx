import { Link } from "react-router-dom";
import { IconChevronRight } from "@tabler/icons-react";

export interface Crumb {
  label: string;
  to?: string; // link target; the last crumb (current page) is rendered plain
}

// Breadcrumbs renders a navigation trail, e.g. "Ingress Gateway › my-gw".
// The last item is the current page (not a link).
export function Breadcrumbs({ items, className = "" }: { items: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Хлебные крошки" className={`flex flex-wrap items-center gap-2.5 text-sm ${className}`}>
      {items.map((c, i) => {
        const last = i === items.length - 1;
        return (
          <span key={i} className="flex items-center gap-2.5">
            {i > 0 && <IconChevronRight size={15} stroke={1.8} className="shrink-0 text-slate-300" />}
            {c.to && !last ? (
              <Link to={c.to} className="font-medium text-slate-500 transition-colors hover:text-slate-700">
                {c.label}
              </Link>
            ) : (
              <span className={last ? "font-semibold text-slate-700" : "font-medium text-slate-500"}>
                {c.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
