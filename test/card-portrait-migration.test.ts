import {env} from 'cloudflare:test';
import {expect,it} from 'vitest';
import {resetDb,role} from './helpers';
import {upsertCard} from '../src/cards';
it('migrates legacy-only images, preserves existing portraits and drops the retired card column after the Worker cutover',async()=>{
 await resetDb();
 const a=await upsertCard(env.DB,role({roleId:'legacy'}),1);
 const b=await upsertCard(env.DB,role({roleId:'portrait'}),1);
 // Reconstruct legacy storage in this isolated transaction.
 await env.DB.prepare('ALTER TABLE cards ADD COLUMN avatar_url TEXT').run();
 await env.DB.prepare("UPDATE cards SET avatar_url='old.gif',background_url=NULL WHERE id=?").bind(a.id).run();
 await env.DB.prepare("UPDATE cards SET avatar_url='old.png',background_url='portrait.gif' WHERE id=?").bind(b.id).run();
 for(const migration of env.TEST_MIGRATIONS.filter(m=>m.name.includes('0038_card_portrait')||m.name.includes('0039_drop_card_avatar')))
  // 只重播搬圖與刪欄位：0038 裡重建的 hosting_decision 是當時的版本，之後的 migration（0056）已換掉它引用的欄位
  for(const sql of migration.queries.filter(q=>!/TRIGGER\s+hosting_decision/i.test(q)))await env.DB.prepare(sql).run();
 expect(await env.DB.prepare('SELECT background_url FROM cards WHERE id=?').bind(a.id).first()).toEqual({background_url:'old.gif'});
 expect(await env.DB.prepare('SELECT background_url FROM cards WHERE id=?').bind(b.id).first()).toEqual({background_url:'portrait.gif'});
 const columns=await env.DB.prepare('PRAGMA table_info(cards)').all<{name:string}>();
 expect(columns.results.map(c=>c.name)).not.toContain('avatar_url');
 const memberColumns=await env.DB.prepare('PRAGMA table_info(members)').all<{name:string}>();
 expect(memberColumns.results.map(c=>c.name)).toContain('avatar_url');
});
