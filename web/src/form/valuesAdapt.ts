// Fitting an order's saved values to the schema of a newer chart version.
//
// An upgrade opens the form of the target version over the values the order was
// created with, and between two versions a field changes shape: a list of
// gateways becomes the one gateway, a single block becomes a list, a field moves
// under "global" or disappears. Those values are not wrong - they were right for
// the version that saved them - but the new schema has nowhere to put them, and
// the form cannot show what it cannot draw. What it does instead is worse than
// showing nothing: an object field handed a list spreads it into keys "0", "1",
// ... beside the new fields, and the order goes to the server as values no
// schema accepts, complaining about fields the person never saw.
//
// So the values are fitted to the new schema before the form opens, and every
// change is said out loud - the person is about to send these values under their
// own name, and a value that quietly disappeared is found much later, in the
// cluster. Nothing is invented here: a field the new version brought with it is
// filled in by the version's "initial" block (see internal/views/initial.go),
// which is a different question from this one.
//
// The same walk repairs values already spoiled by an earlier upgrade, because
// what it finds there is the shape it knows how to read: an object carrying
// "0" next to the new fields is a list that was spread, and the element inside
// it is where the answers are.

import { deref, fieldBreadcrumb, type Schema } from "./fieldPath";
import { mergeUnder } from "./valuesMerge";

type Values = Record<string, unknown>;

// Adapted is the fitted values and what had to be done to them, in the order it
// was done. A note names the field the way the form names it.
export interface Adapted {
  values: Values;
  notes: string[];
}

function isObject(v: unknown): v is Values {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const isIndex = (k: string) => /^\d+$/.test(k);

// adaptToSchema fits values to the schema and returns them with a note per
// change. Values the schema accepts as they are come back untouched, and so does
// everything the walk cannot judge: a variant (oneOf), a map of free-form keys,
// a field the schema says nothing about. Being too careful here costs a person
// one confusing field; being too eager costs them a value they meant to keep.
export function adaptToSchema(schema: Schema, values: Values, view?: Schema): Adapted {
  const notes: string[] = [];
  if (!schema || !isObject(values)) return { values, notes };
  const label = (path: string) => fieldBreadcrumb(path, schema, view) || "Значения";
  const fitted = adapt(schema, values, schema, label, "", notes);
  return { values: isObject(fitted?.value) ? fitted.value : {}, notes };
}

// adapt returns the value fitted to one schema node, or null when nothing of it
// can be kept. Null is not an error: it means the field is cleared, and the note
// beside it says so.
function adapt(
  node: Schema,
  value: unknown,
  root: Schema,
  label: (path: string) => string,
  path: string,
  notes: string[],
): { value: unknown } | null {
  const s = deref(node, root);
  // A variant node decides which branch it is by the value it holds, and that
  // decision is the form's (matchVariant). Fitting the value to the branch this
  // walk guessed would change the variant under the person.
  if (Array.isArray(s.oneOf)) return { value };
  if (s.type === "object" && s.properties) return adaptObject(s, value, root, label, path, notes);
  if (s.type === "array") return adaptArray(s, value, root, label, path, notes);
  // A leaf that holds a whole structure is a field that used to be one - there
  // is no first element to take and no key to read it by.
  if (typeof s.type === "string" && s.type !== "object" && isStructure(value)) {
    notes.push(`${label(path)}: прежнее значение не подходит новой версии. Поле очищено.`);
    return null;
  }
  return { value };
}

function isStructure(v: unknown): boolean {
  return Array.isArray(v) || isObject(v);
}

// adaptObject fits a value to a block of fields.
//
// A list arriving here is the shape the field had in the older version, and its
// first element is the block the person filled in: one gateway out of a list of
// one is exactly the change charts make when they decide a release may only have
// one. Elements past the first have nowhere to go and are named in the note
// rather than dropped in silence.
function adaptObject(
  s: Schema,
  value: unknown,
  root: Schema,
  label: (path: string) => string,
  path: string,
  notes: string[],
): { value: unknown } | null {
  let obj: Values;
  if (Array.isArray(value)) {
    const first = value[0];
    if (!isObject(first)) {
      notes.push(`${label(path)}: прежнее значение не подходит новой версии. Поле очищено.`);
      return null;
    }
    notes.push(listToBlock(label(path), value.length));
    obj = first;
  } else if (isObject(value)) {
    obj = recoverSpreadList(s, value, label(path), notes);
  } else if (value === undefined || value === null) {
    return { value };
  } else {
    notes.push(`${label(path)}: прежнее значение не подходит новой версии. Поле очищено.`);
    return null;
  }

  const out: Values = {};
  for (const [key, child] of Object.entries(obj)) {
    const childSchema = s.properties?.[key];
    if (!childSchema) {
      // A chart that accepts unknown keys keeps them: Helm will take them too,
      // and a subchart the portal never mounted answers for its own values.
      if (s.additionalProperties !== false) {
        out[key] = child;
        continue;
      }
      // At the root there is no block to name the key inside, and the key is
      // all there is to call it by: the new schema never heard of it, so it has
      // no title either.
      const where = path ? `${label(path)} › ${key}` : key;
      notes.push(`${where}: в новой версии такого поля нет. Значение удалено.`);
      continue;
    }
    const fitted = adapt(childSchema, child, root, label, `${path}/${key}`, notes);
    if (fitted) out[key] = fitted.value;
  }
  return { value: out };
}

// recoverSpreadList reads back a list that was spread into the block: keys "0",
// "1", ... that the schema does not declare, left behind when a form wrote a new
// field into what was still a list. The first element is merged UNDER what is
// already there, so anything typed since wins and the rest of the old element
// comes back instead of staying out of reach.
function recoverSpreadList(s: Schema, value: Values, name: string, notes: string[]): Values {
  const spread = Object.keys(value).filter((k) => isIndex(k) && !s.properties?.[k]);
  if (spread.length === 0) return value;
  const kept: Values = {};
  for (const [k, v] of Object.entries(value)) if (!spread.includes(k)) kept[k] = v;
  const first = value[spread.sort((a, b) => Number(a) - Number(b))[0]];
  if (!isObject(first)) return kept;
  notes.push(listToBlock(name, spread.length));
  return mergeUnder(kept, first);
}

function listToBlock(name: string, count: number): string {
  const head = `${name}: раньше это был список, теперь одно поле. Значения первого элемента перенесены.`;
  return count > 1 ? `${head} Остальные элементы удалены.` : head;
}

// adaptArray fits a value to a list.
//
// The mirror of adaptObject: a field that used to hold one block now holds
// several, and what the order has is that one block - it becomes the first
// element rather than being thrown away.
function adaptArray(
  s: Schema,
  value: unknown,
  root: Schema,
  label: (path: string) => string,
  path: string,
  notes: string[],
): { value: unknown } | null {
  let list: unknown[];
  if (Array.isArray(value)) list = value;
  else if (value === undefined || value === null) return { value };
  else if (isObject(value)) {
    const keys = Object.keys(value);
    if (keys.length > 0 && keys.every(isIndex)) {
      // A list that was spread into an object and never written into since:
      // its own keys, in their own order, are the list itself.
      list = keys.sort((a, b) => Number(a) - Number(b)).map((k) => value[k]);
    } else {
      notes.push(`${label(path)}: раньше это было одно поле, теперь список. Прежние значения стали первым элементом.`);
      list = [value];
    }
  } else {
    notes.push(`${label(path)}: прежнее значение не подходит новой версии. Поле очищено.`);
    return null;
  }
  const items = s.items ?? {};
  const out: unknown[] = [];
  list.forEach((item, i) => {
    const fitted = adapt(items, item, root, label, `${path}/${i}`, notes);
    if (fitted) out.push(fitted.value);
  });
  return { value: out };
}
