// What the playground keeps and shares: the two documents as typed. Nothing
// here is parsed or validated, so a half-typed schema survives a reload the
// same way it would in the version constructor.

export interface PlaygroundState {
  schema: string;
  view: string;
}

export const STORAGE_KEY = "console-playground";

// Where a fresh page starts: a document with the order view and no "include",
// which is how the form shows every field of the schema until the author
// narrows it down.
export const DEFAULT_VIEW = `{
  "views": {
    "order": {}
  }
}
`;

export function loadState(storage: Pick<Storage, "getItem">): PlaygroundState | null {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalize(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveState(storage: Pick<Storage, "setItem">, state: PlaygroundState): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private mode or a full quota: the page still works, it just forgets.
  }
}

function normalize(v: unknown): PlaygroundState | null {
  if (!v || typeof v !== "object") return null;
  const { schema, view } = v as Record<string, unknown>;
  if (typeof schema !== "string" || typeof view !== "string") return null;
  return { schema, view };
}

// The share link carries both documents in the fragment, deflated and
// base64url-encoded: a schema of a few hundred lines fits a link a chat
// accepts, and the fragment never reaches a server.
const SHARE_PARAM = "s=";

export async function encodeShare(state: PlaygroundState): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  const packed = await pump(bytes, new CompressionStream("deflate-raw"));
  return SHARE_PARAM + base64url(packed);
}

export async function decodeShare(hash: string): Promise<PlaygroundState | null> {
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!h.startsWith(SHARE_PARAM)) return null;
  try {
    const packed = fromBase64url(h.slice(SHARE_PARAM.length));
    const bytes = await pump(packed, new DecompressionStream("deflate-raw"));
    return normalize(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

async function pump(bytes: Uint8Array, through: GenericTransformStream): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(through);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// parseObject reads a JSON text that has to be an object, and says what is
// wrong with it otherwise. An empty text is not an error: it is the page
// before anything was pasted.
export function parseObject(text: string): {
  value: Record<string, any> | null;
  error: string | null;
} {
  if (!text.trim()) return { value: null, error: null };
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== "object" || Array.isArray(v)) {
      return { value: null, error: "not an object" };
    }
    return { value: v, error: null };
  } catch (e) {
    return { value: null, error: (e as Error).message };
  }
}

// chartName is what the preview calls the chart: the schema's title when it
// has one, lowercased the way a chart name is, else a stand-in.
export function chartName(schema: Record<string, any> | null): string {
  const title = typeof schema?.title === "string" ? schema.title.trim() : "";
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "chart";
}
