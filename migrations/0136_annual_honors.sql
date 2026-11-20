-- 年冠：每年一屆，按當年發布作品的榜單榮譽累計積分（shared/annual-honors.ts）。
-- 結算一次定案：snapshot 記下當時的前十名，之後的連結或撤銷不改名次。
CREATE TABLE annual_settlements (
 year INTEGER NOT NULL,
 zone TEXT NOT NULL CHECK(zone IN ('clean','all')),
 settled_at INTEGER NOT NULL,
 receipt TEXT NOT NULL,
 snapshot TEXT NOT NULL,
 PRIMARY KEY(year,zone)
);
-- 一個年度、一個榜、一個名次只有一列：第 1 名（年冠）全站唯一。amount=0 的名次沒有獎金（status='none'）。
CREATE TABLE annual_awards (
 id TEXT PRIMARY KEY,
 year INTEGER NOT NULL,
 zone TEXT NOT NULL CHECK(zone IN ('clean','all')),
 rank INTEGER NOT NULL CHECK(rank BETWEEN 1 AND 10),
 member_id TEXT,
 account_no INTEGER NOT NULL,
 points INTEGER NOT NULL,
 amount INTEGER NOT NULL CHECK(amount>=0),
 awarded_at INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','none')),
 attempts INTEGER NOT NULL DEFAULT 0,
 attempted_at INTEGER,
 paid_at INTEGER,
 UNIQUE(year,zone,rank),
 FOREIGN KEY(year,zone) REFERENCES annual_settlements(year,zone)
);
CREATE INDEX annual_awards_payable ON annual_awards(status,attempted_at) WHERE status='pending';

INSERT INTO community_badge_definitions(key,icon,category,titles,descriptions,created_at,metric,threshold,sort_order) VALUES
('annual_all_2026_1','crown','rank','{"zh-Hant":"開元年冠・綜合","zh-Hans":"开元年冠・综合","en":"Founding Year Crown · Overall","ja":"開元年冠・総合","ko":"개원 연간 챔피언 · 종합"}','{"zh-Hant":"2026 年發布的卡片累計全年榜單積分，綜合榜第 1 名。全站只有一位。","zh-Hans":"2026 年发布的卡片累计全年榜单积分，综合榜第 1 名。全站只有一位。","en":"Rank #1 on the Overall board by 2026 annual points, earned by cards published in 2026. Only one author holds it.","ja":"2026 年に公開したカードの年間ランキングポイントで、総合ランキング 1 位になる。全サイトで 1 人だけ。","ko":"2026년에 공개한 카드의 연간 랭킹 포인트로 종합 1위면 획득해요. 사이트 전체에서 한 명뿐이에요."}',0,NULL,NULL,190),
('annual_clean_2026_1','crown','rank','{"zh-Hant":"開元年冠・清水","zh-Hans":"开元年冠・清水","en":"Founding Year Crown · SFW","ja":"開元年冠・全年齢","ko":"개원 연간 챔피언 · 전연령"}','{"zh-Hant":"2026 年發布的卡片累計全年榜單積分，清水榜第 1 名。全站只有一位。","zh-Hans":"2026 年发布的卡片累计全年榜单积分，清水榜第 1 名。全站只有一位。","en":"Rank #1 on the SFW board by 2026 annual points, earned by cards published in 2026. Only one author holds it.","ja":"2026 年に公開したカードの年間ランキングポイントで、全年齢ランキング 1 位になる。全サイトで 1 人だけ。","ko":"2026년에 공개한 카드의 연간 랭킹 포인트로 전연령 1위면 획득해요. 사이트 전체에서 한 명뿐이에요."}',0,NULL,NULL,191),
('annual_all_2026_10','crown','rank','{"zh-Hant":"2026 年度十傑・綜合","zh-Hans":"2026 年度十杰・综合","en":"2026 Top 10 · Overall","ja":"2026 年間トップ10・総合","ko":"2026 연간 톱10 · 종합"}','{"zh-Hant":"2026 年發布的卡片累計全年榜單積分，綜合榜第 2–10 名。","zh-Hans":"2026 年发布的卡片累计全年榜单积分，综合榜第 2–10 名。","en":"Rank #2–10 on the Overall board by 2026 annual points, earned by cards published in 2026.","ja":"2026 年に公開したカードの年間ランキングポイントで、総合ランキング 2〜10 位になる。","ko":"2026년에 공개한 카드의 연간 랭킹 포인트로 종합 2~10위면 획득해요."}',0,NULL,NULL,192),
('annual_clean_2026_10','crown','rank','{"zh-Hant":"2026 年度十傑・清水","zh-Hans":"2026 年度十杰・清水","en":"2026 Top 10 · SFW","ja":"2026 年間トップ10・全年齢","ko":"2026 연간 톱10 · 전연령"}','{"zh-Hant":"2026 年發布的卡片累計全年榜單積分，清水榜第 2–10 名。","zh-Hans":"2026 年发布的卡片累计全年榜单积分，清水榜第 2–10 名。","en":"Rank #2–10 on the SFW board by 2026 annual points, earned by cards published in 2026.","ja":"2026 年に公開したカードの年間ランキングポイントで、全年齢ランキング 2〜10 位になる。","ko":"2026년에 공개한 카드의 연간 랭킹 포인트로 전연령 2~10위면 획득해요."}',0,NULL,NULL,193);
UPDATE public_catalog_clock SET revision=lower(hex(randomblob(16))) WHERE id=1;
