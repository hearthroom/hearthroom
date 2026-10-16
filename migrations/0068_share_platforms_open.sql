-- 分享平台改由程式維護（src/campaign.ts PLATFORMS），資料庫只擋長度。
--
-- 開幕活動上線前 owner（2026-10-16）要求依語言給不同的平台：繁中是巴哈姆特、Discord、Dcard、PTT 這類，
-- 簡中是 QQ 群、貼吧、小紅書、抖音這類。0063 把平台寫死成 CHECK 清單，每加一個平台就要重建整張表；
-- 拿掉之後加平台只改程式。寫入時 campaign-apply 仍只收 PLATFORMS 裡的值。
--
-- SQLite 改不了既有欄位的 CHECK，只能重建表。share_evidence.placement_id 參照這張表，
-- 所以先延後外鍵檢查到交易結束；兩個索引會跟著舊表消失，原樣補回。這張表上沒有 trigger。
PRAGMA defer_foreign_keys = on;

CREATE TABLE share_placements_v2 (
 id TEXT PRIMARY KEY,
 content_id TEXT NOT NULL REFERENCES share_contents(id),
 platform TEXT NOT NULL CHECK (length(platform) BETWEEN 1 AND 40),
 location TEXT NOT NULL CHECK (length(location) BETWEEN 1 AND 200),
 location_key TEXT NOT NULL,
 published_at INTEGER NOT NULL,
 url TEXT CHECK (url IS NULL OR length(url) <= 2000),
 note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
 requested_tier TEXT NOT NULL CHECK (requested_tier IN ('light','original','guide','video')),
 approved_tier TEXT CHECK (approved_tier IS NULL OR approved_tier IN ('light','original','guide','video')),
 review_status TEXT NOT NULL DEFAULT 'submitted'
   CHECK (review_status IN ('submitted','needs_info','resubmitted','approved','rejected')),
 review_reason TEXT,
 reviewed_by TEXT,
 reviewed_kind TEXT CHECK (reviewed_kind IS NULL OR reviewed_kind IN ('human','ai')),
 reviewed_at INTEGER,
 counts_as_placement INTEGER NOT NULL DEFAULT 1 CHECK (counts_as_placement IN (0,1)),
 version INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 CHECK ((review_status = 'approved') = (approved_tier IS NOT NULL))
);
INSERT INTO share_placements_v2 SELECT * FROM share_placements;
DROP TABLE share_placements;
ALTER TABLE share_placements_v2 RENAME TO share_placements;
CREATE INDEX share_placements_content ON share_placements(content_id, location_key);
CREATE INDEX share_placements_queue ON share_placements(review_status, created_at);
