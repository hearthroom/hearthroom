import {frozenFixtureRoles,restoreHostedFixture,hostedFixture} from './hosted-fixture';
import { env } from "cloudflare:test";
import { type UpstreamRole, upstream } from "../src/upstream";
import type { ProviderId } from "../src/providers";
import { HttpError } from "../src/types";
import { mineCache } from "../src/mine";
import { boardCache } from "../src/index";

let cacheGeneration = 0;

/**
 * vitest-pool-workers v0.22 拿掉了 isolatedStorage，測試之間要自己清乾淨。
 * 邊緣快取也一樣——不換命名空間的話，後面的測試會讀到前一個測試留下的結果。
 */
export async function resetDb(): Promise<void> {
  frozenFixtureRoles.clear();hostedFixture();
for (const table of ["review_deliveries", "community_badge_audit", "community_appearance_media", "community_discord_appearance", "community_appearance_preferences", "community_review_signal", "community_case_jobs", "community_notifications", "community_metrics", "community_nonces", "community_awards", "community_xp", "discord_link_attempts", "discord_links", "community_subjects", "community_preferences", "member_conversations", "library_metrics", "member_favorites", "member_follows", "hosting_transfers", "hosting_replicas", "hosting_versions", "avatar_cleanup", "work_copies", "works", "member_connections", "card_saves", "comment_likes", "comments", "game_worlds", "cards", "card_numbers", "card_registrations", "review_stamps", "review_snapshots", "review_submissions", "reviewers", "member_identities", "members", "moderation_blocked_versions", "moderation_votes", "moderation_cases", "moderation_compensation", "moderation_events", "moderation_state", "moderation_metrics"]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await env.DB.prepare("DELETE FROM community_badge_definitions WHERE category='event'").run();
  // 卡號是 AUTOINCREMENT（刪過的號不再發），測試之間把序號推回起點，每個測試都從 100001 數起
  // sqlite_sequence 沒有唯一鍵，不能 INSERT OR REPLACE（只會多一列）；刪掉再放
  await env.DB.prepare("DELETE FROM sqlite_sequence WHERE name = 'card_numbers'").run();
  await env.DB.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES ('card_numbers', 100000)").run();
  mineCache.namespace = `mine-test-${++cacheGeneration}`;
  boardCache.namespace = `board-test-${cacheGeneration}`;
}

const real = { ...upstream };
export function restoreUpstream(): void {
  Object.assign(upstream, real);
  restoreHostedFixture();
}

// ---- 審核的假上游 ----------------------------------------------------------------

/** 記錄每次「用作者的 token 讀整份設定」：測試才驗得出提交真的讀了、而且是拿作者的 token 讀的。 */
export const settingsReads: { token: string; roleId: string; provider: string }[] = [];

/** 切換社群審核配置；公開測試資料同樣必須完成封存與審核。 */
export function reviewOn(): void { (env as { REVIEW_ENABLED?: string }).REVIEW_ENABLED = "true"; }
export function reviewOff(): void { (env as { REVIEW_ENABLED?: string }).REVIEW_ENABLED = "false"; }

const blankSettings = (roleId: string) => ({
  document: { roleName: roleId },
  hashes: { card: "c", welcome: "w", worldbook: "", authorAsset: "a", content: `sha256:${roleId}` },
});

export function reviewUpstream(detailFor: (roleId: string) => Record<string, unknown> = blankSettings): void {
  settingsReads.length = 0;
  upstream.readForReview = async (_env, token, roleId, provider) => {
    settingsReads.push({ token, roleId, provider });
    return { ...blankSettings(roleId), ...detailFor(roleId) } as Awaited<ReturnType<typeof real.readForReview>>;
  };
}

/** 測試用的公開 ID：8 個小寫字母，由數字 ID 決定，跑幾次都一樣（10001 → "aaabaaab" 之類）。 */
export function testHandle(accountNumId: number): string {
  const digits = String(accountNumId).padStart(8, "0").slice(-8);
  return [...digits].map((d) => "abcdefghij"[Number(d)]).join("");
}

/** 把某個供應商公開 ID 建成成員（綁身分、給公開 ID）。回成員 id。 */
export async function makeMember(accountNumId: number): Promise<string> {
  const id = `member-${accountNumId}`;
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO members (id, handle, created_at) VALUES (?, ?, ?)").bind(id, testHandle(accountNumId), now),
    env.DB.prepare("INSERT OR IGNORE INTO member_identities (provider, external_id, member_id, linked_at) VALUES ('lunatalk', ?, ?, ?)").bind(String(accountNumId), id, now),
  ]);
  return id;
}

/** 把某個供應商公開 ID 登記成審核人（建成員、綁身分、標記）。 */
export async function makeReviewer(accountNumId: number): Promise<string> {
  const id = await makeMember(accountNumId);
  await env.DB.prepare("INSERT OR IGNORE INTO reviewers (member_id, granted_at, granted_by) VALUES (?, ?, 'test')").bind(id, Date.now()).run();
  return id;
}

export interface RoleFixture {
  roleId: string;
  zone?: UpstreamRole["zone"];
  welcome?: string;
  authorNumId?: number;
  authorName?: string;
  name?: string;
  nameEn?: string;
  nameJa?: string;
  desc?: string;
  tags?: string[];
  talkNum?: number;
  followNum?: number;
  /** 上游記的建卡來源。沒給就當社群站建的——大多數登記測試關心的不是這件事。 */
  creationMethod?: string;
}

export function role(f: RoleFixture): UpstreamRole {
  return {
    roleId: f.roleId,
    zone: f.zone ?? "zh",
    authorNumId: f.authorNumId ?? 10001,
    authorName: f.authorName ?? "月光",
    authorAvatar: "https://cdn.lunatalk.ai/author.png",
    names: { zh: f.name ?? "夜行偵探", en: f.nameEn ?? "", ja: f.nameJa ?? "", ko: "" },
    summaries: { zh: f.desc ?? "民國背景推理", en: "", ja: "", ko: "" },
    avatarUrl: "https://cdn.lunatalk.ai/cover.png",
    backgroundUrl: "https://cdn.lunatalk.ai/bg.png",
    slug: null,
    tags: f.tags ?? ["推理"],
    welcome: f.welcome ?? "",
    talkNum: f.talkNum ?? 0,
    followNum: f.followNum ?? 0,
    creationMethod: f.creationMethod ?? "hearthroom",
  };
}

/** 上游回答「這個 token 屬於這個公開數字 ID」。 */
export function whoAmI(accountNumId: number | null): void {
  upstream.fetchMe = async () => {
    if (accountNumId === null) throw new HttpError(401, "upstream rejected the token");
    return { accountNumId };
  };
}

/** 上游上有哪些卡。沒列出的一律當成不存在。 */
export function rolesOnMainSite(...fixtures: RoleFixture[]): void {
  const byId = new Map(fixtures.map((f) => [f.roleId, role(f)]));
  upstream.fetchRole = async (_env, roleId) => {
    const found = frozenFixtureRoles.get(roleId) ?? byId.get(roleId);
    if (!found) throw new HttpError(404, "role not found");
    return found;
  };
}

/**
 * 兩家供應商上各有哪些卡。同一個 roleId 在兩家可以是不同的卡——撞號正是要驗的事。
 */
export function rolesOnProviders(byProvider: Partial<Record<ProviderId, RoleFixture[]>>): void {
  const maps = new Map<ProviderId, Map<string, UpstreamRole>>();
  for (const [id, fixtures] of Object.entries(byProvider)) {
    maps.set(id as ProviderId, new Map((fixtures ?? []).map((f) => [f.roleId, role(f)])));
  }
  upstream.fetchRole = async (_env, roleId, provider = "lunatalk") => {
    const found = frozenFixtureRoles.get(roleId) ?? maps.get(provider)?.get(roleId);
    if (!found) throw new HttpError(404, "role not found");
    return found;
  };
}

export function mainSiteDown(): void {
  upstream.fetchRole = async () => {
    throw new HttpError(502, "upstream role failed with 500");
  };
}

export const bearer = (t = "author-token") => ({ Authorization: `Bearer ${t}` });

/** token → 公開數字 ID 的對照，用來模擬「不同的人拿著不同的 token」。 */
export function identities(map: Record<string, number>): void {
  identitiesFor({ lunatalk: map });
}

/**
 * 每家供應商各自一組 token → 公開數字 ID。同一個數字在兩家是兩個人，
 * 假上游也必須照這個規矩答，否則測不出資料有沒有混。
 */
export function identitiesFor(byProvider: Partial<Record<ProviderId, Record<string, number>>>): void {
  upstream.fetchMe = async (_env, token, provider = "lunatalk") => {
    const id = byProvider[provider]?.[token];
    if (!id) throw new HttpError(401, "upstream rejected the token");
    return { accountNumId: id };
  };
}

export interface MyRoleFixture {
  roleId: string;
  zone?: UpstreamRole["zone"];
  name?: string;
  visibility?: string;
  talkNum?: number;
}

/** 記錄每次上游清單呼叫，測試才驗得出快取到底有沒有省掉請求。 */
export const upstreamCalls: { token: string; page: number; pageSize: number }[] = [];

export function myRolesOnUpstream(byToken: Record<string, MyRoleFixture[]>): void {
  upstreamCalls.length = 0;
  upstream.fetchMyRoles = async (_env, token, page, pageSize) => {
    upstreamCalls.push({ token, page, pageSize });
    const all = byToken[token] ?? [];
    const start = (page - 1) * pageSize;
    const slice = all.slice(start, start + pageSize);
    return {
      items: slice.map((r) => ({
        roleId: r.roleId,
        zone: r.zone ?? "zh",
        name: r.name ?? r.roleId,
        summary: "",
        avatarUrl: null,
        backgroundUrl: null,
        visibility: r.visibility ?? "private",
        talkNum: r.talkNum ?? 0,
      })),
      total: all.length,
      hasNext: start + pageSize < all.length,
    };
  };
}

// ── 假的資源層 ───────────────────────────────────────────────
//
// 唯一的一份，所有測試共用。契約照 wrangler.toml 的 `not_found_handling = "single-page-application"`：
// 列出的檔回它本身，其餘**一律 200 + index.html，不是 404**。2026-09-07 的 /assets/* KV 回退曾因為各測試
// 自己手寫的假物件回 404 而全綠、線上卻從沒觸發——假物件的契約錯，測試就只是在測自己。

/** 前端的殼：測試裡不建 web/dist，資源層回同一份 index.html。 */
export const SHELL = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>Hearthroom</title><meta name="description" content="site"></head><body><div id="app"></div></body></html>`;

/**
 * @param files 有的靜態檔：路徑 → 內容（字串當 JS）或整個 Response
 * @param shellHeaders 殼的額外回應頭（例如 etag／last-modified，測快取驗證器用）
 */
export function fakeAssets(files: Record<string, string | Response> = {}, shellHeaders: Record<string, string> = {}): Fetcher {
  return {
    fetch: async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      const file = files[new URL(url).pathname];
      if (file instanceof Response) return file.clone();
      if (typeof file === "string") return new Response(file, { headers: { "content-type": "text/javascript" } });
      return new Response(SHELL, { headers: { "content-type": "text/html; charset=utf-8", ...shellHeaders } });
    },
  } as unknown as Fetcher;
}

/** 帶假資源層的 env，直接餵 worker.fetch。 */
export const envWithAssets = (files?: Record<string, string | Response>, shellHeaders?: Record<string, string>): typeof env =>
  ({ ...env, ASSETS: fakeAssets(files, shellHeaders) });
