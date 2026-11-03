-- Opening veterans include beta sign-ups; never rewrite the shipped 0103.
UPDATE community_badge_definitions SET descriptions='{"zh-Hant": "2026 年 11 月 17 日（含）以前註冊，內測期間註冊的也算。", "zh-Hans": "2026 年 11 月 17 日（含）以前注册，内测期间注册的也算。", "en": "Sign up on or before November 17, 2026. Beta sign-ups count too.", "ja": "2026 年 11 月 17 日（当日を含む）までに登録する。ベータ期間中の登録も含む。", "ko": "2026년 11월 17일(당일 포함)까지 가입하면 획득해요. 베타 기간에 가입한 경우도 포함돼요."}' WHERE key='opening_veteran';
INSERT OR IGNORE INTO community_awards(member_id,badge,source,created_at)
SELECT m.id,'opening_veteran','veteran-overlap-v1',m.created_at FROM members m
WHERE m.created_at<1794931200000
AND NOT EXISTS(SELECT 1 FROM legacy_account_fence f WHERE f.member_id=m.id);
