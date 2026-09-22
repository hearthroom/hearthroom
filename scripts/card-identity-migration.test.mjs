import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const files = readdirSync(new URL('../migrations/', import.meta.url)).filter(f=>f.endsWith('.sql')).sort();
const sql = name => readFileSync(new URL('../migrations/'+name, import.meta.url),'utf8');
const target = '0037_numeric_card_identity.sql';
function legacy() {
 const db = new DatabaseSync(':memory:');
 db.exec('PRAGMA foreign_keys=ON;');
 for(const f of files.filter(f=>f<target)) db.exec(sql(f));
 db.exec(`INSERT INTO members(id,handle,created_at) VALUES('member','abcdefgh',1);
 INSERT INTO cards(id,source_role_id,author_num_id,registered_at,last_synced_at,search_text) VALUES('old-card-uuid','source',7,1,1,'lighthouse');
 INSERT INTO card_numbers(provider,source_role_id) VALUES('lunatalk','source');
 INSERT INTO member_favorites VALUES('member','old-card-uuid',1);
 INSERT INTO comments(id,card_id,member_id,content,created_at) VALUES('comment','old-card-uuid','member','A comment',1);
 INSERT INTO comment_likes VALUES('comment','member',1);
 INSERT INTO review_submissions(id,card_id,provider,source_role_id,kind,status,submitted_at) VALUES('review','old-card-uuid','lunatalk','source','first','approved',1);
 INSERT INTO review_submissions(id,card_id,provider,source_role_id,kind,status,submitted_at) VALUES('frozen-review','old-card-uuid','lunatalk','frozen-source','re','superseded',1);
 INSERT INTO hosting_versions(version_id,work_id,member_id,operation_id,source_role_id,provider,nsfw,card_id,state,created_at) VALUES('version','work','member','op','source','lunatalk',0,'old-card-uuid','approved',1);
 INSERT INTO hosting_replicas VALUES('version','lunatalk','source','frozen-source','ready',1);
 INSERT INTO community_notifications(event_key,member_id,kind,path,created_at) VALUES('event','member','comment_reply','/cards/old-card-uuid',1);
 INSERT INTO works VALUES('private-work','member','harbor','private-source',1);`);
 return db;
}
test('migrates existing identities, references, FTS and notifications without losing data or guards',()=>{
 const db=legacy();
 const before=db.prepare("SELECT type,name FROM sqlite_schema WHERE type IN ('trigger','view','index') AND sql IS NOT NULL ORDER BY type,name").all();
 db.exec('BEGIN;');db.exec(sql(target));db.exec('COMMIT;');
 assert.equal(db.prepare('SELECT id FROM cards').get().id,100001);
 for(const t of ['comments','member_favorites','review_submissions','hosting_versions']) {
  assert.equal(db.prepare(`SELECT card_id FROM ${t}`).get().card_id,100001,t);
  assert.equal(db.prepare(`SELECT typeof(card_id) AS t FROM ${t}`).get().t,'integer',t);
 }
 assert.equal(db.prepare('SELECT count(*) AS n FROM comment_likes').get().n,1);
 assert.equal(db.prepare('SELECT count(*) AS n FROM hosting_replicas').get().n,1);
 assert.equal(db.prepare("SELECT id FROM cards WHERE rowid IN(SELECT rowid FROM cards_fts WHERE cards_fts MATCH 'lighthouse')").get().id,100001);
 assert.equal(db.prepare("SELECT path FROM community_notifications WHERE event_key='event'").get().path,'/cards/100001');
 assert.equal(db.prepare("SELECT num FROM card_numbers WHERE source_role_id='private-source'").get().num,100002);
 assert.equal(db.prepare("SELECT count(*) AS n FROM card_numbers WHERE source_role_id='frozen-source'").get().n,0);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 assert.deepEqual(db.prepare("SELECT type,name FROM sqlite_schema WHERE type IN ('trigger','view','index') AND sql IS NOT NULL ORDER BY type,name").all(),before);
 assert.throws(()=>db.exec("UPDATE review_submissions SET status='pending' WHERE id='review'"),/submission already decided/);
 assert.throws(()=>db.exec("UPDATE cards SET id='uuid'"),/datatype mismatch/);
 assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name LIKE 'card_%migration%'").get().n,0);
 db.exec('DELETE FROM cards;');
 assert.equal(db.prepare('SELECT count(*) AS n FROM member_favorites').get().n,0);
 assert.equal(db.prepare('SELECT count(*) AS n FROM comments').get().n,1);
 db.close();
});
test('aborts and rolls back when an old comment cannot be mapped instead of dropping it',()=>{
 const db=legacy();db.exec("INSERT INTO comments(id,card_id,member_id,content,created_at) VALUES('orphan','unknown-uuid','member','Keep me',2)");
 db.exec('BEGIN;');assert.throws(()=>db.exec(sql(target)),/CHECK constraint failed/);db.exec('ROLLBACK;');
 assert.equal(db.prepare("SELECT content FROM comments WHERE id='orphan'").get().content,'Keep me');
 assert.equal(db.prepare('SELECT id FROM cards').get().id,'old-card-uuid');
 assert.equal(db.prepare('SELECT count(*) AS n FROM member_favorites').get().n,1);db.close();
});
