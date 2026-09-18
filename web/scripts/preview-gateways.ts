import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const out = resolve(import.meta.dir, "../../docs/design/icons");
mkdirSync(out, { recursive: true });

const gateways = [
  { name: "ingress", label: "Ingress Gateway", description: "Внешний трафик → сервис", color: "#244BA3", background: "#EAF2FF", arrow: "M3 12h12.5m-3.5-3.5 3.5 3.5-3.5 3.5" },
  { name: "egress", label: "Egress Gateway", description: "Сервис → внешние системы", color: "#126557", background: "#E0F5F0", arrow: "M15.5 12H3m3.5-3.5L3 12l3.5 3.5" },
  { name: "waypoint", label: "Waypoint", description: "Трафик проходит через узел", color: "#6840A5", background: "#F1EAFA", arrow: "M2 12h7M15 12h7m-3.5-3.5L22 12l-3.5 3.5" },
];

for (const gateway of gateways) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" fill="none">
  <title>${gateway.label}</title>
  <desc>${gateway.description}. Стрелка показывает направление трафика.</desc>
  <rect width="64" height="64" rx="16" fill="${gateway.background}"/>
  <g transform="scale(2.666666667)" stroke="${gateway.color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="${gateway.name === "waypoint"
      ? "M7 8V5.5A1.5 1.5 0 0 1 8.5 4h7A1.5 1.5 0 0 1 17 5.5V8M7 16v2.5A1.5 1.5 0 0 0 8.5 20h7a1.5 1.5 0 0 0 1.5-1.5V16"
      : "M10 8V5.5A1.5 1.5 0 0 1 11.5 4h8A1.5 1.5 0 0 1 21 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-8a1.5 1.5 0 0 1-1.5-1.5V16"}"/>
    <path d="${gateway.arrow}"/>
    ${gateway.name === "waypoint" ? '<circle cx="12" cy="12" r="3"/>' : ""}
  </g>
</svg>
`;
  writeFileSync(resolve(out, `${gateway.name}-gateway.svg`), svg);
}

const cards = (theme: string) => gateways.map(gateway => `<article class="card ${theme}">
  <div class="heading"><span>${gateway.name.toUpperCase()}</span><span class="direction">${gateway.name === "ingress" ? "ВХОД" : gateway.name === "egress" ? "ВЫХОД" : "ЧЕРЕЗ УЗЕЛ"}</span></div>
  <div class="hero"><img src="${gateway.name}-gateway.svg" width="96" height="96" alt="${gateway.label}"></div>
  <h2>${gateway.label}</h2><p>${gateway.description}</p>
  <div class="sizes">${[16, 20, 24, 32, 48].map(size => `<div><div class="sample"><img src="${gateway.name}-gateway.svg" width="${size}" height="${size}" alt=""></div><small>${size} px</small></div>`).join("")}</div>
  <div class="row"><img src="${gateway.name}-gateway.svg" width="24" height="24" alt=""><span>${gateway.label}</span></div>
  <a href="${gateway.name}-gateway.svg">Открыть SVG ↗</a>
</article>`).join("");

writeFileSync(resolve(out, "gateways-preview.html"), `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Ingress и Egress — эскизы</title><style>
*{box-sizing:border-box}body{margin:0;padding:36px;background:#f2f4f8;color:#172238;font:14px/1.5 system-ui,sans-serif}main{max-width:1040px;margin:auto}h1{font-size:26px;margin:0 0 6px;font-weight:650}.intro{margin:0 0 26px;color:#647084}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}.card{padding:22px 18px;border:1px solid #e1e6ef;border-radius:16px;background:white;min-width:0}.dark{background:#18212e;border-color:#293448;color:#e8edf5}.heading{display:flex;justify-content:space-between;gap:8px;align-items:center;font-size:10px;letter-spacing:1px;font-weight:650}.direction{color:#768398;font-size:9px}.hero{height:145px;display:grid;place-items:center}h2{font-size:16px;margin:0 0 5px;letter-spacing:-.2px}p{font-size:11px;min-height:34px;margin:0;color:#68758a}.dark p{color:#9caac0}.sizes{display:flex;align-items:flex-end;justify-content:space-between;gap:6px;margin:20px 0}.sizes>div{text-align:center}.sample{height:48px;display:flex;justify-content:center;align-items:center}small{display:block;font-size:9px;color:#78869b;margin-top:7px}.row{display:flex;align-items:center;gap:9px;padding:10px 8px;border-radius:7px;background:#f1f4f9;white-space:nowrap;font-size:11px}.dark .row{background:#242f3d}a{display:inline-block;margin-top:18px;color:inherit;font-size:11px;text-decoration-color:#95a4ba;text-underline-offset:3px}img{display:block;flex-shrink:0}@media(max-width:850px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:460px){body{padding:20px}.grid{grid-template-columns:1fr}}
.grid{grid-template-columns:repeat(3,minmax(0,1fr))}.hero{height:110px}.card{padding:18px}.hero img{width:80px;height:80px}.sizes{margin:12px 0}.sample{height:40px}.row{padding:8px}a{margin-top:12px}@media(max-width:700px){.grid{grid-template-columns:1fr}}
</style></head><body><main><h1>Ingress / Egress / Waypoint</h1><p class="intro">Вход, выход и прохождение через узел — одна серия значков.</p><div class="grid">${cards("light")}${cards("dark")}</div></main></body></html>
`);
console.log(`Gateway drafts saved to ${out}`);
