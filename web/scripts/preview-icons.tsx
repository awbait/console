import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { categoryGlyphs } from "../src/components/CategoryIcons";
import { CatalogIcon } from "../src/components/CatalogIcon";
import { OrdersIcon } from "../src/components/OrdersIcon";
import { ProjectsIcon } from "../src/components/ProjectsIcon";

// Run with `bun run scripts/preview-icons.tsx` from web/.
const out = resolve(import.meta.dir, "../../docs/design/icons");
mkdirSync(out, { recursive: true });
const labels: Record<string, string> = {
  catalog: "Каталог",
  orders: "Список заказов",
  projects: "Проекты",
  tag: "Без категории",
  stack: "Платформа", network: "Сеть", database: "Базы данных", box: "Ресурсы",
  server: "Серверы", cloud: "Облако", shield: "Безопасность", lock: "Доступ",
  key: "Ключи", chart: "Мониторинг", bucket: "Хранилище", cpu: "Вычисления",
  apps: "Приложения", messages: "Сообщения",
};
const iconCSS = readFileSync(resolve(import.meta.dir, "../src/components/sidebar.css"), "utf8");
const motion = iconCSS.slice(iconCSS.indexOf(".category-icon-accent"));
for (const [name, Icon] of Object.entries({ catalog: CatalogIcon, orders: OrdersIcon, projects: ProjectsIcon, ...categoryGlyphs })) {
  const svg = renderToStaticMarkup(<Icon size={24} />)
    .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')
    .replace('aria-hidden="true"', 'role="img"')
    .replace(/(<svg[^>]*>)/, `$1<title>${labels[name]}</title>`);
  writeFileSync(resolve(out, `${name}.svg`), `${svg}\n`);
  if (name === "network") {
    writeFileSync(resolve(out, "network-ring-animated.svg"), svg.replace("</svg>", `<style>${motion}</style></svg>\n`));
  }
  if (name === "catalog" || name === "orders" || name === "projects") {
    writeFileSync(resolve(out, `${name}-animated.svg`), svg.replace("</svg>", `<style>${motion}</style></svg>\n`));
  }
}
const gateway = (name: string) => readFileSync(resolve(out, `${name}-gateway.svg`), "utf8");
const gatewayCard = (name: string, description: string) => `<article class="gateway">
  <div class="hero-icon">${gateway(name)}</div><h3>${name === "ingress" ? "Ingress" : "Egress"} Gateway</h3>
  <p>${description}</p><div class="sizes">${[16, 20, 24, 32].map(size => `<div><img src="${name}-gateway.svg" width="${size}" height="${size}" alt=""><small>${size} px</small></div>`).join("")}</div>
  <a href="${name}-gateway.svg" download>Скачать SVG</a></article>`;
const categories = (theme: string) => Object.entries(categoryGlyphs).map(([name, Icon]) => `<button class="glyph" type="button" aria-label="${labels[name]}">
  ${renderToStaticMarkup(<Icon size={28} />, { identifierPrefix: `${theme}-${name}-large` })}<span>${labels[name]}</span>${renderToStaticMarkup(<Icon size={20} />, { identifierPrefix: `${theme}-${name}-small` })}</button>`).join("");
const panel = (theme: string) => `<section class="theme ${theme}"><h2>${theme === "light" ? "Светлая тема" : "Тёмная тема"}</h2>
  <div class="gateways">${gatewayCard("ingress", "Входящий трафик: снаружи к сервису.")}${gatewayCard("egress", "Исходящий трафик: от сервиса наружу.")}</div>
  <h2 class="category-title">Категории</h2><div class="categories">${categories(theme)}</div></section>`;
writeFileSync(resolve(out, "preview.html"), `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Иконки платформы</title><style>
*{box-sizing:border-box}body{margin:0;background:#e9ecf1;color:#172033;font:14px/1.5 system-ui,sans-serif;padding:36px}
header{max-width:1180px;margin:0 auto 24px}h1{font-size:28px;letter-spacing:-.7px;margin:0 0 8px}header p{margin:0;color:#566176}
.themes{display:grid;grid-template-columns:1fr 1fr;gap:24px;max-width:1180px;margin:auto}.theme{padding:28px;border-radius:20px;background:#fff;color:#27374e;min-width:0}
.dark{background:#0a0a0a;color:#e0e0e0}.theme h2{font-size:13px;font-weight:600;margin:0 0 22px;color:#58687c}.dark h2{color:#a1a1a1}
.gateways{display:grid;grid-template-columns:1fr 1fr;gap:24px}.gateway{min-width:0}.hero-icon svg{width:88px;height:88px}h3{font-size:19px;margin:14px 0 6px;letter-spacing:-.3px}.gateway p{font-size:13px;max-width:190px;min-height:40px;color:#58687c;margin:0}.dark p{color:#a1a1a1}
.sizes{display:flex;gap:16px;align-items:flex-end;margin:24px 0 16px;height:62px}.sizes>div{display:flex;flex-direction:column;align-items:center;gap:8px}.sizes small{font-size:11px;color:#58687c}.dark small{color:#a1a1a1}a{color:#244ba3;font-size:12px;text-underline-offset:3px}.dark a{color:#93b4ff}
.theme .category-title{margin-top:32px;padding-top:24px;border-top:1px solid #dce2eb}.dark .category-title{border-color:#333}.categories{display:grid;grid-template-columns:1fr 1fr;gap:8px 18px}.glyph{font:inherit;display:flex;align-items:center;gap:10px;padding:10px 0;text-align:left;border:0;background:none;color:inherit;cursor:pointer}.glyph span{flex:1;font-size:12px}.glyph svg{flex-shrink:0}.glyph>svg:last-child{opacity:.65}.glyph:hover,.glyph:focus-visible{color:#244ba3}.dark .glyph:hover,.dark .glyph:focus-visible{color:#93b4ff}.glyph:focus-visible{outline:2px solid currentColor;outline-offset:3px;border-radius:4px}
@media(max-width:950px){.themes{grid-template-columns:1fr}body{padding:20px}}@media(max-width:460px){.theme{padding:20px}.categories{grid-template-columns:1fr}.gateways{gap:16px}.sizes{gap:10px}}
${motion}</style></head><body><header><h1>Иконки платформы</h1><p>Ingress и Egress: эскизы перед подключением к чартам. Наведите на категорию, чтобы увидеть анимацию.</p></header><main class="themes">${panel("light")}${panel("dark")}</main></body></html>\n`);
const ringSVG = readFileSync(resolve(out, "network-ring-animated.svg"), "utf8");
const ringMask = ringSVG.match(/<mask id="([^"]+)"/)![1];
const ring = (key: string) => ringSVG.replaceAll(ringMask, `network-${key}`);
writeFileSync(resolve(out, "network-ring.html"), `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Сеть: кольцо</title><style>
*{box-sizing:border-box}body{margin:0;padding:40px;background:#edf0f4;color:#24344c;font:15px/1.5 system-ui,sans-serif}main{max-width:880px;margin:auto}h1{font-size:26px;margin:0 0 10px}p{margin:0 0 24px;color:#58677c}.grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}.card{padding:28px;border-radius:16px;background:white}.dark{background:#141b24;color:#e3eaf4}.large{height:190px;display:grid;place-items:center}.large svg{width:96px;height:96px}.row{display:flex;align-items:center;gap:12px;background:#f1f5f9;padding:12px;border-radius:8px}.dark .row{background:#242f3d}.row svg{width:24px;height:24px}svg{flex-shrink:0}a{color:inherit;display:inline-block;margin-top:24px}button{font:inherit;border:1px solid #a1afbf;border-radius:7px;background:white;color:#24344c;padding:8px 14px;cursor:pointer;margin-bottom:24px}.row{width:100%;border:0;margin:0;text-align:left;color:inherit}.row:focus-visible{outline:2px solid currentColor;outline-offset:3px}@media(max-width:680px){.grid{grid-template-columns:1fr}body{padding:20px}}
</style></head><body><main><h1>Сеть: кольцо и три узла</h1><p>Наведите на «Сеть»: два кружка окажутся сверху, один снизу. Уберите курсор, чтобы вернуть их обратно.</p><div class="grid">${["light", "dark"].map(theme => `<article class="card ${theme}"><div class="large">${ring(`${theme}-large`)}</div><button type="button" class="row">${ring(`${theme}-small`)}Сеть</button></article>`).join("")}</div><a href="network-ring-animated.svg">Открыть SVG</a></main><script>

</script></body></html>\n`);
console.log(`Icon preview saved to ${out}`);
