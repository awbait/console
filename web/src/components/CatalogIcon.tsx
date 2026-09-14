import { useId } from "react";

const cubeOutline = "M0-6 5.5-3.25v7L0 6.5-5.5 3.75v-7Z";

function Cube() {
  return (
    <>
      <path d={cubeOutline} fill="currentColor" fillOpacity=".06" />
      <path d="m-5.5-3.25 5.5 2.75 5.5-2.75M0-.5v7" />
    </>
  );
}

export function CatalogIcon({
  size = 24,
  stroke = 1.8,
  className = "",
}: {
  size?: number | string;
  stroke?: number;
  className?: string;
}) {
  const maskId = useId();

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
      className={`catalog-icon ${className}`}
    >
      <defs>
        <mask id={`${maskId}-front`} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24" style={{ maskType: "luminance" }}>
          <path d="M0 0h24v24H0Z" fill="white" stroke="none" />
          <path className="catalog-icon-front" transform="translate(12 12.75)" d={cubeOutline} fill="black" stroke="black" />
        </mask>
      </defs>
      <g mask={`url(#${maskId}-front)`}>
        <g className="catalog-icon-cube" transform="translate(6.5 10)"><Cube /></g>
        <g className="catalog-icon-cube" transform="translate(17.5 10)"><Cube /></g>
      </g>
      <g className="catalog-icon-cube catalog-icon-front" transform="translate(12 12.75)">
        <Cube />
      </g>
    </svg>
  );
}
