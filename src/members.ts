import { DEFAULT_PROVIDER, parseProvider, type ProviderId, requireConfigured } from "./providers";
import { tagNamesFor } from "../shared/tag-catalog";
import { type Env, HttpError } from "./types";
import { upstream } from "./upstream";

/**
 * 成員與身分。
 *
 * 本站沒有原生登入：成員是第一次以某家供應商登入時自動建立的，之後每個需要身分的請求
 * 仍然把 token 轉發給供應商驗（跟登記一樣，用完即棄），拿回公開 ID 再查身分表換成成員。
 * 成員 id 是本站產生的不透明字串——審核人、領取、蓋章都掛在它上面，供應商換了或多綁
 * 一家，這些紀錄不用動。
 *
 * 這裡存的關於一個人的東西只有：供應商代號、供應商上的公開 ID、可選的顯示名稱。
 * 沒有 token、沒有信箱、沒有內部識別碼。
 */
export interface Member {
  id: string;
  provider: ProviderId;
  /** 供應商上的公開 ID（lunatalk = accountNumId） */
  externalId: number;
}

/** 公開 ID 的字元集與長度：8 個小寫字母（見 migrations/0005）。 */
const HANDLE_ALPHABET = "abcdefghijklmnopqrstuvwxyz";
export const HANDLE_RE = /^[a-z]{8}$/;

export function newHandle(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let out = "";
  for (const b of bytes) out += HANDLE_ALPHABET[b % 26];
  return out;
}

/**
 * 某家供應商上的公開 ID → 本站成員 id；第一次見到就建成員（連同公開 handle）。
 * 兩個請求同時第一次登入：身分表的主鍵擋住第二個，重讀就拿到第一個建的。
 * handle 撞到唯一索引（機率極低）也會落到同一個 catch，所以重讀不到才換一個 handle 再試。
 */
export async function resolveMember(db: D1Database, provider: ProviderId, externalId: number, now: number): Promise<string> {
  const ext = String(externalId);
  const connected = await db.prepare("SELECT owner_member_id FROM member_connections WHERE provider=? AND external_id=?").bind(provider,ext).first<{owner_member_id:string}>();
  if(connected) return connected.owner_member_id;
  const lookup = () =>
    db
      .prepare("SELECT member_id FROM member_identities WHERE provider = ? AND external_id = ?")
      .bind(provider, ext)
      .first<{ member_id: string }>();
  const found = await lookup();
  if (found) return found.member_id;
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = crypto.randomUUID();
    try {
      await db.batch([
        db.prepare("INSERT INTO members (id, handle, created_at) VALUES (?, ?, ?)").bind(id, newHandle(), now),
        db.prepare("INSERT INTO member_identities (provider, external_id, member_id, linked_at) VALUES (?, ?, ?, ?)").bind(provider, ext, id, now),
      ]);
      return id;
    } catch {
      const again = await lookup();
      if (again) return again.member_id;
    }
  }
  throw new HttpError(502, "could not create member");
}

/**
 * 這些供應商身分裡還沒有成員列的，回一組「建成員＋綁身分」的寫入語句，讓呼叫端併進自己的批次。
 * 一次查詢、零個或多個寫入；同步用（迴圈裡逐張 resolveMember 會把 D1 呼叫算進子請求額度）。
 * INSERT OR IGNORE：同一輪裡有人剛好登入建了同一個身分，主鍵擋住，不會壞批次。
 */
export async function missingMemberStatements(
  db: D1Database,
  identities: { provider: ProviderId; externalId: number }[],
  now: number,
): Promise<D1PreparedStatement[]> {
  if (!identities.length) return [];
  const keys = identities.map((i) => `${i.provider}:${i.externalId}`);
  const holes = keys.map(() => "?").join(",");
  const have = await db
    .prepare(`SELECT provider || ':' || external_id AS k FROM member_identities WHERE provider || ':' || external_id IN (${holes})`)
    .bind(...keys)
    .all<{ k: string }>();
  const existing = new Set(have.results.map((r) => r.k));
  const out: D1PreparedStatement[] = [];
  for (const i of identities) {
    if (existing.has(`${i.provider}:${i.externalId}`)) continue;
    const id = crypto.randomUUID();
    out.push(
      db.prepare("INSERT OR IGNORE INTO members (id, handle, created_at) VALUES (?, ?, ?)").bind(id, newHandle(), now),
      db.prepare("INSERT OR IGNORE INTO member_identities (provider, external_id, member_id, linked_at) VALUES (?, ?, ?, ?)").bind(i.provider, String(i.externalId), id, now),
    );
  }
  return out;
}

/** 公開 ID → 成員 id；格式不對或沒這個人都是 null。 */
export async function memberByHandle(db: D1Database, handle: string): Promise<string | null> {
  if (!HANDLE_RE.test(handle)) return null;
  const row = await db.prepare("SELECT id FROM members WHERE handle = ?").bind(handle).first<{ id: string }>();
  return row?.id ?? null;
}

export interface MemberProfile {
  displayName: string;
  avatarUrl: string;
  bio: string;
  handle: string;
  memberSince: number;
  identities: { provider: string; externalId: number; linkedAt: number; founding: boolean }[];
  /** 成人內容開關（要先驗過年齡才開得了） */
  showNsfw: boolean;
  /** 驗過年齡了（只記有沒有，不記生日） */
  ageVerified: boolean;
  /** 不想看的類型（目錄鍵，排序去重）：榜單與搜尋不列這些類型的卡 */
  hiddenTags: string[];
}

/** 成員存的隱藏名單讀出來：壞掉的 JSON 當空；目錄裡已經拿掉的鍵不算（別顯示「已隱藏 N 類」卻找不到那一類）。 */
export function parseHiddenTags(raw: string | null | undefined): string[] {
  try {
    const list = JSON.parse(raw || "[]");
    return Array.isArray(list) ? list.filter((k): k is string => typeof k === "string" && tagNamesFor(k) !== null) : [];
  } catch {
    return [];
  }
}

/**
 * 整理客戶端送來的隱藏名單：必須是字串陣列，每個鍵都要在目錄裡（不然 400 unknown_tag），去重排序。
 * 只認鍵不認名字：名字跟語言走，鍵才是跨語言同一個籤。
 */
export function normalizeHiddenTags(input: unknown): string[] {
  if (!Array.isArray(input) || input.some((k) => typeof k !== "string")) throw new HttpError(400, "hiddenTags_invalid");
  const keys = [...new Set(input as string[])].sort();
  if (keys.some((k) => tagNamesFor(k) === null)) throw new HttpError(400, "unknown_tag");
  return keys;
}

/** 「我的」頁要的：公開 ID、加入時間、連結了哪些供應商帳號。沒有 token、沒有信箱。 */
export async function memberProfile(db: D1Database, memberId: string): Promise<MemberProfile | null> {
  const m = await db
    .prepare("SELECT handle, display_name, avatar_url, bio, created_at, show_nsfw, age_verified_at, hidden_tags FROM members WHERE id = ?")
    .bind(memberId)
    .first<{ handle: string; display_name: string | null; avatar_url: string; bio: string; created_at: number; show_nsfw: number; age_verified_at: number | null; hidden_tags: string }>();
  if (!m) return null;
  const founding = await db.prepare("SELECT provider FROM member_identities WHERE member_id=?").bind(memberId).all<{provider:string}>();
  const ids = await db
    .prepare("SELECT provider, external_id, linked_at FROM member_connections WHERE owner_member_id = ? UNION SELECT provider, external_id, linked_at FROM member_identities WHERE member_id = ? AND NOT EXISTS (SELECT 1 FROM member_connections c WHERE c.provider=member_identities.provider AND c.external_id=member_identities.external_id) ORDER BY linked_at")
    .bind(memberId, memberId)
    .all<{ provider: string; external_id: string; linked_at: number }>();
  return {
    handle: m.handle,
    displayName: m.display_name ?? m.handle,
    avatarUrl: m.avatar_url,
    bio: m.bio,
    memberSince: m.created_at,
    identities: ids.results.map((r) => ({ provider: r.provider, externalId: Number(r.external_id), linkedAt: r.linked_at, founding: founding.results.some(i=>i.provider===r.provider) })),
    showNsfw: m.show_nsfw === 1,
    ageVerified: m.age_verified_at !== null,
    hiddenTags: parseHiddenTags(m.hidden_tags),
  };
}

/** 成員目前的隱藏名單。 */
export async function memberHiddenTags(db: D1Database, memberId: string): Promise<string[]> {
  const m = await db.prepare("SELECT hidden_tags FROM members WHERE id = ?").bind(memberId).first<{ hidden_tags: string }>();
  return parseHiddenTags(m?.hidden_tags);
}

/** 整份換掉隱藏名單（客戶端送的是勾完的完整清單，不是增減）。 */
export async function updateMemberHiddenTags(db: D1Database, memberId: string, input: unknown): Promise<string[]> {
  const keys = normalizeHiddenTags(input);
  await db.prepare("UPDATE members SET hidden_tags = ? WHERE id = ?").bind(JSON.stringify(keys), memberId).run();
  return keys;
}

/** 成人內容相關的設定：開關與年齡驗證時間。 */
export async function memberNsfw(db: D1Database, memberId: string): Promise<{ showNsfw: boolean; ageVerifiedAt: number | null }> {
  const m = await db
    .prepare("SELECT show_nsfw, age_verified_at FROM members WHERE id = ?")
    .bind(memberId)
    .first<{ show_nsfw: number; age_verified_at: number | null }>();
  return { showNsfw: m?.show_nsfw === 1, ageVerifiedAt: m?.age_verified_at ?? null };
}

const BIRTHDATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * 生日 → 今天（UTC）滿 18 歲了沒。格式不對或日期不存在都算沒填；未來的日期也是。
 * 生日只在這裡看一眼，不落庫。
 */
export function isAdultBirthdate(birthdate: string, now: number): boolean | null {
  const m = BIRTHDATE_RE.exec(birthdate.trim());
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  if (date.getTime() > now) return null;
  const today = new Date(now);
  let age = today.getUTCFullYear() - y;
  const beforeBirthday = today.getUTCMonth() < mo - 1 || (today.getUTCMonth() === mo - 1 && today.getUTCDate() < d);
  if (beforeBirthday) age--;
  return age >= 18;
}

/**
 * 改成人內容開關。開：要驗過年齡——已經驗過就直接開，沒驗過要帶生日且滿 18；未滿不存任何東西。
 * 關：只關開關，驗證留著（下次開不必再填）。
 */
export async function updateMemberNsfw(
  db: D1Database,
  memberId: string,
  input: { showNsfw: boolean; birthdate?: string },
  now: number,
): Promise<{ showNsfw: boolean; ageVerified: boolean }> {
  const current = await memberNsfw(db, memberId);
  if (!input.showNsfw) {
    await db.prepare("UPDATE members SET show_nsfw = 0 WHERE id = ?").bind(memberId).run();
    return { showNsfw: false, ageVerified: current.ageVerifiedAt !== null };
  }
  let verifiedAt = current.ageVerifiedAt;
  if (verifiedAt === null) {
    if (!input.birthdate) throw new HttpError(400, "birthdate_required");
    const adult = isAdultBirthdate(input.birthdate, now);
    if (adult === null) throw new HttpError(400, "invalid_birthdate");
    if (!adult) throw new HttpError(403, "underage");
    verifiedAt = now;
  }
  await db.prepare("UPDATE members SET show_nsfw = 1, age_verified_at = ? WHERE id = ?").bind(verifiedAt, memberId).run();
  return { showNsfw: true, ageVerified: true };
}

/**
 * 看的人開了成人內容嗎。前端想看時帶 ?nsfw=1 加 token；token 驗不過或沒開，一律當沒開——
 * 不報錯、不洩漏。呼叫端必須先驗權限，才能讀取對應內容分級的內部榜單快取。
 */
export async function viewerAllowsNsfw(c: Ctx & { req: { query: (k: string) => string | undefined } }): Promise<boolean> {
  if (c.req.query("nsfw") !== "1") return false;
  try {
    const bearer = c.req.header("Authorization")?.match(/^Bearer\s+(\S+)$/)?.[1];
    if (!bearer) return false;
    const provider = providerOf(c);
    const me = await requestIdentity(c, bearer, provider);
    // Viewing is read-only. Resolve linked identities and current preferences in one D1 trip;
    // a member who has never signed in cannot already have opted into adult content.
    const member = await c.env.DB.prepare(`
      SELECT show_nsfw, age_verified_at FROM members WHERE id = COALESCE(
        (SELECT owner_member_id FROM member_connections WHERE provider=? AND external_id=?),
        (SELECT member_id FROM member_identities WHERE provider=? AND external_id=?)
      )`).bind(provider, String(me.accountNumId), provider, String(me.accountNumId))
      .first<{ show_nsfw: number; age_verified_at: number | null }>();
    return member?.show_nsfw === 1 && member.age_verified_at !== null;
  } catch {
    return false;
  }
}

export async function isReviewer(db: D1Database, memberId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS ok FROM reviewers WHERE member_id = ? AND revoked_at IS NULL")
    .bind(memberId)
    .first<{ ok: number }>();
  return !!row;
}

/** 這個成員在某家供應商上的公開 ID；沒綁就是 null。 */
export async function externalIdOf(db: D1Database, memberId: string, provider: ProviderId): Promise<number | null> {
  const profile=await memberProfile(db,memberId);
  return profile?.identities.find(i=>i.provider===provider)?.externalId ?? null;
}

type Ctx = { env: Env; req: { header: (k: string) => string | undefined } };

// The context is unique to a request. Even rejected authentication is shared only here.
const identities = new WeakMap<Ctx, Promise<Awaited<ReturnType<typeof upstream.fetchMe>>>>();
function requestIdentity(c:Ctx,bearer:string,provider:ProviderId) {
 let pending=identities.get(c);
 if(!pending){pending=upstream.fetchMe(c.env,bearer,provider);identities.set(c,pending);}
 return pending;
}

/** 轉發 token 問供應商「你是誰」，再換成本站成員。token 不落庫、不進日誌。 */
export async function requireMember(c: Ctx): Promise<Member> {
  const bearer = c.req.header("Authorization")?.match(/^Bearer\s+(\S+)$/)?.[1];
  if (!bearer) throw new HttpError(401, "missing bearer token");
  // token 屬於哪一家由呼叫端明說，不從 token 反推：兩家的格式沒有互斥保證。
  const provider = providerOf(c);
  const me = await requestIdentity(c, bearer, provider);
  const id = await resolveMember(c.env.DB, provider, me.accountNumId, Date.now());
  await c.env.DB.prepare("UPDATE members SET display_name=?, avatar_url=? WHERE id=? AND display_name IS NULL")
    .bind(me.nickName?.trim().slice(0, 60) || (await memberProfile(c.env.DB, id))!.handle, safeAvatar(me.avatar), id).run();
  return { id, provider, externalId: me.accountNumId };
}

/** 這個請求屬於哪一家供應商。沒帶標頭就是預設那家；不認得或這個部署沒設定的一律 400。 */
export function providerOf(c: Ctx): ProviderId {
  return requireConfigured(c.env, parseProvider(c.req.header("X-Provider")));
}

export async function requireReviewer(c: Ctx): Promise<Member> {
  const member = await requireMember(c);
  if (!(await isReviewer(c.env.DB, member.id))) throw new HttpError(403, "not a reviewer");
  return member;
}

export async function saveMemberId(db:D1Database,member:Member):Promise<string> {
 const original=await db.prepare('SELECT member_id FROM member_identities WHERE provider=? AND external_id=?').bind(member.provider,String(member.externalId)).first<{member_id:string}>();
 return original?.member_id ?? member.id;
}

function safeAvatar(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && value.length <= 2048 ? url.href : ""; } catch { return ""; }
}
