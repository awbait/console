export function ProjectsIcon({
  size = 24,
  stroke = 1.8,
  className = "",
}: {
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
      className={`projects-icon ${className}`}
    >
      <g className="projects-icon-member projects-icon-member-left">
        <circle cx="4" cy="8.5" r="2.25" />
        <path d="M4.5 19H1v-2.5a3.5 3.5 0 0 1 5-3.16" />
      </g>
      <g className="projects-icon-member projects-icon-member-right">
        <circle cx="20" cy="8.5" r="2.25" />
        <path d="M19.5 19H23v-2.5a3.5 3.5 0 0 0-5-3.16" />
      </g>
      <circle cx="12" cy="5.5" r="2.75" />
      <path d="M7 21v-4a5 5 0 0 1 10 0v4Z" fill="currentColor" fillOpacity=".06" />
    </svg>
  );
}
