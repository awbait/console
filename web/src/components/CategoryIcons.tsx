import { type ReactNode, useEffect, useId, useState } from "react";

type IconProps = { size?: number | string; stroke?: number; className?: string };

let cssPathSupported: boolean | undefined;

function supportsCssPath() {
  if (cssPathSupported !== undefined) return cssPathSupported;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const path = document.createElementNS(svg.namespaceURI, "path") as SVGPathElement;
  svg.setAttribute("aria-hidden", "true");
  svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;visibility:hidden";
  path.setAttribute("d", "M0 0h1");
  path.style.setProperty("d", 'path("M0 0h2")');
  svg.append(path);
  document.body.append(svg);
  try {
    // Some browsers parse CSS d without applying it, so CSS.supports is insufficient.
    cssPathSupported = path.getTotalLength() === 2;
  } catch {
    cssPathSupported = false;
  } finally {
    svg.remove();
  }
  return cssPathSupported;
}

function SecurityShape() {
  const [canMorph, setCanMorph] = useState(false);
  useEffect(() => setCanMorph(supportsCssPath()), []);
  return <g className={canMorph ? "category-security-morph" : undefined}>
    <path className="category-security-half category-security-half-left" fill="currentColor" fillOpacity=".06" d="m12 3-8 3v5c0 4.5 3 7.5 8 10" />
    <path className="category-security-half category-security-half-right" fill="currentColor" fillOpacity=".06" d="m12 3 8 3v5c0 4.5-3 7.5-8 10" />
    <path className="category-security-seam" d="M10.5 3v18m3-18v18" />
  </g>;
}

function DatabaseShape() {
  const clipId = useId();
  return <>
    <defs>
      <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
        <rect x="3" y="6" width="18" height="15" />
      </clipPath>
    </defs>
    <g clipPath={`url(#${clipId})`}>
      <path className="category-database-band" d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3" />
    </g>
    <path d="M3 6v12c0 1.66 4.03 3 9 3s9-1.34 9-3V6" />
    <ellipse cx="12" cy="6" rx="9" ry="3" fill="currentColor" fillOpacity=".06" />
  </>;
}

function NetworkShape() {
  const maskId = useId();
  const nodes = [
    { name: "a", x: 12, y: 4.5 },
    { name: "b", x: 18.495, y: 15.75 },
    { name: "c", x: 5.505, y: 15.75 },
  ];
  return <>
    <defs>
      <mask id={maskId} x="0" y="0" width="24" height="24" maskUnits="userSpaceOnUse">
        <rect width="24" height="24" fill="white" stroke="none" />
        <g className="category-network-orbit">
          {nodes.map(node => <circle key={node.name} cx={node.x} cy={node.y} r="3.1" fill="black" stroke="none" />)}
        </g>
      </mask>
    </defs>
    <circle cx="12" cy="12" r="7.5" mask={`url(#${maskId})`} />
    <g className="category-network-orbit">
      {nodes.map(node => <circle key={node.name} cx={node.x} cy={node.y} r="2.8" />)}
    </g>
  </>;
}

// Original 24px glyphs. Stable names are shared with the persisted icon picker.
// The accent layer moves once on interaction; the silhouette stays readable.
const glyphs: Record<string, ReactNode> = {
  stack: <><path d="m2 12 10 5 10-5M2 16l10 5 10-5" /><path className="category-platform-layer" fill="currentColor" fillOpacity=".06" d="m12 3 10 5-10 5L2 8Z" /></>,
  network: <NetworkShape />,
  tag: <g className="category-uncategorized-tag"><path d="M3 3h8l10 10-8 8L3 11Z" fill="currentColor" fillOpacity=".06" /><circle cx="7.5" cy="7.5" r="1.5" /></g>,
  database: <DatabaseShape />,
  box: <><path d="m3 7 9 5 9-5M12 12v9M3 7v10l9 4 9-4V7L12 3Z" /><path className="category-icon-accent" d="m7.5 5 9 5v5" /></>,
  server: <><rect x="3" y="3" width="18" height="8" rx="2" /><rect x="3" y="14" width="18" height="7" rx="2" /><path d="M7 7h.01M7 17.5h.01" /><path className="category-icon-accent" d="M13 7h4M13 17.5h4" /></>,
  cloud: <><path d="M7 18H6a4 4 0 0 1-.6-8A7 7 0 0 1 19 8a5 5 0 0 1 0 10h-2" /><path className="category-icon-accent" d="M12 21V12m-3 3 3-3 3 3" /></>,
  shield: <SecurityShape />,
  lock: <><path d="M7 10V7a5 5 0 0 1 10 0v3" /><rect x="4" y="10" width="16" height="11" rx="3" fill="currentColor" fillOpacity=".12" /><path className="category-icon-accent" d="M12 14v3" /></>,
  key: <><circle cx="8" cy="8" r="5" fill="currentColor" fillOpacity=".12" /><path className="category-icon-accent" d="m11.5 11.5 9 9m-3-3 3-3m-6 0 3-3" /><path d="M7 7h.01" /></>,
  chart: <><path d="M3 3v18h18" /><path className="category-icon-accent" d="m6 15 4-5 4 3 7-8" /><path d="M17 5h4v4" /></>,
  bucket: <><path d="m3 7 2 12c.5 3 13.5 3 14 0l2-12" /><ellipse cx="12" cy="7" rx="9" ry="4" fill="currentColor" fillOpacity=".12" /><path className="category-icon-accent" d="M9 15h6" /></>,
  cpu: <><rect x="5" y="5" width="14" height="14" rx="3" /><path d="M9 2v3m6-3v3M9 19v3m6-3v3M2 9h3m-3 6h3m14-6h3m-3 6h3" /><rect className="category-icon-accent" x="9" y="9" width="6" height="6" rx="1" fill="currentColor" fillOpacity=".2" /></>,
  apps: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /><path className="category-icon-accent" fill="currentColor" fillOpacity=".18" d="m17.5 2 4.5 5-4.5 5L13 7Z" /></>,
  messages: <><path d="M14 15v3a2 2 0 0 0 2 2h3l3 2V11a2 2 0 0 0-2-2h-3" /><path fill="currentColor" fillOpacity=".1" d="M4 3h11a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H7l-5 4V5a2 2 0 0 1 2-2Z" /><path className="category-icon-accent" d="M6 7h7M6 11h4" /></>,
  code: <>
    <path className="category-code-bracket-left" d="m8 6-5 6 5 6" />
    <path className="category-code-bracket-right" d="m16 6 5 6-5 6" />
    <path d="m14 7-4 10" />
  </>,
};

export const categoryGlyphs = Object.fromEntries(
  Object.entries(glyphs).map(([name, glyph]) => [name, function CategoryGlyph({ size = 24, stroke = 1.8, className = "" }: IconProps) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={`category-icon category-icon-${name} ${className}`}>
        {glyph}
      </svg>
    );
  }]),
);
