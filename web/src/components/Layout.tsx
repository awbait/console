import {
  IconActivity,
  IconAdjustments,
  IconBell,
  IconBook,
  IconBox,
  IconCheck,
  IconChecklist,
  IconChevronDown,
  IconChevronRight,
  IconHash,
  IconInfoCircle,
  IconLayoutDashboard,
  IconLayoutGrid,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconLifebuoy,
  IconLogout,
  IconPackages,
  IconPalette,
  IconScan,
  IconSettings,
  IconShieldCheck,
  IconShieldLock,
  IconTags,
  IconUser,
  IconUsersGroup,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Focusable,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
  Tooltip,
  TooltipTrigger,
} from "react-aria-components";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { CatalogChart } from "../api/types";
import { chartLabel, inMenu, useCatalog } from "../app/CatalogContext";
import { useTeam } from "../app/TeamContext";
import { THEME_CHOICES, THEME_LABELS, type ThemeChoice, useTheme } from "../app/ThemeContext";
import { useUser } from "../auth/UserContext";
import { useAsync } from "../hooks/useAsync";
import { useStored } from "../hooks/useStored";
import { categoryIcon, type TablerIcon } from "./icons";
import { LoginScreen } from "./LoginScreen";
import { PlatformHealthBanner } from "./PlatformHealthBanner";
import { PlatformHealthIndicator } from "./PlatformHealthIndicator";
import { Skeleton, SkeletonText } from "./ui";

const navItems = [
  { to: "/requests", label: "Список заказов", Icon: IconBox },
  { to: "/catalog", label: "Каталог", Icon: IconPackages },
];

// Top-level sidebar sections. The platform section is the default product
// experience; the security (InfoSec) and admin sections swap the lower nav for
// their own pages. The switcher only appears when a role can see more than one.
type SectionId = "platform" | "support" | "admin" | "security";

const SECTIONS: { id: SectionId; label: string; home: string; Icon: typeof IconBox }[] = [
  { id: "platform", label: "Платформа", home: "/catalog", Icon: IconLayoutGrid },
  { id: "support", label: "Поддержка", home: "/support", Icon: IconLifebuoy },
  { id: "admin", label: "Админ", home: "/admin", Icon: IconSettings },
  { id: "security", label: "ИБ", home: "/security", Icon: IconShieldLock },
];

type SectionNavItem = { to: string; label: string; Icon: typeof IconBox; exact?: boolean };

// Lower-nav items of the security section. The overview matches its route
// exactly so deeper pages don't also light it up.
const securitySectionNav: SectionNavItem[] = [
  { to: "/security", label: "Обзор", Icon: IconLayoutDashboard, exact: true },
  { to: "/security/policies", label: "Согласование политик", Icon: IconShieldCheck },
  { to: "/security/kyverno", label: "Kyverno UI", Icon: IconScan },
];

// Lower-nav items of the support section.
const supportSectionNav: SectionNavItem[] = [
  { to: "/support", label: "Обзор", Icon: IconLayoutDashboard, exact: true },
  { to: "/support/requests", label: "Заказы всех команд", Icon: IconBox },
];

// Lower-nav items of the platform-admin section.
const adminSectionNav: SectionNavItem[] = [
  { to: "/admin", label: "Обзор", Icon: IconLayoutDashboard, exact: true },
  { to: "/admin/approvals", label: "Согласование публикаций", Icon: IconChecklist },
  { to: "/admin/status", label: "Состояние платформы", Icon: IconActivity },
  { to: "/admin/config", label: "Конфигурация", Icon: IconAdjustments },
  { to: "/admin/categories", label: "Категории каталога", Icon: IconTags },
];

// SideTip labels a sidebar item while the menu is collapsed, where only the
// icon is left. It replaces the native `title` attribute: that one is slow,
// unstyled and cannot be themed. Rendered through react-aria's overlay (a
// portal), so the label escapes the card's `overflow-hidden` instead of being
// clipped by it. Expanded, the item speaks for itself and the tip is skipped.
function SideTip({
  label,
  enabled,
  children,
}: {
  label: string;
  enabled: boolean;
  children: React.ReactElement<React.DOMAttributes<HTMLElement>, string>;
}) {
  if (!enabled) return <>{children}</>;
  return (
    <TooltipTrigger delay={200} closeDelay={0}>
      {/* Focusable passes the trigger's hover/focus props down to a plain
          element - the router's Link is not a react-aria component. */}
      <Focusable>{children}</Focusable>
      <Tooltip
        placement="right"
        offset={10}
        className="z-20 rounded-md border border-slate-200 bg-surface px-2.5 py-1.5 text-sm font-medium text-slate-700 shadow-lg outline-none entering:animate-in entering:fade-in entering:zoom-in-95 entering:slide-in-from-left-1"
      >
        {label}
      </Tooltip>
    </TooltipTrigger>
  );
}

// One geometry for every sidebar row, collapsed or not, so switching states
// never nudges an icon: it always starts 26px from the card's left edge, which
// is the centre line of the 72px collapsed column. Plain rows reach it with
// 1px of card border + 12px of nav wrapper + 13px of their own padding; the
// framed ones with 1px of card border + 12px of wrapper + 1px of their own
// border + 12px of padding. The collapsed column is sized from that padding,
// not the other way round: widening the menu's inner padding widens it too.
// Padding rather than justify-center: a centred icon would slide across the row
// while the width animates, and a scrollbar on the right would shift it too.
const ROW = "py-2 pl-[13px] pr-3.5";
const SELECT_ROW = "px-3 py-2";
// Rows inside a section share the horizontal geometry of a plain row - so a
// child lines up with the header above it - but stay 32px tall instead of 36:
// a shorter row keeps a long list compact and the section header taller.
const SUB_ROW = "py-1.5 pl-[13px] pr-3.5";

// Labels fade with the width instead of popping in and out. Leaving is quicker
// than arriving so the text is gone before the column gets narrow enough to
// clip it. No transition-delay here: tailwindcss-animate rebinds delay-* to
// animation-delay, so a staggered variant would need an arbitrary value.
function labelFade(collapsed: boolean): string {
  return `transition-opacity motion-reduce:transition-none ${
    collapsed ? "opacity-0 duration-100" : "opacity-100 duration-200"
  }`;
}

// A sidebar section that opens in place: its header toggles the list below it.
// Built by hand rather than on react-aria's Disclosure because that one hides
// the panel with the `hidden` attribute (display: none), which no transition
// can touch. The grid 0fr -> 1fr trick animates a height nobody has to measure
// in advance. The panel mounts closed and opens on the next frame, so expanding
// the whole sidebar plays the same opening as clicking a header does.
function NavSection({
  Icon,
  label,
  open,
  onToggle,
  framed = false,
  children,
}: {
  Icon: TablerIcon;
  label: string;
  open: boolean;
  onToggle: () => void;
  framed?: boolean;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const shown = mounted && open;

  return (
    <div>
      <Button
        onPress={onToggle}
        aria-expanded={open}
        /* framed: a transparent border of the same weight as the select this
           header turns into when the sidebar collapses. The box then matches
           in both states, so folding the menu does not resize the card. */
        className={`flex w-full items-center justify-between overflow-hidden whitespace-nowrap rounded-md text-sm font-medium text-slate-600 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-500 ${
          framed ? `border border-transparent ${SELECT_ROW}` : ROW
        }`}
      >
        <span className="flex items-center gap-3">
          <Icon size={20} stroke={1.7} className="shrink-0" />
          <span className="shrink-0">{label}</span>
        </span>
        <IconChevronRight
          size={16}
          className={`shrink-0 text-slate-400 transition-transform duration-200 motion-reduce:transition-none ${
            shown ? "rotate-90" : ""
          }`}
        />
      </Button>
      {/* visibility rides the same transition on purpose: it flips to visible
          at the start of the opening and back to hidden only at the end of the
          closing, so a folded list is out of the tab order without cutting the
          animation short. */}
      <div
        className={`grid transition-[grid-template-rows,visibility] duration-200 ease-out motion-reduce:transition-none ${
          shown ? "visible grid-rows-[1fr]" : "invisible grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">{children}</div>
      </div>
    </div>
  );
}

// Human-readable role labels for the profile menu.
const ROLE_LABELS: Record<string, string> = {
  auditor: "Аудитор",
  member: "Участник",
  support: "Поддержка",
  security: "Информационная безопасность",
  admin: "Администратор платформы",
};

export function Layout() {
  const { user, loading, unauthenticated } = useUser();
  // Whether the menu is folded is a preference too: a user who works with it
  // collapsed should not have to collapse it on every visit.
  const [collapsed, setCollapsed] = useStored("sidebar.collapsed", false);
  const { pathname } = useLocation();
  const navigate = useNavigate();

  // On a request detail/edit route the URL doesn't say which product it is, so
  // fetch the order and map its chart - that chart's sidebar item then lights
  // up (e.g. viewing an Ingress Gateway order highlights it).
  const reqId = pathname.match(/^\/requests\/([^/]+)(?:\/edit)?$/)?.[1];
  const { data: reqForNav } = useAsync(
    () => (reqId ? api.getRequest(reqId) : Promise.resolve(null)),
    [reqId],
  );
  const navReq = reqForNav?.request;

  // Sidebar product taxonomy is dynamic: catalog categories (admin-managed) ->
  // published charts whose approved view declares an order form. Categories
  // without a single such chart are hidden.
  const { categories, charts } = useCatalog();
  const menu = useMemo(
    () =>
      categories
        .map((cat) => ({
          ...cat,
          charts: charts.filter((c) => inMenu(c) && c.publication!.category_id === cat.id),
        }))
        .filter((g) => g.charts.length > 0),
    [categories, charts],
  );

  // A chart's menu item is "active" on its product page (/products/:project/:name),
  // while ordering it (/catalog/:project/:name/order - ordering is a product
  // action), and on a request of that chart (/requests/:id). Browsing the chart
  // itself (/catalog/:project/:name, no /order) is NOT a product - it belongs to
  // the "Charts" section, so that top-level item lights up there instead.
  const chartActive = (c: CatalogChart) =>
    pathname === `/products/${c.project}/${c.name}` ||
    pathname === `/catalog/${c.project}/${c.name}/order` ||
    (!!navReq && navReq.chart_project === c.project && navReq.chart_name === c.name);
  const activeReqInMenu =
    !!navReq && menu.some((g) => g.charts.some((c) => c.project === navReq.chart_project && c.name === navReq.chart_name));
  const activeCategory = menu.find((g) => g.charts.some(chartActive))?.id;

  // Category expansion: open by default, and what the browser remembers is the
  // set of categories the user folded away, not the ones left open. That way a
  // category published later shows up open instead of hidden behind a
  // preference written before it existed.
  const [foldedCategories, setFoldedCategories] = useStored<string[]>("sidebar.folded-categories", []);
  const folded = useMemo(() => new Set(foldedCategories), [foldedCategories]);
  // The category of the page being viewed opens itself - a folded one would
  // otherwise hide the item that is currently active.
  useEffect(() => {
    if (!activeCategory) return;
    setFoldedCategories((prev) => (prev.includes(activeCategory) ? prev.filter((id) => id !== activeCategory) : prev));
  }, [activeCategory, setFoldedCategories]);
  const toggleCategory = (id: string) =>
    setFoldedCategories((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  // Top-level nav active state. "Charts"/"Orders list" must NOT light up when
  // the route belongs to a product (ordering a gateway under /catalog/…, or
  // viewing a gateway order under /requests/:id) - the product item owns it.
  const navActive = (to: string) => {
    if (to === "/catalog")
      return (pathname === "/catalog" || pathname.startsWith("/catalog/")) && !activeCategory;
    if (to === "/requests")
      return (pathname === "/requests" || pathname.startsWith("/requests/")) && !activeReqInMenu;
    return pathname === to || pathname.startsWith(`${to}/`);
  };

  // Pages come in two widths. The limit applies to the whole shell (topbar +
  // sidebar + content), not to the content alone: leftover space becomes an
  // outer margin left of the sidebar and right of the content, and the content
  // itself always fills its column. Wide pages drop the limit and use the full
  // window - only the version editor qualifies, its editor + preview panes need
  // the room; the version list above it stays a standard page.
  // max-w-full rather than no class at all: a length -> percentage pair still
  // interpolates, so switching between the two widths animates instead of
  // snapping.
  const isWide = /^\/catalog\/[^/]+\/[^/]+\/manage\/[^/]+$/.test(pathname);
  const shellWidth = `transition-[max-width] duration-300 ease-out motion-reduce:transition-none ${
    isWide ? "max-w-full" : "max-w-[1440px]"
  }`;

  if (loading) return <ShellSkeleton width={shellWidth} />;
  if (unauthenticated || !user) return <LoginScreen />;

  // Sections by role: security sees only its own section, admin sees all three,
  // everyone else only the platform section. The active section follows the URL,
  // clamped to what the role may actually see.
  const availableSections = SECTIONS.filter((s) => {
    if (s.id === "security") return user.role === "security" || user.role === "admin";
    if (s.id === "admin") return user.role === "admin";
    if (s.id === "support") return user.role === "support" || user.role === "admin";
    return user.role !== "security"; // platform
  });
  const pathSection: SectionId = pathname.startsWith("/security")
    ? "security"
    : pathname.startsWith("/admin")
      ? "admin"
      : pathname.startsWith("/support")
        ? "support"
        : "platform";
  const activeSection: SectionId = availableSections.some((s) => s.id === pathSection)
    ? pathSection
    : (availableSections[0]?.id ?? "platform");
  // The active section's own flat nav (security/admin); platform renders the
  // dynamic product taxonomy instead.
  const sectionNav =
    activeSection === "security"
      ? securitySectionNav
      : activeSection === "admin"
        ? adminSectionNav
        : activeSection === "support"
          ? supportSectionNav
          : null;
  const currentSection = SECTIONS.find((s) => s.id === activeSection) ?? SECTIONS[0];

  return (
    <div className="flex h-screen flex-col bg-app text-slate-800">
      {/* TOPBAR - the bar spans the whole window; its contents share the shell's
          width and gutters, so the team selector lines up with the left edge of
          the sidebar card and the account tools with the content's right edge.
          The wordmark keeps its own full-height flex box so it sits on the
          bar's vertical centre despite its larger type size. */}
      <header className="shrink-0 border-b border-slate-200 bg-surface">
        <div
          className={`mx-auto flex h-14 w-full items-center justify-between gap-4 px-4 lg:px-6 ${shellWidth}`}
        >
          {/* Wordmark: lowercase and accented, set larger and bolder than the
              rest of the topbar so it anchors the page. System fonts on purpose -
              the portal runs in a closed network with no font CDN. */}
          <Link
            to="/"
            className="flex h-full items-center truncate rounded-md text-2xl font-bold lowercase leading-none tracking-tight text-brand-600 outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            console
          </Link>
          <div className="flex items-center gap-1">
            <PlatformHealthIndicator />
            <ThemeMenu />
            {/* Docs live at the bottom of the sidebar; no duplicate here. */}
            <Link
              to="/about"
              aria-label="О портале"
              title="О портале"
              aria-current={pathname.startsWith("/about") ? "page" : undefined}
              className="rounded-md p-2 text-slate-500 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-500 aria-[current=page]:bg-brand-50 aria-[current=page]:text-brand-700"
            >
              <IconInfoCircle size={20} stroke={1.7} />
            </Link>
            <IconButton label="Уведомления">
              <IconBell size={20} stroke={1.7} />
            </IconButton>
            <UserMenu />
          </div>
        </div>
      </header>

      {/* BODY - sidebar card and content column. mx-auto turns the space beyond
          the shell width into an outer margin: it sits left of the sidebar and
          right of the content, never between them - the gap and the gutters are
          fixed. min-h-0 lets the two columns scroll inside themselves instead of
          growing the page. */}
      <div className={`mx-auto flex min-h-0 w-full flex-1 gap-10 px-4 py-8 lg:px-6 ${shellWidth}`}>
        {/* LEFT COLUMN - a stack of cards: the current project on top, the
            navigation below. Width animates (px->px) for a smooth collapse. */}
        <div
          className={`flex shrink-0 flex-col transition-[width] duration-300 ease-in-out ${
            collapsed ? "w-[72px]" : "w-[260px]"
          }`}
        >
          {/* The project selector is a platform concept: the admin, support and
              security sections are not scoped to a team, so it folds away there.
              Height animates via grid-rows 0fr->1fr (the card has no fixed
              height); the card itself only fades, and the two are staggered so no
              half-revealed card is ever on screen: leaving, it fades out first
              and the space closes after; arriving, the space opens first and the
              card fades in. The gap to the menu below lives inside the collapsing
              row (pb-4), so it folds away with it - hence no gap on the column. */}
          {(() => {
            const shown = activeSection === "platform";
            return (
              <div
                className={`grid shrink-0 transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${
                  shown ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                }`}
              >
                <div className="overflow-hidden">
                  <div
                    aria-hidden={!shown}
                    className={`pb-4 transition-opacity motion-reduce:transition-none ${
                      shown ? "opacity-100 duration-200 delay-150" : "opacity-0 duration-100"
                    }`}
                  >
                    <div className="rounded-xl border border-slate-200 bg-surface px-3 py-2 shadow-sm">
                      <OrgSelector collapsed={collapsed} />
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          <aside className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-surface shadow-sm">
            {/* Nav scrolls on its own so the collapse toggle stays pinned to the
                bottom of the card even with a long product taxonomy.
                overflow-x-hidden is not redundant: with overflow-y set, the other
                axis computes to auto, so while the width animates the nowrap
                labels overflow sideways and flash a horizontal scrollbar. */}
            <div className="scroll-slim flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
              {/* Section switcher (only when a role can see more than one).
                  A dropdown in both states: the labels don't fit as a pill row
                  once there are three of them, and collapsing must not turn one
                  control into a stack of look-alike icons. Collapsed, the
                  trigger shows the active section's icon and the menu carries
                  the labels. */}
              {availableSections.length > 1 && (
                <div className="px-3 pt-2">
                  <MenuTrigger>
                    <SideTip label={currentSection.label} enabled={collapsed}>
                      <Button
                        aria-label={collapsed ? `Раздел: ${currentSection.label}` : undefined}
                        className={`group flex w-full items-center justify-between gap-2 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 ${SELECT_ROW} text-sm font-medium text-slate-700 outline-none transition-colors hover:border-brand-300 hover:bg-brand-50 focus-visible:ring-2 focus-visible:ring-brand-500 data-[pressed]:border-brand-300 data-[pressed]:bg-brand-50`}
                      >
                        {/* Same markup in both states - the frame stays so the
                            control still reads as a select, and only the label
                            and the chevron fade. Swapping the markup instead
                            would teleport the icon mid-animation.
                            overflow-hidden clips the two of them while the
                            column is narrow: they do not fit next to the icon
                            and would otherwise spill past the frame. */}
                        <span className="flex min-w-0 items-center gap-2">
                          <currentSection.Icon size={20} stroke={1.7} className="shrink-0 text-brand-600" />
                          <span className={`truncate ${labelFade(collapsed)}`}>{currentSection.label}</span>
                        </span>
                        <IconChevronDown
                          size={16}
                          className={`shrink-0 text-slate-400 transition-[transform,opacity] duration-200 group-data-[pressed]:rotate-180 ${
                            collapsed ? "opacity-0" : "opacity-100"
                          }`}
                        />
                      </Button>
                    </SideTip>
                    <Popover
                      className={`rounded-md border border-slate-200 bg-surface py-1 shadow-lg outline-none entering:animate-in entering:fade-in ${
                        collapsed ? "min-w-52" : "w-[var(--trigger-width)]"
                      }`}
                    >
                      <Menu className="outline-none" onAction={(key) => navigate(String(key))}>
                        {availableSections.map((s) => {
                          const Icon = s.Icon;
                          return (
                            <MenuItem
                              key={s.id}
                              id={s.home}
                              className="flex cursor-pointer items-center justify-between gap-6 px-3 py-1.5 text-sm text-slate-700 outline-none focus:bg-slate-50"
                            >
                              <span className="flex items-center gap-2">
                                <Icon size={20} stroke={1.7} className="shrink-0 text-slate-500" />
                                {s.label}
                              </span>
                              {activeSection === s.id && <IconCheck size={16} className="text-brand-600" />}
                            </MenuItem>
                          );
                        })}
                      </Menu>
                    </Popover>
                  </MenuTrigger>
                </div>
              )}

              {sectionNav ? (
                /* security/admin section: its own flat nav, no product categories */
                <nav className="px-3 py-2">
                  <ul className="flex flex-col gap-0.5">
                    {sectionNav.map((n) => {
                      const Icon = n.Icon;
                      const active = n.exact ? pathname === n.to : navActive(n.to);
                      return (
                        <li key={n.to}>
                          <SideTip label={n.label} enabled={collapsed}>
                            <Link
                              to={n.to}
                              aria-current={active ? "page" : undefined}
                              className={`flex items-center gap-3 overflow-hidden whitespace-nowrap rounded-md ${ROW} text-sm font-medium text-slate-800 hover:bg-slate-50 aria-[current=page]:bg-brand-50 aria-[current=page]:text-brand-700`}
                            >
                              <Icon size={20} stroke={1.7} className="shrink-0" />
                              <span className={`shrink-0 ${labelFade(collapsed)}`}>{n.label}</span>
                            </Link>
                          </SideTip>
                        </li>
                      );
                    })}
                  </ul>
                </nav>
              ) : (
                <>
                  {/* flat group: Resources / Charts (active via navActive aria-current) */}
                  <nav className="px-3 py-2">
                    <ul className="flex flex-col gap-0.5">
                      {navItems.map((n) => {
                        const Icon = n.Icon;
                        return (
                          <li key={n.to}>
                            <SideTip label={n.label} enabled={collapsed}>
                              <Link
                                to={n.to}
                                aria-current={navActive(n.to) ? "page" : undefined}
                                className={`flex items-center gap-3 overflow-hidden whitespace-nowrap rounded-md ${ROW} text-sm font-medium text-slate-800 hover:bg-slate-50 aria-[current=page]:bg-brand-50 aria-[current=page]:text-brand-700`}
                              >
                                <Icon size={20} stroke={1.7} className="shrink-0" />
                                <span className={`shrink-0 ${labelFade(collapsed)}`}>{n.label}</span>
                              </Link>
                            </SideTip>
                          </li>
                        );
                      })}
                    </ul>
                  </nav>

                  <div className="mx-3 border-t border-slate-100" />

                  {/* Product categories (dynamic: published charts with an order
                      view). Collapsed, a category opens its services in a menu -
                      it used to be a plain link to the first chart, which left
                      every other service in the category unreachable. */}
                  {collapsed ? (
                    <nav className="flex flex-col gap-0.5 px-3 py-2">
                      {menu.map((g) => {
                        const Icon = categoryIcon(g.icon || g.id);
                        return (
                          <MenuTrigger key={g.id}>
                            <SideTip label={g.label} enabled>
                              <Button
                                aria-label={g.label}
                                aria-current={activeCategory === g.id ? "page" : undefined}
                                className={`flex w-full rounded-md ${ROW} text-slate-600 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-500 aria-[current=page]:bg-brand-50 aria-[current=page]:text-brand-700`}
                              >
                                <Icon size={20} stroke={1.7} className="shrink-0" />
                              </Button>
                            </SideTip>
                            <Popover className="min-w-52 rounded-md border border-slate-200 bg-surface py-1 shadow-lg outline-none entering:animate-in entering:fade-in">
                              <div className="border-b border-slate-100 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                                {g.label}
                              </div>
                              <Menu className="outline-none" onAction={(key) => navigate(String(key))}>
                                {g.charts.map((c) => (
                                  <MenuItem
                                    key={`${c.project}/${c.name}`}
                                    id={`/products/${c.project}/${c.name}`}
                                    className="flex cursor-pointer items-center justify-between gap-6 px-3 py-1.5 text-sm text-slate-700 outline-none focus:bg-slate-50"
                                  >
                                    {chartLabel(c.name)}
                                    {chartActive(c) && <IconCheck size={16} className="text-brand-600" />}
                                  </MenuItem>
                                ))}
                              </Menu>
                            </Popover>
                          </MenuTrigger>
                        );
                      })}
                    </nav>
                  ) : (
                    <nav className="px-3 py-2">
                      {menu.map((g) => {
                        const Icon = categoryIcon(g.icon || g.id);
                        return (
                          <NavSection
                            key={g.id}
                            Icon={Icon}
                            label={g.label}
                            open={!folded.has(g.id)}
                            onToggle={() => toggleCategory(g.id)}
                          >
                            <ul className="flex flex-col gap-0.5 py-1">
                              {g.charts.map((c) => (
                                <li key={`${c.project}/${c.name}`}>
                                  <Link
                                    to={`/products/${c.project}/${c.name}`}
                                    aria-current={chartActive(c) ? "page" : undefined}
                                    className={`block whitespace-nowrap rounded-md ${SUB_ROW} text-sm text-slate-500 hover:bg-slate-50 hover:text-slate-700 aria-[current=page]:bg-brand-50 aria-[current=page]:font-medium aria-[current=page]:text-brand-700`}
                                  >
                                    {chartLabel(c.name)}
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          </NavSection>
                        );
                      })}
                    </nav>
                  )}
                </>
              )}
            </div>

            {/* Docs closes the navigation: a destination like the items above,
                just a secondary one, so it stays inside the menu block with no
                divider of its own. */}
            <div className="shrink-0 px-3 pb-2">
              <SideTip label="Документация" enabled={collapsed}>
                <Link
                  to="/docs"
                  aria-current={pathname.startsWith("/docs") ? "page" : undefined}
                  className={`flex items-center gap-3 overflow-hidden whitespace-nowrap rounded-md ${ROW} text-sm text-slate-500 hover:bg-slate-50 aria-[current=page]:bg-brand-50 aria-[current=page]:font-medium aria-[current=page]:text-brand-700`}
                >
                  <IconBook size={20} stroke={1.7} className="shrink-0" />
                  <span className={`shrink-0 ${labelFade(collapsed)}`}>Документация</span>
                </Link>
              </SideTip>
            </div>

            {/* Collapsing is shell chrome, not a place to go: it sits below the
                divider, on its own, and never looks active. */}
            <div className="shrink-0 border-t border-slate-100 px-3 py-2">
              <SideTip label="Развернуть меню" enabled={collapsed}>
                <Button
                  onPress={() => setCollapsed((c) => !c)}
                  aria-label={collapsed ? "Развернуть меню" : "Свернуть меню"}
                  aria-pressed={collapsed}
                  className={`flex w-full items-center gap-3 overflow-hidden whitespace-nowrap rounded-md ${ROW} text-sm text-slate-400 outline-none hover:bg-slate-50 hover:text-slate-600 focus-visible:ring-2 focus-visible:ring-brand-500`}
                >
                  {collapsed ? (
                    <IconLayoutSidebarLeftExpand size={20} stroke={1.7} className="shrink-0" />
                  ) : (
                    <IconLayoutSidebarLeftCollapse size={20} stroke={1.7} className="shrink-0" />
                  )}
                  <span className={`shrink-0 ${labelFade(collapsed)}`}>Свернуть меню</span>
                </Button>
              </SideTip>
            </div>
          </aside>
        </div>

        {/* MAIN - min-h-0 lets this flex child shrink below its content so its
            own overflow-y-auto scrolls instead of growing the page. relative
            makes it the containing block for react-aria's absolutely-positioned
            hidden nodes (VisuallyHidden/HiddenSelect) so they're clipped here
            instead of escaping to grow the document (whole-page scroll + phantom
            white block on the form). flex flex-col makes the wrapper below a flex
            item so it takes its height via flex-1 (not a height:100% percentage,
            which Chrome does not resolve against a flex-item main - the wrapper
            then collapsed to content height and main scrolled). */}
        {/* -m-1 p-1: the scroll box clips at its own edge, which cut the focus
            rings and shadows of controls sitting flush against it (the buttons in
            a page header). The inset padding gives them 4px of room and the
            negative margin takes it back off the layout, so nothing moves. */}
        <main className="scroll-slim relative -m-1 flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-1">
          {/* The page fills the column edge to edge - width is capped by the
              shell above, not here. flex-1 + min-h-0 gives full-height pages
              (e.g. the view builder, which uses flex-1 at its root) a real
              bounded height via flex, with no fragile height:100% chain. Short
              pages keep a single content-sized child pinned to the top.
              The key fades the page in when the shell changes width, so the
              standard -> wide switch reads as one move; navigating between two
              pages of the same width keeps the subtree (and its state) alive. */}
          <div
            key={isWide ? "wide" : "standard"}
            className="flex min-h-0 w-full flex-1 flex-col animate-in fade-in duration-300 motion-reduce:animate-none"
          >
            {/* Outside the page, above every route: an outage belongs to the
                portal, not to whichever screen happens to be open. */}
            <PlatformHealthBanner />
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

// While the session is being resolved the shell itself is already known - the
// bar, the menu card, the content column do not depend on who is signed in.
// Drawing it right away means one continuous page instead of a bare word on
// white that is then replaced by the whole portal.
function ShellSkeleton({ width }: { width: string }) {
  return (
    <div className="flex h-screen flex-col bg-app">
      <header className="shrink-0 border-b border-slate-200 bg-surface">
        <div className={`mx-auto flex h-14 w-full items-center px-4 lg:px-6 ${width}`}>
          <span className="text-2xl font-bold lowercase leading-none tracking-tight text-brand-600">
            console
          </span>
        </div>
      </header>
      <div className={`mx-auto flex min-h-0 w-full flex-1 gap-10 px-4 py-8 lg:px-6 ${width}`}>
        <div className="hidden w-[260px] shrink-0 flex-col gap-4 sm:flex">
          <div className="rounded-xl border border-slate-200 bg-surface px-3 py-2 shadow-sm">
            <Skeleton className="h-9 w-full rounded-lg" />
          </div>
          <div className="flex flex-1 flex-col gap-2 rounded-xl border border-slate-200 bg-surface px-3 py-2 shadow-sm">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length decorative list
                key={i}
                className="h-9 w-full rounded-md"
              />
            ))}
          </div>
        </div>
        <main className="min-w-0 flex-1">
          <SkeletonText lines={6} />
        </main>
      </div>
    </div>
  );
}

// OrgSelector lives in its own sidebar card, so it fills the card's width and
// draws no card of its own. It takes the shape the width allows: a foldable
// section listing the projects while the sidebar is open, a framed select once
// it is collapsed.
function OrgSelector({ collapsed }: { collapsed: boolean }) {
  const { team, teams, setTeam } = useTeam();
  const [open, setOpen] = useStored("sidebar.projects-open", true);

  if (teams.length === 0) {
    return (
      <SideTip label="Нет группы" enabled={collapsed}>
        <span
          className={`flex items-center gap-2 overflow-hidden whitespace-nowrap rounded-lg ${ROW} text-sm text-slate-400`}
        >
          <IconUsersGroup size={20} stroke={1.7} className="shrink-0" />
          <span className={`shrink-0 ${labelFade(collapsed)}`}>нет группы</span>
        </span>
      </SideTip>
    );
  }

  // A single group is context, not a control: no menu to open.
  if (teams.length === 1) {
    return (
      <SideTip label={`Проект: ${team}`} enabled={collapsed}>
        <span
          className={`flex items-center gap-2 overflow-hidden whitespace-nowrap rounded-lg ${ROW} text-sm`}
        >
          <IconUsersGroup size={20} stroke={1.7} className="shrink-0 text-brand-600" />
          <span className={`truncate font-medium text-slate-700 ${labelFade(collapsed)}`}>{team}</span>
        </span>
      </SideTip>
    );
  }

  // Expanded, the projects are a section of the navigation like a product
  // category: the header folds, the list sits under it and the current project
  // is simply the lit-up row. Collapsed there is no room for a list, so the
  // same choice becomes a framed select with the menu in a popover.
  if (!collapsed) {
    return (
      <NavSection
        Icon={IconUsersGroup}
        label="Проекты"
        open={open}
        onToggle={() => setOpen((o) => !o)}
        framed
      >
        {/* No nesting indent: the rows carry their own icon, so aligning them
            with the header's icon reads as one list instead of a sub-list. */}
        <ul className="flex flex-col gap-0.5 py-1">
          {teams.map((t) => (
            <li key={t}>
              <Button
                onPress={() => setTeam(t)}
                aria-pressed={t === team}
                className={`flex w-full items-center gap-3 whitespace-nowrap rounded-md ${SUB_ROW} text-sm text-slate-500 outline-none hover:bg-slate-50 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-brand-500 aria-pressed:bg-brand-50 aria-pressed:font-medium aria-pressed:text-brand-700`}
              >
                <IconHash size={20} stroke={1.7} className="shrink-0 text-slate-400" />
                <span className="truncate">{t}</span>
                {t === team && <IconCheck size={16} className="ml-auto shrink-0 text-brand-600" />}
              </Button>
            </li>
          ))}
        </ul>
      </NavSection>
    );
  }

  return (
    <MenuTrigger>
      <SideTip label={`Проект: ${team}`} enabled>
        <Button
          aria-label={`Проект: ${team}`}
          className={`flex w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-50 ${SELECT_ROW} outline-none transition-colors hover:border-brand-300 hover:bg-brand-50 focus-visible:ring-2 focus-visible:ring-brand-500 data-[pressed]:border-brand-300 data-[pressed]:bg-brand-50`}
        >
          {/* No label and no chevron: neither fits beside the icon at 64px,
              and the frame alone is enough to keep it reading as a select. */}
          <IconUsersGroup size={20} stroke={1.7} className="shrink-0 text-brand-600" />
        </Button>
      </SideTip>
      <Popover className="min-w-52 rounded-md border border-slate-200 bg-surface py-1 shadow-lg outline-none entering:animate-in entering:fade-in">
        <Menu className="max-h-72 overflow-auto outline-none" onAction={(key) => setTeam(String(key))}>
          {teams.map((t) => (
            <MenuItem
              key={t}
              id={t}
              className="flex cursor-pointer items-center justify-between gap-6 px-3 py-1.5 text-sm text-slate-700 outline-none focus:bg-slate-50"
            >
              <span className="flex min-w-0 items-center gap-2">
                <IconHash size={20} stroke={1.7} className="shrink-0 text-slate-500" />
                <span className="truncate">{t}</span>
              </span>
              {t === team && <IconCheck size={16} className="shrink-0 text-brand-600" />}
            </MenuItem>
          ))}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

function IconButton({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <button
      aria-label={label}
      className="rounded-md p-2 text-slate-500 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-500"
    >
      {children}
    </button>
  );
}

// Theme switcher: system / light / dark / RN. The choice is saved in
// localStorage and applied on <html data-theme> (see ThemeContext).
//
// The tick follows what was picked, not what is on screen: with the system
// followed, a tick on "Тёмная" would read as a theme that was chosen and leave
// no way to see that the portal is simply going along with the desktop. What
// the system says right now is written next to that line instead, so the row
// explains the choice without a second control.
function ThemeMenu() {
  const { choice, system, setTheme } = useTheme();
  return (
    <MenuTrigger>
      <Button
        aria-label="Тема оформления"
        className="rounded-md p-2 text-slate-500 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <IconPalette size={20} stroke={1.7} />
      </Button>
      <Popover className="min-w-40 rounded-md border border-slate-200 bg-surface py-1 shadow-lg outline-none entering:animate-in entering:fade-in">
        <Menu className="outline-none" onAction={(key) => setTheme(key as ThemeChoice)}>
          {THEME_CHOICES.map((t) => (
            <MenuItem
              key={t}
              id={t}
              className="flex cursor-pointer items-center justify-between gap-6 px-3 py-1.5 text-sm text-slate-700 outline-none focus:bg-slate-50"
            >
              <span className="flex items-baseline gap-2">
                {THEME_LABELS[t]}
                {t === "system" && (
                  <span className="text-xs text-slate-400">
                    сейчас {THEME_LABELS[system].toLowerCase()}
                  </span>
                )}
              </span>
              {choice === t && <IconCheck size={16} className="shrink-0 text-brand-600" />}
            </MenuItem>
          ))}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

function UserMenu() {
  const { user } = useUser();
  if (!user) return null;

  return (
    <MenuTrigger>
      <Button className="ml-2 flex items-center gap-2 rounded-md py-1 pl-1 pr-2 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-500">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 text-brand-700">
          <IconUser size={20} stroke={1.7} />
        </span>
        <span className="text-left text-xs leading-tight">
          <span className="block font-medium text-slate-800">{user.name || user.preferred_username}</span>
          <span className="block text-slate-400">{ROLE_LABELS[user.role] ?? user.role}</span>
        </span>
      </Button>
      <Popover className="min-w-44 rounded-md border border-slate-200 bg-surface py-1 shadow-lg outline-none entering:animate-in entering:fade-in">
        <Menu
          className="outline-none"
          onAction={(key) => {
            if (key === "logout") {
              window.location.href = api.logoutUrl();
            }
          }}
        >
          <MenuItem
            id="logout"
            className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-slate-700 outline-none focus:bg-slate-50"
          >
            <IconLogout size={20} stroke={1.7} />
            Выйти
          </MenuItem>
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

