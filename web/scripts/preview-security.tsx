import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { categoryGlyphs } from "../src/components/CategoryIcons";

const out = resolve(import.meta.dir, "../../docs/design/icons/category-drafts");
const css = readFileSync(resolve(import.meta.dir, "../src/components/sidebar.css"), "utf8");
const Icon = categoryGlyphs.shield;
const svg = renderToStaticMarkup(<Icon size={24} />);
writeFileSync(resolve(out, "security-animated.svg"), svg.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ').replace("</svg>", `<style>${css}</style></svg>`));
writeFileSync(resolve(out, "security.html"), `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Безопасность</title><style>
*{box-sizing:border-box}body{margin:0;padding:32px;background:#edf0f4;color:#24344c;font:14px/1.5 system-ui}h1{font-size:22px;margin:0 0 8px}p{margin:0 0 24px;color:#617084}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.card{background:#fff;padding:24px;border-radius:16px}.dark{background:#111827;color:#e5e7eb}.large{display:flex;justify-content:center;padding:24px 0 36px}.large svg{width:88px;height:88px}button{font:inherit;color:inherit;display:flex;gap:12px;align-items:center;width:100%;height:36px;padding:0 10px;border:0;border-radius:6px;background:#f3f4f6;cursor:pointer}.dark button{background:#242f3d}button:focus-visible{outline:2px solid currentColor;outline-offset:3px}.neighbors{display:flex;gap:24px;justify-content:center;margin-top:28px;opacity:.65}${css}</style><h1>Безопасность · Щит</h1><p>При наведении две половины смыкаются. 100 мс, два шага.</p><main class="grid">${["light", "dark"].map(theme => `<section class="card ${theme}"><div class="large">${svg}</div><button>${renderToStaticMarkup(<Icon size={20} />)}Безопасность</button><div class="neighbors">${["stack", "database", "shield", "tag"].map(name => { const Glyph = categoryGlyphs[name]; return renderToStaticMarkup(<Glyph size={20} />); }).join("")}</div></section>`).join("")}</main></html>`);
