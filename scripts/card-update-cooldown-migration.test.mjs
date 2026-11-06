import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const target = '0111_card_update_cooldown_exempt.sql';
const sql = name => readFileSync(new URL('../migrations/' + name, import.meta.url), 'utf8');
function baseline() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  for (const name of readdirSync(new URL('../migrations/', import.meta.url)).filter(n => n.endsWith('.sql') && n < target).sort()) db.exec(sql(name));
  for (const work of ['listed', 'ordinary']) {
    db.prepare("INSERT INTO works VALUES(?, 'synthetic-author', 'harbor', ?, 1)").run(work, work);
    for (const version of ['old', 'next', 'pending']) db.prepare(`INSERT INTO hosting_versions(version_id,work_id,member_id,operation_id,source_role_id,provider,rating,state,created_at)
      VALUES(?,?,'synthetic-author',?,?,'harbor','G','approved',1)`).run(work+'-'+version,work,work+'-'+version,work);
    db.prepare("INSERT INTO card_update_events VALUES(?,?,'published',1000,1000)").run(work+'-old',work);
  }
  return db;
}
function migrate(db) {
  db.exec('BEGIN');
  try { db.exec(sql(target)); db.exec('COMMIT'); }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
const reserve = (db, work, version='next', at=1001) => db.prepare("INSERT INTO card_update_events(version_id,work_id,state,reserved_at) VALUES(?,?,'reserved',?)").run(work+'-'+version,work,at);

test('full migration preserves old rows, exempts only the listed work and keeps FK, uniqueness and publication guards', () => {
  const db = baseline();
  const before = db.prepare('SELECT * FROM card_update_events ORDER BY version_id').all();
  const guards = db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND name<>'card_update_reservation_guard' ORDER BY name").all();
  migrate(db);
  assert.deepEqual(db.prepare('SELECT * FROM card_update_events ORDER BY version_id').all(), before);
  assert.deepEqual(db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND name<>'card_update_reservation_guard' ORDER BY name").all(), guards);
  assert.throws(() => reserve(db,'listed'), /update_notification_cooldown/);
  db.exec("INSERT INTO card_update_cooldown_exempt VALUES('listed',2000,'Synthetic author request')");
  reserve(db,'listed');
  assert.throws(() => reserve(db,'listed','pending'), /UNIQUE constraint/);
  assert.throws(() => reserve(db,'ordinary'), /update_notification_cooldown/);
  db.exec("DELETE FROM card_update_events WHERE state='reserved'; DELETE FROM card_update_cooldown_exempt WHERE work_id='listed'");
  assert.throws(() => reserve(db,'listed'), /update_notification_cooldown/);
  reserve(db,'ordinary','next',1000+259200000);
  assert.throws(() => db.exec("INSERT INTO card_update_cooldown_exempt VALUES('missing',1,'request')"), /FOREIGN KEY/);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  db.close();
});

test('runner rolls back the complete file on failure and retries from the last recorded schema', () => {
  const db=baseline();
  const guard=db.prepare("SELECT sql FROM sqlite_schema WHERE name='card_update_reservation_guard'").get().sql;
  db.exec('DROP TRIGGER card_update_reservation_guard'); // Simulate a drifted predecessor.
  assert.throws(() => migrate(db), /no such trigger/);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name='card_update_cooldown_exempt'").get().n,0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM card_update_events').get().n,2);
  db.exec(guard);migrate(db);
  assert.throws(() => reserve(db,'ordinary'), /update_notification_cooldown/);
  db.close();
});
