import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const directory=new URL('../migrations/',import.meta.url),target='0107_blog_publisher_identity.sql';
test('seeds a rerunnable system-owned blog audit member without login identity or reviewer privileges',()=>{
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
 for(const name of readdirSync(directory).filter(n=>n.endsWith('.sql')&&n<target).sort())db.exec(readFileSync(new URL(name,directory),'utf8'));
 const migration=readFileSync(new URL(target,directory),'utf8');db.exec(migration);db.exec(migration);
 const member=db.prepare("SELECT id,handle,display_name FROM members WHERE id='system-blog-publisher'").get();
 assert.deepEqual(member&&{...member},{id:'system-blog-publisher',handle:'sukiblog',display_name:'蘇綺'});
 for(const table of ['member_identities','reviewers','review_agents'])assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE member_id='system-blog-publisher'`).get().n,0);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM member_connections WHERE owner_member_id='system-blog-publisher'").get().n,0);
 const audit=db.prepare("SELECT subject_kind,subject_id,actor_kind,action FROM audit_log WHERE id='system-blog-publisher-created'").get();
 assert.deepEqual(audit&&{...audit},{subject_kind:'member',subject_id:'system-blog-publisher',actor_kind:'system',action:'blog_publisher_identity_create'});
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE operation_id='system-blog-publisher-created'").get().n,1);
 db.close();
});

test('refuses to adopt the reserved member once it has a login identity',()=>{
 const db=new DatabaseSync(':memory:');
 for(const name of readdirSync(directory).filter(n=>n.endsWith('.sql')).sort())db.exec(readFileSync(new URL(name,directory),'utf8'));
 db.exec("INSERT INTO member_identities(provider,external_id,member_id,linked_at) VALUES('harbor','synthetic','system-blog-publisher',1)");
 assert.throws(()=>db.exec(readFileSync(new URL(target,directory),'utf8')),/CHECK constraint/); db.close();
});
