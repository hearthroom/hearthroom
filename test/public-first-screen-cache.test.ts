import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import worker from "../src/index";
import { boardCache, boardKey } from "../src/board-cache";
import { upsertCard } from "../src/cards";
import { makeMember, recordD1, resetDb, role, testHandle } from "./helpers";

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

const flag = "public_candidate_projection_cache";
async function toggle(enabled: boolean) {
  await env.DB.prepare("INSERT OR REPLACE INTO community_settings(key,value,updated_at) VALUES (?,?,?)")
    .bind(flag, JSON.stringify(enabled), Date.now()).run();
}

async function fetchBoard(path: string, db: D1Database) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request("https://c.test/v1/cards" + path), { ...env, DB: db }, ctx);
  await waitOnExecutionContext(ctx);
  expect(response.status).toBe(200);
  return { layer: response.headers.get("X-Cache-Layer"), body: await response.json() };
}

const candidateScans = (queries: string[]) => queries.filter(query =>
  query.startsWith("SELECT CAST(c.id AS TEXT) AS id FROM cards c") && query.includes("ORDER BY"));

it("reuses a general first-screen projection across locale and page size without sharing the presentation", async () => {
  await toggle(true);
  await upsertCard(env.DB, { ...role({ roleId: "projection-1", authorNumId: 11, name: "Project 1" }), names: { en: "Project 1", ja: "作品 1", zh: "作品 1", ko: "작품 1" } }, 1, { status: "approved" });
  await upsertCard(env.DB, { ...role({ roleId: "projection-2", authorNumId: 11, name: "Project 2" }), names: { en: "Project 2", ja: "作品 2", zh: "作品 2", ko: "작품 2" } }, 2, { status: "approved" });
  const { db, queries } = recordD1(env.DB);
  const first = await fetchBoard("?zone=all&sort=new&lang=en&limit=1", db);
  expect(first.layer).toBe("origin");
  expect(first.body).toMatchObject({ items: [{ name: "Project 2" }], limit: 1, hasNext: true });
  expect(candidateScans(queries)).toHaveLength(1);

  const second = await fetchBoard("?zone=all&sort=new&lang=ja&limit=2", db);
  expect(second.layer).toBe("edge");
  expect(second.body).toMatchObject({ items: [{ name: "作品 2" }, { name: "作品 1" }], limit: 2, hasNext: false });
  expect(candidateScans(queries)).toHaveLength(1);

  const clock = await db.prepare("SELECT revision FROM moderation_clock WHERE id=1").first<{ revision: number }>();
  const sharedKey = await boardKey("https://c.test/v1/cards?zone=all&sort=new", clock?.revision ?? 0, false, "en", undefined, undefined, true);
  expect(await (await caches.open(boardCache.namespace)).delete(sharedKey.edge)).toBe(true);
  const coldEdge = await fetchBoard("?zone=all&sort=new&lang=ko&limit=3", db);
  expect(coldEdge.layer).toBe("kv");
  expect(coldEdge.body).toMatchObject({ items: [{ name: "작품 2" }, { name: "작품 1" }], limit: 3 });
  expect(candidateScans(queries)).toHaveLength(1);
});

it("never uses a filtered legacy response as a shared first-screen projection", async () => {
  await toggle(true);
  await upsertCard(env.DB, role({ roleId: "projection-1", authorNumId: 11, name: "Project" }), 1, { status: "approved" });
  const { db } = recordD1(env.DB);

  const filtered = await fetchBoard("?zone=all&sort=new&lang=en&limit=1&fandom=unmatched", db);
  expect(filtered.body).toMatchObject({ items: [] });
  const first = await fetchBoard("?zone=all&sort=new&lang=en&limit=1", db);
  expect(first.layer).toBe("origin");
  expect(first.body).toMatchObject({ items: [{ name: "Project" }] });
  const warm = await fetchBoard("?zone=all&sort=new&lang=ja&limit=2", db);
  expect(warm.layer).toBe("edge");
  expect(warm.body).toMatchObject({ items: [{ name: "Project" }] });
});

it("keeps the public author filter on a warm first screen and preserves its cursor", async () => {
  await toggle(true);
  await makeMember(11);
  await makeMember(12);
  await upsertCard(env.DB, role({ roleId: "author-first", authorNumId: 11, name: "First" }), 1, { status: "approved" });
  await upsertCard(env.DB, role({ roleId: "author-second", authorNumId: 11, name: "Second" }), 2, { status: "approved" });
  await upsertCard(env.DB, role({ roleId: "other-author", authorNumId: 12, name: "Other" }), 3, { status: "approved" });
  const { db, queries } = recordD1(env.DB);
  const author = `?author=${testHandle(11)}&sort=new`;

  const first = await fetchBoard(`${author}&lang=en&limit=1`, db);
  expect(first.body).toMatchObject({ items: [{ name: "Second" }], hasNext: true });
  const warm = await fetchBoard(`${author}&lang=ja&limit=2`, db);
  expect(warm.layer).toBe("edge");
  expect(warm.body).toMatchObject({ items: [{ name: "Second" }, { name: "First" }], hasNext: false });
  expect(candidateScans(queries)).toHaveLength(1);

  const { nextCursor } = first.body as { nextCursor?: string };
  expect(nextCursor).toBeTruthy();
  const next = await fetchBoard(`${author}&lang=en&limit=1&offset=1&cursor=${encodeURIComponent(nextCursor!)}`, db);
  expect(next.layer).toBe("origin");
  expect(next.body).toMatchObject({ items: [{ name: "First" }], hasNext: false });
});

it("bypasses the shared projection after the primary 5s settings memo expires", async () => {
  const time = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
  await toggle(true);
  await upsertCard(env.DB, role({ roleId: "projection-1", authorNumId: 11 }), 1, { status: "approved" });
  const { db } = recordD1(env.DB);
  expect((await fetchBoard("?zone=all&sort=new&limit=1", db)).layer).toBe("origin");
  expect((await fetchBoard("?zone=all&sort=new&limit=2", db)).layer).toBe("edge");

  await toggle(false);
  time.mockReturnValue(1_800_000_005_001);
  expect((await fetchBoard("?zone=all&sort=new&limit=3", db)).layer).toBe("origin");
});
