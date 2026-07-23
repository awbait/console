import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

export interface MenuEntry {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  onAction: () => void;
}

// ContextMenu is a small custom right-click menu positioned at the cursor.
// Closes on outside click, Escape or after an action; the first item receives
// focus so the menu is keyboard-reachable.
export function ContextMenu({
  x,
  y,
  title,
  entries,
  onClose,
}: {
  x: number;
  y: number;
  title?: string;
  entries: MenuEntry[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector("button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    // Capture phase: canvas libraries (d3-drag under React Flow) may stop
    // propagation of press events, which would leave the menu hanging open.
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("wheel", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("wheel", onDown, true);
    };
  }, [onClose]);

  // Keep the menu inside the viewport near the edges.
  const style = {
    left: Math.min(x, window.innerWidth - 200),
    top: Math.min(y, window.innerHeight - 8 - (entries.length * 34 + (title ? 28 : 8))),
  };

  return (
    <div
      ref={ref}
      role="menu"
      style={style}
      className="fixed z-50 min-w-44 rounded-md border border-gray-200 bg-surface py-1 shadow-lg"
      onContextMenu={(e) => e.preventDefault()}
    >
      {title && (
        <div className="truncate border-b border-gray-100 px-3 py-1.5 text-xs font-medium text-slate-400">
          {title}
        </div>
      )}
      {entries.map((entry) => (
        <button
          key={entry.label}
          type="button"
          role="menuitem"
          onClick={() => {
            onClose();
            entry.onAction();
          }}
          className={`flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm outline-none focus-visible:bg-gray-50 ${
            entry.danger ? "text-red-600 hover:bg-red-50" : "text-slate-700 hover:bg-gray-50"
          }`}
        >
          {entry.icon}
          {entry.label}
        </button>
      ))}
    </div>
  );
}
