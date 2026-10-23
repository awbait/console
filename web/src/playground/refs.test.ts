import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TEMPLATE_REFS } from "./refs";

// The catalogue is written once, in Go, and copied here because the playground
// has no portal to ask. This reads the Go literal back and compares, so a
// reference added to the portal shows up as a failing test rather than as a
// hint the playground never offers.
test("TEMPLATE_REFS matches views.TemplateRefs() in Go", () => {
  const src = readFileSync(resolve(import.meta.dir, "../../../internal/views/tmpl.go"), "utf8");
  const body = src.slice(src.indexOf("func TemplateRefs()"));
  const re = /\{"(\.[A-Za-z.]+)", "([^"]*)", (true|false), (true|false)\}/g;
  const fromGo = [...body.matchAll(re)].map((m) => ({
    ref: m[1],
    desc: m[2],
    at_order_form: m[3] === "true",
    in_namespace: m[4] === "true",
  }));
  expect(fromGo.length).toBeGreaterThan(0);
  expect(TEMPLATE_REFS).toEqual(fromGo);
});
