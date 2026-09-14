export function OrdersIcon({
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
      className={`orders-icon ${className}`}
    >
      <path d="m7 5 6 3v8l-6 3-6-3V8Z" fill="currentColor" fillOpacity=".06" />
      <path d="m1 8 6 3 6-3M7 11v8" />
      <path className="orders-icon-row" d="M16 7h5M16 17h5" />
      <path className="orders-icon-row orders-icon-row-middle" d="M17.5 12H23" />
    </svg>
  );
}
