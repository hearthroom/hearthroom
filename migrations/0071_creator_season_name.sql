-- 中文活動名去掉「社」（owner 2026-10-17）：綺夢創作季／绮梦创作季。外語名不變。
-- 只在還是原本那個名字時改，後台若已改過就不動。
UPDATE card_reward_campaigns
SET title = json_set(title, '$."zh-Hant"', '綺夢創作季', '$."zh-Hans"', '绮梦创作季'),
    updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE id = 'creator-season-1' AND json_extract(title, '$."zh-Hant"') = '綺夢社創作季';
