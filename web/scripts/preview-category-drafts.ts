import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const out = resolve(import.meta.dir, "../../docs/design/icons/category-drafts");
mkdirSync(out, { recursive: true });
const icons = [
  {
    name: "platform", label: "Платформа", caption: "Куб на основании", motion: "Куб быстро приподнимается над основанием.",
    shape: '<path d="m2 15 10 6 10-6"/><g class="draft-platform-cube"><path d="m12 3 7 3.5v7L12 17l-7-3.5v-7Z" fill="currentColor" fill-opacity=".06"/><path d="m5 6.5 7 3.5 7-3.5M12 10v7"/></g>',
  },
  {
    name: "database", label: "Базы данных", caption: "Крупный цилиндр", motion: "Внутренняя линия быстро смещается вниз.",
    shape: '<path d="M3 6v12c0 1.66 4.03 3 9 3s9-1.34 9-3V6"/><ellipse cx="12" cy="6" rx="9" ry="3" fill="currentColor" fill-opacity=".06"/><path class="draft-database-band" d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/>',
  },
];
const css = `
.draft-platform-cube,.draft-database-band{transform:translateY(0)}
:is(button:hover,button:focus-visible,.preview-active) .draft-platform-cube,svg.draft-platform:hover .draft-platform-cube{transform:translateY(-1.5px)}
:is(button:hover,button:focus-visible,.preview-active) .draft-database-band,svg.draft-database:hover .draft-database-band{transform:translateY(2px)}
@media(prefers-reduced-motion:no-preference){.draft-platform-cube,.draft-database-band{transition:transform 100ms steps(2,jump-start)}}
`;
const svg = (icon: typeof icons[number], size: number, animated = false) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="draft-${icon.name}">${icon.shape}${animated ? `<style>${css}</style>` : ""}</svg>`;
for (const icon of icons) {
  writeFileSync(resolve(out, `${icon.name}.svg`), svg(icon, 24));
  writeFileSync(resolve(out, `${icon.name}-animated.svg`), svg(icon, 24, true));
}
const card = (icon: typeof icons[number], dark: boolean) => `<article class="card ${dark ? "dark" : ""}">
  <h2>${icon.label}</h2><p class="caption">${icon.caption}</p>
  <div class="states"><div><div class="hero">${svg(icon, 76)}</div><small>Обычное состояние</small></div><div><div class="hero preview-active">${svg(icon, 76)}</div><small>При наведении</small></div></div>
  <div class="sizes">${[16, 20, 24, 32].map(size => `<div>${svg(icon, size)}<small>${size} px</small></div>`).join("")}</div>
  <button type="button" class="row">${svg(icon, 20)}<span>${icon.label}</span><span class="chevron">›</span></button>
  <p class="motion">${icon.motion}</p>
</article>`;
writeFileSync(resolve(out, "preview.html"), `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Платформа и базы данных: эскизы</title><style>
*{box-sizing:border-box}body{margin:0;padding:32px;background:#f1f4f8;color:#243248;font:14px/1.5 system-ui,sans-serif}main{max-width:980px;margin:auto}h1{font-size:25px;margin:0 0 6px}.intro{margin:0 0 24px;color:#6a788d}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.card{padding:22px 26px;border:1px solid #dfe5ee;border-radius:16px;background:white}.dark{background:#1b2431;color:#e6ecf6;border-color:#2c3748}h2{margin:0;font-size:18px;font-weight:650}.caption{color:#7b899d;margin:2px 0 14px;font-size:12px}.states{display:grid;grid-template-columns:1fr 1fr;gap:24px;text-align:center}.hero{display:grid;place-items:center;height:108px}small{font-size:10px;color:#8793a5}.sizes{display:flex;justify-content:center;align-items:flex-end;gap:30px;margin:22px 0}.sizes>div{display:flex;align-items:center;flex-direction:column;gap:8px}svg{flex-shrink:0;display:block}.row{height:36px;display:flex;width:100%;align-items:center;gap:12px;padding:8px 9px;border:0;border-radius:6px;background:#f1f4f8;color:inherit;font:600 14px system-ui,sans-serif;text-align:left;cursor:pointer}.dark .row{background:#273243}.row:focus-visible{outline:2px solid #5077d1;outline-offset:3px}.chevron{margin-left:auto;color:#8290a3;font-size:22px;font-weight:400}.motion{margin:12px 0 0;color:#7e8da3;font-size:11px}@media(max-width:650px){body{padding:20px}.grid{grid-template-columns:1fr}}
${css}</style></head><body><main><h1>Платформа и базы данных</h1><p class="intro">Наведите на строку категории, чтобы проверить анимацию.</p><div class="grid">${icons.map(icon => card(icon, false)).join("")}${icons.map(icon => card(icon, true)).join("")}</div></main></body></html>`);
console.log(`Category drafts saved to ${out}`);
