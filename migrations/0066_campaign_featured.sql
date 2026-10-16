-- 推薦到首頁：進行中或即將開始的活動會出現在首頁看板的輪播裡。只是顯示，不影響啟用條件。
ALTER TABLE campaigns ADD COLUMN featured INTEGER NOT NULL DEFAULT 0;
