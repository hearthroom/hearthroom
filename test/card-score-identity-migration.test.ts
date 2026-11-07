import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach, expect, it } from "vitest";
import { resetDb } from "./helpers";
import { readScore, clearScore } from "../src/card-scores";

const migration = env.TEST_MIGRATIONS.find(m => m.name === "0112_card_score_identity.sql")!;
const run = () => applyD1Migrations(env.DB, [migration]);
beforeEach(async () => {
  await resetDb();
  for (const trigger of ["card_scores_canonical_insert", "card_scores_canonical_update"])
    await env.DB.prepare(`DROP TRIGGER IF EXISTS ${trigger}`).run();
  await env.DB.prepare("DELETE FROM d1_migrations WHERE name=?").bind(migration.name).run();
});
const vote = (card: string, member: string, score: number, created: number, updated: number) =>
  env.DB.prepare("INSERT INTO card_scores VALUES(?,?,?,?,?)").bind(card, member, score, created, updated);
const rows = async () => (await env.DB.prepare("SELECT * FROM card_scores ORDER BY card_id,member_id").all()).results;

it("keeps the latest update, then creation, with a stable tie break; all readers and clear use the surviving rating", async () => {
  for (let i=0; i<5; i++) await env.DB.prepare("INSERT INTO members(id,handle,created_at) VALUES(?,?,0)").bind(`fan${i}`, `fanname${i}`).run();
  await env.DB.batch([
    vote("100001.0", "fan0", 1, 10, 10), vote("100001", "fan0", 5, 1, 20),
    vote("100001.0", "fan1", 4, 20, 20), vote("100001", "fan1", 1, 10, 20),
    vote("100001.0", "fan2", 1, 20, 20), vote("100001", "fan2", 3, 20, 20),
    vote("100001.0", "fan3", 2, 1, 1), vote("100001", "fan4", 5, 1, 1),
    vote("100002", "fan0", 1, 1, 1),
  ]);
  await run();
  expect(await rows()).toHaveLength(6);
  expect(await readScore(env.DB,"100001","fan1")).toEqual({count:5,average:3.8,sufficient:true,histogram:[0,1,1,1,2],mine:4});
  expect((await rows()).every(r => !String(r.card_id).includes("."))).toBe(true);
  await run(); // the runner records it once
  expect(await rows()).toHaveLength(6);
  await clearScore(env.DB,"100001","fan1");
  expect(await readScore(env.DB,"100001","fan1")).toMatchObject({count:4,mine:null});
});

it("rejects noncanonical insert/update and preserves one member per card", async () => {
  await run();
  await vote("100001","fan",5,1,1).run();
  for(const bad of ["100001.0","0100001","100001junk","1e5","", "-1", "0", "9223372036854775808"])
    await expect(vote(bad,"other",4,1,1).run()).rejects.toThrow(/card_score_id_invalid/);
  await expect(env.DB.prepare("UPDATE card_scores SET card_id='100001.0'").run()).rejects.toThrow(/card_score_id_invalid/);
  await expect(vote("100001","fan",1,2,2).run()).rejects.toThrow(/UNIQUE/);
  expect(await rows()).toHaveLength(1);
});

it("rolls back all changes and bookkeeping on unexpected legacy formats, then resumes after correction", async () => {
  await env.DB.batch([vote("100001.0","fan",4,1,1),vote("bad-id","other",2,1,1)]);
  const before=await rows();
  await expect(run()).rejects.toThrow();
  expect(await rows()).toEqual(before);
  expect(await env.DB.prepare("SELECT name FROM d1_migrations WHERE name=?").bind(migration.name).first()).toBeNull();
  await env.DB.prepare("DELETE FROM card_scores WHERE card_id='bad-id'").run();
  await run();
  expect(await rows()).toMatchObject([{card_id:"100001",score:4}]);
});

for (const protection of ["test", "retired", "test-owner"] as const) it(`preserves ${protection} fences and rolls back instead of bypassing them`, async () => {
  await env.DB.prepare("INSERT INTO members(id,handle,created_at) VALUES('protected','protected',0)").run();
  await env.DB.batch([vote("100001.0","protected",4,1,1),vote("100001","protected",5,2,2)]);
  if(protection === "test") await env.DB.prepare("UPDATE members SET account_class='test' WHERE id='protected'").run();
  if(protection === "retired") await env.DB.prepare("INSERT INTO legacy_account_fence(public_no,member_id,request_id,created_at) VALUES(279,'protected','fixture',0)").run();
  if(protection === "test-owner") {
    await env.DB.prepare("INSERT INTO members(id,handle,created_at,account_class) VALUES('owner','ownername',0,'test')").run();
    // The ownership view resolves registered cards, so insert its actual backing rows.
    await env.DB.prepare("INSERT INTO cards(id,provider,source_role_id,author_num_id,registered_at,last_synced_at,search_text) VALUES(100001,'harbor','fixture',7,0,0,'')").run();
    await env.DB.prepare("INSERT INTO member_identities(provider,external_id,member_id,linked_at) VALUES('harbor','7','owner',0)").run();
  }
  const before=await rows();
  await expect(run()).rejects.toThrow();
  expect(await rows()).toEqual(before);
  expect(await env.DB.prepare("SELECT name FROM d1_migrations WHERE name=?").bind(migration.name).first()).toBeNull();
});

it("rolls back deletions and prior updates when a later update fails; the original file resumes successfully", async () => {
  await env.DB.batch([vote("100001.0","fan",1,1,1), vote("100001","fan",5,2,2),vote("100002.0","other",4,1,1)]);
  await env.DB.prepare("CREATE TRIGGER fixture_abort_score_update BEFORE UPDATE ON card_scores BEGIN SELECT RAISE(ABORT,'fixture_update_failure'); END").run();
  const before=await rows();
  await expect(run()).rejects.toThrow(/fixture_update_failure/);
  expect(await rows()).toEqual(before);
  expect(await env.DB.prepare("SELECT name FROM d1_migrations WHERE name=?").bind(migration.name).first()).toBeNull();
  expect(await env.DB.prepare("SELECT name FROM sqlite_master WHERE name='card_score_identity_guard'").first()).toBeNull();
  await env.DB.prepare("DROP TRIGGER fixture_abort_score_update").run();
  await run();
  expect(await rows()).toMatchObject([{card_id:"100001",score:5},{card_id:"100002",score:4}]);
});
