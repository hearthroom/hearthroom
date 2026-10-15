-- 分享獎勵活動（開業活動設計 §3、§4.4）。錢不在這裡：點數池與入帳都在 Provider，
-- 這裡只存申請、審核、證據索引與發放紀錄（share_payouts.id 就是 Provider 的冪等鍵）。
CREATE TABLE campaigns (
 id TEXT PRIMARY KEY,
 slug TEXT NOT NULL UNIQUE CHECK (slug GLOB '[a-z0-9]*' AND slug NOT GLOB '*[^a-z0-9-]*' AND length(slug) BETWEEN 1 AND 40),
 title TEXT NOT NULL,                       -- Localized JSON，zh-Hant 必填
 intro TEXT NOT NULL DEFAULT '{}',          -- Localized JSON，markdown
 banner_key TEXT,                           -- AVATARS 的 blog/ 前綴（公開圖）
 starts_at INTEGER,
 ends_at INTEGER,
 timezone TEXT,                             -- IANA 名稱，只用來顯示
 submit_deadline INTEGER,                   -- 補件截止
 payout_deadline INTEGER,                   -- 發獎截止；截圖保留天數從這天起算
 tiers TEXT NOT NULL DEFAULT '{}',          -- {"light":n,"original":n,"guide":n,"video":n}
 extra_placement_amount INTEGER CHECK (extra_placement_amount IS NULL OR extra_placement_amount >= 0),
 flag_burst_threshold INTEGER CHECK (flag_burst_threshold IS NULL OR flag_burst_threshold >= 1),
 evidence_retention_days INTEGER NOT NULL DEFAULT 90 CHECK (evidence_retention_days BETWEEN 1 AND 3650),
 status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','ended')),
 version INTEGER NOT NULL DEFAULT 1,
 created_by TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);

CREATE TABLE share_contents (
 id TEXT PRIMARY KEY,
 campaign_id TEXT NOT NULL REFERENCES campaigns(id),
 member_id TEXT NOT NULL REFERENCES members(id),
 recipient_account_no INTEGER NOT NULL CHECK (recipient_account_no > 0), -- 建立時登入的 Harbor 公開帳號
 card_id INTEGER,
 title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
 share_code TEXT NOT NULL UNIQUE,           -- 歸因短碼（計畫 6 使用）
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX share_contents_member ON share_contents(member_id, created_at DESC);
CREATE INDEX share_contents_campaign ON share_contents(campaign_id, created_at DESC);

CREATE TABLE share_placements (
 id TEXT PRIMARY KEY,
 content_id TEXT NOT NULL REFERENCES share_contents(id),
 platform TEXT NOT NULL CHECK (platform IN ('qq_group','tieba','bahamut','moments','video','forum','other')),
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
CREATE INDEX share_placements_content ON share_placements(content_id, location_key);
CREATE INDEX share_placements_queue ON share_placements(review_status, created_at);

CREATE TABLE share_evidence (
 id TEXT PRIMARY KEY,
 member_id TEXT NOT NULL REFERENCES members(id),  -- 上傳者
 placement_id TEXT REFERENCES share_placements(id),
 r2_key TEXT NOT NULL UNIQUE,
 sha256 TEXT NOT NULL,
 bytes INTEGER NOT NULL CHECK (bytes > 0),
 created_at INTEGER NOT NULL,
 purged_at INTEGER
);
CREATE INDEX share_evidence_placement ON share_evidence(placement_id);
CREATE INDEX share_evidence_hash ON share_evidence(sha256);
CREATE INDEX share_evidence_unattached ON share_evidence(created_at) WHERE placement_id IS NULL;

CREATE TABLE share_payouts (
 id TEXT PRIMARY KEY,                       -- 同時是 Provider 的 key
 content_id TEXT NOT NULL REFERENCES share_contents(id),
 amount INTEGER NOT NULL CHECK (amount > 0),
 target_total INTEGER NOT NULL CHECK (target_total > 0),
 status TEXT NOT NULL DEFAULT 'pending'
   CHECK (status IN ('pending','paid','blocked_insufficient','failed','cancelled')),
 provider_entry_id TEXT,
 error TEXT,
 requested_by TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 1,
 checked_absent_at INTEGER,                 -- 對帳時 Provider 回查無此筆的時間
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 settled_at INTEGER
);
CREATE UNIQUE INDEX share_payouts_open ON share_payouts(content_id) WHERE status IN ('pending','blocked_insufficient');
CREATE INDEX share_payouts_status ON share_payouts(status, created_at);
CREATE INDEX share_payouts_content ON share_payouts(content_id, status);
