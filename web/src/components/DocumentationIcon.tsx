export function DocumentationIcon({
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
      className={`documentation-icon ${className}`}
    >
      <path d="M3 6v16h14" />
      <g className="documentation-icon-sheet">
        <path d="M7 3h9l5 5v11H7Z" fill="currentColor" fillOpacity=".06" />
        <path d="M16 3v5h5M10 12h8M10 15.5h5" />
      </g>
    </svg>
  );
}
