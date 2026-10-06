-- 審核訊息只在卡片「真的變了」時重發。
--
-- `AFTER UPDATE OF status,public_blocked,names` 的意思是「SET 裡有這幾欄」，不是「值變了」。每小時的
-- 同步（syncStatement）一律把 names 寫回去，於是每張卡的每一則審核訊息每小時都被推一次 revision，
-- bot 跟著重新編輯 Discord 訊息：2026-10 實測已結案的審核單 revision 到 188–315，一天上千次編輯，
-- 真正有進度的審核通知得跟它們搶 Discord 的速率限制。
--
-- 比較用 IS NOT：任一邊是 NULL 也算得出「有沒有變」。
DROP TRIGGER review_delivery_card;

CREATE TRIGGER review_delivery_card AFTER UPDATE OF status,public_blocked,names ON cards
WHEN NEW.status IS NOT OLD.status OR NEW.public_blocked IS NOT OLD.public_blocked OR NEW.names IS NOT OLD.names
BEGIN
 UPDATE review_deliveries SET revision=revision+1,due_at=0,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER) WHERE submission_id IN(SELECT id FROM review_submissions WHERE card_id=NEW.id);
END;
