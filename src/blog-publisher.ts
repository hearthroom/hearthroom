import type { Actor } from "./blog";
import { bumpOp } from "./ops-metrics";
import { HttpError, type Env } from "./types";

/** Private machine credential, recognized only by the blog writer gate. No browser or upstream scope. */
export async function blogPublisher(env: Env, key: string | undefined, origin: string | undefined): Promise<Actor | null> {
  if (key === undefined) return null;
  try {
    const config = JSON.parse(env.BLOG_PUBLISHER_CONFIG ?? "null") as { memberId?: unknown; keySha256?: unknown } | null;
    if (origin !== undefined || !/^[a-f0-9]{64}$/.test(key) || !config || typeof config.memberId !== "string" || !config.memberId || typeof config.keySha256 !== "string" || !/^[a-f0-9]{64}$/.test(config.keySha256)) throw new HttpError(403, "blog_write_forbidden");
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
    const expected = Uint8Array.from(config.keySha256.match(/../g)!, value => parseInt(value,16));
    let difference = 0;
    for (let i = 0; i < digest.length; i++) difference |= digest[i]! ^ expected[i]!;
    if (difference || !await env.DB.prepare("SELECT 1 FROM members WHERE id=?").bind(config.memberId).first()) throw new HttpError(403, "blog_write_forbidden");
    await bumpOp(env.DB, "blog_publisher", "admission", "allow");
    return { memberId: config.memberId, kind: "ai" };
  } catch (error) {
    const denied = error instanceof SyntaxError || error instanceof HttpError;
    await bumpOp(env.DB, "blog_publisher", "admission", denied ? "denied" : "error");
    if (denied) throw new HttpError(403, "blog_write_forbidden");
    throw error;
  }
}
