-- 分享回流（原語 2）：分享者在卡內主動產生一條帶平台短碼的連結（?share=~XXXXXXXX），朋友從那條連結
-- 回應卡片宣告過的投票，分享者讀得到匿名彙總。回應本身記在 card_state_* 的 scope='share:<短碼>'。
-- owner_member_id 只用來授權分享者讀自己的結果，從不回傳給任何人；接收者看不到分享者是誰。

CREATE TABLE card_share_tokens (
 token TEXT PRIMARY KEY,
 card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
 ns TEXT NOT NULL CHECK(ns IN ('live','draft','test')),
 owner_member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
 context TEXT NOT NULL,
 poll_key TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX card_share_tokens_owner ON card_share_tokens(owner_member_id, card_id, created_at DESC);

-- 各選項人數每天最多更新一次（E4）：當天第一次讀時從總數照一張，之後當天都讀這張。
-- 總數另外即時讀；朋友少時，分享者才不能從「剛剛 +1」推回某個人選了什麼。
CREATE TABLE card_share_snapshots (
 token TEXT NOT NULL REFERENCES card_share_tokens(token) ON DELETE CASCADE,
 day TEXT NOT NULL,
 counts TEXT NOT NULL,
 total INTEGER NOT NULL,
 PRIMARY KEY(token, day)
);
