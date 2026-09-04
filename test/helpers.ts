import { env } from "cloudflare:test";
import { type UpstreamRole, upstream } from "../src/upstream";
import { HttpError } from "../src/types";
import { mineCache } from "../src/mine";
import { boardCache } from "../src/index";

let cacheGeneration = 0;

/**
 * vitest-pool-workers v0.22 拿掉了 isolatedStorage，測試之間要自己清乾淨。
 * 邊緣快取也一樣——不換命名空間的話，後面的測試會讀到前一個測試留下的結果。
 */
export async function resetDb(): Promise<void> {
  await env.DB.prepare("DELETE FROM cards").run();
  mineCache.namespace = `mine-test-${++cacheGeneration}`;
  boardCache.namespace = `board-test-${cacheGeneration}`;
}

const real = { ...upstream };
export function restoreUpstream(): void {
  Object.assign(upstream, real);
}

export interface RoleFixture {
  roleId: string;
  zone?: UpstreamRole["zone"];
  authorNumId?: number;
  authorName?: string;
  name?: string;
  nameEn?: string;
  nameJa?: string;
  desc?: string;
  tags?: string[];
  talkNum?: number;
  followNum?: number;
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
    talkNum: f.talkNum ?? 0,
    followNum: f.followNum ?? 0,
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
    const found = byId.get(roleId);
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
  upstream.fetchMe = async (_env, token) => {
    const id = map[token];
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
        visibility: r.visibility ?? "private",
        talkNum: r.talkNum ?? 0,
      })),
      total: all.length,
      hasNext: start + pageSize < all.length,
    };
  };
}
