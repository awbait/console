import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const out = resolve(import.meta.dir, "../../docs/design/icons");
mkdirSync(out, { recursive: true });
const directions = ["ingress", "egress"] as const;
const variants = [
  { key: "cube", title: "А · Куб сервиса", description: "Стрелка пересекает грань куба: входит в сервис или выходит из него." },
  { key: "nodes", title: "Б · Сетевой шлюз", description: "Узлы сети по обе стороны границы. Стрелка задаёт направление трафика." },
];

for (const variant of variants) {
  for (const direction of directions) {
    const incoming = direction === "ingress";
    const color = incoming ? "#244BA3" : "#126557";
    const background = incoming ? "#EAF2FF" : "#E0F5F0";
    const arrow = incoming ? "M1.5 13H13m-3-3 3 3-3 3" : "M13 13H1.5m3-3-3 3 3 3";
    const drawing = variant.key === "cube" ? `
      <defs><mask id="arrow-gap" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <path d="M0 0h24v24H0Z" fill="white" stroke="none"/>
        <path d="${arrow}" stroke="black" stroke-width="3.5"/>
      </mask></defs>
      <g mask="url(#arrow-gap)">
        <path d="m16 3 7 3.5v10.5l-7 3.5-7-3.5V6.5Z"/>
        <path d="m9 6.5 7 3.5 7-3.5M16 10v10.5"/>
      </g>
      <path d="${arrow}"/>` : `
      <circle cx="3" cy="4.5" r="2.1"/>
      <circle cx="3" cy="19.5" r="2.1"/>
      <circle cx="21" cy="12" r="2.1"/>
      <path d="M3 6.6V9l4 3-4 3v2.4M7 12h11.9"/>
      <path d="M12 2v5M12 17v5"/>
      <path d="${incoming ? "m14 9 3 3-3 3" : "m14 9-3 3 3 3"}"/>`;
    writeFileSync(resolve(out, `${direction}-gateway-${variant.key}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" fill="none">
  <title>${incoming ? "Ingress" : "Egress"} Gateway — ${variant.title}</title>
  <rect width="64" height="64" rx="16" fill="${background}"/>
  <g transform="scale(2.666666667)" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${drawing}
  </g>
</svg>
`);
  }
}

const pair = (key: string, dark: boolean) => `<div class="pair ${dark ? "dark" : ""}">${directions.map(direction => `<div class="icon-card">
  <img class="hero" src="${direction}-gateway-${key}.svg" width="80" height="80" alt="${direction}">
  <h3>${direction === "ingress" ? "Ingress" : "Egress"}</h3>
  <div class="sizes">${[16, 24, 32].map(size => `<div><div class="sample"><img src="${direction}-gateway-${key}.svg" width="${size}" height="${size}" alt=""></div><small>${size} px</small></div>`).join("")}</div>
</div>`).join("")}</div>`;
writeFileSync(resolve(out, "gateway-variants.html"), `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ingress / Egress — варианты</title><style>
*{box-sizing:border-box}body{margin:0;padding:32px;background:#f0f3f8;color:#1a2940;font:14px/1.5 system-ui,sans-serif}main{max-width:1020px;margin:auto}h1{font-size:25px;margin:0 0 24px}h2{font-size:19px;margin:0 0 5px}p{margin:0 0 20px;color:#66758b;font-size:12px}.variants{display:grid;grid-template-columns:1fr 1fr;gap:24px}.variant{padding:22px;background:white;border:1px solid #dce3ee;border-radius:16px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:20px 12px;border-radius:12px;background:#f7f9fc}.dark{background:#192332;color:#eef3fa;margin-top:16px}.icon-card{text-align:center}.hero{margin:0 auto}h3{font-size:13px;font-weight:600;margin:10px 0}.sizes{display:flex;gap:18px;align-items:flex-end;justify-content:center}.sample{height:32px;display:flex;align-items:center;justify-content:center}small{font-size:9px;color:#7b8ba2}img{display:block}a{display:inline-block;margin-top:18px;font-size:12px;color:#244ba3;text-underline-offset:3px}@media(max-width:750px){.variants{grid-template-columns:1fr}body{padding:20px}}
</style></head><body><main><h1>Ingress / Egress — два направления формы</h1><div class="variants">${variants.map(variant => `<section class="variant"><h2>${variant.title}</h2><p>${variant.description}</p>${pair(variant.key, false)}${pair(variant.key, true)}<a href="ingress-gateway-${variant.key}.svg">Ingress SVG</a> · <a href="egress-gateway-${variant.key}.svg">Egress SVG</a></section>`).join("")}</div></main></body></html>
`);
console.log(`Gateway variants saved to ${out}`);
