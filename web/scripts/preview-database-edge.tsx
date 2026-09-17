import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { categoryGlyphs } from "../src/components/CategoryIcons";

const out = resolve(import.meta.dir, "../../docs/design/icons/category-drafts");
const css = readFileSync(resolve(import.meta.dir, "../src/components/sidebar.css"), "utf8");
const Icon = categoryGlyphs.database;
writeFileSync(resolve(out, "database-edge.html"), `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Базы данных</title><style>
body{font:14px system-ui;padding:24px;margin:0;background:#edf0f4;color:#24344c}.grid{display:flex;gap:20px}.card{background:white;padding:24px;border-radius:12px;flex:1}.dark{background:#111827;color:#e5e7eb}.samples{display:flex;gap:24px;margin:24px 0}button{color:inherit;background:transparent;border:0;display:flex;gap:12px;align-items:center;font:inherit;cursor:pointer;height:36px;padding:0}${css}</style><main class="grid">${["light", "dark"].map(theme => `<section class="card ${theme}">${[0, 1, 2].map(step => `<div class="samples">${[16, 20, 24].map(size => renderToStaticMarkup(<Icon size={size} />, { identifierPrefix: `${theme}-${step}-${size}` }).replace('class="category-database-band"', `class="category-database-band" style="transform:translateY(${step}px)"`)).join("")}</div>`).join("")}<button>${renderToStaticMarkup(<Icon size={20} />, { identifierPrefix: `${theme}-hover` })}Базы данных</button></section>`).join("")}</main></html>`);
