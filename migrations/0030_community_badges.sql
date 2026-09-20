-- Badge collection: retain existing award producers and earned timestamps.
ALTER TABLE community_awards ADD COLUMN revoked_at INTEGER;
ALTER TABLE community_awards ADD COLUMN expires_at INTEGER;
ALTER TABLE community_awards ADD COLUMN expiry_notified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE community_preferences ADD COLUMN featured_badges TEXT;
CREATE TABLE community_badge_definitions (
 key TEXT PRIMARY KEY, icon TEXT NOT NULL, category TEXT NOT NULL,
 titles TEXT NOT NULL, descriptions TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE community_badge_audit (
 request_id TEXT PRIMARY KEY, actor TEXT NOT NULL REFERENCES members(id),
 member_id TEXT NOT NULL REFERENCES members(id), badge TEXT NOT NULL REFERENCES community_badge_definitions(key),
 action TEXT NOT NULL CHECK(action IN ('grant','revoke')), reason TEXT NOT NULL,
 payload TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX community_badge_audit_time ON community_badge_audit(created_at DESC);
CREATE TRIGGER community_award_update AFTER UPDATE ON community_awards BEGIN
 UPDATE community_subjects SET revision=lower(hex(randomblob(16))),dirty=1,sync_state='pending'
 WHERE discord_id IN (SELECT discord_id FROM discord_links WHERE member_id=NEW.member_id AND state='active');
END;
CREATE TRIGGER community_award_delete AFTER DELETE ON community_awards BEGIN
 UPDATE community_subjects SET revision=lower(hex(randomblob(16))),dirty=1,sync_state='pending'
 WHERE discord_id IN (SELECT discord_id FROM discord_links WHERE member_id=OLD.member_id AND state='active');
END;
INSERT INTO community_badge_definitions VALUES
('discord_linked','discord','connection','{"zh-Hant":"Discord 已連結","zh-Hans":"已关联 Discord","en":"Discord connected","ja":"Discord 連携済み","ko":"Discord 연결됨"}','{"zh-Hant":"連結 Discord 帳號。","zh-Hans":"关联 Discord 账号。","en":"Connect your Discord account.","ja":"Discord アカウントを連携する。","ko":"Discord 계정을 연결하세요."}',0),
('first_work','award','creation','{"zh-Hant":"第一個過審作品","zh-Hans":"首个过审作品","en":"First approved work","ja":"初めての審査通過作品","ko":"첫 심사 통과 작품"}','{"zh-Hant":"首份作品通過社群審核。","zh-Hans":"首份作品通过社区审核。","en":"Have your first work approved by the community.","ja":"初めての作品がコミュニティ審査を通過する。","ko":"첫 작품이 커뮤니티 심사를 통과하면 획득해요."}',0),
('server_booster','flame','supporter','{"zh-Hant":"社群贊助者","zh-Hans":"社区赞助者","en":"Server supporter","ja":"サーバーサポーター","ko":"서버 후원자"}','{"zh-Hant":"連結 Discord，並持續加成社群伺服器。","zh-Hans":"关联 Discord，并持续助力社区服务器。","en":"Keep boosting the community server with your linked Discord account.","ja":"連携した Discord アカウントでコミュニティサーバーをブーストする。","ko":"연결한 Discord 계정으로 커뮤니티 서버를 부스트하세요."}',0),
('community_level_5','lantern','activity','{"zh-Hant":"社群 Lv.5","zh-Hans":"社区 Lv.5","en":"Community Lv.5","ja":"コミュニティ Lv.5","ko":"커뮤니티 Lv.5"}','{"zh-Hant":"Discord 社群等級達到 5 級。","zh-Hans":"Discord 社区等级达到 5 级。","en":"Reach community level 5 on Discord.","ja":"Discord のコミュニティレベル 5 に到達する。","ko":"Discord 커뮤니티 레벨 5에 도달하세요."}',0),
('community_level_10','star','activity','{"zh-Hant":"社群 Lv.10","zh-Hans":"社区 Lv.10","en":"Community Lv.10","ja":"コミュニティ Lv.10","ko":"커뮤니티 Lv.10"}','{"zh-Hant":"Discord 社群等級達到 10 級。","zh-Hans":"Discord 社区等级达到 10 级。","en":"Reach community level 10 on Discord.","ja":"Discord のコミュニティレベル 10 に到達する。","ko":"Discord 커뮤니티 레벨 10에 도달하세요."}',0),
('community_level_20','crown','activity','{"zh-Hant":"社群 Lv.20","zh-Hans":"社区 Lv.20","en":"Community Lv.20","ja":"コミュニティ Lv.20","ko":"커뮤니티 Lv.20"}','{"zh-Hant":"Discord 社群等級達到 20 級。","zh-Hans":"Discord 社区等级达到 20 级。","en":"Reach community level 20 on Discord.","ja":"Discord のコミュニティレベル 20 に到達する。","ko":"Discord 커뮤니티 레벨 20에 도달하세요."}',0);
CREATE TRIGGER community_badge_xp AFTER INSERT ON community_xp WHEN NEW.points>0 BEGIN
 INSERT OR IGNORE INTO community_awards(member_id,badge,source,created_at) SELECT member_id,'community_level_5','chat-v1',CAST(unixepoch('subsec')*1000 AS INTEGER) FROM discord_links WHERE discord_id=NEW.discord_id AND state='active' AND (SELECT COALESCE(SUM(points),0) FROM community_xp WHERE discord_id=NEW.discord_id)>=250;
 INSERT OR IGNORE INTO community_awards(member_id,badge,source,created_at) SELECT member_id,'community_level_10','chat-v1',CAST(unixepoch('subsec')*1000 AS INTEGER) FROM discord_links WHERE discord_id=NEW.discord_id AND state='active' AND (SELECT COALESCE(SUM(points),0) FROM community_xp WHERE discord_id=NEW.discord_id)>=1000;
 INSERT OR IGNORE INTO community_awards(member_id,badge,source,created_at) SELECT member_id,'community_level_20','chat-v1',CAST(unixepoch('subsec')*1000 AS INTEGER) FROM discord_links WHERE discord_id=NEW.discord_id AND state='active' AND (SELECT COALESCE(SUM(points),0) FROM community_xp WHERE discord_id=NEW.discord_id)>=4000;
END;
CREATE TRIGGER community_badge_link AFTER INSERT ON discord_links WHEN NEW.state='active' BEGIN
 INSERT OR IGNORE INTO community_awards(member_id,badge,source,created_at) SELECT member_id,'community_level_5','chat-v1',CAST(unixepoch('subsec')*1000 AS INTEGER) FROM discord_links WHERE discord_id=NEW.discord_id AND state='active' AND (SELECT COALESCE(SUM(points),0) FROM community_xp WHERE discord_id=NEW.discord_id)>=250;
 INSERT OR IGNORE INTO community_awards(member_id,badge,source,created_at) SELECT member_id,'community_level_10','chat-v1',CAST(unixepoch('subsec')*1000 AS INTEGER) FROM discord_links WHERE discord_id=NEW.discord_id AND state='active' AND (SELECT COALESCE(SUM(points),0) FROM community_xp WHERE discord_id=NEW.discord_id)>=1000;
 INSERT OR IGNORE INTO community_awards(member_id,badge,source,created_at) SELECT member_id,'community_level_20','chat-v1',CAST(unixepoch('subsec')*1000 AS INTEGER) FROM discord_links WHERE discord_id=NEW.discord_id AND state='active' AND (SELECT COALESCE(SUM(points),0) FROM community_xp WHERE discord_id=NEW.discord_id)>=4000;
END;
INSERT OR IGNORE INTO community_awards(member_id,badge,source,created_at) SELECT l.member_id,'community_level_5','chat-v1-backfill',CAST(unixepoch('subsec')*1000 AS INTEGER) FROM discord_links l JOIN community_xp x ON x.discord_id=l.discord_id WHERE l.state='active' GROUP BY l.member_id HAVING SUM(x.points)>=250;
INSERT OR IGNORE INTO community_awards(member_id,badge,source,created_at) SELECT l.member_id,'community_level_10','chat-v1-backfill',CAST(unixepoch('subsec')*1000 AS INTEGER) FROM discord_links l JOIN community_xp x ON x.discord_id=l.discord_id WHERE l.state='active' GROUP BY l.member_id HAVING SUM(x.points)>=1000;
INSERT OR IGNORE INTO community_awards(member_id,badge,source,created_at) SELECT l.member_id,'community_level_20','chat-v1-backfill',CAST(unixepoch('subsec')*1000 AS INTEGER) FROM discord_links l JOIN community_xp x ON x.discord_id=l.discord_id WHERE l.state='active' GROUP BY l.member_id HAVING SUM(x.points)>=4000;
