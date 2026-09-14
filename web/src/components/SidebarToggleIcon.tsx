export function SidebarToggleIcon({
  collapsed,
  size = 24,
  stroke = 1.8,
  className = "",
}: {
  collapsed: boolean;
  size?: number | string;
  stroke?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`sidebar-toggle-icon ${collapsed ? "sidebar-toggle-icon-expand" : "sidebar-toggle-icon-collapse"} ${className}`}
    >
      <path d="M8 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4Z" fill="currentColor" fillOpacity=".08" stroke="none" />
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M8 4v16" />
      <path className="sidebar-toggle-icon-arrow" d={collapsed ? "M12 12h7m-3-3 3 3-3 3" : "M19 12h-7m3-3-3 3 3 3"} />
    </svg>
  );
}
