-- Pending Discord delivery starts with recipients who enabled DMs. Do not scan
-- every undelivered bell notification for members without a live Discord link.
CREATE INDEX community_preferences_discord_dm
 ON community_preferences(member_id) WHERE discord_dm=1 AND notifications=1;
CREATE INDEX community_notifications_member_pending
 ON community_notifications(member_id,retry_at,created_at) WHERE delivered=0;

-- Cleanup already caps each run at 50 objects. Bound finding due objects and
-- checking live avatars as well; never remove an object still used by a profile.
CREATE INDEX avatar_cleanup_due ON avatar_cleanup(delete_after);
CREATE INDEX members_avatar_key ON members(avatar_key);
