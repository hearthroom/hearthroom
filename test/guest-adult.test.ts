import {approveFixtureResponse} from './hosted-fixture';
/**
 * 遊客的成人確認（owner 2026-10-10）：確認是成人就能看，確認不是成人就不能看，跟有沒有帳號無關。
 *
 *   - 遊客自己填出生日期＋同意目前這一版聲明，伺服器發一張加密的 cookie 憑證；之後同源的讀取靠它放行。
 *   - 未滿 18、格式不對、沒同意聲明：什麼都不發。
 *   - 憑證是伺服器封裝的，手改、換掉、聲明改版都當沒有。
 *   - 登入的人照帳號設定，不看遊客憑證。
 */
import { SELF, createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { boardCache } from "../src/index";
import { sealAuth } from "../src/account-auth";
import { ADULT_CONSENT_VERSION } from "../shared/adult-consent";
import { bearer, identities, resetDb, restoreUpstream, rolesOnMainSite } from "./helpers";

const AUTHOR = 10001;
const origin = "https://hearthroom.club";
const authEnv = () => ({ ...env, AUTH_ENABLED: "true", AUTH_ALLOWED_ORIGINS: origin,
  AUTH_KEYRING: JSON.stringify({ active: "test", keys: { test: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" } }) });
let cookies: Record<string, string> = {};
const cookieHeader = () => Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");

async function call(path: string, init: { method?: string; body?: unknown } = {}) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(origin + path, {
    method: init.method ?? "GET",
    headers: { Origin: origin, "X-Hearthroom-Request": "1", Cookie: cookieHeader(), "Content-Type": "application/json" },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  }), authEnv(), ctx);
  await waitOnExecutionContext(ctx);
  for (const c of response.headers.getSetCookie()) {
    const pair = c.split(";")[0]; const eq = pair.indexOf("=");
    const value = pair.slice(eq + 1);
    if (value) cookies[pair.slice(0, eq)] = value; else delete cookies[pair.slice(0, eq)];
  }
  return response;
}
const adult = (body: Record<string, unknown>) => call("/v1/auth/adult", { method: "POST", body });
const json = async (res: Response) => (await res.json()) as any;
const ids = (b: { items: { sourceRoleId: string }[] }) => b.items.map((i) => i.sourceRoleId).sort();
const adultBirthdate = () => `${new Date().getUTCFullYear() - 20}-01-01`;
const minorBirthdate = () => `${new Date().getUTCFullYear() - 15}-01-01`;

const submit = (roleId: string, nsfw: boolean) =>
  SELF.fetch("https://c.test/v1/cards", { method: "POST", headers: { "Content-Type": "application/json", ...bearer("author-token") },
    body: JSON.stringify({ operationId: crypto.randomUUID(), roleId, nsfw }) });
async function listTwo() {
  expect((await approveFixtureResponse(await submit("role-safe", false))).status).toBe(201);
  expect((await approveFixtureResponse(await submit("role-adult", true))).status).toBe(201);
}

beforeEach(async () => {
  await resetDb();
  cookies = {};
  boardCache.namespace = `board-${Math.random()}`;
  identities({ "author-token": AUTHOR });
  rolesOnMainSite({ roleId: "role-safe", authorNumId: AUTHOR, name: "白天的卡" }, { roleId: "role-adult", authorNumId: AUTHOR, name: "深夜的卡" });
});
afterEach(() => { vi.restoreAllMocks(); restoreUpstream(); });

describe("遊客確認年齡", () => {
  it("沒確認過：什麼都沒開", async () => {
    expect(await json(await adult({}))).toEqual({ showNsfw: false, ageVerified: false, adultConsent: false });
  });

  it("滿 18 歲並同意聲明：發憑證，榜單與成人卡都看得到；關掉只關開關，再開不必重填", async () => {
    await listTwo();
    expect(ids(await json(await call("/v1/cards?zone=all")))).toEqual(["role-safe"]);
    const on = await adult({ showNsfw: true, birthdate: adultBirthdate(), consentVersion: ADULT_CONSENT_VERSION });
    expect(on.status).toBe(200);
    expect(await json(on)).toEqual({ showNsfw: true, ageVerified: true, adultConsent: true });
    expect(Object.keys(cookies)).toContain("__Host-hr-adult");
    const board = await call("/v1/cards?zone=all");
    expect(ids(await json(board))).toEqual(["role-adult", "role-safe"]);
    expect(board.headers.get("Cache-Control")).toBe("private, no-store");
    const card = await env.DB.prepare("SELECT id FROM cards WHERE source_role_id = 'role-adult'").first<{ id: string }>();
    expect((await call(`/v1/cards/${card!.id}`)).status).toBe(200);

    expect(await json(await adult({ showNsfw: false }))).toEqual({ showNsfw: false, ageVerified: true, adultConsent: true });
    expect(ids(await json(await call("/v1/cards?zone=all")))).toEqual(["role-safe"]);
    expect(await json(await adult({ showNsfw: true }))).toEqual({ showNsfw: true, ageVerified: true, adultConsent: true });
    expect(ids(await json(await call("/v1/cards?zone=all")))).toEqual(["role-adult", "role-safe"]);
  });

  it("未滿 18：403 underage，不發憑證", async () => {
    const res = await adult({ showNsfw: true, birthdate: minorBirthdate(), consentVersion: ADULT_CONSENT_VERSION });
    expect(res.status).toBe(403);
    expect((await json(res)).error).toBe("underage");
    expect(cookies["__Host-hr-adult"]).toBeUndefined();
  });

  it("沒填生日、日期不對、沒同意目前這一版聲明：不發憑證", async () => {
    expect((await json(await adult({ showNsfw: true, consentVersion: ADULT_CONSENT_VERSION }))).error).toBe("birthdate_required");
    expect((await json(await adult({ showNsfw: true, birthdate: "2000-02-30", consentVersion: ADULT_CONSENT_VERSION }))).error).toBe("invalid_birthdate");
    expect((await json(await adult({ showNsfw: true, birthdate: adultBirthdate() }))).error).toBe("consent_required");
    expect(cookies["__Host-hr-adult"]).toBeUndefined();
  });

  it("手改的憑證、別的用途封的憑證、舊版聲明的憑證都當沒有", async () => {
    await listTwo();
    for (const forged of [
      "1",
      await sealAuth(authEnv(), "credential:harbor:1:x", { consentVersion: ADULT_CONSENT_VERSION, verifiedAt: Date.now(), show: true }),
      await sealAuth(authEnv(), "guest-adult", { consentVersion: ADULT_CONSENT_VERSION - 1, verifiedAt: Date.now(), show: true }),
    ]) {
      cookies = { "__Host-hr-adult": encodeURIComponent(forged) };
      expect(ids(await json(await call("/v1/cards?zone=all")))).toEqual(["role-safe"]);
    }
  });

  it("只記改開關的結果，讀現況不記", async () => {
    await adult({});
    await adult({ showNsfw: true, birthdate: minorBirthdate(), consentVersion: ADULT_CONSENT_VERSION });
    await adult({ showNsfw: true, birthdate: adultBirthdate(), consentVersion: ADULT_CONSENT_VERSION });
    const rows = await env.DB.prepare("SELECT outcome, value FROM account_auth_metrics WHERE operation = 'adult' AND provider = 'guest' ORDER BY outcome").all<{ outcome: string; value: number }>();
    expect(rows.results).toEqual([{ outcome: "on", value: 1 }, { outcome: "underage", value: 1 }]);
  });

  it("跨站來的請求不收", async () => {
    const res = await worker.fetch(new Request(origin + "/v1/auth/adult", {
      method: "POST", headers: { Origin: "https://attacker.test", "X-Hearthroom-Request": "1", "Content-Type": "application/json" },
      body: JSON.stringify({ showNsfw: true, birthdate: adultBirthdate(), consentVersion: ADULT_CONSENT_VERSION }),
    }), authEnv(), createExecutionContext());
    expect(res.status).toBe(403);
  });
});
