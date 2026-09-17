-- 跨站搬運開始搬世界書：來源那本在目標站對應哪一本要記下來，再同步時覆寫它，不是每次多建一本。
-- JSON 物件：{ "<來源世界書 id>": "<目標世界書 id>" }。
ALTER TABLE work_copies ADD COLUMN worldbooks TEXT NOT NULL DEFAULT '{}';
