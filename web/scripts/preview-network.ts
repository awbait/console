import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const out = resolve(import.meta.dir, "../../docs/design/icons");
type Point = [number, number];
const variants = [
  { id: "connections", label: "Б · Связи", description: "Три узла и прямые связи. Форма плавно меняется.", base: [[5, 6], [19, 6], [12, 19]] as Point[], duration: 3.2 },
  { id: "nodes", label: "В · Узлы", description: "Центр неподвижен. Внешние узлы двигаются независимо.", base: [[6, 6], [18, 6], [12, 12], [6, 18], [18, 18]] as Point[], duration: 3.6 },
];
const n = (v: number) => Number(v.toFixed(3));
const path = (id: string, points: Point[]) => id === "connections"
  ? `M${points.map(p => p.map(n).join(" ")).join("L")}Z`
  : [0, 1, 3, 4].map(i => `M${points[2].map(n).join(" ")}L${points[i].map(n).join(" ")}`).join("");
const drawings: Record<string, string> = {};
for (const variant of variants) {
  const frames = Array.from({ length: 33 }, (_, frame) => {
    const t = frame / 32 * Math.PI * 2;
    const points = variant.base.map(([x, y], i): Point => {
      if (variant.id === "nodes" && i === 2) return [x, y];
      if (variant.id === "connections") return [x + Math.sin(t + i * 2.1) * (i === 2 ? 2.5 : 1), y + Math.sin(t + i * 2.1 + .8) * (i === 2 ? .5 : 1.8)];
      return [x + Math.sin(t + i * 1.5) * 1.8, y + Math.sin(t * 2 + i * 1.1) * 1.6];
    });
    return { percent: n(frame / 32 * 100), points };
  });
  const linksAnimation = `@keyframes ${variant.id}-links{${frames.map(f => `${f.percent}%{d:path("${path(variant.id, f.points)}")}`).join("")}}`;
  const nodesAnimation = variant.base.map(([x, y], i) => `@keyframes ${variant.id}-${i}{${frames.map(f => `${f.percent}%{transform:translate(${n(f.points[i][0] - x)}px,${n(f.points[i][1] - y)}px)}`).join("")}}`).join("");
  const styles = `<style>.${variant.id}-links{animation:${variant.id}-links ${variant.duration}s linear infinite}
${variant.base.map((_, i) => `.${variant.id}-${i}{animation:${variant.id}-${i} ${variant.duration}s linear infinite}`).join("")}
${linksAnimation}${nodesAnimation}
@media(prefers-reduced-motion:reduce){.motion{animation:none!important}}</style>`;
  const nodes = (mask: boolean) => variant.base.map(([x, y], i) => `<circle class="motion ${variant.id}-${i}" cx="${x}" cy="${y}" r="${mask ? 2.8 : 2.6}"${mask ? ' fill="black" stroke="none"' : ''}/>`).join("");
  drawings[variant.id] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Сеть">${styles}<defs><mask id="${variant.id}-mask" x="0" y="0" width="24" height="24" maskUnits="userSpaceOnUse"><rect width="24" height="24" fill="white" stroke="none"/>${nodes(true)}</mask></defs><path class="motion ${variant.id}-links" d="${path(variant.id, variant.base)}" mask="url(#${variant.id}-mask)"/>${nodes(false)}</svg>`;
  writeFileSync(resolve(out, `network-${variant.id}-animated.svg`), drawings[variant.id]);
}
const render = (id: string, suffix: string) => drawings[id].replaceAll(`${id}-mask`, `${id}-mask-${suffix}`);
const card = (variant: typeof variants[number], theme: string) => `<article class="card ${theme}"><h2>${variant.label}</h2><p>${variant.description}</p><div class="large">${render(variant.id, `${theme}-large`)}</div><div class="row">${render(variant.id, `${theme}-small`)}<span>Сеть</span><span class="chevron">⌄</span></div><a href="network-${variant.id}-animated.svg">Открыть SVG</a></article>`;
writeFileSync(resolve(out, "network-motion.html"), `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Сеть: Б и В в движении</title><style>
*{box-sizing:border-box}body{margin:0;background:#eef1f5;color:#24344c;font:15px/1.5 system-ui,sans-serif;padding:40px}main{max-width:1050px;margin:auto}h1{font-size:28px;margin:0 0 8px}header p{color:#56677c;margin:0 0 20px}button{font:inherit;background:white;color:inherit;border:1px solid #acb7c5;border-radius:8px;padding:9px 16px;cursor:pointer;margin-bottom:24px}button:focus-visible{outline:2px solid #2563eb;outline-offset:3px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}.card{padding:28px 32px;background:white;border-radius:16px;min-width:0}.card h2{font-size:20px;margin:0 0 8px}.card p{font-size:13px;color:#617086;margin:0;min-height:40px}.large{height:144px;display:flex;align-items:center;justify-content:center}.large svg{width:92px;height:92px}.row{display:flex;align-items:center;gap:12px;border-radius:7px;background:#f1f5f9;padding:11px 14px;font-size:14px;font-weight:600}.row svg{width:20px;height:20px}.chevron{margin-left:auto;color:#77869c}a{display:inline-block;font-size:12px;color:inherit;margin-top:18px;text-underline-offset:3px}.dark{background:#11161d;color:#e4ecf6}.dark p{color:#a2afbf}.dark .row{background:#202832}body[data-paused=true] .motion{animation-play-state:paused!important}@media(max-width:760px){.grid{grid-template-columns:1fr}body{padding:20px}}
</style></head><body><main><header><h1>Сеть: Б и В в движении</h1><p>Крупный рисунок и фактический размер в меню. Без вращения всей иконки и мигания.</p><button type="button" aria-pressed="false" id="pause">Остановить анимацию</button></header><div class="grid">${["light", "dark"].flatMap(theme => variants.map(v => card(v, theme))).join("")}</div></main><script>document.getElementById('pause').onclick=function(){const paused=document.body.dataset.paused!=='true';document.body.dataset.paused=String(paused);this.setAttribute('aria-pressed',String(paused));this.textContent=paused?'Включить анимацию':'Остановить анимацию';}</script></body></html>`);
console.log(`Network motion preview saved to ${out}`);
