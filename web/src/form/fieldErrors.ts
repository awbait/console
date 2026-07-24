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
