-- 審卡系統 V2 第一批（2026-11-23，任務 2026-11-23-review-system-v2）：
-- 不受理、結構化駁回理由、審核事件與送審特徵、作者標記覆寫。
-- 只加表與欄位、不回填：舊單的理由代碼、特徵、指紋一律是 NULL＝不知道，統計顯示「量不到」。

-- 駁回理由代碼（JSON 陣列，例如 ["opening.no_reply_hook","other"]）與理由表版本。
-- 跟 status='rejected' 同一句 UPDATE 寫入，作者通知的 trigger 才讀得到。舊單是 NULL。
ALTER TABLE review_submissions ADD COLUMN reject_reasons TEXT;
ALTER TABLE review_submissions ADD COLUMN reason_version INTEGER;
-- 駁回時用了新人輔導版本（作者結果頁附完整改法與範例）
ALTER TABLE review_submissions ADD COLUMN reject_coaching INTEGER NOT NULL DEFAULT 0;
-- 內容指紋（fp1:<sha256>）：送審當下封存版的文字內容＋作者草稿的媒體參照＋分級答案＋原作。
-- 只用來判斷「不受理後原樣重送」；算不出來是 NULL，交人工（一律回待審）。
ALTER TABLE review_submissions ADD COLUMN content_fingerprint TEXT;

-- 送審特徵：送審當下固定的事實，給審核統計與作者側寫。分析只讀白名單純量，不存任何內容原文。
CREATE TABLE review_submission_features (
  submission_id     TEXT    NOT NULL PRIMARY KEY,
  spec_version      INTEGER NOT NULL,
  author_member_id  TEXT,
  -- 這位作者第幾張成功建立的單（含之後撤回、被取代的；V2 起算，見 da.md）
  author_seq        INTEGER,
  -- 同一張卡之前有沒有作者送審、上一張定案的結果、送審當下有沒有過審版本可比
  has_prior         INTEGER NOT NULL DEFAULT 0,
  prior_result      TEXT,
  has_approved_base INTEGER NOT NULL DEFAULT 0,
  -- 不受理後改版重送（內容與不受理時不同）
  after_drop        INTEGER NOT NULL DEFAULT 0,
  -- 各欄有效字數、世界書條目與規則數、是否有原作、是否有字數豁免（JSON，只有數字與布林）
  features          TEXT    NOT NULL DEFAULT '{}',
  -- 同送審版、同領取期間最近一次成功的設定相似度（審核頁開查重時記；沒開過是 NULL）
  originality         REAL,
  originality_version TEXT,
  originality_at      INTEGER,
  created_at        INTEGER NOT NULL
);
CREATE INDEX idx_review_features_author ON review_submission_features (author_member_id, created_at);

-- 這張單送審時的安裝雜湊（同 card_registrations.device_hash 的 v1:HMAC）。作業用：只在待審期間留著，
-- 單子一離開待審（定案、撤回、被取代、刪除）就由下面的 trigger 刪掉。事件表與統計只存計數，不存雜湊。
CREATE TABLE review_submission_devices (
  submission_id TEXT    NOT NULL PRIMARY KEY,
  device_hash   TEXT    NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_review_submission_devices_hash ON review_submission_devices (device_hash);

-- 不受理案件：一段連續的不受理期間。作者撤回後原樣重送沿用同一個案件與起始時間；
-- 改版重送、人工復原結束案件。案件掛在卡號與作者上（卡號在撤銷再登記時不變），不掛在單上：
-- 舊流程撤銷登記會刪掉待審單，案件要留下來。
CREATE TABLE review_drop_cases (
  id               TEXT    NOT NULL PRIMARY KEY,
  card_id          INTEGER NOT NULL,
  author_member_id TEXT,
  -- 不受理當下那一版的內容指紋；NULL＝算不出來（原樣重送也不會自動移出）
  fingerprint      TEXT,
  source           TEXT    NOT NULL CHECK (source IN ('single','author_batch','device_batch')),
  opened_by        TEXT    NOT NULL,
  opened_at        INTEGER NOT NULL,
  closed_at        INTEGER,
  close_reason     TEXT CHECK (close_reason IN ('restored','resubmitted_changed','decided'))
);
CREATE INDEX idx_review_drop_cases_card ON review_drop_cases (card_id, closed_at);
CREATE INDEX idx_review_drop_cases_author ON review_drop_cases (author_member_id, closed_at);

-- 某張單在不受理中：restored_at 是 NULL 就還在不受理清單。
CREATE TABLE review_drops (
  id            TEXT    NOT NULL PRIMARY KEY,
  submission_id TEXT    NOT NULL,
  case_id       TEXT    NOT NULL,
  source        TEXT    NOT NULL CHECK (source IN ('single','author_batch','device_batch','auto_same_content')),
  actor_member_id TEXT,
  batch_id      TEXT,
  created_at    INTEGER NOT NULL,
  restored_at   INTEGER,
  restored_by   TEXT
);
CREATE UNIQUE INDEX idx_review_drops_active ON review_drops (submission_id) WHERE restored_at IS NULL;
CREATE INDEX idx_review_drops_case ON review_drops (case_id);

-- 不受理中的單誰都不能蓋章（程式先擋；這裡是最後一道，跟冷凍同一種做法）
CREATE TRIGGER review_stamp_drop_guard BEFORE INSERT ON review_stamps
 WHEN EXISTS (SELECT 1 FROM review_drops d WHERE d.submission_id=NEW.submission_id AND d.restored_at IS NULL)
 BEGIN SELECT RAISE(ABORT,'review_dropped'); END;

-- 審核事件：每次人工作業與流程轉態一筆。event_key 綁送審單與那一次已提交操作，重試不多記。
-- reasons 只存代碼；不存備註、內容原文、審核員以外的帳號、裝置。
CREATE TABLE review_events (
  id                INTEGER PRIMARY KEY,
  event_key         TEXT    NOT NULL UNIQUE,
  spec_version      INTEGER NOT NULL,
  submission_id     TEXT,
  card_id           INTEGER,
  at                INTEGER NOT NULL,
  action            TEXT    NOT NULL,
  from_state        TEXT,
  to_state          TEXT,
  actor_kind        TEXT    NOT NULL CHECK (actor_kind IN ('author','reviewer','system')),
  actor_member_id   TEXT,
  source            TEXT,
  batch_id          TEXT,
  reasons           TEXT,
  reason_version    INTEGER,
  coaching          INTEGER,
  -- 同一次有效領取到提交的伺服器時間差（領取後經過時間）；沒領取、批量、自動是 NULL
  claim_elapsed_ms  INTEGER,
  -- 作業當下整個可處理佇列裡「其他」待審卡：同作者幾張、同安裝幾張、安裝關聯是否已知
  queue_same_author INTEGER,
  queue_same_device INTEGER,
  device_known      INTEGER,
  -- 同送審版最近一次成功的設定相似度（0–1）與演算法版本
  originality       REAL,
  originality_version TEXT
);
CREATE INDEX idx_review_events_submission ON review_events (submission_id, at);
CREATE INDEX idx_review_events_action_time ON review_events (action, at);

-- 流程轉態由 trigger 記，任何路徑（作者改卡、撤回、託管同步、改判）都不必各自記一次。
-- 首次生效定案：狀態確實變成 approved／rejected 的那一刻，每單只一筆；託管作品同步完成時才算生效。
CREATE TRIGGER review_event_first_decision AFTER UPDATE OF status ON review_submissions
 WHEN OLD.status='pending' AND NEW.status IN ('approved','rejected') AND NEW.reopen_of IS NULL BEGIN
 INSERT OR IGNORE INTO review_events(event_key,spec_version,submission_id,card_id,at,action,from_state,to_state,actor_kind,reasons,reason_version,coaching)
 VALUES('first:'||NEW.id,1,NEW.id,NEW.card_id,COALESCE(NEW.decided_at,CAST(unixepoch('subsec')*1000 AS INTEGER)),'first_decision','pending',NEW.status,'system',
  CASE WHEN NEW.status='rejected' THEN NEW.reject_reasons END,CASE WHEN NEW.status='rejected' THEN NEW.reason_version END,CASE WHEN NEW.status='rejected' THEN NEW.reject_coaching END);
 DELETE FROM review_submission_devices WHERE submission_id=NEW.id;
END;

-- 撤回與取代：作者改卡、取消送審、收回作品、新版本取代都會把待審單改成 superseded
CREATE TRIGGER review_event_superseded AFTER UPDATE OF status ON review_submissions
 WHEN OLD.status='pending' AND NEW.status='superseded' BEGIN
 INSERT OR IGNORE INTO review_events(event_key,spec_version,submission_id,card_id,at,action,from_state,to_state,actor_kind,source)
 VALUES('superseded:'||NEW.id,1,NEW.id,NEW.card_id,COALESCE(NEW.decided_at,CAST(unixepoch('subsec')*1000 AS INTEGER)),'superseded','pending','superseded','system',
  CASE WHEN EXISTS(SELECT 1 FROM review_drops d WHERE d.submission_id=NEW.id AND d.restored_at IS NULL) THEN 'dropped' END);
 DELETE FROM review_submission_devices WHERE submission_id=NEW.id;
END;

-- 舊流程撤銷登記直接刪待審單：事件與不受理案件要留下撤回的證據
CREATE TRIGGER review_event_deleted AFTER DELETE ON review_submissions
 WHEN OLD.status='pending' BEGIN
 INSERT OR IGNORE INTO review_events(event_key,spec_version,submission_id,card_id,at,action,from_state,to_state,actor_kind,source)
 VALUES('deleted:'||OLD.id,1,OLD.id,OLD.card_id,CAST(unixepoch('subsec')*1000 AS INTEGER),'superseded','pending','deleted','system',
  CASE WHEN EXISTS(SELECT 1 FROM review_drops d WHERE d.submission_id=OLD.id AND d.restored_at IS NULL) THEN 'dropped' END);
 DELETE FROM review_submission_devices WHERE submission_id=OLD.id;
END;

-- 作者標記的人工覆寫（只給審核員看）。自動標記每次即時算，不存；覆寫在有效期內優先。
CREATE TABLE review_author_marks (
  id               TEXT    NOT NULL PRIMARY KEY,
  author_member_id TEXT    NOT NULL,
  -- tier：新人／穩定／頭部／取消標記；batch：疑似批量／取消
  kind             TEXT    NOT NULL CHECK (kind IN ('tier','batch')),
  value            TEXT    NOT NULL CHECK (value IN ('new','stable','top','none','suspected','clear')),
  -- 覆寫當下的自動值（給覆寫率與改標方向）
  auto_value       TEXT,
  reason_code      TEXT    NOT NULL CHECK (reason_code IN ('shared_device','missing_data','content_checked','other')),
  note             TEXT    NOT NULL DEFAULT '',
  rule_version     INTEGER NOT NULL,
  actor_member_id  TEXT    NOT NULL,
  created_at       INTEGER NOT NULL,
  expires_at       INTEGER NOT NULL,
  revoked_at       INTEGER
);
CREATE INDEX idx_review_author_marks_author ON review_author_marks (author_member_id, kind, created_at);

-- 作者的審核結果通知：駁回連到結果頁（理由、怎麼改、範例都在那裡），通知只帶理由代碼，
-- 不再把審核員的整段說明塞進通知。舊流程（沒有託管版本）的單沒有結果頁，仍連「我的卡片」。
-- 其餘照 0114 原樣重建。
DROP TRIGGER community_review_result;
CREATE TRIGGER community_review_result AFTER UPDATE OF status ON review_submissions
 WHEN OLD.status='pending' AND NEW.status IN ('approved','rejected') AND NEW.reopen_of IS NULL BEGIN
 INSERT OR IGNORE INTO community_awards(member_id,badge,source,created_at)
 SELECT o.member_id,'first_work',o.work_id,NEW.decided_at FROM community_card_owners o
 WHERE o.card_id=NEW.card_id AND o.member_id IS NOT NULL AND NEW.status='approved';
 INSERT OR IGNORE INTO community_notifications(event_key,member_id,kind,path,created_at,card_id,extra)
 SELECT 'review:'||NEW.id,o.member_id,'review_result',
  CASE WHEN NEW.status='rejected' AND EXISTS(SELECT 1 FROM hosting_versions v WHERE v.submission_id=NEW.id) THEN '/mine/reviews/'||NEW.id ELSE '/mine' END,
  NEW.decided_at,NEW.card_id,
  CASE WHEN NEW.status='rejected' AND NEW.reject_reasons IS NOT NULL
   THEN json_object('status',NEW.status,'kind',NEW.kind,'reasons',json(NEW.reject_reasons))
   ELSE json_object('status',NEW.status,'kind',NEW.kind,'note',NULLIF(substr(trim(NEW.note),1,500),'')) END
 FROM community_card_owners o WHERE o.card_id=NEW.card_id AND o.member_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM community_preferences p WHERE p.member_id=o.member_id AND p.notifications=0);
END;
