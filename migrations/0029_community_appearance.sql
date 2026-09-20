-- Cosmetic preferences survive a confirmed entitlement loss; active links gate all Discord assets.
CREATE TABLE community_appearance_preferences (
 member_id TEXT PRIMARY KEY REFERENCES members(id),
 avatar_source TEXT NOT NULL DEFAULT 'site', name_style TEXT NOT NULL DEFAULT 'none',
 frame TEXT NOT NULL DEFAULT 'none', public_enabled INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE community_discord_appearance (
 member_id TEXT PRIMARY KEY REFERENCES members(id), link_version TEXT NOT NULL,
 sync_token TEXT NOT NULL, observed_at INTEGER NOT NULL, verified_at INTEGER NOT NULL, boosting_since INTEGER,
 assets TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE community_appearance_media (
 key TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id),
 link_version TEXT NOT NULL, kind TEXT NOT NULL, source_url TEXT NOT NULL,
 UNIQUE(member_id,kind)
);
CREATE TRIGGER community_appearance_unlink AFTER UPDATE OF state ON discord_links WHEN NEW.state<>'active' BEGIN
 DELETE FROM community_discord_appearance WHERE member_id=NEW.member_id;
 DELETE FROM community_appearance_media WHERE member_id=NEW.member_id;
END;
CREATE TRIGGER community_appearance_delete AFTER DELETE ON discord_links BEGIN
 DELETE FROM community_discord_appearance WHERE member_id=OLD.member_id;
 DELETE FROM community_appearance_media WHERE member_id=OLD.member_id;
END;
