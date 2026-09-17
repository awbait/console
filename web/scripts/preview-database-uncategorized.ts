import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const out = resolve(import.meta.dir, "../../docs/design/icons/category-drafts");
const middle = 'M3 9c0 1.66 4.03 3 9 3s9-1.34 9-3v4c0 1.66-4.03 3-9 3s-9-1.34-9-3Z';
const variants = [
  {
    name: "database-drawer", category: "Базы данных", title: "Е · Три секции", motion: "Средняя секция выдвигается целиком.",
    shape: `<defs><mask id="__ID__" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><path d="M0 0h24v24H0Z" fill="white" stroke="none"/><path class="draft-moving" style="--dx:1.5px" d="${middle}" fill="black" stroke="black"/></mask></defs><g mask="url(#__ID__)"><path d="M3 5v4c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 13v5c0 1.66 4.03 3 9 3s9-1.34 9-3v-5M3 13c0 1.66 4.03 3 9 3s9-1.34 9-3"/></g><path class="draft-moving" style="--dx:1.5px" d="${middle}" fill="currentColor" fill-opacity=".06"/>`,
  },
  {
    name: "database-table", category: "Базы данных", title: "Ж · Таблица", motion: "Таблица приподнимается перед цилиндром.",
    shape: '<defs><mask id="__ID__" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><path d="M0 0h24v24H0Z" fill="white" stroke="none"/><rect class="draft-moving" style="--dy:-1.5px" x="11" y="11" width="11" height="10" rx="1.5" fill="black" stroke="black"/></mask></defs><g mask="url(#__ID__)"><ellipse cx="10" cy="5" rx="7" ry="3"/><path d="M3 5v12c0 1.66 3.13 3 7 3s7-1.34 7-3V5M3 11c0 1.66 3.13 3 7 3s7-1.34 7-3"/></g><g class="draft-moving" style="--dy:-1.5px"><rect x="11" y="11" width="11" height="10" rx="1.5" fill="currentColor" fill-opacity=".06"/><path d="M11 16h11M16.5 11v10"/></g>',
  },
  {
    name: "uncategorized-tag", category: "Без категории", title: "А · Пустая метка", motion: "Метка немного сдвигается при наведении.",
    shape: '<g class="draft-moving" style="--dx:1px;--dy:1px"><path d="M3 3h8l10 10-8 8L3 11Z" fill="currentColor" fill-opacity=".06"/><circle cx="7.5" cy="7.5" r="1.5"/></g>',
  },
  {
    name: "uncategorized-outline", category: "Без категории", title: "Б · Пунктирный контейнер", motion: "Черта внутри смещается, контур остаётся неподвижным.",
    shape: '<rect x="3" y="3" width="18" height="18" rx="3" stroke-dasharray="2.8 3.2"/><path class="draft-moving" style="--dx:1.5px" d="M8 12h8"/>',
  },
];
const css = '.draft-moving{transform:translate(0,0)}:is(button:hover,button:focus-visible,.preview-active) .draft-moving,svg.category-draft:hover .draft-moving{transform:translate(var(--dx,0px),var(--dy,0px))}@media(prefers-reduced-motion:no-preference){.draft-moving{transition:transform 100ms steps(2,jump-start)}}';
let sequence = 0;
function svg(variant: typeof variants[number], size: number, animated = false) {
  const shape = variant.shape.replaceAll('__ID__', `draft-mask-${++sequence}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="category-draft">${shape}${animated ? `<style>${css}</style>` : ''}</svg>`;
}
for (const variant of variants) {
  writeFileSync(resolve(out, `${variant.name}.svg`), svg(variant, 24));
  writeFileSync(resolve(out, `${variant.name}-animated.svg`), svg(variant, 24, true));
}
const cards = variants.map(variant => `<article class="card"><header><h2>${variant.category}</h2><span>${variant.title}</span></header>
<div class="states"><div><div class="hero">${svg(variant, 80)}</div><small>Обычное состояние</small></div><div><div class="hero preview-active">${svg(variant, 80)}</div><small>При наведении</small></div></div>
<div class="sizes">${[16, 20, 24, 32].map(size => `<div>${svg(variant, size)}<small>${size} px</small></div>`).join('')}</div>
<button class="row" type="button">${svg(variant, 20)}<span>${variant.category}</span><span class="chevron">›</span></button><p>${variant.motion}</p></article>`).join('');
const html = readFileSync(resolve(out, 'variants.html'), 'utf8')
  .replace(/<title>[^<]*<\/title>/, '<title>Базы данных и без категории</title>')
  .replace(/<h1>[^<]*<\/h1>/, '<h1>Базы данных и «Без категории»</h1>')
  .replace(/<div class="grid">[\s\S]*?<\/div><\/main>/, `<div class="grid">${cards}</div></main>`);
writeFileSync(resolve(out, 'database-uncategorized.html'), html);
console.log(`Category drafts saved to ${out}`);
