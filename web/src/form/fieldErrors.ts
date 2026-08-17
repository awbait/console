// Canonical user-facing validation messages and shared field validators.
// The wording contract lives in CLAUDE.md ("Тексты интерфейса"): product tone,
// one error per field (the first failed check), no spec-style fragments. Every
// new input validation must compose these helpers instead of inlining strings,
// so identical checks always read identically across the app.

export const fieldMsg = {
  required: "Обязательное поле.",
  charset: "Используйте строчные латинские буквы, цифры и дефис.",
  edgeChars: "Первый и последний символ - буква или цифра.",
  badFormat: "Недопустимый формат.",
  integer: "Введите целое число.",
  minLen: (n: number) => `Не короче ${n} символов.`,
  maxLen: (n: number) => `Не длиннее ${n} символов.`,
  min: (n: number) => `Не меньше ${n}.`,
  max: (n: number) => `Не больше ${n}.`,
  range: (min: number, max: number) => `Значение от ${min} до ${max}.`,
  taken: (name: string) => `Имя «${name}» уже занято.`,
};

// The same rules said as requirements rather than as complaints: a hint lists
// what the field takes, so it names it instead of telling the reader what to
// do. Only the messages that read as an instruction need a second form - "Не
// длиннее 63 символов." is already a statement.
export const fieldHint = {
  charset: "Строчные латинские буквы, цифры и дефис.",
  integer: "Целое число.",
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

// Patterns charts use for names. A regular expression is not something to show
// a person, so only the ones we can say in words are turned into a rule; an
// unrecognised pattern contributes nothing and the field just says less.
const CHARSET_PATTERNS = [
  // DNS label, with and without the edge-character clause.
  { re: "^[a-z0-9]([a-z0-9-]*[a-z0-9])?$", rules: [fieldHint.charset, fieldMsg.edgeChars] },
  { re: "^[a-z0-9]([-a-z0-9]*[a-z0-9])?$", rules: [fieldHint.charset, fieldMsg.edgeChars] },
  { re: "^[a-z0-9-]+$", rules: [fieldHint.charset] },
  { re: "^[a-z0-9-]*$", rules: [fieldHint.charset] },
];

// fieldRequirements lists what a field accepts, in the same words the error
// would use if the value were wrong - so the hint and the complaint never
// disagree. Order follows what a person checks first: characters, then length,
// then range. Returns an empty list when the schema says nothing worth
// repeating (an enum, for instance, states its own options).
export function fieldRequirements(s: FieldConstraints): string[] {
  const out: string[] = [];
  if (s.pattern) {
    const known = CHARSET_PATTERNS.find((p) => p.re === s.pattern);
    if (known) out.push(...known.rules);
  }
  if (s.type === "integer") out.push(fieldHint.integer);
  if (typeof s.minLength === "number" && s.minLength > 0) out.push(fieldMsg.minLen(s.minLength));
  if (typeof s.maxLength === "number") out.push(fieldMsg.maxLen(s.maxLength));
  if (typeof s.minimum === "number" && typeof s.maximum === "number") {
    out.push(fieldMsg.range(s.minimum, s.maximum));
  } else if (typeof s.minimum === "number") {
    out.push(fieldMsg.min(s.minimum));
  } else if (typeof s.maximum === "number") {
    out.push(fieldMsg.max(s.maximum));
  }
  return out;
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
