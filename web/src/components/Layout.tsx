import {
  IconActivity,
  IconBell,
  IconBook,
  IconBox,
  IconCheck,
  IconChecklist,
  IconChevronDown,
  IconChevronRight,
  IconCloud,
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
  Disclosure,
  DisclosureGroup,
  DisclosurePanel,
  Heading,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
} from "react-aria-components";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { CatalogChart } from "../api/types";
import { chartLabel, inMenu, useCatalog } from "../app/CatalogContext";
import { useTeam } from "../app/TeamContext";
import { THEME_LABELS, THEMES, type Theme, useTheme } from "../app/ThemeContext";
import { useUser } from "../auth/UserContext";
import { useAsync } from "../hooks/useAsync";
import { categoryIcon } from "./icons";
import { Spinner } from "./ui";

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
  { to: "/admin/categories", label: "Категории каталога", Icon: IconTags },
];

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
  const [collapsed, setCollapsed] = useState(false);
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

  // Controlled category expansion: all categories open by default, user toggles
  // persist, and the active category auto-expands (menu resolves async, so
  // defaultExpandedKeys alone wouldn't reopen it).
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [expandedInit, setExpandedInit] = useState(false);
  useEffect(() => {
    if (!expandedInit && menu.length > 0) {
      setExpanded(new Set(menu.map((g) => g.id)));
      setExpandedInit(true);
    }
  }, [expandedInit, menu]);
  useEffect(() => {
    if (activeCategory) {
      setExpanded((prev) => (prev.has(activeCategory) ? prev : new Set(prev).add(activeCategory)));
    }
  }, [activeCategory]);

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

  if (loading) return <Spinner />;
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
            <ThemeMenu />
            <Link
              to="/docs"
              aria-label="Документация"
              title="Документация"
              aria-current={pathname.startsWith("/docs") ? "page" : undefined}
              className="rounded-md p-2 text-slate-500 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-500 aria-[current=page]:bg-brand-50 aria-[current=page]:text-brand-700"
            >
              <IconBook size={20} stroke={1.7} />
            </Link>
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
          className={`flex shrink-0 flex-col gap-4 transition-[width] duration-300 ease-in-out ${
            collapsed ? "w-16" : "w-[260px]"
          }`}
        >
          {/* The project selector is a platform concept; hide it in the admin,
              support and security sections, which are not scoped to a team. */}
          {activeSection === "platform" && (
            <div className="shrink-0 rounded-xl border border-slate-200 bg-surface p-2 shadow-sm">
              <OrgSelector collapsed={collapsed} />
            </div>
          )}

          <aside className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-surface shadow-sm">
            {/* Nav scrolls on its own so the collapse toggle stays pinned to the
                bottom of the card even with a long product taxonomy. */}
            <div className="scroll-slim flex min-h-0 flex-1 flex-col overflow-y-auto">
              {/* section switcher (only when a role can see more than one section) */}
              {availableSections.length > 1 &&
                (collapsed ? (
                  <nav className="flex flex-col gap-1 px-2 pt-3">
                    {availableSections.map((s) => {
                      const Icon = s.Icon;
                      return (
                        <Link
                          key={s.id}
                          to={s.home}
                          title={s.label}
                          aria-current={activeSection === s.id ? "page" : undefined}
                          className="flex justify-center rounded-md px-3 py-2 text-slate-500 hover:bg-slate-50 aria-[current=page]:bg-brand-50 aria-[current=page]:text-brand-700"
                        >
                          <Icon size={20} stroke={1.7} />
                        </Link>
                      );
                    })}
                  </nav>
                ) : (
                  /* dropdown: section labels don't fit as a pill row once there are
                     three of them, so switch via a menu showing the active section */
                  <div className="px-3 pt-3">
                    <MenuTrigger>
                      <Button className="group flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 outline-none transition-colors hover:border-brand-300 hover:bg-brand-50 focus-visible:ring-2 focus-visible:ring-brand-500 data-[pressed]:border-brand-300 data-[pressed]:bg-brand-50">
                        <span className="flex items-center gap-2">
                          <currentSection.Icon size={18} stroke={1.7} className="text-brand-600" />
                          {currentSection.label}
                        </span>
                        <IconChevronDown
                          size={16}
                          className="text-slate-400 transition-transform duration-200 group-data-[pressed]:rotate-180"
                        />
                      </Button>
                      <Popover className="w-[var(--trigger-width)] rounded-md border border-slate-200 bg-surface py-1 shadow-lg outline-none entering:animate-in entering:fade-in">
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
                                  <Icon size={18} stroke={1.7} className="text-slate-500" />
                                  {s.label}
                                </span>
                                {activeSection === s.id && <IconCheck size={15} className="text-brand-600" />}
                              </MenuItem>
                            );
                          })}
                        </Menu>
                      </Popover>
                    </MenuTrigger>
                  </div>
                ))}

              {sectionNav ? (
                /* security/admin section: its own flat nav, no product categories */
                <nav className="px-2 py-3">
                  <ul className="flex flex-col gap-0.5">
                    {sectionNav.map((n) => {
                      const Icon = n.Icon;
                      const active = n.exact ? pathname === n.to : navActive(n.to);
                      return (
                        <li key={n.to}>
                          <Link
                            to={n.to}
                            title={collapsed ? n.label : undefined}
                            aria-current={active ? "page" : undefined}
                            className="flex items-center gap-3 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 aria-[current=page]:bg-brand-50 aria-[current=page]:text-brand-700"
                          >
                            <Icon size={20} stroke={1.7} className="shrink-0" />
                            {!collapsed && <span className="shrink-0">{n.label}</span>}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </nav>
              ) : (
                <>
                  {/* flat group: Resources / Charts (active via navActive aria-current) */}
                  <nav className="px-2 py-3">
                    <ul className="flex flex-col gap-0.5">
                      {navItems.map((n) => {
                        const Icon = n.Icon;
                        return (
                          <li key={n.to}>
                            <Link
                              to={n.to}
                              title={collapsed ? n.label : undefined}
                              aria-current={navActive(n.to) ? "page" : undefined}
                              className="flex items-center gap-3 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 aria-[current=page]:bg-brand-50 aria-[current=page]:text-brand-700"
                            >
                              <Icon size={20} stroke={1.7} className="shrink-0" />
                              {!collapsed && <span className="shrink-0">{n.label}</span>}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </nav>

                  <div className="mx-3 border-t border-slate-100" />

                  {/* product categories (dynamic: published charts with an order view) */}
                  {collapsed ? (
                    <nav className="flex flex-col gap-0.5 px-2 py-3">
                      {menu.map((g) => {
                        const Icon = categoryIcon(g.icon || g.id);
                        const first = g.charts[0];
                        return (
                          <Link
                            key={g.id}
                            to={first ? `/products/${first.project}/${first.name}` : "/catalog"}
                            title={g.label}
                            aria-current={activeCategory === g.id ? "page" : undefined}
                            className="flex rounded-md px-3 py-2 text-slate-600 hover:bg-slate-50 aria-[current=page]:bg-brand-50 aria-[current=page]:text-brand-700"
                          >
                            <Icon size={20} stroke={1.7} />
                          </Link>
                        );
                      })}
                    </nav>
                  ) : (
                    <DisclosureGroup
                      allowsMultipleExpanded
                      expandedKeys={expanded}
                      onExpandedChange={(keys) => setExpanded(new Set([...keys].map(String)))}
                      className="px-2 py-3"
                    >
                      {menu.map((g) => {
                        const Icon = categoryIcon(g.icon || g.id);
                        return (
                          <Disclosure key={g.id} id={g.id} className="group">
                            <Heading>
                              <Button
                                slot="trigger"
                                className="flex w-full items-center justify-between whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-slate-600 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-500"
                              >
                                <span className="flex items-center gap-3">
                                  <Icon size={20} stroke={1.7} />
                                  {g.label}
                                </span>
                                <IconChevronRight
                                  size={16}
                                  className="text-slate-400 transition-transform duration-200 group-data-[expanded]:rotate-90"
                                />
                              </Button>
                            </Heading>
                            <DisclosurePanel>
                              <ul className="ml-[22px] flex flex-col gap-0.5 border-l border-slate-100 py-1 pl-2">
                                {g.charts.map((c) => (
                                  <li key={`${c.project}/${c.name}`}>
                                    <Link
                                      to={`/products/${c.project}/${c.name}`}
                                      aria-current={chartActive(c) ? "page" : undefined}
                                      className="block whitespace-nowrap rounded-md px-2 py-1.5 text-sm text-slate-500 hover:bg-slate-50 hover:text-slate-700 aria-[current=page]:bg-brand-50 aria-[current=page]:font-medium aria-[current=page]:text-brand-700"
                                    >
                                      {chartLabel(c.name)}
                                    </Link>
                                  </li>
                                ))}
                              </ul>
                            </DisclosurePanel>
                          </Disclosure>
                        );
                      })}
                    </DisclosureGroup>
                  )}
                </>
              )}
            </div>

            {/* collapse toggle */}
            <div className="shrink-0 border-t border-slate-100 p-2">
              <Button
                onPress={() => setCollapsed((c) => !c)}
                aria-label={collapsed ? "Развернуть меню" : "Свернуть меню"}
                aria-pressed={collapsed}
                className="flex w-full items-center gap-3 whitespace-nowrap rounded-md px-3 py-2 text-sm text-slate-500 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                {collapsed ? (
                  <IconLayoutSidebarLeftExpand size={20} stroke={1.7} className="shrink-0" />
                ) : (
                  <IconLayoutSidebarLeftCollapse size={20} stroke={1.7} className="shrink-0" />
                )}
                {!collapsed && <span className="shrink-0">Свернуть меню</span>}
              </Button>
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
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

// OrgSelector lives in its own sidebar card, so it fills the card's width and
// draws no frame of its own. Expanded, the groups are a plain list under a
// "Проекты" header that folds away; collapsed, there is no room for the list, so
// the same groups open in a popover next to the icon.
function OrgSelector({ collapsed }: { collapsed: boolean }) {
  const { team, teams, setTeam } = useTeam();
  const [open, setOpen] = useState(true);

  if (teams.length === 0) {
    return (
      <span
        title={collapsed ? "нет группы" : undefined}
        className={`flex items-center gap-2 rounded-lg py-2 text-sm text-slate-400 ${
          collapsed ? "justify-center px-2" : "px-2.5"
        }`}
      >
        <IconUsersGroup size={20} stroke={1.7} className="shrink-0" />
        {!collapsed && "нет группы"}
      </span>
    );
  }

  if (collapsed) {
    // A single group is context, not a control: no popover to open.
    if (teams.length === 1) {
      return (
        <span
          title={team ?? undefined}
          className="flex justify-center rounded-lg px-2 py-2 text-brand-600"
        >
          <IconUsersGroup size={20} stroke={1.7} />
        </span>
      );
    }
    return (
      <MenuTrigger>
        <Button
          aria-label={`Проект: ${team}`}
          className="flex w-full justify-center rounded-lg px-2 py-2 text-brand-600 outline-none transition-colors hover:bg-brand-50 focus-visible:ring-2 focus-visible:ring-brand-500 data-[pressed]:bg-brand-50"
        >
          <IconUsersGroup size={20} stroke={1.7} />
        </Button>
        <Popover className="min-w-52 rounded-md border border-slate-200 bg-surface py-1 shadow-lg outline-none entering:animate-in entering:fade-in">
          <Menu className="outline-none" onAction={(key) => setTeam(String(key))}>
            {teams.map((t) => (
              <MenuItem
                key={t}
                id={t}
                className="flex cursor-pointer items-center justify-between gap-6 px-3 py-1.5 text-sm text-slate-700 outline-none focus:bg-slate-50"
              >
                <span className="flex items-center gap-2">
                  <IconUsersGroup size={18} stroke={1.7} className="text-slate-500" />
                  {t}
                </span>
                {t === team && <IconCheck size={15} className="text-brand-600" />}
              </MenuItem>
            ))}
          </Menu>
        </Popover>
      </MenuTrigger>
    );
  }

  // Hand-rolled disclosure instead of react-aria's: its panel is hidden with the
  // `hidden` attribute (display:none), which cannot be transitioned. The
  // grid-rows 0fr->1fr trick animates to the list's natural height without
  // measuring it. Closed, the list keeps its DOM node but leaves the tab order.
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="org-projects"
        className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-slate-600 outline-none transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <span className="flex min-w-0 items-center gap-2">
          <IconUsersGroup size={20} stroke={1.7} className="shrink-0 text-brand-600" />
          Проекты
        </span>
        <IconChevronDown
          size={16}
          className={`shrink-0 text-slate-400 transition-transform duration-200 ease-out ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <ul
            id="org-projects"
            aria-hidden={!open}
            className="flex max-h-64 flex-col gap-0.5 overflow-y-auto pt-1"
          >
            {teams.map((t) => (
              <li key={t}>
                <button
                  type="button"
                  onClick={() => setTeam(t)}
                  tabIndex={open ? undefined : -1}
                  aria-current={t === team ? "true" : undefined}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-slate-500 hover:bg-slate-50 hover:text-slate-700 aria-[current]:bg-brand-50 aria-[current]:font-medium aria-[current]:text-brand-700"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <IconHash size={18} stroke={1.7} className="shrink-0 text-slate-400" />
                    <span className="truncate">{t}</span>
                  </span>
                  {t === team && <IconCheck size={15} className="shrink-0 text-brand-600" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
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

// Theme switcher: light / dark / RN. The choice is saved in localStorage and
// applied on <html data-theme> (see ThemeContext).
function ThemeMenu() {
  const { theme, setTheme } = useTheme();
  return (
    <MenuTrigger>
      <Button
        aria-label="Тема оформления"
        className="rounded-md p-2 text-slate-500 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <IconPalette size={20} stroke={1.7} />
      </Button>
      <Popover className="min-w-40 rounded-md border border-slate-200 bg-surface py-1 shadow-lg outline-none entering:animate-in entering:fade-in">
        <Menu className="outline-none" onAction={(key) => setTheme(key as Theme)}>
          {THEMES.map((t) => (
            <MenuItem
              key={t}
              id={t}
              className="flex cursor-pointer items-center justify-between gap-6 px-3 py-1.5 text-sm text-slate-700 outline-none focus:bg-slate-50"
            >
              {THEME_LABELS[t]}
              {theme === t && <IconCheck size={15} className="text-brand-600" />}
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
          <IconUser size={18} stroke={1.7} />
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
            <IconLogout size={16} stroke={1.7} />
            Выйти
          </MenuItem>
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

function LoginScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="rounded-lg border border-slate-200 bg-surface p-8 text-center shadow-sm">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-brand-600 text-on-accent">
          <IconCloud size={24} stroke={1.8} />
        </div>
        <h1 className="text-lg font-semibold text-slate-800">Console</h1>
        <p className="text-xs text-slate-400">Managed Services</p>
        <p className="mt-2 text-sm text-slate-500">Вы не аутентифицированы.</p>
        <a
          href={api.loginUrl(window.location.pathname + window.location.search)}
          className="mt-4 inline-block rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-on-accent hover:bg-brand-700"
        >
          Войти через Keycloak
        </a>
      </div>
    </div>
  );
}
