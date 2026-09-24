/**
 * 審核讀取：本站自己的事，不靠供應商的分享介面。
 *
 * 作者按下提交的那一刻，本站用作者自己的 token 讀一次整份設定（卡片、開場白、綁定的世界書、
 * 作者資產），存成這張審核單的快照；審核人看的是快照。單子一定案（過審或駁回）快照就刪——
 * 本站不長期保存任何卡片的私有設定，只在審核期間暫存作者主動送審的那一份。
 *
 * 過審後的變更偵測看的是「公開指紋」：名稱、簡介、封面、標籤、開場白這些訪客看得到的欄位。
 * 排程同步本來就匿名讀這些欄位，所以比對不需要任何憑證。私有設定改了本站看不到——
 * 它也不會出現在榜單上；作者想讓審核人看新版，重新送審即可。
 */
import { canonicalAsset, readBooks, type TransferCall } from "./card-transfer-resources";
import { apiBaseOf, type ProviderId } from "./providers";
import { type Env, HttpError } from "./types";
import type { UpstreamRole } from "./upstream";

const UA = "Personae/0.1 (open-source role-card community client)";
/** 寫進 D1 的審核副本（壓縮後）上限。D1 單列上限 2 MB，留餘裕給其他欄位。 */
export const SNAPSHOT_MAX_BYTES = 1_500_000;
/** 公開指紋的版本前綴：舊的 reviewed_hash（供應商給的內容雜湊）沒有這個前綴，同步時改綁、不重審。 */
export const PUBLIC_HASH_PREFIX = "pub1:";

const text = (v: unknown): string => (typeof v === "string" ? v : "");
const list = (v: unknown): string[] => {
  let parsed: unknown = v;
  if (typeof v === "string") {
    if (!v.trim()) return [];
    try { parsed = JSON.parse(v); } catch { return []; }
  }
  return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string" && s.trim() !== "") : [];
};

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 訪客看得到的那幾個欄位的指紋。欄位順序固定，同一張卡算幾次都一樣。 */
export async function publicHash(role: UpstreamRole): Promise<string> {
  return PUBLIC_HASH_PREFIX + (await sha256([role.names, role.summaries, role.avatarUrl, role.backgroundUrl, role.tags, role.welcome]));
}

/** 中日韓一字一 token，其餘四個字元一 token。只是給審核人看的量級，不是計費。 */
export function estimateTokens(s: string): number {
  let cjk = 0;
  let other = 0;
  for (const ch of s) {
    if (/[぀-ヿ㐀-鿿가-힯]/.test(ch)) cjk++;
    else other++;
  }
  return cjk + Math.ceil(other / 4);
}

export interface ReviewSettings extends Record<string, unknown> {
  hashes: { card: string; welcome: string; worldbook: string; authorAsset: string; content: string };
}

/**
 * 用作者自己的 token 讀整份設定，組成審核頁要的形狀。token 只活在這一串請求裡，不落庫。
 * 讀不到私有設定（不是作者本人、或供應商沒回）就整個失敗：審核人什麼都看不到，排進佇列也只是卡住。
 */
export async function readForReview(env: Env, bearer: string, roleId: string, provider: ProviderId): Promise<ReviewSettings> {
  const call: TransferCall = async (path) => {
    const res = await fetch(`${apiBaseOf(env, provider)}/open/v1${path}`, {
      headers: { Authorization: `Bearer ${bearer}`, language: "zh-Hans", "User-Agent": UA },
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
    }).catch(() => { throw new HttpError(502, "upstream settings read failed"); });
    if (res.status === 401 || res.status === 403) throw new HttpError(401, "upstream rejected the token");
    if (res.status === 404) throw new HttpError(404, "settings not found");
    if (!res.ok) throw new HttpError(502, `upstream settings read failed with ${res.status}`);
    return (await res.json()) as Record<string, any>;
  };

  const r = await call(`/role/detail?roleId=${encodeURIComponent(roleId)}`);
  if (!("roleDetailDesc" in r)) throw new HttpError(409, "private settings unavailable");
  const document = {
    roleName: text(r.roleName), userName: text(r.userName), roleDesc: text(r.roleDesc),
    roleAvatar: text(r.roleAvatar), roleBackground: text(r.roleBackground), roleDetailDesc: text(r.roleDetailDesc),
    roleTag: typeof r.roleTag === "string" ? r.roleTag : JSON.stringify(r.roleTag ?? []),
    roleType: text(r.roleType), roleSex: text(r.roleSex),
    roleSpeech: typeof r.roleSpeech === "string" ? r.roleSpeech : JSON.stringify(r.roleSpeech ?? ""),
    language: text(r.language),
    customInstructions: text(r.customInstructions) || text(r.jailbreak),
    talkExample: typeof r.talkExample === "string" ? r.talkExample : JSON.stringify(r.talkExample ?? []),
    roleOutputContract: text(r.roleOutputContract),
    // 世界卡的成員（作者 token 讀回的完整版）。只在有的時候才進指紋：普通卡的指紋一個位元都不變，
    // 已上榜的卡不會因此被當成改過；世界卡改了成員就是改了內容。
    ...(r.world ? { world: JSON.stringify(r.world) } : {}),
  };
  const greetings = {
    welcome: text(r.roleWelcome),
    alternates: list(r.welcomeAlternates ?? r.roleWelcomeAlternates ?? r.alternates),
    prologue: list(r.rolePrologue ?? r.prologue),
  };

  const books = (await readBooks(call, roleId)).map((b) => ({
    worldbookId: b.sourceId,
    name: text(b.metadata.name), description: text(b.metadata.description), format: text(b.metadata.format),
    entries: b.entries.map((e, i) => ({
      entryId: String(i), name: text(e.name), content: text(e.content),
      keywords: list(e.keywords), secondaryKeywords: list(e.secondaryKeywords),
      category: text(e.category), isEnabled: e.isEnabled !== false, isConstant: e.isConstant === true, triggerRegion: text(e.triggerRegion),
    })),
  }));

  let rawAsset: Record<string, any> = {};
  try {
    rawAsset = await call(`/role/author-asset?roleId=${encodeURIComponent(roleId)}`);
  } catch (err) {
    if (!(err instanceof HttpError && err.status === 404)) throw err; // 404＝這張卡沒有作者資產
  }
  const authorAsset = { ...canonicalAsset(rawAsset), status: text(rawAsset.status), version: Number(rawAsset.version) || 0 };

  const entries = books.flatMap((b) => b.entries);
  const enabled = entries.filter((e) => e.isEnabled);
  const constant = enabled.filter((e) => e.isConstant);
  const persona = document.roleDetailDesc + document.customInstructions + document.talkExample;
  const chars = (es: typeof entries) => es.reduce((n, e) => n + e.content.length, 0);
  const costProfile = {
    personaChars: persona.length,
    worldbookEntryCount: entries.length, worldbookEnabledCount: enabled.length, worldbookConstantCount: constant.length,
    worldbookChars: chars(enabled), worldbookConstantChars: chars(constant),
    estimatedConstantTokens: estimateTokens(persona + constant.map((e) => e.content).join("")),
    estimatedMaxTokens: estimateTokens(persona + enabled.map((e) => e.content).join("")),
  };

  const parts = {
    card: await sha256(document),
    welcome: await sha256(greetings),
    worldbook: books.length ? await sha256(books) : "",
    authorAsset: await sha256(authorAsset),
  };
  const hashes = { ...parts, content: `sha256:${await sha256(parts)}` };
  return {
    document, greetings,
    // 審核頁一次看一本；綁了多本的全部放在 worldbooks。
    worldbook: books[0] ?? null, worldbooks: books, worldbookAvailable: true,
    authorAsset, hashes, costProfile,
  };
}

/**
 * 審核副本以 gzip 壓縮後存（前綴 gz1:，base64）。D1 單列上限 2 MB；大型世界模擬卡的原文常超過 1.5 MB
 * （幾百條世界書加上作者版面），但文字壓縮後通常只剩三到五分之一。上限檢查看的是壓縮後實際寫進去的大小。
 * 沒有前綴的是壓縮前存的舊副本，照原樣解析。
 */
const GZ_PREFIX = "gz1:";
function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}
async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}
export async function encodeSnapshot(detail: ReviewSettings): Promise<string> {
  const packed = GZ_PREFIX + toBase64(await pipe(new TextEncoder().encode(JSON.stringify(detail)), new CompressionStream("gzip")));
  if (packed.length > SNAPSHOT_MAX_BYTES) throw new HttpError(400, "card_too_large_for_review");
  return packed;
}
async function decodeSnapshot(stored: string): Promise<Record<string, unknown>> {
  if (!stored.startsWith(GZ_PREFIX)) return JSON.parse(stored) as Record<string, unknown>;
  const bytes = Uint8Array.from(atob(stored.slice(GZ_PREFIX.length)), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(await pipe(bytes, new DecompressionStream("gzip")))) as Record<string, unknown>;
}

/** 存這張單的快照；還在排隊時重送就覆寫，審核人看到的是作者最新送來的那一份。 */
export async function saveSnapshotStatement(db: D1Database, submissionId: string, detail: ReviewSettings, now: number): Promise<D1PreparedStatement> {
  const stored = await encodeSnapshot(detail);
  return db
    .prepare(
      `INSERT INTO review_snapshots (submission_id, detail, created_at) VALUES (?, ?, ?)
       ON CONFLICT (submission_id) DO UPDATE SET detail = excluded.detail, created_at = excluded.created_at`,
    )
    .bind(submissionId, stored, now);
}

export async function loadSnapshot(db: D1Database, submissionId: string): Promise<Record<string, unknown> | null> {
  const row = await db.prepare("SELECT detail FROM review_snapshots WHERE submission_id = ?").bind(submissionId).first<{ detail: string }>();
  if (!row) return null;
  try { return await decodeSnapshot(row.detail); } catch { return null; }
}

/** 單子定案就刪：本站不留任何卡片的私有設定。 */
export function dropSnapshotStatement(db: D1Database, submissionId: string): D1PreparedStatement {
  return db.prepare("DELETE FROM review_snapshots WHERE submission_id = ?").bind(submissionId);
}
