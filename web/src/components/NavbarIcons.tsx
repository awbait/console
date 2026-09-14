import type { ReactNode } from "react";

type IconProps = { size?: number | string; stroke?: number; className?: string };

function icon(name: string, shape: ReactNode) {
  return function NavbarIcon({ size = 24, stroke = 1.8, className = "" }: IconProps) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={`navbar-icon navbar-icon-${name} ${className}`}>
        {shape}
      </svg>
    );
  };
}

export const NavbarInfoIcon = icon("info", <>
  <circle cx="12" cy="12" r="10" />
  <g className="navbar-info-mark"><circle cx="12" cy="7" r=".9" fill="currentColor" stroke="none" /><path d="M12 11v6" /></g>
</>);

export const NavbarUserIcon = icon("user", <>
  <circle cx="12" cy="7" r="3.5" />
  <path d="M3 21v-2a9 6 0 0 1 18 0v2" />
</>);

export const NavbarSunIcon = icon("sun", <>
  <circle cx="12" cy="12" r="4.5" />
  <path className="navbar-sun-rays" d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
</>);

export const NavbarMoonIcon = icon("moon", <path className="navbar-moon-shape" d="M20.9 13A9 9 0 1 1 11 3a7 7 0 0 0 9.9 10Z" />);

export const NavbarSystemIcon = icon("system", <>
  <rect x="2" y="3" width="20" height="14" rx="2" />
  <path d="M12 17v4m-4 0h8" />
  <path className="navbar-system-cursor" d="M6 10h5" />
</>);
