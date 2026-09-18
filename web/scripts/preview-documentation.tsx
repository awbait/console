import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { DocumentationIcon } from "../src/components/DocumentationIcon";

const out = resolve(import.meta.dir, "../../docs/design/icons/category-drafts");
const css = readFileSync(resolve(import.meta.dir, "../src/components/sidebar.css"), "utf8");
let index = 0;
const html = readFileSync(resolve(out, "security.html"), "utf8")
  .replaceAll("Безопасность", "Документация")
  .replace("· Щит", "· Листы")
  .replace("При наведении две половины смыкаются.", "При наведении передний лист выдвигается из стопки.")
  .replace(/<svg\b[^>]*class="category-icon category-icon-shield "[\s\S]*?<\/svg>/g, svg => renderToStaticMarkup(<DocumentationIcon size={svg.includes('width="20"') ? 20 : 24} />, { identifierPrefix: `docs-${index++}` }))
  .replace("</style>", `${css}</style>`);
writeFileSync(resolve(out, "documentation.html"), html);
const svg = renderToStaticMarkup(<DocumentationIcon />).replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ');
writeFileSync(resolve(out, "documentation-animated.svg"), svg.replace("</svg>", `<style>${css}</style></svg>`));
