-- 登記補充包：管理員發給指定作者的額外登記次數。不隨週重置，先用免費額度、用完才扣包。
-- 「剩幾次」不存欄位，由 granted 減掉引用這個包的登記列數算出來——登記列是 append-only，
-- 而且登記跟扣包是同一列，兩邊永遠對得上。
CREATE TABLE registration_packs (
 id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id),
 granted INTEGER NOT NULL CHECK(granted>0 AND granted<=100), reason TEXT NOT NULL,
 granted_by TEXT NOT NULL REFERENCES members(id), operation_id TEXT NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(granted_by,operation_id)
);
CREATE INDEX registration_packs_member ON registration_packs(member_id,created_at);
ALTER TABLE card_registrations ADD COLUMN pack_id TEXT REFERENCES registration_packs(id);
CREATE INDEX card_registrations_pack ON card_registrations(pack_id);

-- 週額度只管沒帶包的登記；帶包的登記由下面的 community_pack_guard 管。
DROP TRIGGER community_weekly_limit;
CREATE TRIGGER community_weekly_limit BEFORE INSERT ON card_registrations
WHEN NEW.pack_id IS NULL AND
 (SELECT COUNT(DISTINCT work_key) FROM community_registration_usage
  WHERE member_id=COALESCE(
   (SELECT owner_member_id FROM member_connections WHERE provider=NEW.provider AND external_id=CAST(NEW.author_num_id AS TEXT)),
   (SELECT member_id FROM member_identities WHERE provider=NEW.provider AND external_id=CAST(NEW.author_num_id AS TEXT)))
  AND registered_at >= ((NEW.registered_at-345600000)/604800000)*604800000+345600000
  AND registered_at < ((NEW.registered_at-345600000)/604800000)*604800000+950400000
 ) >= 3 AND NOT EXISTS (
 SELECT 1 FROM community_registration_usage
 WHERE member_id=COALESCE(
   (SELECT owner_member_id FROM member_connections WHERE provider=NEW.provider AND external_id=CAST(NEW.author_num_id AS TEXT)),
   (SELECT member_id FROM member_identities WHERE provider=NEW.provider AND external_id=CAST(NEW.author_num_id AS TEXT)))
 AND work_key=COALESCE((SELECT w.source_provider||':'||w.source_role_id FROM work_copies cp JOIN works w ON w.id=cp.work_id WHERE cp.provider=NEW.provider AND cp.role_id=NEW.source_role_id),NEW.provider||':'||NEW.source_role_id)
 AND registered_at >= ((NEW.registered_at-345600000)/604800000)*604800000+345600000
 AND registered_at < ((NEW.registered_at-345600000)/604800000)*604800000+950400000
 )
BEGIN
 SELECT RAISE(ABORT,'weekly_quota_exceeded');
END;

-- 帶包的登記：包必須是這個成員的、而且還有剩。序列化寫入讓兩個同時扣同一包的請求只有一個成功。
CREATE TRIGGER community_pack_guard BEFORE INSERT ON card_registrations
WHEN NEW.pack_id IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM registration_packs p WHERE p.id=NEW.pack_id
 AND p.member_id=COALESCE(
   (SELECT owner_member_id FROM member_connections WHERE provider=NEW.provider AND external_id=CAST(NEW.author_num_id AS TEXT)),
   (SELECT member_id FROM member_identities WHERE provider=NEW.provider AND external_id=CAST(NEW.author_num_id AS TEXT)))
 AND p.granted > (SELECT COUNT(*) FROM card_registrations r WHERE r.pack_id=p.id)
)
BEGIN
 SELECT RAISE(ABORT,'registration_pack_unavailable');
END;
