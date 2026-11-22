-- 發卡獎活動期間每週上限改為同裝置合計（2026-11-22 任務 2026-11-22-card-reward-device-cap）。
-- 規則：生效時間起，僅在有進行中 card_reward_campaigns 時，同一 reward_device（HMAC 雜湊）下的非白名單帳號共用一份每週免費額度；
-- 非活動期間平時每週 3 張維持每帳號各自計；無裝置代碼且從未留過紀錄的帳號退回帳號計。
-- 補充包（pack_id IS NOT NULL）不佔用免費額度，且管理員可將共用電腦真實作者加入白名單（quota_device_exemptions）。

CREATE TABLE reward_devices (
 device_hash TEXT NOT NULL,
 member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
 first_seen INTEGER NOT NULL,
 last_seen INTEGER NOT NULL,
 PRIMARY KEY (device_hash, member_id)
);
CREATE INDEX reward_devices_member ON reward_devices(member_id, last_seen);
CREATE INDEX reward_devices_last_seen ON reward_devices(last_seen);

ALTER TABLE card_registrations ADD COLUMN device_hash TEXT;
CREATE INDEX card_registrations_device ON card_registrations(device_hash, registered_at) WHERE device_hash IS NOT NULL;

-- 單列政策開關：Worker 與 D1 觸發器讀同一筆設定時間，避免兩層飄移。
-- 預設生效時間：2026-11-30 00:00:00 UTC（1795996800000，即台北時間 11 月 30 日 08:00），範圍限發卡獎活動（campaign）。
CREATE TABLE quota_device_policy (
 id INTEGER PRIMARY KEY CHECK (id = 1),
 effective_at INTEGER,
 scope TEXT NOT NULL DEFAULT 'campaign' CHECK (scope IN ('campaign', 'all')),
 updated_at INTEGER NOT NULL
);
INSERT INTO quota_device_policy (id, effective_at, scope, updated_at)
VALUES (1, 1795996800000, 'campaign', 1795305600000);

-- 共用電腦真實作者白名單：有效期間該帳號回歸獨立計額，也不佔用同裝置他人額度。
CREATE TABLE quota_device_exemptions (
 member_id TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
 reason TEXT NOT NULL,
 granted_by TEXT NOT NULL REFERENCES members(id),
 operation_id TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 revoked_at INTEGER,
 revoked_by TEXT REFERENCES members(id),
 revoke_reason TEXT,
 UNIQUE (granted_by, operation_id)
);

-- 補帶 pack_id 與 device_hash，原欄位（member_id, work_key, registered_at）保持相容。
DROP VIEW community_registration_usage;
CREATE VIEW community_registration_usage AS
SELECT COALESCE(mc.owner_member_id, mi.member_id) AS member_id,
       COALESCE(w.source_provider, r.provider)||':'||COALESCE(w.source_role_id, r.source_role_id) AS work_key,
       r.registered_at,
       r.pack_id,
       r.device_hash
FROM card_registrations r
LEFT JOIN member_identities mi ON mi.provider=r.provider AND mi.external_id=CAST(r.author_num_id AS TEXT)
LEFT JOIN member_connections mc ON mc.provider=r.provider AND mc.external_id=CAST(r.author_num_id AS TEXT)
LEFT JOIN work_copies cp ON cp.provider=r.provider AND cp.role_id=r.source_role_id
LEFT JOIN works w ON w.id=cp.work_id;

-- D1 觸發器與 Worker（src/quota.ts）兩層一致：
-- Keep the condition in WHEN: remote D1 can split CASE ... END inside a trigger.
DROP TRIGGER community_weekly_limit;
CREATE TRIGGER community_weekly_limit BEFORE INSERT ON card_registrations
WHEN NEW.pack_id IS NULL AND
 (SELECT COUNT(DISTINCT u.work_key) FROM community_registration_usage u
  WHERE u.pack_id IS NULL
   AND u.registered_at >= ((NEW.registered_at-345600000)/604800000)*604800000+345600000
   AND u.registered_at < ((NEW.registered_at-345600000)/604800000)*604800000+950400000
   AND (
    u.member_id=COALESCE(
     (SELECT owner_member_id FROM member_connections WHERE provider=NEW.provider AND external_id=CAST(NEW.author_num_id AS TEXT)),
     (SELECT member_id FROM member_identities WHERE provider=NEW.provider AND external_id=CAST(NEW.author_num_id AS TEXT)))
    OR (
     EXISTS (
      SELECT 1 FROM quota_device_policy p
      WHERE p.id=1 AND p.effective_at IS NOT NULL AND NEW.registered_at >= p.effective_at
       AND (p.scope='all' OR EXISTS (
        SELECT 1 FROM card_reward_campaigns k
        WHERE k.status='active' AND k.starts_at<=NEW.registered_at AND k.ends_at>NEW.registered_at))
     )
     AND NOT EXISTS (
      SELECT 1 FROM quota_device_exemptions ex
      WHERE ex.member_id=COALESCE(
       (SELECT owner_member_id FROM member_connections WHERE provider=NEW.provider AND external_id=CAST(NEW.author_num_id AS TEXT)),
       (SELECT member_id FROM member_identities WHERE provider=NEW.provider AND external_id=CAST(NEW.author_num_id AS TEXT)))
       AND ex.revoked_at IS NULL
     )
     AND NOT EXISTS (
      SELECT 1 FROM quota_device_exemptions ex2
      WHERE ex2.member_id=u.member_id AND ex2.revoked_at IS NULL
     )
     AND (
      (NEW.device_hash IS NOT NULL AND (
       u.device_hash=NEW.device_hash
       OR EXISTS (SELECT 1 FROM reward_devices rd WHERE rd.device_hash=NEW.device_hash AND rd.member_id=u.member_id)
      ))
      OR (u.device_hash IS NOT NULL AND EXISTS (
       SELECT 1 FROM reward_devices myd
       WHERE myd.member_id=COALESCE(
        (SELECT owner_member_id FROM member_connections WHERE provider=NEW.provider AND external_id=CAST(NEW.author_num_id AS TEXT)),
        (SELECT member_id FROM member_identities WHERE provider=NEW.provider AND external_id=CAST(NEW.author_num_id AS TEXT)))
        AND myd.device_hash=u.device_hash
      ))
      OR EXISTS (
       SELECT 1 FROM reward_devices myd
       JOIN reward_devices otd ON otd.device_hash=myd.device_hash
       WHERE myd.member_id=COALESCE(
        (SELECT owner_member_id FROM member_connections WHERE provider=NEW.provider AND external_id=CAST(NEW.author_num_id AS TEXT)),
        (SELECT member_id FROM member_identities WHERE provider=NEW.provider AND external_id=CAST(NEW.author_num_id AS TEXT)))
        AND otd.member_id=u.member_id
      )
     )
    )
   )
 ) >= COALESCE((SELECT MAX(weekly_limit) FROM card_reward_campaigns WHERE status='active' AND starts_at<=NEW.registered_at AND ends_at>NEW.registered_at), 3)
 AND NOT EXISTS (
  SELECT 1 FROM community_registration_usage u2
  WHERE u2.member_id=COALESCE(
    (SELECT owner_member_id FROM member_connections WHERE provider=NEW.provider AND external_id=CAST(NEW.author_num_id AS TEXT)),
    (SELECT member_id FROM member_identities WHERE provider=NEW.provider AND external_id=CAST(NEW.author_num_id AS TEXT)))
  AND u2.work_key=COALESCE((SELECT w.source_provider||':'||w.source_role_id FROM work_copies cp JOIN works w ON w.id=cp.work_id WHERE cp.provider=NEW.provider AND cp.role_id=NEW.source_role_id),NEW.provider||':'||NEW.source_role_id)
  AND u2.registered_at >= ((NEW.registered_at-345600000)/604800000)*604800000+345600000
  AND u2.registered_at < ((NEW.registered_at-345600000)/604800000)*604800000+950400000
 )
BEGIN
 SELECT RAISE(ABORT,'weekly_quota_exceeded');
END;
