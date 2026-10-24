ALTER TABLE members ADD COLUMN account_class TEXT NOT NULL DEFAULT 'normal' CHECK(account_class IN ('normal','test'));
ALTER TABLE members ADD COLUMN test_generation INTEGER NOT NULL DEFAULT 0;
CREATE TABLE qa_browser_nonce(nonce_hash TEXT PRIMARY KEY,expires_at INTEGER NOT NULL);
CREATE TABLE qa_browser_receipt(result TEXT PRIMARY KEY CHECK(result IN ('exchanged','rejected')),n INTEGER NOT NULL DEFAULT 0);

CREATE TRIGGER qa_member_follows_insert BEFORE INSERT ON member_follows
 WHEN EXISTS(SELECT 1 FROM members WHERE account_class='test' AND id IN (NEW.member_id,NEW.author_id))
 BEGIN SELECT RAISE(ABORT,'test_account_operation_not_allowed'); END;

CREATE TRIGGER qa_member_follows_update BEFORE UPDATE ON member_follows
 WHEN EXISTS(SELECT 1 FROM members WHERE account_class='test' AND id IN (NEW.member_id,NEW.author_id))
 BEGIN SELECT RAISE(ABORT,'test_account_operation_not_allowed'); END;

CREATE TRIGGER qa_member_favorites_insert BEFORE INSERT ON member_favorites
 WHEN EXISTS(SELECT 1 FROM members WHERE account_class='test' AND id IN (NEW.member_id))
 BEGIN SELECT RAISE(ABORT,'test_account_operation_not_allowed'); END;

CREATE TRIGGER qa_member_favorites_update BEFORE UPDATE ON member_favorites
 WHEN EXISTS(SELECT 1 FROM members WHERE account_class='test' AND id IN (NEW.member_id))
 BEGIN SELECT RAISE(ABORT,'test_account_operation_not_allowed'); END;

CREATE TRIGGER qa_comments_insert BEFORE INSERT ON comments
 WHEN EXISTS(SELECT 1 FROM members WHERE account_class='test' AND id IN (NEW.member_id))
 BEGIN SELECT RAISE(ABORT,'test_account_operation_not_allowed'); END;

CREATE TRIGGER qa_comments_update BEFORE UPDATE ON comments
 WHEN EXISTS(SELECT 1 FROM members WHERE account_class='test' AND id IN (NEW.member_id))
 BEGIN SELECT RAISE(ABORT,'test_account_operation_not_allowed'); END;

CREATE TRIGGER qa_comment_likes_insert BEFORE INSERT ON comment_likes
 WHEN EXISTS(SELECT 1 FROM members WHERE account_class='test' AND id IN (NEW.member_id))
 BEGIN SELECT RAISE(ABORT,'test_account_operation_not_allowed'); END;

CREATE TRIGGER qa_comment_likes_update BEFORE UPDATE ON comment_likes
 WHEN EXISTS(SELECT 1 FROM members WHERE account_class='test' AND id IN (NEW.member_id))
 BEGIN SELECT RAISE(ABORT,'test_account_operation_not_allowed'); END;

CREATE TRIGGER qa_discord_links_insert BEFORE INSERT ON discord_links
 WHEN EXISTS(SELECT 1 FROM members WHERE account_class='test' AND id IN (NEW.member_id))
 BEGIN SELECT RAISE(ABORT,'test_account_operation_not_allowed'); END;

CREATE TRIGGER qa_discord_links_update BEFORE UPDATE ON discord_links
 WHEN EXISTS(SELECT 1 FROM members WHERE account_class='test' AND id IN (NEW.member_id))
 BEGIN SELECT RAISE(ABORT,'test_account_operation_not_allowed'); END;

CREATE TRIGGER qa_discord_link_attempts_insert BEFORE INSERT ON discord_link_attempts
 WHEN EXISTS(SELECT 1 FROM members WHERE account_class='test' AND id IN (NEW.member_id))
 BEGIN SELECT RAISE(ABORT,'test_account_operation_not_allowed'); END;

CREATE TRIGGER qa_discord_link_attempts_update BEFORE UPDATE ON discord_link_attempts
 WHEN EXISTS(SELECT 1 FROM members WHERE account_class='test' AND id IN (NEW.member_id))
 BEGIN SELECT RAISE(ABORT,'test_account_operation_not_allowed'); END;

CREATE TRIGGER qa_push_subscriptions_insert BEFORE INSERT ON push_subscriptions
 WHEN EXISTS(SELECT 1 FROM members WHERE account_class='test' AND id IN (NEW.member_id))
 BEGIN SELECT RAISE(ABORT,'test_account_operation_not_allowed'); END;

CREATE TRIGGER qa_push_subscriptions_update BEFORE UPDATE ON push_subscriptions
 WHEN EXISTS(SELECT 1 FROM members WHERE account_class='test' AND id IN (NEW.member_id))
 BEGIN SELECT RAISE(ABORT,'test_account_operation_not_allowed'); END;

CREATE TRIGGER qa_analytics_milestones_insert BEFORE INSERT ON analytics_milestones
 WHEN EXISTS(SELECT 1 FROM members WHERE account_class='test' AND id IN (NEW.member_id))
 BEGIN SELECT RAISE(ABORT,'test_account_operation_not_allowed'); END;

CREATE TRIGGER qa_analytics_milestones_update BEFORE UPDATE ON analytics_milestones
 WHEN EXISTS(SELECT 1 FROM members WHERE account_class='test' AND id IN (NEW.member_id))
 BEGIN SELECT RAISE(ABORT,'test_account_operation_not_allowed'); END;

CREATE TRIGGER qa_notification_insert BEFORE INSERT ON community_notifications
 WHEN EXISTS(SELECT 1 FROM members WHERE account_class='test' AND id IN(NEW.member_id,NEW.actor_id,NEW.author_id))
 OR EXISTS(SELECT 1 FROM community_card_owners o JOIN members m ON m.id=o.member_id WHERE o.card_id=NEW.card_id AND m.account_class='test')
 BEGIN SELECT RAISE(IGNORE); END;

CREATE TRIGGER qa_notification_update BEFORE UPDATE ON community_notifications
 WHEN EXISTS(SELECT 1 FROM members WHERE account_class='test' AND id IN(NEW.member_id,NEW.actor_id,NEW.author_id))
 OR EXISTS(SELECT 1 FROM community_card_owners o JOIN members m ON m.id=o.member_id WHERE o.card_id=NEW.card_id AND m.account_class='test')
 BEGIN SELECT RAISE(IGNORE); END;

CREATE TRIGGER qa_award_insert BEFORE INSERT ON community_awards WHEN EXISTS(SELECT 1 FROM members WHERE id=NEW.member_id AND account_class='test') BEGIN SELECT RAISE(IGNORE); END;

CREATE TRIGGER qa_card_scores_insert BEFORE INSERT ON card_scores WHEN EXISTS(SELECT 1 FROM members WHERE id=NEW.member_id AND account_class='test') OR EXISTS(SELECT 1 FROM community_card_owners o JOIN members m ON m.id=o.member_id WHERE o.card_id=NEW.card_id AND m.account_class='test') BEGIN SELECT RAISE(ABORT,'test_account_operation_not_allowed'); END;

CREATE TRIGGER qa_card_scores_update BEFORE UPDATE ON card_scores WHEN EXISTS(SELECT 1 FROM members WHERE id=NEW.member_id AND account_class='test') OR EXISTS(SELECT 1 FROM community_card_owners o JOIN members m ON m.id=o.member_id WHERE o.card_id=NEW.card_id AND m.account_class='test') BEGIN SELECT RAISE(ABORT,'test_account_operation_not_allowed'); END;

CREATE TRIGGER qa_class_immutable BEFORE UPDATE OF account_class ON members WHEN OLD.account_class='test' AND NEW.account_class<>'test' BEGIN SELECT RAISE(ABORT,'test classification is immutable'); END;

ALTER TABLE members ADD COLUMN test_state TEXT NOT NULL DEFAULT 'active' CHECK(test_state IN('active','paused','retired'));
ALTER TABLE members ADD COLUMN qa_newcomer_stage INTEGER NOT NULL DEFAULT 0 CHECK(qa_newcomer_stage BETWEEN 0 AND 6);
CREATE TABLE qa_account_operation(request_id TEXT PRIMARY KEY,input_hash TEXT NOT NULL,result TEXT NOT NULL,created_at INTEGER NOT NULL);

CREATE TABLE qa_session_generation(token_hash TEXT PRIMARY KEY,test_generation INTEGER NOT NULL CHECK(test_generation>0));
CREATE TRIGGER qa_session_insert BEFORE INSERT ON account_sessions
 WHEN EXISTS(SELECT 1 FROM members m WHERE m.id=NEW.member_id AND m.account_class='test' AND
 (m.test_state<>'active' OR NOT EXISTS(SELECT 1 FROM qa_session_generation q WHERE q.token_hash=NEW.token_hash AND q.test_generation=m.test_generation)))
 BEGIN SELECT RAISE(ABORT,'test_session_generation_required'); END;
CREATE TRIGGER qa_session_delete AFTER DELETE ON account_sessions BEGIN DELETE FROM qa_session_generation WHERE token_hash=OLD.token_hash; END;

CREATE TABLE legacy_account_fence(public_no INTEGER PRIMARY KEY CHECK(public_no=279),member_id TEXT,handle TEXT,request_id TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TRIGGER legacy_session_fence BEFORE INSERT ON account_sessions
 WHEN (NEW.provider='harbor' AND NEW.external_id='279' AND EXISTS(SELECT 1 FROM legacy_account_fence WHERE public_no=279))
 OR EXISTS(SELECT 1 FROM legacy_account_fence WHERE member_id=NEW.member_id)
 BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

CREATE TRIGGER legacy_card_saves_insert BEFORE INSERT ON card_saves WHEN EXISTS(SELECT 1 FROM legacy_account_fence WHERE member_id=NEW.member_id) BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

CREATE TRIGGER legacy_card_saves_update BEFORE UPDATE ON card_saves WHEN EXISTS(SELECT 1 FROM legacy_account_fence WHERE member_id=NEW.member_id) BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

CREATE TRIGGER legacy_member_conversations_insert BEFORE INSERT ON member_conversations WHEN EXISTS(SELECT 1 FROM legacy_account_fence WHERE member_id=NEW.member_id) BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

CREATE TRIGGER legacy_member_conversations_update BEFORE UPDATE ON member_conversations WHEN EXISTS(SELECT 1 FROM legacy_account_fence WHERE member_id=NEW.member_id) BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

CREATE TRIGGER legacy_rating_drafts_insert BEFORE INSERT ON rating_drafts WHEN EXISTS(SELECT 1 FROM legacy_account_fence WHERE member_id=NEW.member_id) BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

CREATE TRIGGER legacy_rating_drafts_update BEFORE UPDATE ON rating_drafts WHEN EXISTS(SELECT 1 FROM legacy_account_fence WHERE member_id=NEW.member_id) BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

CREATE TRIGGER legacy_checkin_prompts_insert BEFORE INSERT ON checkin_prompts WHEN EXISTS(SELECT 1 FROM legacy_account_fence WHERE member_id=NEW.member_id) BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

CREATE TRIGGER legacy_checkin_prompts_update BEFORE UPDATE ON checkin_prompts WHEN EXISTS(SELECT 1 FROM legacy_account_fence WHERE member_id=NEW.member_id) BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

CREATE TRIGGER legacy_member_update_state_insert BEFORE INSERT ON member_update_state WHEN EXISTS(SELECT 1 FROM legacy_account_fence WHERE member_id=NEW.member_id) BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

CREATE TRIGGER legacy_member_update_state_update BEFORE UPDATE ON member_update_state WHEN EXISTS(SELECT 1 FROM legacy_account_fence WHERE member_id=NEW.member_id) BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

CREATE TRIGGER legacy_suki_states_insert BEFORE INSERT ON suki_states WHEN EXISTS(SELECT 1 FROM legacy_account_fence WHERE member_id=NEW.member_id) BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

CREATE TRIGGER legacy_suki_states_update BEFORE UPDATE ON suki_states WHEN EXISTS(SELECT 1 FROM legacy_account_fence WHERE member_id=NEW.member_id) BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

CREATE TRIGGER legacy_analytics_milestones_insert BEFORE INSERT ON analytics_milestones WHEN EXISTS(SELECT 1 FROM legacy_account_fence WHERE member_id=NEW.member_id) BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

CREATE TRIGGER legacy_analytics_milestones_update BEFORE UPDATE ON analytics_milestones WHEN EXISTS(SELECT 1 FROM legacy_account_fence WHERE member_id=NEW.member_id) BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

CREATE TRIGGER legacy_community_preferences_insert BEFORE INSERT ON community_preferences WHEN EXISTS(SELECT 1 FROM legacy_account_fence WHERE member_id=NEW.member_id) BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

CREATE TRIGGER legacy_community_preferences_update BEFORE UPDATE ON community_preferences WHEN EXISTS(SELECT 1 FROM legacy_account_fence WHERE member_id=NEW.member_id) BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

CREATE TRIGGER legacy_community_appearance_preferences_insert BEFORE INSERT ON community_appearance_preferences WHEN EXISTS(SELECT 1 FROM legacy_account_fence WHERE member_id=NEW.member_id) BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

CREATE TRIGGER legacy_community_appearance_preferences_update BEFORE UPDATE ON community_appearance_preferences WHEN EXISTS(SELECT 1 FROM legacy_account_fence WHERE member_id=NEW.member_id) BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

CREATE TRIGGER legacy_community_discord_appearance_insert BEFORE INSERT ON community_discord_appearance WHEN EXISTS(SELECT 1 FROM legacy_account_fence WHERE member_id=NEW.member_id) BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

CREATE TRIGGER legacy_community_discord_appearance_update BEFORE UPDATE ON community_discord_appearance WHEN EXISTS(SELECT 1 FROM legacy_account_fence WHERE member_id=NEW.member_id) BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

CREATE TRIGGER legacy_community_appearance_media_insert BEFORE INSERT ON community_appearance_media WHEN EXISTS(SELECT 1 FROM legacy_account_fence WHERE member_id=NEW.member_id) BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

CREATE TRIGGER legacy_community_appearance_media_update BEFORE UPDATE ON community_appearance_media WHEN EXISTS(SELECT 1 FROM legacy_account_fence WHERE member_id=NEW.member_id) BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

CREATE TRIGGER legacy_community_case_jobs_insert BEFORE INSERT ON community_case_jobs WHEN EXISTS(SELECT 1 FROM legacy_account_fence WHERE member_id=NEW.member_id) BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

CREATE TRIGGER legacy_community_case_jobs_update BEFORE UPDATE ON community_case_jobs WHEN EXISTS(SELECT 1 FROM legacy_account_fence WHERE member_id=NEW.member_id) BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

CREATE TRIGGER legacy_discord_link_attempts_insert BEFORE INSERT ON discord_link_attempts WHEN EXISTS(SELECT 1 FROM legacy_account_fence WHERE member_id=NEW.member_id) BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

CREATE TRIGGER legacy_discord_link_attempts_update BEFORE UPDATE ON discord_link_attempts WHEN EXISTS(SELECT 1 FROM legacy_account_fence WHERE member_id=NEW.member_id) BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

CREATE TRIGGER legacy_community_awards_insert BEFORE INSERT ON community_awards WHEN EXISTS(SELECT 1 FROM legacy_account_fence WHERE member_id=NEW.member_id) BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

CREATE TRIGGER legacy_community_awards_update BEFORE UPDATE ON community_awards WHEN EXISTS(SELECT 1 FROM legacy_account_fence WHERE member_id=NEW.member_id) BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

CREATE TRIGGER legacy_push_subscriptions_insert BEFORE INSERT ON push_subscriptions WHEN EXISTS(SELECT 1 FROM legacy_account_fence WHERE member_id=NEW.member_id) BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

CREATE TRIGGER legacy_push_subscriptions_update BEFORE UPDATE ON push_subscriptions WHEN EXISTS(SELECT 1 FROM legacy_account_fence WHERE member_id=NEW.member_id) BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

CREATE TRIGGER legacy_community_notifications_insert BEFORE INSERT ON community_notifications WHEN EXISTS(SELECT 1 FROM legacy_account_fence WHERE member_id=NEW.member_id) BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

CREATE TRIGGER legacy_community_notifications_update BEFORE UPDATE ON community_notifications WHEN EXISTS(SELECT 1 FROM legacy_account_fence WHERE member_id=NEW.member_id) BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

CREATE TRIGGER legacy_member_favorites_insert BEFORE INSERT ON member_favorites WHEN EXISTS(SELECT 1 FROM legacy_account_fence WHERE member_id=NEW.member_id) BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

CREATE TRIGGER legacy_member_favorites_update BEFORE UPDATE ON member_favorites WHEN EXISTS(SELECT 1 FROM legacy_account_fence WHERE member_id=NEW.member_id) BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

CREATE TRIGGER legacy_member_follows_insert BEFORE INSERT ON member_follows WHEN EXISTS(SELECT 1 FROM legacy_account_fence WHERE member_id=NEW.member_id) BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

CREATE TRIGGER legacy_member_follows_update BEFORE UPDATE ON member_follows WHEN EXISTS(SELECT 1 FROM legacy_account_fence WHERE member_id=NEW.member_id) BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

CREATE TRIGGER legacy_card_scores_insert BEFORE INSERT ON card_scores WHEN EXISTS(SELECT 1 FROM legacy_account_fence WHERE member_id=NEW.member_id) BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

CREATE TRIGGER legacy_card_scores_update BEFORE UPDATE ON card_scores WHEN EXISTS(SELECT 1 FROM legacy_account_fence WHERE member_id=NEW.member_id) BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

CREATE TRIGGER legacy_account_credentials_insert BEFORE INSERT ON account_credentials WHEN NEW.provider='harbor' AND NEW.external_id='279' AND EXISTS(SELECT 1 FROM legacy_account_fence WHERE public_no=279) BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

CREATE TRIGGER legacy_account_credentials_update BEFORE UPDATE ON account_credentials WHEN NEW.provider='harbor' AND NEW.external_id='279' AND EXISTS(SELECT 1 FROM legacy_account_fence WHERE public_no=279) BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

CREATE TRIGGER legacy_member_identities_insert BEFORE INSERT ON member_identities WHEN NEW.provider='harbor' AND NEW.external_id='279' AND EXISTS(SELECT 1 FROM legacy_account_fence WHERE public_no=279) BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

CREATE TRIGGER legacy_member_identities_update BEFORE UPDATE ON member_identities WHEN NEW.provider='harbor' AND NEW.external_id='279' AND EXISTS(SELECT 1 FROM legacy_account_fence WHERE public_no=279) BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

CREATE TRIGGER legacy_member_connections_insert BEFORE INSERT ON member_connections WHEN NEW.provider='harbor' AND NEW.external_id='279' AND EXISTS(SELECT 1 FROM legacy_account_fence WHERE public_no=279) BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

CREATE TRIGGER legacy_member_connections_update BEFORE UPDATE ON member_connections WHEN NEW.provider='harbor' AND NEW.external_id='279' AND EXISTS(SELECT 1 FROM legacy_account_fence WHERE public_no=279) BEGIN SELECT RAISE(ABORT,'legacy_account_retired'); END;

-- An exclusion hint grants no access and survives revocation until the QA window ends.
CREATE TABLE qa_session_exclusion(token_hash TEXT PRIMARY KEY,expires_at INTEGER NOT NULL);
CREATE TRIGGER qa_session_exclusion_insert AFTER INSERT ON account_sessions
 WHEN EXISTS(SELECT 1 FROM members m WHERE m.id=NEW.member_id AND m.account_class='test')
 BEGIN INSERT OR REPLACE INTO qa_session_exclusion VALUES(NEW.token_hash,min(NEW.expires_at,NEW.created_at+28800000)); END;
