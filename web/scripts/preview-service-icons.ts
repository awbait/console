import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const out = resolve(root, "docs/design/icons");
const items = [
  { chart: "policies", label: "Policies", description: "Правила доступа", change: "Перерисовали иконку правил доступа как щит с регуляторами без фона и с общей толщиной линий." },
  { chart: "namespace", label: "Namespace", description: "Изолированная область ресурсов", change: "Добавили SVG-иконку области ресурсов без фона и с общей толщиной линий." },
  { chart: "project", label: "Project", description: "Глобальный объект", change: "Добавили SVG-иконку глобуса для глобального объекта проекта без фона и с общей толщиной линий." },
  { chart: "secret-store", label: "Secret Store", description: "Исходный знак хранилища секретов", change: "Перерисовали исходный знак хранилища секретов в общей толщине линий для читаемости в каталоге." },
  { chart: "console", label: "Console", description: "Знак Console", change: "Добавили SVG-иконку на основе знака Console без фона и с общей толщиной линий." },
];
for (const item of items) {
  copyFileSync(resolve(root, "charts", item.chart, "icon.svg"), resolve(out, `${item.chart}.svg`));
  const chartPath = resolve(root, "charts", item.chart, "Chart.yaml");
  const source = readFileSync(resolve(root, "charts", item.chart, "icon.svg"));
  const metadata = readFileSync(chartPath, "utf8");
  const field = `icon: data:image/svg+xml;base64,${source.toString("base64")}`;
  const updated = /^icon:/m.test(metadata)
    ? metadata.replace(/^icon:[^\r\n]*/m, field)
    : metadata.replace(/^(version:[^\r\n]*)(\r?\n)/m, (_, line, eol) => `${line}${eol}${field}${eol}`);
  if (!updated.includes(field)) throw new Error(`Missing icon: ${item.chart}`);
  writeFileSync(chartPath, updated);
  const logPath = resolve(root, "charts", item.chart, "CHANGELOG.md");
  const log = readFileSync(logPath, "utf8");
  if (!log.includes(item.change)) {
    if (log.includes("## [Unreleased]")) throw new Error(`Review existing unreleased section: ${item.chart}`);
    const eol = log.includes("\r\n") ? "\r\n" : "\n";
    const section = ["## [Unreleased]", "", "### Changed", "", `- ${item.change}`, "", ""].join(eol);
    writeFileSync(logPath, log.replace(/(?=^## \[\d)/m, section));
  }
}
const cards = (theme: string, onlyConsole = false) => items.filter(item => (item.chart === "console") === onlyConsole).map(item => `<article class="card ${theme}"><h2>${item.label}</h2><p>${item.description}</p><div class="hero"><img src="${item.chart}.svg" width="72" height="72" alt=""></div><div class="sizes">${[16, 20, 24, 32].map(size => `<div><img src="${item.chart}.svg" width="${size}" height="${size}" alt=""><small>${size} px</small></div>`).join("")}</div><div class="row"><img src="${item.chart}.svg" width="24" height="24" alt="">${item.label}</div><a href="${item.chart}.svg">Открыть SVG</a></article>`).join("");
writeFileSync(resolve(out, "service-icons.html"), `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Service icons</title><style>
*{box-sizing:border-box}body{margin:0;padding:28px;background:#edf0f4;color:#24344c;font:14px/1.5 system-ui}main{max-width:1120px;margin:auto}h1{font-size:24px;margin:0 0 8px}.intro{margin:0 0 22px;color:#647084}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}.card{background:white;border-radius:14px;padding:18px}.dark{background:#111827;color:#e5e7eb}h2{font-size:15px;margin:0}.card p{font-size:11px;min-height:32px;margin:6px 0 0;color:#79869a}.hero{display:flex;justify-content:center;padding:20px}.sizes{display:flex;align-items:flex-end;justify-content:space-between;margin:10px 0 22px}.sizes>div{display:flex;align-items:center;flex-direction:column;gap:8px}small{font-size:10px;color:#8490a1}.row{display:flex;gap:10px;align-items:center;border-radius:6px;background:#f3f4f6;padding:10px}.dark .row{background:#242f3d}a{display:inline-block;margin-top:14px;color:inherit;font-size:12px}img{display:block}.reference{display:flex;align-items:center;gap:14px;margin-top:20px;font-size:12px}.reference img{width:44px;height:44px}@media(max-width:850px){.grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:480px){.grid{grid-template-columns:1fr}}
</style><main><h1>Policies / Namespace / Project / Secret Store</h1><p class="intro">Крупные символы, прозрачный фон, общая толщина линий.</p><div class="grid">${cards("light")}${cards("dark")}</div><div class="reference"><img src="secret-store-original.svg" alt="">Исходная иконка Secret Store</div></main></html>`);
const consolePage = readFileSync(resolve(out, "service-icons.html"), "utf8")
  .replace(cards("light") + cards("dark"), cards("light", true) + cards("dark", true))
  .replace("Policies / Namespace / Project / Secret Store", "Console")
  .replace(/<div class="reference">[\s\S]*?<\/div>/, "")
  .replace("</style>", "main{max-width:650px}.grid{grid-template-columns:repeat(2,1fr)}@media(max-width:480px){.grid{grid-template-columns:1fr}}</style>");
writeFileSync(resolve(out, "console-icon.html"), consolePage);
