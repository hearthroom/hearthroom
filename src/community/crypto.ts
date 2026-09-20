import { HttpError, type Env } from "../types";
const encoder = new TextEncoder();
export const random = () => crypto.randomUUID() + crypto.randomUUID();
const hex = (b: ArrayBuffer) =>
  Array.from(new Uint8Array(b), (v) => v.toString(16).padStart(2, "0")).join(
    "",
  );
export const digest = async (s: string) =>
  hex(await crypto.subtle.digest("SHA-256", encoder.encode(s)));
export async function sign(
  key: string,
  method: string,
  path: string,
  time: string,
  nonce: string,
  body: string,
) {
  const k = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(
    await crypto.subtle.sign(
      "HMAC",
      k,
      encoder.encode(
        [method, path, time, nonce, await digest(body)].join("\n"),
      ),
    ),
  );
}
export async function verifyBridge(env: Env, req: Request) {
  const time = req.headers.get("X-Community-Time") ?? "",
    nonce = req.headers.get("X-Community-Nonce") ?? "",
    actual = req.headers.get("X-Community-Signature") ?? "";
  if (
    !env.COMMUNITY_BRIDGE_KEY ||
    !/^\d{13}$/.test(time) ||
    Math.abs(Date.now() - Number(time)) > 60000 ||
    !/^[a-zA-Z0-9-]{20,100}$/.test(nonce) ||
    !/^[a-f0-9]{64}$/.test(actual)
  )
    throw new HttpError(401, "community_signature");
  const url = new URL(req.url);
  const body = await req.text();
  const expected = await sign(
    env.COMMUNITY_BRIDGE_KEY,
    req.method,
    url.pathname + url.search,
    time,
    nonce,
    body,
  );
  let mismatch = 0;
  for (let i = 0; i < 64; i++)
    mismatch |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  if (mismatch) throw new HttpError(401, "community_signature");
  try {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM community_nonces WHERE expires<?").bind(
        Date.now(),
      ),
      env.DB.prepare("INSERT INTO community_nonces VALUES(?,?)").bind(
        nonce,
        Date.now() + 120000,
      ),
    ]);
  } catch {
    throw new HttpError(409, "community_replay");
  }
  try {
    return JSON.parse(body || "{}") as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "community_input");
  }
}
export async function seal(key: string, value: unknown) {
  const k = await crypto.subtle.importKey(
    "raw",
    await crypto.subtle.digest("SHA-256", encoder.encode(key)),
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    k,
    encoder.encode(JSON.stringify(value)),
  );
  return btoa(String.fromCharCode(...iv, ...new Uint8Array(encrypted)));
}
export async function unseal(key: string, value: string) {
  const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  const k = await crypto.subtle.importKey(
    "raw",
    await crypto.subtle.digest("SHA-256", encoder.encode(key)),
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  return JSON.parse(
    new TextDecoder().decode(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: bytes.slice(0, 12) },
        k,
        bytes.slice(12),
      ),
    ),
  );
}
