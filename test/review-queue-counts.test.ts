import { env } from "cloudflare:test";
import { beforeEach, expect, it } from "vitest";
import { queueCounts } from "../src/review";
import { resetDb } from "./helpers";

beforeEach(resetDb);

it("counts pending tabs without reading decisions from unrelated cards", async () => {
  await env.DB.batch([
    env.DB.prepare(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<32)
      INSERT INTO cards(id,provider,source_role_id,author_num_id,registered_at,last_synced_at,status)
      SELECT 100000+x,'harbor','fixture-'||x,x,1,1,'approved' FROM n`),
    env.DB.prepare(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<2400)
      INSERT INTO review_submissions(id,card_id,provider,source_role_id,kind,status,submitted_at)
      SELECT 'history-'||x,101000+x,'harbor','history-'||x,'first',
             CASE WHEN x%2=0 THEN 'approved' ELSE 'rejected' END,1 FROM n`),
    env.DB.prepare(`INSERT INTO review_submissions(id,card_id,provider,source_role_id,kind,status,submitted_at,reopen_of,flip_of)
      VALUES ('earlier-rejected',100001,'harbor','fixture-1','first','rejected',2,NULL,NULL),
             ('replaced',100002,'harbor','fixture-2','first','superseded',1,NULL,NULL),
             ('reopened-history',100003,'harbor','fixture-3','first','approved',1,'original',NULL),
             ('flip-original',100004,'harbor','fixture-4','first','rejected',2,NULL,NULL),
             ('hidden-flip',100005,'harbor','fixture-5','first','rejected',1,NULL,'missing-original')`),
    env.DB.prepare(`INSERT INTO review_submissions(id,card_id,provider,source_role_id,kind,status,submitted_at,reopen_of,flip_of)
      SELECT 'pending-'||(id-100000),id,'harbor',source_role_id,CASE WHEN id=100006 THEN 'update' ELSE 'first' END,
             'pending',2,CASE WHEN id=100007 THEN 'original' END,CASE WHEN id=100004 THEN 'flip-original' END
      FROM cards`),
    env.DB.prepare(`INSERT INTO review_submissions(id,card_id,provider,source_role_id,kind,status,submitted_at)
      VALUES ('later-same-time',100008,'harbor','fixture-8','first','approved',2),
             ('orphan',199999,'harbor','orphan','first','pending',2)`),
    env.DB.prepare(`INSERT INTO review_drops(id,submission_id,case_id,source,created_at,restored_at)
      VALUES ('active','pending-9','drop','single',2,NULL),
             ('restored','pending-10','drop','single',1,2)`),
  ]);

  let sql = "";
  let reads = 0;
  const measured = {
    prepare(query: string) {
      sql = query;
      return {
        async first() {
          const result = await env.DB.prepare(query).all();
          reads = result.meta.rows_read;
          return result.results[0] ?? null;
        },
      };
    },
  } as unknown as D1Database;

  expect(await queueCounts(measured)).toEqual({ new: 28, updates: 3, dropped: 1 });
  const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).all<{ detail: string }>();
  console.log("review queue counts rows_read", reads, plan.results.map((row) => row.detail).join("\n"));
  expect(reads).toBeLessThan(500);
});
