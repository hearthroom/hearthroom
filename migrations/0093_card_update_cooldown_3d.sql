-- Runtime and UI use shared/card-update.ts (UPDATE_COOLDOWN_DAYS).
-- This durable admission guard mirrors that policy; the D1 boundary tests verify parity.
DROP TRIGGER card_update_reservation_guard;
CREATE TRIGGER card_update_reservation_guard BEFORE INSERT ON card_update_events
WHEN EXISTS(SELECT 1 FROM card_update_events WHERE work_id=NEW.work_id AND state='published' AND published_at+259200000>NEW.reserved_at)
BEGIN SELECT RAISE(ABORT,'update_notification_cooldown'); END;
