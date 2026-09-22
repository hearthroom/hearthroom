import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDb, restoreUpstream, role, rolesOnMainSite } from "./helpers";
import { upsertCard } from "../src/cards";
import { syncBatch } from "../src/index";
import { upstream } from "../src/upstream";
import { HttpError } from "../src/types";

beforeEach(resetDb);
afterEach(restoreUpstream);

const onBoard = async () =>
  (await env.DB.prepare("SELECT source_role_id FROM cards ORDER BY source_role_id").all<{ source_role_id: string }>()).results.map((r) => r.source_role_id);

describe("排程同步", () => {
  it("未封存的舊列不再觸發更新、下架或重審", async () => {
    await upsertCard(env.DB,role({roleId:"old-1",name:"保留原狀"}),1);
    let reads=0;upstream.fetchRole=async()=>{reads++;return role({roleId:"old-1",name:"新草稿"})};
    expect(await syncBatch(env)).toMatchObject({ok:0,failed:0,delisted:0});
    expect(reads).toBe(0);
    expect(await onBoard()).toEqual(["old-1"]);
    expect(await env.DB.prepare("SELECT status,names FROM cards").first()).toMatchObject({status:"approved",names:expect.stringContaining("保留原狀")});
    expect((await env.DB.prepare("SELECT id FROM review_submissions").all()).results).toHaveLength(0);
  });

  it("讀不到的卡保留（上游可能只是暫時掛了），不當成來源不對", async () => {
    await upsertCard(env.DB, role({ roleId: "ours-1" }), 1);
    await env.DB.prepare("UPDATE cards SET approved_hosted_role_id='frozen-1'").run();
    upstream.fetchRole = async () => { throw new HttpError(502, "upstream down"); };
    const r = await syncBatch(env);
    expect(r).toMatchObject({ ok: 0, failed: 1, delisted: 0 });
    expect(await onBoard()).toEqual(["ours-1"]);
  });
});
