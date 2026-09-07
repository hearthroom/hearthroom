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
  it("來源不是本站建的卡，同步時下架；本站建的照常更新", async () => {
    // 規則之前登記進來的：一張主站建的、一張上游沒記來源的、一張本站建的
    await upsertCard(env.DB, role({ roleId: "main-1", creationMethod: "manual" }), 1);
    await upsertCard(env.DB, role({ roleId: "old-1", creationMethod: "" }), 1);
    await upsertCard(env.DB, role({ roleId: "ours-1", name: "舊名" }), 1);
    rolesOnMainSite(
      { roleId: "main-1", creationMethod: "manual" },
      { roleId: "old-1", creationMethod: "" },
      { roleId: "ours-1", name: "新名" },
    );

    const r = await syncBatch(env);
    expect(r).toMatchObject({ ok: 1, failed: 0, delisted: 2 });
    expect(await onBoard()).toEqual(["ours-1"]);
    const row = await env.DB.prepare("SELECT names FROM cards WHERE source_role_id = 'ours-1'").first<{ names: string }>();
    expect(JSON.parse(row!.names).zh).toBe("新名");
  });

  it("讀不到的卡保留（上游可能只是暫時掛了），不當成來源不對", async () => {
    await upsertCard(env.DB, role({ roleId: "ours-1" }), 1);
    upstream.fetchRole = async () => { throw new HttpError(502, "upstream down"); };
    const r = await syncBatch(env);
    expect(r).toMatchObject({ ok: 0, failed: 1, delisted: 0 });
    expect(await onBoard()).toEqual(["ours-1"]);
  });
});
