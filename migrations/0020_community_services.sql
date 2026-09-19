-- Community profile edits and owned avatars are independent of provider profiles.
ALTER TABLE members ADD COLUMN bio TEXT NOT NULL DEFAULT '';
ALTER TABLE members ADD COLUMN avatar_key TEXT NOT NULL DEFAULT '';
ALTER TABLE members ADD COLUMN profile_edited_at INTEGER;
-- Older custom profiles cannot be proved empty; preserve them conservatively.
UPDATE members SET profile_edited_at=created_at WHERE display_name IS NOT NULL;

-- Map every publication and known copy to one community and one canonical work.
CREATE VIEW community_registration_usage AS
SELECT COALESCE(mc.owner_member_id, mi.member_id) AS member_id,
       COALESCE(w.source_provider,r.provider)||':'||COALESCE(w.source_role_id,r.source_role_id) AS work_key,
       r.registered_at
FROM card_registrations r
LEFT JOIN member_identities mi ON mi.provider=r.provider AND mi.external_id=CAST(r.author_num_id AS TEXT)
LEFT JOIN member_connections mc ON mc.provider=r.provider AND mc.external_id=CAST(r.author_num_id AS TEXT)
LEFT JOIN work_copies cp ON cp.provider=r.provider AND cp.role_id=r.source_role_id
LEFT JOIN works w ON w.id=cp.work_id;

-- A serialised SQLite write closes the check-then-insert race across providers.
-- Keep the condition in WHEN: remote D1 can split CASE ... END inside a trigger.
CREATE TRIGGER community_weekly_limit BEFORE INSERT ON card_registrations
WHEN
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

CREATE TABLE avatar_cleanup (key TEXT PRIMARY KEY, delete_after INTEGER NOT NULL);
