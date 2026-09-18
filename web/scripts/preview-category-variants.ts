import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const out = resolve(import.meta.dir, "../../docs/design/icons/category-drafts");
mkdirSync(out, { recursive: true });
const variants = [
  {
    name: "platform-layers", category: "Платформа", title: "Б · Слои", motion: "Верхний слой приподнимается.",
    shape: '<path d="m2 12 10 5 10-5M2 16l10 5 10-5"/><path class="draft-moving" style="--dy:-2px" d="m12 3 10 5-10 5L2 8Z" fill="currentColor" fill-opacity=".06"/>',
  },
  {
    name: "platform-modules", category: "Платформа", title: "В · Модули", motion: "Модули опускаются к общему основанию.",
    shape: '<path d="M2 16v4h20v-4"/><g class="draft-moving" style="--dy:2px"><rect x="2" y="3" width="8" height="9" rx="1.25" fill="currentColor" fill-opacity=".06"/><rect x="14" y="3" width="8" height="9" rx="1.25" fill="currentColor" fill-opacity=".06"/></g>',
  },
  {
    name: "database-disks", category: "Базы данных", title: "Б · Диски", motion: "Средний диск выдвигается вправо.",
    shape: '<ellipse cx="12" cy="5" rx="9" ry="2.5"/><ellipse class="draft-moving" style="--dx:1.5px" cx="12" cy="12" rx="9" ry="2.5" fill="currentColor" fill-opacity=".06"/><ellipse cx="12" cy="19" rx="9" ry="2.5"/>',
  },
  {
    name: "database-pair", category: "Базы данных", title: "В · Два цилиндра", motion: "Задний цилиндр выдвигается из-за переднего.",
    shape: '<defs><mask id="__ID__" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><path d="M0 0h24v24H0Z" fill="white" stroke="none"/><path d="M3 10a6 2.5 0 0 1 12 0v9a6 2.5 0 0 1-12 0Z" fill="black" stroke="black"/></mask></defs><g mask="url(#__ID__)"><g class="draft-moving" style="--dx:1.5px;--dy:-1px"><path d="M9 5.5v10a6 2.5 0 0 0 12 0v-10"/><ellipse cx="15" cy="5.5" rx="6" ry="2.5"/></g></g><path d="M3 10v9a6 2.5 0 0 0 12 0v-9"/><ellipse cx="9" cy="10" rx="6" ry="2.5" fill="currentColor" fill-opacity=".06"/>',
  },
];
const motionCSS = `
.draft-moving{transform:translate(0,0)}
:is(button:hover,button:focus-visible,.preview-active) .draft-moving,svg.category-draft:hover .draft-moving{transform:translate(var(--dx,0px),var(--dy,0px))}
@media(prefers-reduced-motion:no-preference){.draft-moving{transition:transform 100ms steps(2,jump-start)}}
`;
let sequence = 0;
function svg(variant: typeof variants[number], size: number, animated = false) {
  const shape = variant.shape.replaceAll("__ID__", `draft-mask-${++sequence}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="category-draft">${shape}${animated ? `<style>${motionCSS}</style>` : ""}</svg>`;
}
for (const variant of variants) {
  writeFileSync(resolve(out, `${variant.name}.svg`), svg(variant, 24));
  writeFileSync(resolve(out, `${variant.name}-animated.svg`), svg(variant, 24, true));
}
const card = (variant: typeof variants[number]) => `<article class="card">
  <header><h2>${variant.category}</h2><span>${variant.title}</span></header>
  <div class="states"><div><div class="hero">${svg(variant, 80)}</div><small>Обычное состояние</small></div><div><div class="hero preview-active">${svg(variant, 80)}</div><small>При наведении</small></div></div>
  <div class="sizes">${[16, 20, 24, 32].map(size => `<div>${svg(variant, size)}<small>${size} px</small></div>`).join("")}</div>
  <button class="row" type="button">${svg(variant, 20)}<span>${variant.category}</span><span class="chevron">›</span></button>
  <p>${variant.motion}</p>
</article>`;
writeFileSync(resolve(out, "variants.html"), `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Категории: варианты Б и В</title><style>
*{box-sizing:border-box}body{margin:0;padding:30px;background:#f1f4f8;color:#243248;font:14px/1.5 system-ui,sans-serif}main{max-width:1000px;margin:auto}.top{display:flex;gap:20px;align-items:center;justify-content:space-between;margin-bottom:6px}h1{font-size:24px;margin:0}button{font:inherit;cursor:pointer}.theme-toggle{background:white;color:inherit;border:1px solid #dce3ed;border-radius:7px;padding:7px 12px;font-size:12px}.intro{margin:0 0 22px;color:#7c899c;font-size:12px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.card{padding:20px 24px;border:1px solid #dfe5ee;border-radius:16px;background:white}.card header{display:flex;justify-content:space-between;gap:12px;align-items:center}h2{font-size:17px;margin:0}.card header>span{font-size:12px;color:#7b899d}.states{display:grid;grid-template-columns:1fr 1fr;gap:24px;text-align:center;margin-top:12px}.hero{display:grid;place-items:center;height:104px}small{font-size:10px;color:#8793a5}.sizes{display:flex;justify-content:center;align-items:flex-end;gap:30px;margin:18px 0}.sizes>div{display:flex;align-items:center;flex-direction:column;gap:7px}svg{display:block;flex-shrink:0}.row{height:36px;display:flex;width:100%;align-items:center;gap:12px;padding:8px 9px;border:0;border-radius:6px;background:#f1f4f8;color:inherit;font-weight:600;font-size:14px;text-align:left}.row:focus-visible,.theme-toggle:focus-visible{outline:2px solid #5077d1;outline-offset:3px}.chevron{margin-left:auto;color:#8290a3;font-size:22px;font-weight:400}.card p{margin:10px 0 0;color:#7e8da3;font-size:11px}body.dark{background:#131b26;color:#e6ecf6}.dark .card,.dark .theme-toggle{background:#1b2431;border-color:#2c3748}.dark .row{background:#273243}@media(max-width:650px){body{padding:20px}.grid{grid-template-columns:1fr}.top{align-items:flex-start}h1{font-size:21px}}
${motionCSS}</style></head><body><main><div class="top"><h1>Платформа и базы данных: ещё варианты</h1><button class="theme-toggle" type="button" aria-pressed="false">Тёмный фон</button></div><p class="intro">Наведите на строку категории. Движение занимает 100 мс.</p><div class="grid">${variants.map(card).join("")}</div></main><script>
document.querySelector('.theme-toggle').addEventListener('click',event=>{const dark=document.body.classList.toggle('dark');event.currentTarget.setAttribute('aria-pressed',String(dark));event.currentTarget.textContent=dark?'Светлый фон':'Тёмный фон';});
</script></body></html>`);
console.log(`Category variants saved to ${out}`);
