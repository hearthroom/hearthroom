import {env} from 'cloudflare:test';
import {expect,it} from 'vitest';
import {resetDb} from './helpers';

// 正式站 2026-11-03：0103 把舊成員一律發元老徽章，退役帳號（legacy_account_fence）也在其中，
// 它的 BEFORE INSERT trigger 用 RAISE(ABORT) 擋寫入，INSERT OR IGNORE 擋不住，整支 migration 失敗（CI 41596393651）。
// 這裡在已套用全部 migration 的庫上，加一個退役帳號，再重播 0103 發徽章那幾句（定義那句已經在庫裡，跳過）。
it('awards veterans to existing members but skips the retired legacy account, so 0103 applies on production data',async()=>{
 await resetDb();
 await env.DB.batch([
  env.DB.prepare("INSERT INTO members(id,handle,created_at) VALUES('legacy','cccccccc',1),('early','dddddddd',2)"),
  // 主頁展示的徽章在退役前就設好了（設 fence 之後就寫不進去）
  env.DB.prepare(`INSERT INTO community_preferences(member_id,featured_badges) VALUES('legacy','["member_founder"]'),('early','["member_founder"]')`),
  env.DB.prepare("INSERT INTO legacy_account_fence(public_no,member_id,handle,request_id,created_at) VALUES(279,'legacy','cccccccc','fixture-fence',1)"),
 ]);
 const migration=env.TEST_MIGRATIONS.find(m=>m.name.startsWith('0103_'))!;
 const replay=migration.queries.filter(q=>!/^\s*INSERT\s+INTO\s+community_badge_definitions/i.test(q));
 for(const sql of replay)await env.DB.prepare(sql).run();
 const awards=await env.DB.prepare("SELECT member_id,badge FROM community_awards WHERE source='veteran-v2' ORDER BY member_id").all<{member_id:string;badge:string}>();
 expect(awards.results).toEqual([{member_id:'early',badge:'beta_veteran'}]);
 const prefs=await env.DB.prepare("SELECT member_id,featured_badges FROM community_preferences ORDER BY member_id").all<{member_id:string;featured_badges:string}>();
 expect(prefs.results).toEqual([{member_id:'early',featured_badges:'["beta_veteran"]'},{member_id:'legacy',featured_badges:'["member_founder"]'}]);
});
