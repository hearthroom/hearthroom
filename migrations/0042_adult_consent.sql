-- 成人內容聲明的同意紀錄（owner 2026-09-26）。
--
-- 開成人內容除了驗年齡，還要勾選同意聲明（內容可能令人反感、不得提供給未滿 18 歲的人）。
-- 記的是「同意了哪一版、什麼時候」：聲明改版時（shared/adult-consent.ts 加一），
-- 版本不符的成員視同沒開，下次打開重新同意一次。年齡驗證（age_verified_at）不受影響。
-- 上線前已經開著的成員這兩欄是 NULL，一樣要同意一次才看得到成人內容。
ALTER TABLE members ADD COLUMN adult_consent_version INTEGER;
ALTER TABLE members ADD COLUMN adult_consented_at INTEGER;
