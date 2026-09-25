-- 成人內容聲明的同意紀錄（owner 2026-09-26）。
--
-- 開成人內容除了驗年齡，還要勾選同意聲明（內容可能令人反感、不得提供給未滿 18 歲的人）。
-- 記的是「同意了哪一版、什麼時候」：聲明改版時（shared/adult-consent.ts 加一），
-- 版本不符的成員視同沒開，下次打開重新同意一次。年齡驗證（age_verified_at）不受影響。
ALTER TABLE members ADD COLUMN adult_consent_version INTEGER;
ALTER TABLE members ADD COLUMN adult_consented_at INTEGER;

-- 上線當下已經開著成人內容的成員維持開啟（owner 2026-09-26「現在開著的就開了」）：
-- 記成同意第 1 版，但同意時間留空——時間是空的就代表沒有真的看過聲明，是沿用舊設定。
-- 之後聲明改版時，他們跟其他人一樣要重新同意。
UPDATE members SET adult_consent_version = 1
 WHERE show_nsfw = 1 AND age_verified_at IS NOT NULL AND adult_consent_version IS NULL;
