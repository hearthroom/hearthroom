-- Revision checks remain authoritative in D1; KV invalidation never relies on propagation.
ALTER TABLE members ADD COLUMN public_cache_revision TEXT NOT NULL DEFAULT '';
CREATE TABLE public_catalog_clock (id INTEGER PRIMARY KEY CHECK(id=1), revision TEXT NOT NULL);
INSERT INTO public_catalog_clock VALUES(1,lower(hex(randomblob(16))));
CREATE TRIGGER public_profile_revision AFTER UPDATE OF handle,display_name,avatar_url,bio ON members
WHEN OLD.handle IS NOT NEW.handle OR OLD.display_name IS NOT NEW.display_name OR OLD.avatar_url IS NOT NEW.avatar_url OR OLD.bio IS NOT NEW.bio BEGIN
 UPDATE members SET public_cache_revision=lower(hex(randomblob(16))) WHERE id=NEW.id;
END;
CREATE TRIGGER snapshot_community_preferences_insert AFTER INSERT ON community_preferences BEGIN
 UPDATE members SET public_cache_revision=lower(hex(randomblob(16))) WHERE id=NEW.member_id;
END;
CREATE TRIGGER snapshot_community_preferences_update AFTER UPDATE ON community_preferences BEGIN
 UPDATE members SET public_cache_revision=lower(hex(randomblob(16))) WHERE id=NEW.member_id;
 UPDATE members SET public_cache_revision=lower(hex(randomblob(16))) WHERE id=OLD.member_id AND OLD.member_id<>NEW.member_id;
END;
CREATE TRIGGER snapshot_community_preferences_delete AFTER DELETE ON community_preferences BEGIN
 UPDATE members SET public_cache_revision=lower(hex(randomblob(16))) WHERE id=OLD.member_id;
END;
CREATE TRIGGER snapshot_community_appearance_preferences_insert AFTER INSERT ON community_appearance_preferences BEGIN
 UPDATE members SET public_cache_revision=lower(hex(randomblob(16))) WHERE id=NEW.member_id;
END;
CREATE TRIGGER snapshot_community_appearance_preferences_update AFTER UPDATE ON community_appearance_preferences BEGIN
 UPDATE members SET public_cache_revision=lower(hex(randomblob(16))) WHERE id=NEW.member_id;
 UPDATE members SET public_cache_revision=lower(hex(randomblob(16))) WHERE id=OLD.member_id AND OLD.member_id<>NEW.member_id;
END;
CREATE TRIGGER snapshot_community_appearance_preferences_delete AFTER DELETE ON community_appearance_preferences BEGIN
 UPDATE members SET public_cache_revision=lower(hex(randomblob(16))) WHERE id=OLD.member_id;
END;
CREATE TRIGGER snapshot_community_discord_appearance_insert AFTER INSERT ON community_discord_appearance BEGIN
 UPDATE members SET public_cache_revision=lower(hex(randomblob(16))) WHERE id=NEW.member_id;
END;
CREATE TRIGGER snapshot_community_discord_appearance_update AFTER UPDATE ON community_discord_appearance BEGIN
 UPDATE members SET public_cache_revision=lower(hex(randomblob(16))) WHERE id=NEW.member_id;
 UPDATE members SET public_cache_revision=lower(hex(randomblob(16))) WHERE id=OLD.member_id AND OLD.member_id<>NEW.member_id;
END;
CREATE TRIGGER snapshot_community_discord_appearance_delete AFTER DELETE ON community_discord_appearance BEGIN
 UPDATE members SET public_cache_revision=lower(hex(randomblob(16))) WHERE id=OLD.member_id;
END;
CREATE TRIGGER snapshot_community_awards_insert AFTER INSERT ON community_awards BEGIN
 UPDATE members SET public_cache_revision=lower(hex(randomblob(16))) WHERE id=NEW.member_id;
END;
CREATE TRIGGER snapshot_community_awards_update AFTER UPDATE ON community_awards BEGIN
 UPDATE members SET public_cache_revision=lower(hex(randomblob(16))) WHERE id=NEW.member_id;
 UPDATE members SET public_cache_revision=lower(hex(randomblob(16))) WHERE id=OLD.member_id AND OLD.member_id<>NEW.member_id;
END;
CREATE TRIGGER snapshot_community_awards_delete AFTER DELETE ON community_awards BEGIN
 UPDATE members SET public_cache_revision=lower(hex(randomblob(16))) WHERE id=OLD.member_id;
END;
CREATE TRIGGER snapshot_discord_links_insert AFTER INSERT ON discord_links BEGIN
 UPDATE members SET public_cache_revision=lower(hex(randomblob(16))) WHERE id=NEW.member_id;
END;
CREATE TRIGGER snapshot_discord_links_update AFTER UPDATE ON discord_links BEGIN
 UPDATE members SET public_cache_revision=lower(hex(randomblob(16))) WHERE id=NEW.member_id;
 UPDATE members SET public_cache_revision=lower(hex(randomblob(16))) WHERE id=OLD.member_id AND OLD.member_id<>NEW.member_id;
END;
CREATE TRIGGER snapshot_discord_links_delete AFTER DELETE ON discord_links BEGIN
 UPDATE members SET public_cache_revision=lower(hex(randomblob(16))) WHERE id=OLD.member_id;
END;
CREATE TRIGGER snapshot_xp_insert AFTER INSERT ON community_xp BEGIN
 UPDATE members SET public_cache_revision=lower(hex(randomblob(16))) WHERE id IN (SELECT member_id FROM discord_links WHERE discord_id=NEW.discord_id);
END;
CREATE TRIGGER snapshot_catalog_insert AFTER INSERT ON community_badge_definitions BEGIN
 UPDATE public_catalog_clock SET revision=lower(hex(randomblob(16))) WHERE id=1;
END;
CREATE TRIGGER snapshot_xp_update AFTER UPDATE ON community_xp BEGIN
 UPDATE members SET public_cache_revision=lower(hex(randomblob(16))) WHERE id IN (SELECT member_id FROM discord_links WHERE discord_id=NEW.discord_id);
 UPDATE members SET public_cache_revision=lower(hex(randomblob(16))) WHERE id IN (SELECT member_id FROM discord_links WHERE discord_id=OLD.discord_id);
END;
CREATE TRIGGER snapshot_catalog_update AFTER UPDATE ON community_badge_definitions BEGIN
 UPDATE public_catalog_clock SET revision=lower(hex(randomblob(16))) WHERE id=1;
END;
CREATE TRIGGER snapshot_xp_delete AFTER DELETE ON community_xp BEGIN
 UPDATE members SET public_cache_revision=lower(hex(randomblob(16))) WHERE id IN (SELECT member_id FROM discord_links WHERE discord_id=OLD.discord_id);
END;
CREATE TRIGGER snapshot_catalog_delete AFTER DELETE ON community_badge_definitions BEGIN
 UPDATE public_catalog_clock SET revision=lower(hex(randomblob(16))) WHERE id=1;
END;
ALTER TABLE cards ADD COLUMN comment_revision TEXT NOT NULL DEFAULT '';
CREATE TRIGGER snapshot_comments_insert AFTER INSERT ON comments BEGIN
 UPDATE cards SET comment_revision=lower(hex(randomblob(16))) WHERE id=NEW.card_id;
END;
CREATE TRIGGER snapshot_comments_update AFTER UPDATE ON comments BEGIN
 UPDATE cards SET comment_revision=lower(hex(randomblob(16))) WHERE id=NEW.card_id;
END;
CREATE TRIGGER snapshot_comments_delete AFTER DELETE ON comments BEGIN
 UPDATE cards SET comment_revision=lower(hex(randomblob(16))) WHERE id=OLD.card_id;
END;
