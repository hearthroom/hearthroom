import type { Env } from "./types";

export const BOARD_TTL = 300;
export const boardCache = { namespace: "board-numeric-v3" };
interface Entry { body: string; expiresAt: number }
interface Key { edge: Request; kv: string }

/** Only semantic query parameters enter the key; access and moderation are server-derived. */
export async function boardKey(raw: string, revision: number, adult: boolean, locale?: string): Promise<Key> {
  const source = new URL(raw);
  const url = new URL(source.pathname, source.origin);
  const fields = source.pathname === "/v1/cards"
    ? ["zone", "sort", "period", "q", "author", "limit", "offset", "lang", "hide"]
    : ["zone", "sort", "q", "limit", "offset"];
  for (const field of fields) {
    const value = source.searchParams.get(field);
    if (value !== null) url.searchParams.set(field, value);
  }
  if (source.pathname === "/v1/cards") {
    const language = locale ?? source.searchParams.get("lang") ?? "zh";
    url.searchParams.set("lang", ["en", "ja", "ko"].find(value => language.startsWith(value)) ?? "zh");
    for (const tag of [...new Set(source.searchParams.getAll("tag").map(t => t.trim()).filter(Boolean))].sort()) {
      url.searchParams.append("tag", tag);
    }
  }
  url.searchParams.set("_access", adult ? "adult" : "general");
  url.searchParams.set("_moderation", String(revision));
  // No bearer, cookie or viewer identity is stored in either cache.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url.toString()));
  const hash = [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, "0")).join("");
  return { edge: new Request(url), kv: `${boardCache.namespace}:${hash}` };
}

function live(value: unknown): value is Entry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Entry;
  return typeof entry.body === "string" && Number.isFinite(entry.expiresAt) && entry.expiresAt > Date.now();
}

async function storeEdge(key: Key, entry: Entry): Promise<void> {
  const ttl = Math.floor((entry.expiresAt - Date.now()) / 1000);
  if (ttl <= 0) return;
  const cache = await caches.open(boardCache.namespace);
  await cache.put(key.edge, new Response(JSON.stringify(entry), {
    headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${ttl}` },
  }));
}

/** Internal cache only. The handler must verify access before returning any cached data. */
export async function readBoardCache(env: Env, ctx: Pick<ExecutionContext, "waitUntil">, key: Key): Promise<{ body: string; layer: "edge" | "kv" } | null> {
  try {
    const hit = await (await caches.open(boardCache.namespace)).match(key.edge);
    const entry: unknown = hit ? await hit.json() : null;
    if (live(entry)) return { body: entry.body, layer: "edge" };
  } catch { console.warn("Board edge cache read unavailable"); }
  try {
    const entry: unknown = await env.CACHE.get(key.kv, "json");
    if (live(entry)) {
      ctx.waitUntil(storeEdge(key, entry).catch(() => { console.warn("Board edge cache write unavailable"); }));
      return { body: entry.body, layer: "kv" };
    }
  } catch { console.warn("Board KV cache read unavailable"); }
  return null;
}

export function writeBoardCache(env: Env, ctx: Pick<ExecutionContext, "waitUntil">, key: Key, body: string): void {
  const entry: Entry = { body, expiresAt: Date.now() + BOARD_TTL * 1000 };
  ctx.waitUntil(Promise.all([
    storeEdge(key, entry).catch(() => { console.warn("Board edge cache write unavailable"); }),
    env.CACHE.put(key.kv, JSON.stringify(entry), { expirationTtl: BOARD_TTL })
      .catch(() => { console.warn("Board KV cache write unavailable"); }),
  ]).then(() => {}));
}
