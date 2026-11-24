-- AI 判定拆兩欄（owner 2026-11-24）：note 是給審核員的內部說明（可以提作者行為、額度、同裝置），
-- author_note 是給作者的詳細說明草稿（只寫卡片本身），審核員採用 AI 判定時帶進給作者的說明欄、可改後送出。
ALTER TABLE review_ai_suggestions ADD COLUMN author_note TEXT NOT NULL DEFAULT '';
