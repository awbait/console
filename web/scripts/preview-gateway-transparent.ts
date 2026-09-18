import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const out = resolve(root, "docs/design/icons");
const items = [
  { chart: "ingress-gateway", file: "ingress-gateway.svg", label: "Ingress Gateway" },
  { chart: "egress-gateway", file: "egress-gateway.svg", label: "Egress Gateway" },
  { chart: "waypoint", file: "waypoint-gateway.svg", label: "Waypoint" },
];
for (const item of items) copyFileSync(resolve(root, "charts", item.chart, "icon.svg"), resolve(out, item.file));
const cards = (theme: string) => items.map(item => `<article class="card ${theme}"><h2>${item.label}</h2><div class="hero"><img src="${item.file}" width="72" height="72" alt=""></div><div class="sizes">${[16, 20, 24, 32, 48].map(size => `<div><img src="${item.file}" width="${size}" height="${size}" alt=""><small>${size} px</small></div>`).join("")}</div><div class="row"><img src="${item.file}" width="24" height="24" alt="">${item.label}</div><a href="${item.file}">Открыть SVG</a></article>`).join("");
writeFileSync(resolve(out, "gateway-transparent.html"), `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gateway icons</title><style>
*{box-sizing:border-box}body{margin:0;padding:28px;background:#edf0f4;color:#24344c;font:14px/1.5 system-ui}main{max-width:1040px;margin:auto}h1{font-size:24px;margin:0 0 8px}p{margin:0 0 22px;color:#647084}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.card{background:white;border-radius:14px;padding:20px}.dark{background:#111827;color:#e5e7eb}h2{font-size:15px;margin:0}.hero{display:flex;justify-content:center;padding:24px}.sizes{display:flex;align-items:flex-end;justify-content:space-between;margin:10px 0 22px}.sizes>div{display:flex;align-items:center;flex-direction:column;gap:8px}small{font-size:10px;color:#8490a1}.row{display:flex;gap:10px;align-items:center;border-radius:6px;background:#f3f4f6;padding:10px}.dark .row{background:#242f3d}a{display:inline-block;margin-top:14px;color:inherit;font-size:12px}img{display:block}@media(max-width:680px){.grid{grid-template-columns:1fr}}
</style><main><h1>Ingress / Egress / Waypoint</h1><p>Без фона, крупнее, с увеличенными зазорами. Общая толщина линий: 1,8 на сетке 24.</p><div class="grid">${cards("light")}${cards("dark")}</div></main></html>`);
for (const item of items) {
  const chartPath = resolve(root, "charts", item.chart, "Chart.yaml");
  const source = readFileSync(resolve(root, "charts", item.chart, "icon.svg"));
  const metadata = readFileSync(chartPath, "utf8");
  writeFileSync(chartPath, metadata.replace(/^icon:.*$/m, `icon: data:image/svg+xml;base64,${source.toString("base64")}`));
}
