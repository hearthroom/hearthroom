/**
 * 榜單的固定類型目錄（照魅魔島的清單，去掉「類NTR」；owner 2026-09-07）。
 *
 * 為什麼是固定清單而不是從資料裡數：作者手打的標籤五花八門，數出來的前 N 名每天在變，
 * 使用者記不住位置；固定的一排才是「類型」。卡片自帶的標籤是作者用卡片語言寫的，所以每個類型
 * 帶五種語言的名字，過濾時任一命中都算——繁體卡標「調教&強迫」、簡體卡標「调教&强迫」，同一個籤。
 *
 * key 進網址（/?tag=training），跨語言分享同一個連結看到同一個籤。Worker 與前端共用這一份。
 */
export type TagLocale = "zh-Hans" | "zh-Hant" | "en" | "ja" | "ko";

export interface TagEntry {
  key: string;
  names: Record<TagLocale, string>;
}

const t = (key: string, zhHans: string, zhHant: string, en: string, ja: string, ko: string): TagEntry => ({
  key,
  names: { "zh-Hans": zhHans, "zh-Hant": zhHant, en, ja, ko },
});

export const TAG_CATALOG: TagEntry[] = [
  t("roleplay", "角色扮演", "角色扮演", "Roleplay", "ロールプレイ", "롤플레이"),
  t("world-sim", "世界模拟器", "世界模擬器", "World simulator", "世界シミュレーター", "세계 시뮬레이터"),
  t("gameplay-sim", "玩法模拟器", "玩法模擬器", "Gameplay simulator", "ゲームシミュレーター", "게임 시뮬레이터"),
  t("loli", "萝莉", "蘿莉", "Loli", "ロリ", "로리"),
  t("hypnosis", "催眠", "催眠", "Hypnosis", "催眠", "최면"),
  t("female-pov", "女生视角", "女生視角", "Female POV", "女性視点", "여성 시점"),
  t("taboo", "伦理", "倫理", "Taboo", "背徳", "금기"),
  t("training", "调教&强迫", "調教&強迫", "Training & coercion", "調教&強制", "조교&강제"),
  t("ntl", "NTL", "NTL", "NTL", "NTL", "NTL"),
  t("ntr", "NTR", "NTR", "NTR", "NTR", "NTR"),
  t("story", "剧情", "劇情", "Story", "ストーリー", "스토리"),
  t("motherly", "母系", "母系", "Motherly", "母系", "모성"),
  t("mature", "熟女", "熟女", "Mature women", "熟女", "숙녀"),
  t("submissive", "顺从", "順從", "Submissive", "従順", "순종"),
  t("wuxia", "武侠", "武俠", "Wuxia", "武侠", "무협"),
  t("western-fantasy", "西幻", "西幻", "Western fantasy", "西洋ファンタジー", "서양 판타지"),
  t("womens-fiction", "女频（bl/4i/abo/np）", "女頻（bl/4i/abo/np）", "Women’s fiction (BL/ABO/NP)", "女性向け（BL/ABO/NP）", "여성향(BL/ABO/NP)"),
  t("xianxia", "修仙", "修仙", "Xianxia", "仙侠", "선협"),
  t("mystery", "悬疑", "懸疑", "Mystery", "ミステリー", "미스터리"),
  t("onee-san", "御姐", "御姐", "Onee-san", "お姉さん", "누님"),
  t("redemption", "救赎", "救贖", "Redemption", "救済", "구원"),
  t("fantasy-scifi", "玄幻&科幻", "玄幻&科幻", "Fantasy & sci-fi", "ファンタジー&SF", "판타지&SF"),
  t("aesthetic", "唯美", "唯美", "Aesthetic", "耽美", "유미"),
  t("management-sim", "模拟经营", "模擬經營", "Management sim", "経営シミュレーション", "경영 시뮬레이션"),
  t("r18g", "R18G", "R18G", "R18G", "R18G", "R18G"),
  t("bestiality", "人兽", "人獸", "Bestiality", "獣姦", "수간"),
  t("gender-swap", "性转", "性轉", "Gender swap", "性転換", "성전환"),
  t("furry", "福瑞", "福瑞", "Furry", "ケモノ", "퍼리"),
  t("shota", "正太", "正太", "Shota", "ショタ", "쇼타"),
  t("school", "校园", "校園", "School", "学園", "학원"),
  t("blacked", "媚黑", "媚黑", "Blacked", "媚黒", "미흑"),
  t("sfw", "SFW", "SFW", "SFW", "SFW", "SFW"),
  t("ancient", "古风", "古風", "Ancient China", "古風", "고풍"),
  t("hardcore", "重口味", "重口味", "Hardcore", "ハード", "하드코어"),
  t("romance", "恋爱&攻略", "戀愛&攻略", "Romance & dating", "恋愛&攻略", "연애&공략"),
  t("femboy", "男娘", "男娘", "Femboy", "男の娘", "여장남자"),
  t("fanwork", "同人", "同人", "Fan work", "二次創作", "팬픽"),
  t("tomboy", "假小子", "假小子", "Tomboy", "ボーイッシュ", "톰보이"),
  t("futanari", "扶她", "扶她", "Futanari", "ふたなり", "후타나리"),
  t("beastfolk", "兽人", "獸人", "Beastfolk", "獣人", "수인"),
  t("harem", "后宫", "後宮", "Harem", "ハーレム", "하렘"),
  t("foot", "恋足", "戀足", "Foot fetish", "足フェチ", "발 페티시"),
  t("tool", "工具", "工具", "Tool", "ツール", "도구"),
  t("game", "游戏", "遊戲", "Game", "ゲーム", "게임"),
  t("absurd", "抽象", "抽象", "Absurd", "シュール", "병맛"),
  t("system", "系统", "系統", "System", "システム", "시스템"),
  t("secret", "隐奸", "隱姦", "Secret sex", "こっそり", "몰래"),
  t("exhibition", "露出", "露出", "Exhibitionism", "露出", "노출"),
  t("gap", "反差", "反差", "Gap", "ギャップ", "갭"),
  t("yuri", "百合", "百合", "Yuri", "百合", "백합"),
  t("erotic", "情欲肉爱", "情慾肉愛", "Erotic", "エロ", "에로"),
  t("humiliation", "羞辱", "羞辱", "Humiliation", "羞辱", "굴욕"),
];

const BY_KEY = new Map(TAG_CATALOG.map((e) => [e.key, e]));

/** 一個類型鍵對應的所有名字（五語去重）；不是目錄裡的鍵就回 null，呼叫端照字面當標籤用。 */
export function tagNamesFor(key: string): string[] | null {
  const entry = BY_KEY.get(key);
  return entry ? [...new Set(Object.values(entry.names))] : null;
}

/** 目錄裡的顯示名：沒有那個語言就退回簡體（清單的原文）。 */
export function tagLabel(entry: TagEntry, locale: string): string {
  return entry.names[locale as TagLocale] ?? entry.names["zh-Hans"];
}
