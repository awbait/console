import { IconDeviceDesktop, IconMoon, IconSun } from "@tabler/icons-react";
import { Button, Menu, MenuItem, MenuTrigger, Popover } from "react-aria-components";
import { THEME_CHOICES, THEME_LABELS, type ThemeChoice, useTheme } from "../app/ThemeContext";
import type { TablerIcon } from "./icons";

// Each choice gets a glyph of its own, and the same glyph stands for it in the
// topbar and in the switcher. RN has none: it is a brand theme, not a time of
// day, and the two letters say more than any icon would.
const THEME_ICONS: Partial<Record<ThemeChoice, TablerIcon>> = {
  system: IconDeviceDesktop,
  light: IconSun,
  dark: IconMoon,
};

function ThemeGlyph({ choice, size }: { choice: ThemeChoice; size: number }) {
  const Icon = THEME_ICONS[choice];
  if (Icon) return <Icon size={size} stroke={1.7} />;
  return (
    <span className="text-xs font-semibold leading-none tracking-tight">
      {THEME_LABELS[choice]}
    </span>
  );
}

// Theme switcher: system / light / dark / RN, saved in localStorage and applied
// on <html data-theme> (see ThemeContext).
//
// The four choices sit in one segmented track rather than a list of rows: a
// theme is a thing you try, not a command you issue, and a track shows all of
// them at once with the current one raised out of it.
//
// What is raised is what the user picked, not what is on screen: with the
// system followed, a raised moon would read as a theme that was chosen and
// leave no way to see that the portal is simply going along with the desktop.
export function ThemeMenu() {
  const { choice, setTheme } = useTheme();
  return (
    <MenuTrigger>
      <Button
        aria-label="Тема оформления"
        className="flex h-9 w-9 items-center justify-center rounded-md text-slate-500 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <ThemeGlyph choice={choice} size={20} />
      </Button>
      {/* Three layers of one card: the popover in the card colour, the track
          sunk into it in the page colour, the chosen segment lifted back out in
          the card colour. The same three steps read in every theme, which a
          pair of greys picked for the light one would not. */}
      <Popover className="rounded-xl border border-slate-200 bg-surface p-1.5 shadow-lg outline-none entering:animate-in entering:fade-in entering:zoom-in-95">
        <Menu
          aria-label="Тема оформления"
          className="flex items-center gap-1 rounded-lg bg-app p-1 outline-none"
          onAction={(key) => setTheme(key as ThemeChoice)}
        >
          {THEME_CHOICES.map((t) => (
            <MenuItem
              key={t}
              id={t}
              textValue={THEME_LABELS[t]}
              aria-label={THEME_LABELS[t]}
              className={`flex h-8 w-10 cursor-pointer items-center justify-center rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 ${
                choice === t
                  ? // The hairline is what carries the lift in the dark themes,
                    // where the card sits one hair above the page and a fill
                    // alone would leave the segment to the icon colour to show.
                    "bg-surface text-brand-600 shadow-sm ring-1 ring-slate-200"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              <ThemeGlyph choice={t} size={18} />
            </MenuItem>
          ))}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}
