/**
 * 每小時同步的兩個副作用：
 * - 名稱沒變的回寫不能叫審核訊息重發（2026-10 實測：已結案的審核單 revision 被推到 188–315，
 *   bot 每天重新編輯上千則 Discord 訊息）。
 * - 上游說「這張卡不在了」（404）時要下榜並往後排；只有暫時性失敗才留在最前面重試
 *   （2026-09-28 起一張在 Harbor 已刪除的卡每小時佔住第一個名額，榜上一直掛著舊資料）。
 */
import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ensureCardNumber, syncStatement } from "../src/cards";
import { syncBatch } from "../src/index";
import { upstream } from "../src/upstream";
import { HttpError } from "../src/types";
import { resetDb, restoreUpstream, role } from "./helpers";

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

const synced = role({ roleId: "sealed-1" });

async function card(source: string, opts: { status?: string; hosted?: string | null; lastSynced?: number } = {}) {
  const id = await ensureCardNumber(env.DB, "harbor", source);
  await env.DB.prepare(
    "INSERT INTO cards(id,source_role_id,provider,author_num_id,author_name,names,registered_at,last_synced_at,status,approved_hosted_role_id) VALUES(?,?,'harbor',10001,'月光',?,?,?,?,?)",
  ).bind(id, source, JSON.stringify(synced.names), 1, opts.lastSynced ?? 1, opts.status ?? "approved", opts.hosted === undefined ? null : opts.hosted).run();
  // 卡片 ID 在 D1 是整數，程式各處的型別卻是字串（index.ts 的同步也這樣傳）；照同一個口徑傳。
  return String(id);
}

async function submissionFor(cardId: string, id = "s1", status = "approved") {
  await env.DB.prepare("INSERT INTO review_submissions(id,card_id,provider,source_role_id,kind,status,submitted_at,nsfw) VALUES(?,?,'harbor',?,'first',?,1,0)")
    .bind(id, cardId, id, status).run();
}

const revision = async (submission = "s1") =>
  (await env.DB.prepare("SELECT revision FROM review_deliveries WHERE submission_id=?").bind(submission).first<{ revision: number }>())!.revision;

const cardRow = async (id: string) =>
  (await env.DB.prepare("SELECT status,last_synced_at FROM cards WHERE id=?").bind(id).first<{ status: string; last_synced_at: number }>())!;

it("a sync that writes the same names does not re-deliver the review message", async () => {
  const id = await card("draft");
  await submissionFor(id);
  const before = await revision();
  await syncStatement(env.DB, id, 0, synced, Date.now()).run();
  await syncStatement(env.DB, id, 0, synced, Date.now() + 1).run();
  expect(await revision()).toBe(before);
});

it("a real name, status or visibility change still re-delivers it", async () => {
  const id = await card("draft");
  await submissionFor(id);
  let expected = await revision();
  await syncStatement(env.DB, id, 0, role({ roleId: "sealed-1", name: "改過的名字" }), Date.now()).run();
  expect(await revision()).toBe(++expected);
  await env.DB.prepare("UPDATE cards SET status='rejected' WHERE id=?").bind(id).run();
  expect(await revision()).toBe(++expected);
  await env.DB.prepare("UPDATE cards SET public_blocked=1 WHERE id=?").bind(id).run();
  expect(await revision()).toBe(++expected);
});

/** Harbor 的回應：真的 role/detail 處理函式說「沒有這張卡」，或是路由層／邊緣的裸 404。 */
function harborAnswers(answer: (roleId: string) => Response) {
  restoreUpstream();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    return answer(url.searchParams.get("roleId") ?? "");
  });
}
const roleNotFound = () => new Response(JSON.stringify({ error: "role_not_found" }), { status: 404, headers: { "content-type": "application/json" } });

it("a card Harbor says is gone (role_not_found) leaves the board, keeps its review history and goes to the back of the queue", async () => {
  const gone = await card("gone", { hosted: "sealed-gone", lastSynced: 1 });
  await submissionFor(gone, "s-gone", "pending");
  await env.DB.prepare("INSERT INTO review_stamps(submission_id,member_id,verdict,created_at) VALUES('s-gone','reviewer','approve',1)").run();
  await env.DB.prepare("UPDATE review_submissions SET status='approved' WHERE id='s-gone'").run();
  harborAnswers(roleNotFound);

  const result = await syncBatch(env);

  expect(result).toMatchObject({ ok: 0, failed: 0, delisted: 1 });
  const row = await cardRow(gone);
  expect(row.status).toBe("unshared");
  expect(row.last_synced_at).toBeGreaterThan(1);
  expect(await env.DB.prepare("SELECT count(*) n FROM review_submissions WHERE card_id=?").bind(gone).first<{ n: number }>()).toEqual({ n: 1 });
  expect(await env.DB.prepare("SELECT count(*) n FROM review_stamps WHERE submission_id='s-gone'").first<{ n: number }>()).toEqual({ n: 1 });
  restoreUpstream();
  const board = (await (await SELF.fetch("https://c.test/v1/cards")).json()) as { items: { id: string }[] };
  expect(board.items.map((i) => String(i.id))).not.toContain(gone);
});

it("a bare 404 without Harbor's role_not_found (edge, route, deploy) stays a transient failure", async () => {
  const id = await card("edge", { hosted: "sealed-edge", lastSynced: 1 });
  harborAnswers(() => new Response("<html>404 Not Found</html>", { status: 404, headers: { "content-type": "text/html" } }));

  const result = await syncBatch(env);

  expect(result).toMatchObject({ ok: 0, failed: 1, delisted: 0 });
  expect(await cardRow(id)).toEqual({ status: "approved", last_synced_at: 1 });
});

it("other callers still see role_not_found as a plain 404", async () => {
  harborAnswers(roleNotFound);
  const error = await upstream.fetchRole(env, "whatever").catch((e) => e);
  expect(error).toBeInstanceOf(HttpError);
  expect((error as HttpError).status).toBe(404);
});

it("when many cards vanish in one round, none are delisted: a mass disappearance is an upstream fault", async () => {
  const ids = [];
  for (let i = 0; i < 4; i++) ids.push(await card(`vanished-${i}`, { hosted: `sealed-${i}`, lastSynced: 1 }));
  harborAnswers(roleNotFound);

  const result = await syncBatch(env);

  expect(result).toMatchObject({ ok: 0, failed: 4, delisted: 0 });
  for (const id of ids) expect(await cardRow(id)).toEqual({ status: "approved", last_synced_at: 1 });
});

it("a few real deletions in one round are still delisted", async () => {
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push(await card(`deleted-${i}`, { hosted: `sealed-${i}`, lastSynced: 1 }));
  harborAnswers(roleNotFound);

  expect(await syncBatch(env)).toMatchObject({ failed: 0, delisted: 3 });
  for (const id of ids) expect((await cardRow(id)).status).toBe("unshared");
});

it("a temporary upstream failure keeps the card listed and first in line for the next round", async () => {
  const flaky = await card("flaky", { hosted: "sealed-flaky", lastSynced: 1 });
  vi.spyOn(upstream, "fetchRole").mockImplementation(async () => {
    throw new HttpError(502, "upstream boom");
  });

  const result = await syncBatch(env);

  expect(result).toMatchObject({ ok: 0, failed: 1, delisted: 0 });
  expect(await cardRow(flaky)).toEqual({ status: "approved", last_synced_at: 1 });
});

it("does not delist a card whose approved revision changed while the read was in flight", async () => {
  const id = await card("moving", { hosted: "sealed-old", lastSynced: 1 });
  restoreUpstream();
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    await env.DB.prepare("UPDATE cards SET approved_hosted_role_id='sealed-new' WHERE id=?").bind(id).run();
    return roleNotFound();
  });

  await syncBatch(env);

  expect((await cardRow(id)).status).toBe("approved");
});
