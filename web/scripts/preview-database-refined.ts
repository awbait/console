import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const out = resolve(import.meta.dir, "../../docs/design/icons/category-drafts");
const variants = [
  {
    name: "database-lid", title: "Г · Цельный цилиндр", motion: "Крышка приподнимается, корпус остаётся на месте.",
    shape: '<path d="M3 6v12a9 3 0 0 0 18 0V6"/><ellipse class="draft-moving" style="--dy:-2px" cx="12" cy="6" rx="9" ry="3" fill="currentColor" fill-opacity=".06"/>',
  },
  {
    name: "database-sections", title: "Д · Две секции", motion: "Верхняя секция выдвигается вправо.",
    shape: '<path d="M4 14v5a8 2 0 0 0 16 0v-5"/><ellipse cx="12" cy="14" rx="8" ry="2"/><g class="draft-moving" style="--dx:2px"><path d="M4 5v3a8 2 0 0 0 16 0V5"/><ellipse cx="12" cy="5" rx="8" ry="2" fill="currentColor" fill-opacity=".06"/></g>',
  },
];
const css = '.draft-moving{transform:translate(0,0)}:is(button:hover,button:focus-visible,.preview-active) .draft-moving,svg.category-draft:hover .draft-moving{transform:translate(var(--dx,0px),var(--dy,0px))}@media(prefers-reduced-motion:no-preference){.draft-moving{transition:transform 100ms steps(2,jump-start)}}';
const svg = (variant: typeof variants[number], size: number, animated = false) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="category-draft">${variant.shape}${animated ? `<style>${css}</style>` : ""}</svg>`;
for (const variant of variants) {
  writeFileSync(resolve(out, `${variant.name}.svg`), svg(variant, 24));
  writeFileSync(resolve(out, `${variant.name}-animated.svg`), svg(variant, 24, true));
}
const cards = variants.map(variant => `<article class="card"><header><h2>Базы данных</h2><span>${variant.title}</span></header>
<div class="states"><div><div class="hero">${svg(variant, 80)}</div><small>Обычное состояние</small></div><div><div class="hero preview-active">${svg(variant, 80)}</div><small>При наведении</small></div></div>
<div class="sizes">${[16, 20, 24, 32].map(size => `<div>${svg(variant, size)}<small>${size} px</small></div>`).join("")}</div>
<button class="row" type="button">${svg(variant, 20)}<span>Базы данных</span><span class="chevron">›</span></button><p>${variant.motion}</p></article>`).join("");
const html = readFileSync(resolve(out, "variants.html"), "utf8")
  .replace(/<title>[^<]*<\/title>/, '<title>Базы данных: варианты Г и Д</title>')
  .replace(/<h1>[^<]*<\/h1>/, '<h1>Базы данных: более простая форма</h1>')
  .replace(/<div class="grid">[\s\S]*?<\/div><\/main>/, `<div class="grid">${cards}</div></main>`);
writeFileSync(resolve(out, "database-refined.html"), html);
console.log(`Database drafts saved to ${out}`);
