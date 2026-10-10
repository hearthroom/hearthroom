/**
 * 卡片分級：作者自評問卷與計分（owner 2026-10-10）。
 *
 * 級別與題目對齊台灣《遊戲軟體分級管理辦法》（108-05-23 修正）第 4–9 條；結構照官方
 * 「分級級別評量系統」：先複選這張卡會出現哪些內容，再就每一類選「最接近且不低於」實際內容的
 * 那一項，取最高者。設計稿：docs/technical-design/HearthroomContentRatingSelfAssessment_*。
 *
 * 伺服器、網頁、CLI（經 GET /v1/rating/questionnaire）共用這一份。計分只在伺服器算：
 * 客戶端送答案，不送級別。題目或對應級別有實質改動時把版本加一——舊答案照舊能顯示，
 * 但重送審時要用新版重答。
 *
 * 只有限制級要擋未成年人（第 16 條），所以成人旗標（cards.nsfw）＝「級別是限制級」；
 * 輔12／輔15 只標示，不加年齡閘門。
 */

export const RATING_QUESTIONNAIRE_VERSION = 1;

/** 由低到高。代號沿用官方英文簡稱。 */
export const RATINGS = ["G", "P", "PG12", "PG15", "R"] as const;
export type Rating = (typeof RATINGS)[number];

export const LOCALES = ["zh-Hant", "zh-Hans", "en", "ja", "ko"] as const;
export type RatingLocale = (typeof LOCALES)[number];
export type Text = Record<RatingLocale, string>;

/** 第 12 條要標示的七種情節，加上第 7 條第 4 款的戀愛交友（只計分，不算情節名稱）。 */
export const TOPICS = ["sex", "violence", "horror", "tobacco_alcohol", "drugs", "language", "antisocial", "romance"] as const;
export type Topic = (typeof TOPICS)[number];
const NOT_DESCRIPTORS: readonly Topic[] = ["romance"];

export interface RatingOption { id: string; rating: Rating; text: Text }
export interface RatingTopic { id: Topic; title: Text; options: RatingOption[] }

export const RATING_NAMES: Record<Rating, Text> = {
  G: { "zh-Hant": "普遍級", "zh-Hans": "普遍级", en: "All ages", ja: "全年齢", ko: "전체 이용가" },
  P: { "zh-Hant": "保護級", "zh-Hans": "保护级", en: "Ages 6+", ja: "6歳以上", ko: "6세 이상" },
  PG12: { "zh-Hant": "輔12級", "zh-Hans": "辅12级", en: "Ages 12+", ja: "12歳以上", ko: "12세 이상" },
  PG15: { "zh-Hant": "輔15級", "zh-Hans": "辅15级", en: "Ages 15+", ja: "15歳以上", ko: "15세 이상" },
  R: { "zh-Hant": "限制級", "zh-Hans": "限制级", en: "Adults only", ja: "18歳以上", ko: "청소년 이용불가" },
};

export const RATING_INTRO: Text = {
  "zh-Hant": "以正常遊玩時可能出現的最高程度為準，包含角色設定、開場白、世界書、圖片，以及卡片引導 AI 產生的情節。",
  "zh-Hans": "以正常游玩时可能出现的最高程度为准，包含角色设定、开场白、世界书、图片，以及卡片引导 AI 生成的情节。",
  en: "Based on the strongest content in normal play, including the definition, openings, Lorebook, images and story the card directs the AI to write.",
  ja: "通常プレイで生じうる最も強い内容が基準。キャラクター設定、オープニング、ロアブック、画像、カードが AI に書かせる展開を含む。",
  ko: "일반 플레이에서 나올 수 있는 가장 강한 내용 기준. 캐릭터 설정, 오프닝, 로어북, 이미지, 카드가 AI에 쓰게 하는 전개 포함.",
};

/** 第二步的作答原則（官方評量系統的說法）。 */
export const RATING_PICK_RULE: Text = {
  "zh-Hant": "每個類型選擇最接近且不低於實際內容的描述。",
  "zh-Hans": "每个类型选择最接近且不低于实际内容的描述。",
  en: "For each type, select the closest description that is not milder than the actual content.",
  ja: "種類ごとに、実際の内容に最も近く、それより軽くない記述を選択。",
  ko: "유형마다 실제 내용에 가장 가깝고 그보다 가볍지 않은 설명을 선택.",
};

export const RATING_TOPICS: RatingTopic[] = [
  {
    id: "sex",
    title: { "zh-Hant": "性", "zh-Hans": "性", en: "Sexual content", ja: "性的表現", ko: "선정성" },
    options: [
      { id: "sex.attire", rating: "PG12", text: {
        "zh-Hant": "強調身材的服裝或打扮（無性暗示），或教育、醫學目的的裸露",
        "zh-Hans": "突出身材的服装或打扮（无性暗示），或教育、医学目的的裸露",
        en: "Revealing outfits without sexual suggestion, or educational or medical nudity",
        ja: "体型を強調する服装（性的示唆なし）、または教育・医療目的の裸体",
        ko: "몸매를 드러내는 복장(성적 암시 없음) 또는 교육·의료 목적의 노출",
      } },
      { id: "sex.suggestive", rating: "PG15", text: {
        "zh-Hant": "輕微性暗示；女性上半身或背部裸露、遠景全裸、經遮蔽處理的裸露",
        "zh-Hans": "轻微性暗示；女性上半身或背部裸露、远景全裸、经遮蔽处理的裸露",
        en: "Mild sexual suggestion; female upper-body or back nudity, distant full nudity, or censored nudity",
        ja: "軽い性的示唆、女性の上半身・背中の露出、遠景の全裸、修正処理された裸体",
        ko: "가벼운 성적 암시, 여성 상반신·등 노출, 원경 전신 노출, 가림 처리된 노출",
      } },
      { id: "sex.explicit", rating: "R", text: {
        "zh-Hant": "全裸，或以文字、圖像、語音明確描寫或暗示性行為",
        "zh-Hans": "全裸，或以文字、图像、语音明确描写或暗示性行为",
        en: "Full nudity, or sexual acts described or clearly implied in text, images or audio",
        ja: "全裸、または文章・画像・音声による性行為の明確な描写・示唆",
        ko: "전신 노출 또는 글·이미지·음성을 통한 성행위의 명확한 묘사·암시",
      } },
    ],
  },
  {
    id: "violence",
    title: { "zh-Hant": "暴力", "zh-Hans": "暴力", en: "Violence", ja: "暴力", ko: "폭력" },
    options: [
      { id: "violence.cartoon", rating: "P", text: {
        "zh-Hant": "可愛角色打鬥，或未描寫傷亡細節的攻擊，無血腥",
        "zh-Hans": "可爱角色打斗，或未描写伤亡细节的攻击，无血腥",
        en: "Cartoon fighting, or attacks without injury detail and no blood",
        ja: "デフォルメキャラの戦闘、または負傷描写のない攻撃（流血なし）",
        ko: "귀여운 캐릭터의 싸움 또는 부상 묘사가 없는 공격(유혈 없음)",
      } },
      { id: "violence.fighting", rating: "PG12", text: {
        "zh-Hant": "未達血腥程度的打鬥、攻擊",
        "zh-Hans": "未达血腥程度的打斗、攻击",
        en: "Fighting or attacks without blood",
        ja: "流血に至らない戦闘・攻撃",
        ko: "유혈에 이르지 않는 싸움·공격",
      } },
      { id: "violence.bloody", rating: "PG15", text: {
        "zh-Hant": "血腥的攻擊或殺戮，未達殘虐程度",
        "zh-Hans": "血腥的攻击或杀戮，未达残虐程度",
        en: "Bloody attacks or killing, short of cruelty",
        ja: "流血を伴う攻撃・殺害（残虐に至らない）",
        ko: "유혈이 있는 공격·살해(잔혹하지 않음)",
      } },
      { id: "violence.cruel", rating: "R", text: {
        "zh-Hant": "血腥、殘暴，令人感到殘虐的殺害或殺戮",
        "zh-Hans": "血腥、残暴，令人感到残虐的杀害或杀戮",
        en: "Gory, brutal killing that comes across as cruel",
        ja: "残虐と感じさせる、血なまぐさく凄惨な殺害",
        ko: "잔혹하게 느껴지는 피비린내 나는 살해",
      } },
    ],
  },
  {
    id: "horror",
    title: { "zh-Hant": "恐怖", "zh-Hans": "恐怖", en: "Horror", ja: "恐怖表現", ko: "공포" },
    options: [
      { id: "horror.mild", rating: "PG12", text: {
        "zh-Hant": "輕微恐怖的畫面或情節",
        "zh-Hans": "轻微恐怖的画面或情节",
        en: "Mildly frightening scenes or story",
        ja: "軽い恐怖を感じる場面・展開",
        ko: "가볍게 무서운 장면·전개",
      } },
      { id: "horror.scary", rating: "PG15", text: {
        "zh-Hant": "恐怖的畫面或情節，未達殘虐程度",
        "zh-Hans": "恐怖的画面或情节，未达残虐程度",
        en: "Frightening scenes or story, short of cruelty",
        ja: "恐怖を感じる場面・展開（残虐に至らない）",
        ko: "무서운 장면·전개(잔혹하지 않음)",
      } },
      { id: "horror.cruel", rating: "R", text: {
        "zh-Hant": "令人感到殘虐的恐怖內容",
        "zh-Hans": "令人感到残虐的恐怖内容",
        en: "Horror that comes across as cruel",
        ja: "残虐と感じさせる恐怖表現",
        ko: "잔혹하게 느껴지는 공포 묘사",
      } },
    ],
  },
  {
    id: "tobacco_alcohol",
    title: { "zh-Hant": "菸酒", "zh-Hans": "烟酒", en: "Tobacco and alcohol", ja: "飲酒・喫煙", ko: "음주·흡연" },
    options: [
      { id: "tobacco_alcohol.shown", rating: "PG15", text: {
        "zh-Hant": "吸菸、飲酒，或誘導使用菸酒的情節",
        "zh-Hans": "吸烟、饮酒，或诱导使用烟酒的情节",
        en: "Smoking or drinking, or story that encourages either",
        ja: "喫煙・飲酒、またはそれを促す展開",
        ko: "흡연·음주 또는 이를 부추기는 전개",
      } },
    ],
  },
  {
    id: "drugs",
    title: { "zh-Hant": "毒品", "zh-Hans": "毒品", en: "Drugs", ja: "薬物", ko: "약물" },
    options: [
      { id: "drugs.mentioned", rating: "PG15", text: {
        "zh-Hant": "提及毒品，無使用描寫",
        "zh-Hans": "提及毒品，无使用描写",
        en: "References to drugs, no depicted use",
        ja: "薬物への言及のみ（使用描写なし）",
        ko: "약물 언급만 있음(사용 묘사 없음)",
      } },
      { id: "drugs.use", rating: "R", text: {
        "zh-Hant": "使用毒品的畫面或情節",
        "zh-Hans": "使用毒品的画面或情节",
        en: "Depicted drug use",
        ja: "薬物使用の描写",
        ko: "약물 사용 묘사",
      } },
    ],
  },
  {
    id: "language",
    title: { "zh-Hant": "不當言語", "zh-Hans": "不当言语", en: "Crude language", ja: "不適切な言葉", ko: "부적절한 언어" },
    options: [
      { id: "language.mild", rating: "PG12", text: {
        "zh-Hant": "一般不雅用語，無不良隱喻",
        "zh-Hans": "一般不雅用语，无不良隐喻",
        en: "Mild crude language without offensive innuendo",
        ja: "悪意ある含みのない一般的な下品な言葉",
        ko: "악의적 함의 없는 일반적인 비속어",
      } },
      { id: "language.crude", rating: "PG15", text: {
        "zh-Hant": "粗俗的用字或對白",
        "zh-Hans": "粗俗的用字或对白",
        en: "Vulgar words or dialogue",
        ja: "下品な言葉・セリフ",
        ko: "저속한 단어·대사",
      } },
      { id: "language.hateful", rating: "R", text: {
        "zh-Hant": "反覆出現粗俗或仇恨性言語",
        "zh-Hans": "反复出现粗俗或仇恨性言语",
        en: "Repeated vulgar or hateful language",
        ja: "下品・差別的な言葉の繰り返し",
        ko: "저속하거나 혐오적인 표현의 반복",
      } },
    ],
  },
  {
    id: "antisocial",
    title: { "zh-Hant": "反社會性", "zh-Hans": "反社会性", en: "Crime and self-harm", ja: "反社会的行為", ko: "반사회적 행위" },
    options: [
      { id: "antisocial.depicted", rating: "PG15", text: {
        "zh-Hant": "犯罪或不當行為的描寫，不易引發兒少模仿",
        "zh-Hans": "犯罪或不当行为的描写，不易引发未成年人模仿",
        en: "Crime or wrongdoing unlikely to be imitated by minors",
        ja: "犯罪・不適切な行為の描写（未成年者が模倣しにくいもの）",
        ko: "범죄·부적절한 행위 묘사(청소년이 모방하기 어려움)",
      } },
      { id: "antisocial.imitable", rating: "R", text: {
        "zh-Hant": "搶劫、綁架、自傷、自殺等描寫，易引發兒少模仿",
        "zh-Hans": "抢劫、绑架、自伤、自杀等描写，易引发未成年人模仿",
        en: "Robbery, kidnapping, self-harm, suicide or similar, likely to be imitated by minors",
        ja: "強盗・誘拐・自傷・自殺などの描写（未成年者が模倣しやすいもの）",
        ko: "강도·납치·자해·자살 등의 묘사(청소년이 모방하기 쉬움)",
      } },
    ],
  },
  {
    id: "romance",
    title: { "zh-Hant": "戀愛交友", "zh-Hans": "恋爱交友", en: "Romance", ja: "恋愛", ko: "연애" },
    options: [
      { id: "romance.dating", rating: "PG12", text: {
        "zh-Hant": "與角色戀愛、交往或結婚的玩法",
        "zh-Hans": "与角色恋爱、交往或结婚的玩法",
        en: "Dating, romance or marriage with characters",
        ja: "キャラクターとの恋愛・交際・結婚",
        ko: "캐릭터와의 연애·교제·결혼",
      } },
    ],
  },
];

/** 第三步：各級都有的兜底條款（第 5-六、6-七、7-六、8-二款）。 */
export const RATING_OTHER: { title: Text; options: RatingOption[] } = {
  title: {
    "zh-Hant": "其他可能對特定年齡以下使用者造成不良影響的內容",
    "zh-Hans": "其他可能对特定年龄以下用户造成不良影响的内容",
    en: "Other content that may be harmful below a certain age",
    ja: "その他、一定年齢未満に悪影響を及ぼすおそれのある内容",
    ko: "그 밖에 일정 연령 미만에게 해로울 수 있는 내용",
  },
  options: [
    { id: "other.none", rating: "G", text: { "zh-Hant": "無", "zh-Hans": "无", en: "None", ja: "なし", ko: "없음" } },
    { id: "other.under6", rating: "P", text: { "zh-Hant": "不適合未滿 6 歲", "zh-Hans": "不适合未满 6 岁", en: "Not suitable under 6", ja: "6歳未満に不適切", ko: "6세 미만 부적합" } },
    { id: "other.under12", rating: "PG12", text: { "zh-Hant": "不適合未滿 12 歲", "zh-Hans": "不适合未满 12 岁", en: "Not suitable under 12", ja: "12歳未満に不適切", ko: "12세 미만 부적합" } },
    { id: "other.under15", rating: "PG15", text: { "zh-Hant": "不適合未滿 15 歲", "zh-Hans": "不适合未满 15 岁", en: "Not suitable under 15", ja: "15歳未満に不適切", ko: "15세 미만 부적합" } },
    { id: "other.under18", rating: "R", text: { "zh-Hant": "不適合未滿 18 歲", "zh-Hans": "不适合未满 18 岁", en: "Not suitable under 18", ja: "18歳未満に不適切", ko: "18세 미만 부적합" } },
  ],
};

/** 作者送出的答案。topics 只列勾了的類型；全沒勾＝以上皆無。 */
export interface RatingAnswers {
  version: number;
  topics: Partial<Record<Topic, string>>;
  other: string;
}

export interface RatingResult {
  rating: Rating;
  /** 第 12 條的情節名稱，依級別由高到低（同級照題目順序） */
  descriptors: Topic[];
  answers: RatingAnswers;
}

export class RatingAnswersError extends Error {}

const rank = (r: Rating) => RATINGS.indexOf(r);

/** 驗證並計分。答案形狀不對、版本不是現行版、選項不存在，一律丟 RatingAnswersError。 */
export function evaluateRating(input: unknown): RatingResult {
  if (!input || typeof input !== "object") throw new RatingAnswersError("rating_answers_invalid");
  const raw = input as { version?: unknown; topics?: unknown; other?: unknown };
  if (typeof raw.version !== "number") throw new RatingAnswersError("rating_answers_invalid");
  if (raw.version !== RATING_QUESTIONNAIRE_VERSION) throw new RatingAnswersError("rating_version_outdated");
  if (!raw.topics || typeof raw.topics !== "object" || Array.isArray(raw.topics)) throw new RatingAnswersError("rating_answers_invalid");
  const topics: Partial<Record<Topic, string>> = {};
  const picked: { topic: Topic; rating: Rating }[] = [];
  for (const [key, value] of Object.entries(raw.topics as Record<string, unknown>)) {
    const topic = RATING_TOPICS.find((t) => t.id === key);
    const option = topic?.options.find((o) => o.id === value);
    if (!topic || !option) throw new RatingAnswersError("rating_answers_invalid");
    topics[topic.id] = option.id;
    picked.push({ topic: topic.id, rating: option.rating });
  }
  const other = RATING_OTHER.options.find((o) => o.id === raw.other);
  if (!other) throw new RatingAnswersError("rating_answers_invalid");
  let rating: Rating = other.rating;
  for (const p of picked) if (rank(p.rating) > rank(rating)) rating = p.rating;
  const descriptors = picked
    .filter((p) => !NOT_DESCRIPTORS.includes(p.topic))
    .sort((a, b) => rank(b.rating) - rank(a.rating) || TOPICS.indexOf(a.topic) - TOPICS.indexOf(b.topic))
    .map((p) => p.topic);
  // 正規化後的答案照題目順序存，同一份答案不論送來的鍵順序都存成同一串
  const ordered: Partial<Record<Topic, string>> = {};
  for (const t of TOPICS) if (topics[t]) ordered[t] = topics[t];
  return { rating, descriptors, answers: { version: RATING_QUESTIONNAIRE_VERSION, topics: ordered, other: other.id } };
}

export function isRating(value: unknown): value is Rating {
  return typeof value === "string" && (RATINGS as readonly string[]).includes(value);
}

/** 公開給 CLI 與 AI 的題目定義：單一語言、帶級別，讓讀的人知道每個選項的後果。 */
export function questionnaireFor(locale: string) {
  const l: RatingLocale = (LOCALES as readonly string[]).includes(locale) ? (locale as RatingLocale) : locale.startsWith("zh") ? (/hans|cn|sg/i.test(locale) ? "zh-Hans" : "zh-Hant") : locale.startsWith("ja") ? "ja" : locale.startsWith("ko") ? "ko" : "en";
  const option = (o: RatingOption) => ({ id: o.id, rating: o.rating, text: o.text[l] });
  return {
    version: RATING_QUESTIONNAIRE_VERSION,
    locale: l,
    intro: RATING_INTRO[l],
    pickRule: RATING_PICK_RULE[l],
    ratings: RATINGS.map((r) => ({ id: r, name: RATING_NAMES[r][l] })),
    topics: RATING_TOPICS.map((t) => ({ id: t.id, title: t.title[l], options: t.options.map(option) })),
    other: { title: RATING_OTHER.title[l], options: RATING_OTHER.options.map(option) },
    answerShape: { version: RATING_QUESTIONNAIRE_VERSION, topics: { "<topic id>": "<option id>" }, other: "<other option id>" },
  };
}
