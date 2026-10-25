-- 共用狀態的寫入資格（design §7.6，PM 裁定 2026-10-25）：在這張卡開過對話。第一次寫入時用玩家自己的登入
-- 向 Harbor 查這張卡的對話存檔（同一作品的各版本都算），查到就記 30 天，期間不再問。查不到不記，下次再查。
-- 本站自己的 member_conversations 是遊玩頁回報的指標，伺服器不驗證，不能當資格。
CREATE TABLE card_state_eligibility (
 card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
 member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
 checked_at INTEGER NOT NULL,
 PRIMARY KEY(card_id, member_id)
);
