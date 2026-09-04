import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../src/types";
import { buildSearchText, projectRole, upstream } from "../src/upstream";

/** 上游角色詳情的回應形狀。 */
const mainSiteRole = {
  characterRoleId: "role-1",
  accountNumId: 10001,
  authorName: "月光",
  authorAvatar: "https://cdn.lunatalk.ai/author.png",
  roleName: "夜行偵探",
  roleNameEn: "Night Detective",
  roleNameJa: "夜行探偵",
  roleNameKo: "",
  roleDesc: "民國背景推理",
  roleDescEn: "Republic-era mystery",
  roleDescJa: "",
  roleDescKo: "",
  roleAvatar: "https://cdn.lunatalk.ai/cover.png",
  roleBackground: "https://cdn.lunatalk.ai/bg.png",
  slug: "night-detective",
  roleTag: ["推理", "民國"],
  talkNum: 1200,
  followNum: 88,
  // 以下都不屬於社群
  roleDetailDesc: "作者的詳細設定",
  jailbreak: "破限詞",
  roleWelcome: "開場白",
  accountId: "internal-uuid",
};

afterEach(() => vi.unstubAllGlobals());

describe("語區判定", () => {
  it("簡繁體併成 zh，其餘三種各自一區", () => {
    expect(projectRole({ ...mainSiteRole, language: "zh-Hans" }).zone).toBe("zh");
    expect(projectRole({ ...mainSiteRole, language: "zh-Hant" }).zone).toBe("zh");
    expect(projectRole({ ...mainSiteRole, language: "en" }).zone).toBe("en");
    expect(projectRole({ ...mainSiteRole, language: "ja" }).zone).toBe("ja");
    expect(projectRole({ ...mainSiteRole, language: "ko" }).zone).toBe("ko");
  });

  it("沒標或標了不認得的值 → all：寧可每區都看得到，不要憑空消失", () => {
    expect(projectRole({ ...mainSiteRole, language: "all" }).zone).toBe("all");
    expect(projectRole({ ...mainSiteRole, language: "" }).zone).toBe("all");
    expect(projectRole({ ...mainSiteRole, language: undefined }).zone).toBe("all");
    expect(projectRole({ ...mainSiteRole, language: "fr" }).zone).toBe("all");
  });
});

describe("白名單投影", () => {
  it("只取列出的欄位，其餘一律不帶走", () => {
    const projected = projectRole({ ...mainSiteRole, someFieldAddedLater: "leak-me" });
    const serialized = JSON.stringify(projected);

    expect(serialized).not.toContain("leak-me");
    expect(serialized).not.toContain("internal-uuid");
    expect(serialized).not.toContain("作者的詳細設定");
    expect(serialized).not.toContain("破限詞");
    expect(serialized).not.toContain("開場白");
  });

  it("四個語言版本各自保留", () => {
    const p = projectRole(mainSiteRole);
    expect(p.names).toEqual({ zh: "夜行偵探", en: "Night Detective", ja: "夜行探偵", ko: "" });
    expect(p.summaries.en).toBe("Republic-era mystery");
  });

  it("標籤同時吃字串陣列與物件陣列", () => {
    expect(projectRole(mainSiteRole).tags).toEqual(["推理", "民國"]);
    expect(projectRole({ ...mainSiteRole, roleTag: [{ tagName: "科幻" }] }).tags).toEqual(["科幻"]);
    expect(projectRole({ ...mainSiteRole, roleTag: null }).tags).toEqual([]);
  });

  it("計數欄位髒了也不會炸，退成 0", () => {
    const p = projectRole({ ...mainSiteRole, talkNum: "not-a-number", followNum: -5 });
    expect(p.talkNum).toBe(0);
    expect(p.followNum).toBe(0);
  });

  it("搜尋字串涵蓋四語名稱、四語簡介與標籤", () => {
    const text = buildSearchText(projectRole(mainSiteRole));
    for (const term of ["夜行偵探", "Night Detective", "夜行探偵", "民國背景推理", "推理"]) {
      expect(text).toContain(term);
    }
  });
});

describe("上游呼叫的 HTTP 形狀", () => {
  it("問身分時帶 Bearer，讀卡片時不帶任何憑證", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
      const body = String(url).includes("/me") ? { accountNumId: 10001 } : mainSiteRole;
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    await upstream.fetchMe(env, "secret-token");
    await upstream.fetchRole(env, "role-1");

    expect(calls[0].url).toBe(`${env.LUNATALK_API_BASE}/open/v1/me`);
    expect(calls[0].headers.Authorization).toBe("Bearer secret-token");
    // 同步跑在排程裡，那時沒有使用者在線——讀卡片這條路不該需要任何人的憑證。
    expect(calls[1].url).toBe(`${env.LUNATALK_API_BASE}/open/v1/role/detail?roleId=role-1`);
    expect(calls[1].headers.Authorization).toBeUndefined();
    // 上游掛在 Cloudflare 後面，沒有 User-Agent 會被 bot 防護擋成 403。
    for (const call of calls) expect(call.headers["User-Agent"]).toContain("Personae");
  });

  it("roleId 有特殊字元也不會拼壞 URL", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      seen.push(String(url));
      return new Response(JSON.stringify(mainSiteRole), { status: 200 });
    });
    await upstream.fetchRole(env, "a b&c=d");
    expect(seen[0]).toContain("roleId=a%20b%26c%3Dd");
  });

  it("上游狀態碼對應到社群自己的錯誤語意", async () => {
    const cases: [number, number][] = [
      [401, 401],
      [403, 401],
      [404, 404],
      [500, 502],
      [503, 502],
    ];
    for (const [upstreamStatus, want] of cases) {
      vi.stubGlobal("fetch", async () => new Response("{}", { status: upstreamStatus }));
      await expect(upstream.fetchRole(env, "role-1")).rejects.toMatchObject({ status: want });
    }
  });

  it("上游沒回公開數字 ID 就不算通過驗證", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ nickName: "月光" }), { status: 200 }));
    await expect(upstream.fetchMe(env, "t")).rejects.toBeInstanceOf(HttpError);
  });
});
