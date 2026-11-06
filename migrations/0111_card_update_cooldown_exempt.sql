-- Internal, support-managed exception. It follows the stable work across versions.
CREATE TABLE card_update_cooldown_exempt (
 work_id TEXT PRIMARY KEY REFERENCES works(id) ON DELETE CASCADE,
 added_at INTEGER NOT NULL,
 reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 200)
);

-- Exemption skips only the interval, preserving reservation uniqueness and
-- publication/notification guards from 0092. Mirror runtime admission below.
DROP TRIGGER card_update_reservation_guard;
CREATE TRIGGER card_update_reservation_guard BEFORE INSERT ON card_update_events
WHEN NOT EXISTS(SELECT 1 FROM card_update_cooldown_exempt WHERE work_id=NEW.work_id)
 AND EXISTS(SELECT 1 FROM card_update_events WHERE work_id=NEW.work_id AND state='published' AND published_at+259200000>NEW.reserved_at)
BEGIN SELECT RAISE(ABORT,'update_notification_cooldown'); END;
