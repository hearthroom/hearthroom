-- 卡片的共用狀態（sdk.shared：全服投票、共鬥計數器、每卡排行榜）。作者在 rules.json 宣告 key 與規則
-- （Provider 的作者資產 sharedState），這裡只存數字與作者宣告過的選項 ID，不存玩家寫的任何文字。
-- 設計：docs/studio/tasks/2026-10-25-card-share-context/design.md §7（monorepo docs）。
--
-- ns：live 正式；draft 作者試玩與「僅自己」的卡；test 測試帳號——三者互不相混，測試帳號不上榜。
-- scope：global 全服；之後分享回流用 share:<短碼>。period：計數器的期（'' 不分期，日 D2026-10-25，週 W2026-10-20，UTC+8）。

-- 總數：投票每個選項一列，計數器 option 為 ''。reached_at：計數器達標的時刻。
CREATE TABLE card_state_totals (
 card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
 ns TEXT NOT NULL CHECK(ns IN ('live','draft','test')),
 scope TEXT NOT NULL,
 key TEXT NOT NULL,
 period TEXT NOT NULL,
 option TEXT NOT NULL DEFAULT '',
 value INTEGER NOT NULL DEFAULT 0,
 reached_at INTEGER,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(card_id, ns, scope, key, period, option)
);

-- 每人一列：投的票（option）或這一期的累計貢獻（value）。rev 是這次寫入的序號，
-- 同一個 batch 裡更新總數時只認自己這一筆，重送或並發的另一筆不會被重算。
CREATE TABLE card_state_members (
 card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
 ns TEXT NOT NULL CHECK(ns IN ('live','draft','test')),
 scope TEXT NOT NULL,
 key TEXT NOT NULL,
 period TEXT NOT NULL,
 member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
 option TEXT NOT NULL DEFAULT '',
 previous TEXT NOT NULL DEFAULT '',
 value INTEGER NOT NULL DEFAULT 0,
 last_delta INTEGER NOT NULL DEFAULT 0,
 changes INTEGER NOT NULL DEFAULT 0,
 changes_day TEXT NOT NULL DEFAULT '',
 rev TEXT NOT NULL DEFAULT '',
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(card_id, ns, scope, key, period, member_id)
);
CREATE INDEX card_state_members_rank ON card_state_members(card_id, ns, scope, key, period, value DESC, updated_at);
CREATE INDEX card_state_members_member ON card_state_members(member_id);

-- 單卡開關：作者自己關（author_off）與工作人員關（platform_off）。變更寫 audit_log。
CREATE TABLE card_state_controls (
 card_id INTEGER PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
 author_off INTEGER NOT NULL DEFAULT 0,
 platform_off INTEGER NOT NULL DEFAULT 0,
 updated_at INTEGER NOT NULL
);
