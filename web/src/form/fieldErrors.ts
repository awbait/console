// Canonical user-facing validation messages and shared field validators.
// The wording contract lives in CLAUDE.md ("Тексты интерфейса"): product tone,
// one error per field (the first failed check), no spec-style fragments. Every
// new input validation must compose these helpers instead of inlining strings,
// so identical checks always read identically across the app.

export const fieldMsg = {
  required: "Обязательное поле.",
  charset: "Используйте строчные латинские буквы, цифры и дефис.",
  charsetDots: "Используйте строчные латинские буквы, цифры, точку и дефис.",
  charsetFromLetter: "Используйте строчные латинские буквы, цифры и дефис, начиная с буквы.",
  // Platform variables are named the other way round: a document references
  // one as "{{.Vars.OPS_DOMAIN}}", and upper case is what tells such a reference
  // apart from a reference to the order.
  charsetUpperFromLetter:
    "Используйте заглавные латинские буквы, цифры и подчёркивание, начиная с буквы.",
  edgeChars: "Первый и последний символ - буква или цифра.",
  firstLetter: "Первый символ - буква, последний - буква или цифра.",
  pathSlash: "Начните путь с косой черты.",
  badFormat: "Недопустимый формат.",
  integer: "Введите целое число.",
  number: "Введите число.",
  // What is left to say when a value breaks a rule the portal cannot put into
  // words: a schema keyword nobody has translated, or a failure that belongs to
  // no single field. Says the value is the problem without pretending to know
  // more than it does.
  badValue: "Значение не подходит.",
  notUnique: "Значения не должны повторяться.",
  minLen: (n: number) => `Не короче ${n} символов.`,
  maxLen: (n: number) => `Не длиннее ${n} символов.`,
  min: (n: number) => `Не меньше ${n}.`,
  max: (n: number) => `Не больше ${n}.`,
  range: (min: number, max: number) => `Значение от ${min} до ${max}.`,
  taken: (name: string) => `Имя «${name}» уже занято.`,
  oneOf: (values: string[]) => `Допустимые значения: ${values.join(", ")}.`,
  minItems: (n: number) =>
    n <= 1
      ? "Добавьте хотя бы один элемент."
      : `Добавьте хотя бы ${n} ${ruPlural(n, "элемент", "элемента", "элементов")}.`,
  maxItems: (n: number) => `Не больше ${n} ${ruPlural(n, "элемента", "элементов", "элементов")}.`,
};

// The same rules said as requirements rather than as complaints: a hint lists
// what the field takes, so it names it instead of telling the reader what to
// do. Only the messages that read as an instruction need a second form - "Не
// длиннее 63 символов." is already a statement.
export const fieldHint = {
  charset: "Строчные латинские буквы, цифры и дефис.",
  charsetDots: "Строчные латинские буквы, цифры, точка и дефис.",
  integer: "Целое число.",
  pathSlash: "Путь начинается с косой черты.",
};

// withField prefixes a canonical message with a field label for error lists
// where several fields report at once ("projectTag: не короче 2 символов.").
export function withField(label: string, msg: string): string {
  return `${label}: ${msg.charAt(0).toLowerCase()}${msg.slice(1)}`;
}

// ruPlural picks the Russian plural form: ruPlural(n, "элемент", "элемента",
// "элементов") -> 1 элемент, 2 элемента, 5 элементов.
export function ruPlural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

// RFC 1123 DNS label: lower-case latin letters, digits and hyphens, no leading
// or trailing hyphen. Namespaces, workload names, service accounts and naming
// tags all follow it.
export const DNS_LABEL_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

// RFC 1123 DNS subdomain: labels as above, joined by dots. The name of a
// Kubernetes object, which is what a service name becomes (the ArgoCD
// application) and what a chart may name a thing after - the secret-store calls
// a store after the vault it reads, vault.idp.ecpk.test-vault.
export const DNS_SUBDOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

// FieldConstraints is the part of a chart's values.schema.json that says what
// may be typed into a field.
export interface FieldConstraints {
  type?: string;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
}

// FieldRequirement is one rule a field states about itself, and the check for
// it: the form ticks off what the typed value already satisfies, so the person
// sees which part is still missing instead of finding out on submit.
export interface FieldRequirement {
  text: string;
  // met answers for a non-empty value. An empty field is "not yet", not
  // "wrong", and callers show those rules neutral rather than failing.
  met: (value: string) => boolean;
  // What to say when the value breaks this rule, if the requirement itself does
  // not read as an instruction. "Первый символ - буква" already tells the
  // reader what is wrong; "Строчные латинские буквы" needs "Используйте".
  err?: string;
}

const CHARSET_RE = /^[a-z0-9-]*$/;
const DOTS_CHARSET_RE = /^[a-z0-9.-]*$/;
const INTEGER_RE = /^-?\d+$/;
// Like a DNS label, but the first character has to be a letter. Charts use it
// for the tags that become the leading part of a resource name.
const LETTER_LABEL_RE = /^[a-z]([a-z0-9-]*[a-z0-9])?$/;

// The rules a pattern is made of. Written once because two fields ask for them
// in different voices: the hint names what the field takes, the error says what
// to do about a value that does not.
const charsetRule: FieldRequirement = {
  text: fieldHint.charset,
  met: (v) => CHARSET_RE.test(v),
  err: fieldMsg.charset,
};
const edgeRule: FieldRequirement = { text: fieldMsg.edgeChars, met: (v) => DNS_LABEL_RE.test(v) };
const dotsCharsetRule: FieldRequirement = {
  text: fieldHint.charsetDots,
  met: (v) => DOTS_CHARSET_RE.test(v),
  err: fieldMsg.charsetDots,
};
const subdomainEdgeRule: FieldRequirement = {
  text: fieldMsg.edgeChars,
  met: (v) => DNS_SUBDOMAIN_RE.test(v),
};
const firstLetterRule: FieldRequirement = {
  text: fieldMsg.firstLetter,
  met: (v) => LETTER_LABEL_RE.test(v),
};
const pathRule: FieldRequirement = {
  text: fieldHint.pathSlash,
  met: (v) => v.startsWith("/"),
  err: fieldMsg.pathSlash,
};

// Patterns charts use, and what each one says in words. A regular expression is
// not something to show a person, so a pattern nobody has put into words
// contributes no rules and the field simply says less.
//
// Matching is by the text of the pattern, which is exact by nature: an
// equivalent regular expression written differently is a different string here.
// That is why this list is meant to grow with the charts - and why a chart that
// needs a shape the portal cannot phrase should say so itself rather than hope
// its regular expression is recognised (see issue #189).
const CHARSET_PATTERNS: { re: string; msg: string; rules: FieldRequirement[] }[] = [
  // DNS label, with and without the edge-character clause.
  {
    re: "^[a-z0-9]([a-z0-9-]*[a-z0-9])?$",
    msg: fieldMsg.charset,
    rules: [charsetRule, edgeRule],
  },
  {
    re: "^[a-z0-9]([-a-z0-9]*[a-z0-9])?$",
    msg: fieldMsg.charset,
    rules: [charsetRule, edgeRule],
  },
  { re: "^[a-z0-9-]+$", msg: fieldMsg.charset, rules: [charsetRule] },
  { re: "^[a-z0-9-]*$", msg: fieldMsg.charset, rules: [charsetRule] },
  // DNS subdomain: the same label, and dots between labels.
  {
    re: "^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$",
    msg: fieldMsg.charsetDots,
    rules: [dotsCharsetRule, subdomainEdgeRule],
  },
  {
    re: "^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$",
    msg: fieldMsg.charsetDots,
    rules: [dotsCharsetRule, subdomainEdgeRule],
  },
  // The same label, but starting with a letter.
  {
    re: "^[a-z]([a-z0-9-]*[a-z0-9])?$",
    msg: fieldMsg.charsetFromLetter,
    rules: [charsetRule, firstLetterRule],
  },
  // An HTTP path: the only thing the pattern demands is the leading slash.
  { re: "^/", msg: fieldMsg.pathSlash, rules: [pathRule] },
];

// findPattern looks a pattern up by its text, ignoring the whitespace around
// it: a chart that indents its schema differently means the same rule.
function findPattern(pattern: string) {
  const re = pattern.trim();
  return CHARSET_PATTERNS.find((p) => p.re === re);
}

// fieldRequirements lists what a field accepts, in the same words the error
// would use if the value were wrong - so the hint and the complaint never
// disagree. Order follows what a person checks first: characters, then length,
// then range. Returns an empty list when the schema says nothing worth
// repeating (an enum, for instance, states its own options).
export function fieldRequirements(s: FieldConstraints): FieldRequirement[] {
  const out: FieldRequirement[] = [];
  if (s.pattern) {
    const known = findPattern(s.pattern);
    if (known) out.push(...known.rules);
  }
  if (s.type === "integer") {
    out.push({ text: fieldHint.integer, met: (v) => INTEGER_RE.test(v) });
  }
  if (typeof s.minLength === "number" && s.minLength > 0) {
    const n = s.minLength;
    out.push({ text: fieldMsg.minLen(n), met: (v) => v.length >= n });
  }
  if (typeof s.maxLength === "number") {
    const n = s.maxLength;
    out.push({ text: fieldMsg.maxLen(n), met: (v) => v.length <= n });
  }
  const { minimum: lo, maximum: hi } = s;
  if (typeof lo === "number" && typeof hi === "number") {
    out.push({ text: fieldMsg.range(lo, hi), met: (v) => inRange(v, lo, hi) });
  } else if (typeof lo === "number") {
    out.push({ text: fieldMsg.min(lo), met: (v) => inRange(v, lo, Number.POSITIVE_INFINITY) });
  } else if (typeof hi === "number") {
    out.push({ text: fieldMsg.max(hi), met: (v) => inRange(v, Number.NEGATIVE_INFINITY, hi) });
  }
  return out;
}

// inRange is false for anything that is not a number: a half-typed "-" or "1e"
// satisfies no bound, and saying so is more honest than treating it as zero.
function inRange(v: string, lo: number, hi: number): boolean {
  const n = Number(v);
  return v.trim() !== "" && !Number.isNaN(n) && n >= lo && n <= hi;
}

// dnsLabelError validates a DNS label and returns the canonical message for
// the first failed check only (bad characters and a hyphen on the edge are
// separate checks), or null when valid. Empty input is valid here:
// requiredness is a separate concern (fieldMsg.required or a disabled button).
export function dnsLabelError(v: string, maxLen = 63): string | null {
  if (!v) return null;
  if (v.length > maxLen) return fieldMsg.maxLen(maxLen);
  if (!/^[a-z0-9-]+$/.test(v)) return fieldMsg.charset;
  if (!DNS_LABEL_RE.test(v)) return fieldMsg.edgeChars;
  return null;
}

// dnsLabelRequirements is dnsLabelError said forwards: the same three checks,
// as rules the field states about itself before anything is wrong. Fields the
// portal writes by hand - service name, cluster, namespace - have no chart
// schema for fieldRequirements to read, so their list is built here, next to
// the validator it has to agree with. Order matches the other lists:
// characters first, then length.
export function dnsLabelRequirements(maxLen = 63): FieldRequirement[] {
  return [
    { text: fieldHint.charset, met: (v) => CHARSET_RE.test(v) },
    { text: fieldMsg.edgeChars, met: (v) => DNS_LABEL_RE.test(v) },
    { text: fieldMsg.maxLen(maxLen), met: (v) => v.length <= maxLen },
  ];
}

// dnsSubdomainError is dnsLabelError with dots allowed between labels.
export function dnsSubdomainError(v: string, maxLen = 63): string | null {
  if (!v) return null;
  if (v.length > maxLen) return fieldMsg.maxLen(maxLen);
  if (!DOTS_CHARSET_RE.test(v)) return fieldMsg.charsetDots;
  if (!DNS_SUBDOMAIN_RE.test(v)) return fieldMsg.edgeChars;
  return null;
}

// dnsSubdomainRequirements is dnsSubdomainError said forwards.
export function dnsSubdomainRequirements(maxLen = 63): FieldRequirement[] {
  return [
    { text: fieldHint.charsetDots, met: (v) => DOTS_CHARSET_RE.test(v) },
    { text: fieldMsg.edgeChars, met: (v) => DNS_SUBDOMAIN_RE.test(v) },
    { text: fieldMsg.maxLen(maxLen), met: (v) => v.length <= maxLen },
  ];
}

// FieldKind is the two halves of one rule set travelling together: what the
// field says it takes, and what it says when the value is not that. A field
// driven by a chart schema gets both from the schema; a field the portal writes
// by hand - the order card, the map dialogs - names a kind instead of wiring
// the hint and the check separately, which is how the two used to disagree.
//
// Pass it to TextField as `kind` and the field grows an "i" with the rules
// ticking off as they are met, and reports the first broken one under itself.
export interface FieldKind {
  requirements: FieldRequirement[];
  // The canonical message for the first failed check, or null when the value is
  // acceptable. Empty input is always acceptable here: whether a field may be
  // left blank is the form's business, not the rule set's.
  error: (value: string) => string | null;
}

// The kinds a hand-written field can be. Anything used in more than one place
// belongs here; a rule that is true of exactly one field (the Harbor path) is
// better declared next to that field.
export const fieldKind = {
  // RFC 1123 DNS label: cluster names, workload names, service accounts.
  dnsLabel: (maxLen = 63): FieldKind => ({
    requirements: dnsLabelRequirements(maxLen),
    error: (v) => dnsLabelError(v, maxLen),
  }),

  // RFC 1123 DNS subdomain: the service name, which may come from a chart field
  // that names a Kubernetes object.
  dnsSubdomain: (maxLen = 63): FieldKind => ({
    requirements: dnsSubdomainRequirements(maxLen),
    error: (v) => dnsSubdomainError(v, maxLen),
  }),

  // A whole number within bounds: ports, replica counts, sizes.
  integerRange: (lo: number, hi: number): FieldKind => ({
    requirements: [
      { text: fieldHint.integer, met: (v) => INTEGER_RE.test(v) },
      { text: fieldMsg.range(lo, hi), met: (v) => inRange(v, lo, hi) },
    ],
    error: (v) => {
      if (!v) return null;
      if (!INTEGER_RE.test(v)) return fieldMsg.integer;
      return inRange(v, lo, hi) ? null : fieldMsg.range(lo, hi);
    },
  }),
};

// patternError is what a value that does not match a field's pattern is told.
// A regular expression is not something to show a person, so a pattern we can
// say in words says it - in the same sentence the field's own hint uses - and
// any other one only says the format is wrong.
//
// Given the value, it names the rule that value actually broke, which is the
// one thing the person needs: told "используйте строчные буквы" about "1abc",
// they would go looking for a capital letter that is not there. Without a value
// - a complaint that came back from the server, where only the field is known -
// the pattern speaks for itself as a whole.
export function patternError(pattern: string, value?: string): string {
  const known = findPattern(pattern);
  if (!known) return fieldMsg.badFormat;
  if (value !== undefined) {
    const broken = known.rules.find((r) => !r.met(value));
    if (broken) return broken.err ?? broken.text;
  }
  return known.msg;
}

// SchemaRule is the part of a schema node needed to word a complaint about it:
// the constraints a field states, plus the ones that belong to a list or a
// choice rather than to a typed value.
export interface SchemaRule extends FieldConstraints {
  enum?: unknown[];
  const?: unknown;
  minItems?: number;
  maxItems?: number;
}

// schemaViolationText says, in the portal's own words, what a value broke.
//
// The backend validates the submitted values against the chart's schema and
// reports the rule that failed ("minLength", "pattern", ...) rather than a
// sentence: its validator speaks English and in the vocabulary of JSON Schema
// ("length must be >= 3, but got 2"), which is not something to put in front of
// a person. The sentence is written here instead, from the same fieldMsg the
// form uses while the value is being typed - so what is said after sending the
// order and what was said during typing are the same words.
//
// The rule itself comes from the schema the form already has, not from the
// message: the field knows it is at most 63 characters long, and reading that
// off the node is more honest than parsing it out of a complaint.
export function schemaViolationText(keyword: string | undefined, s: SchemaRule = {}): string {
  switch (keyword) {
    case "required":
      return fieldMsg.required;
    case "type":
      if (s.type === "integer") return fieldMsg.integer;
      if (s.type === "number") return fieldMsg.number;
      return fieldMsg.badValue;
    case "minLength":
      return typeof s.minLength === "number" ? fieldMsg.minLen(s.minLength) : fieldMsg.badValue;
    case "maxLength":
      return typeof s.maxLength === "number" ? fieldMsg.maxLen(s.maxLength) : fieldMsg.badValue;
    case "minimum":
    case "exclusiveMinimum":
    case "maximum":
    case "exclusiveMaximum":
    case "multipleOf": {
      const { minimum: lo, maximum: hi } = s;
      if (typeof lo === "number" && typeof hi === "number") return fieldMsg.range(lo, hi);
      if (typeof lo === "number") return fieldMsg.min(lo);
      if (typeof hi === "number") return fieldMsg.max(hi);
      return fieldMsg.badValue;
    }
    case "pattern":
      return typeof s.pattern === "string" ? patternError(s.pattern) : fieldMsg.badFormat;
    case "enum":
    case "const": {
      const values = s.enum ?? (s.const === undefined ? [] : [s.const]);
      const named = values.filter((v) => v !== null && v !== undefined).map(String);
      return named.length > 0 ? fieldMsg.oneOf(named) : fieldMsg.badValue;
    }
    case "minItems":
      return fieldMsg.minItems(typeof s.minItems === "number" ? s.minItems : 1);
    case "maxItems":
      return typeof s.maxItems === "number" ? fieldMsg.maxItems(s.maxItems) : fieldMsg.badValue;
    case "uniqueItems":
      return fieldMsg.notUnique;
    default:
      return fieldMsg.badValue;
  }
}
