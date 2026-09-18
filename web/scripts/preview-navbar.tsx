import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { NavbarInfoIcon, NavbarMoonIcon, NavbarSunIcon, NavbarSystemIcon, NavbarUserIcon } from "../src/components/NavbarIcons";

const out = resolve(import.meta.dir, "../../docs/design/icons");
const css = readFileSync(resolve(import.meta.dir, "../src/components/sidebar.css"), "utf8");
const items = [["О портале", NavbarInfoIcon], ["Профиль", NavbarUserIcon], ["Светлая тема", NavbarSunIcon], ["Тёмная тема", NavbarMoonIcon], ["Системная тема", NavbarSystemIcon]] as const;
writeFileSync(resolve(out, "navbar.html"), `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Навбар</title><style>body{margin:0;padding:28px;background:#edf0f4;color:#24344c;font:14px/1.5 system-ui}h1{font-size:24px;margin:0 0 8px}p{margin:0 0 24px;color:#647084}.theme{display:flex;gap:16px;justify-content:space-around;background:#fff;border-radius:14px;padding:24px;margin-top:16px}.dark{background:#111827;color:#e5e7eb}button{font:inherit;color:inherit;border:0;background:transparent;display:flex;flex-direction:column;align-items:center;gap:14px;padding:12px;cursor:pointer;border-radius:6px}button:focus-visible{outline:2px solid currentColor}button span{font-size:12px}${css}</style><h1>Верхняя панель</h1><p>Общая толщина линий, анимация при наведении за 100 мс.</p>${["light", "dark"].map(theme => `<section class="theme ${theme}">${items.map(([name, Icon]) => `<button>${renderToStaticMarkup(<Icon size={40} />)}<span>${name}</span>${renderToStaticMarkup(<Icon size={20} />)}</button>`).join("")}</section>`).join("")}</html>`);
