/**
 * 把一則 AI 回覆拆成「敘事」與「遊戲狀態」。
 *
 * 這張卡（以及同一作者體系的酒館卡）約定 AI 每一輪都吐三個區塊：
 *   <zzt>a|b|c</zzt>            這一輪的標題碎片
 *   <zzhud>[主角]…[场景]…[行动]…</zzhud>   INI 形狀的 HUD：主角欄位、場景欄位、可選行動
 *   <zzroles>[角色1]…[角色2]…</zzroles>     台上每個角色的欄位（好感度、心理活动、立绘代码…）
 * 對話頁靠作者的正則規則把它們換成版面；遊戲頁不換版面，直接讀成資料去驅動舞台。
 *
 * 敘事 = 去掉這三個區塊、去掉作者的開局面板觸發字（【开局配置N】等）、去掉非標準標籤後剩下的文字。
 * 串流途中區塊還沒收尾也要能讀：從最後一個沒閉合的 <zz 開始截掉，敘事不會被半截的 key=value 汙染。
 */

// i18n-ignore：區塊名與 INI 的節名／欄位名是卡片協定的一部分，照原文比對。
/** 協定裡的欄位名，頁面用這張表取值，不把中文 key 散在模板裡。 */
export const F = { time: "时间", place: "地点", round: "当前轮次", objective: "当前目标", note: "便签", mood: "心理活动", identity: "身份" } as const;

export interface GameAction { short: string; full: string }
export interface GameRole { name: string; affection: number | null; fields: Record<string, string> }
export interface GameTurn {
  title: string[];
  prose: string;
  hero: Record<string, string>;
  scene: Record<string, string>;
  actions: GameAction[];
  roles: GameRole[];
}

const BLOCK = /<(zzt|zzhud|zzroles)>([\s\S]*?)<\/\1>/g;
const OPEN_TAIL = /<zz[a-z]*(?:>[\s\S]*)?$/;
const OPENING_TOKENS = /【开局(?:配置|样式|引擎)\d*】/g;
const UNKNOWN_TAG = /<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?>/gi;
const KNOWN_INLINE = new Set(["b", "i", "em", "strong", "br", "u", "s", "span"]);

/** INI：`[节]` 開節、`key=value` 一行一欄；value 裡的 = 保留。 */
function parseIni(text: string): { name: string; fields: Record<string, string> }[] {
  const sections: { name: string; fields: Record<string, string> }[] = [];
  let cur: { name: string; fields: Record<string, string> } | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const sec = line.match(/^\[(.+?)\]$/);
    if (sec) { cur = { name: sec[1].trim(), fields: {} }; sections.push(cur); continue; }
    const eq = line.indexOf("=");
    if (eq < 0 || !cur) continue;
    cur.fields[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return sections;
}

function actionsOf(fields: Record<string, string>): GameAction[] {
  const out: GameAction[] = [];
  for (let i = 1; i <= 9; i++) {
    const full = fields[`选项${i}`];
    const short = fields[`选项${i}短`];
    if (!full && !short) continue;
    out.push({ short: short || full, full: full || short });
  }
  return out;
}

function stripProse(text: string): string {
  return text
    .replace(OPENING_TOKENS, "")
    .replace(UNKNOWN_TAG, (m) => (KNOWN_INLINE.has(m.replace(/^<\/?|[\s>].*$/gs, "").toLowerCase()) ? m : ""))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parseTurn(text: string): GameTurn {
  const turn: GameTurn = { title: [], prose: "", hero: {}, scene: {}, actions: [], roles: [] };
  let rest = String(text || "");
  rest = rest.replace(BLOCK, (_m, tag: string, body: string) => {
    if (tag === "zzt") {
      turn.title = body.split("|").map((s) => s.trim()).filter(Boolean);
    } else if (tag === "zzhud") {
      for (const s of parseIni(body)) {
        if (s.name === "主角") turn.hero = s.fields;
        else if (s.name === "场景") turn.scene = s.fields;
        else if (s.name === "行动") turn.actions = actionsOf(s.fields);
      }
    } else {
      turn.roles = parseIni(body)
        .filter((s) => s.fields.名字)
        .map((s) => {
          const n = Number(s.fields.好感度);
          return { name: s.fields.名字, affection: Number.isFinite(n) && s.fields.好感度 !== undefined ? n : null, fields: s.fields };
        });
    }
    return "";
  });
  // 還在串流的半截區塊
  rest = rest.replace(OPEN_TAIL, "");
  turn.prose = stripProse(rest);
  return turn;
}

/** 新一輪沒提到的欄位沿用上一輪：AI 常只回有變化的部分。 */
export function mergeTurn(prev: GameTurn, next: GameTurn): GameTurn {
  const roles = prev.roles.map((r) => ({ ...r, fields: { ...r.fields } }));
  for (const nr of next.roles) {
    const hit = roles.find((r) => r.name === nr.name);
    if (!hit) { roles.push(nr); continue; }
    hit.fields = { ...hit.fields, ...nr.fields };
    if (nr.affection !== null) hit.affection = nr.affection;
  }
  return {
    title: next.title.length ? next.title : prev.title,
    prose: next.prose,
    hero: { ...prev.hero, ...next.hero },
    scene: { ...prev.scene, ...next.scene },
    actions: next.actions.length ? next.actions : prev.actions,
    roles,
  };
}

/** 協定裡「還沒有值」的寫法（未登记／未设定）。 */
export const isUnset = (v: string | undefined): boolean => !v || /未登记|未设定/.test(v);

/** 敘事裡最後被點到名的角色，當成這一刻的說話者。 */
export function speakerOf(prose: string, names: string[]): string {
  let best = "";
  let at = -1;
  for (const n of names) {
    const i = prose.lastIndexOf(n);
    if (i > at) { at = i; best = n; }
  }
  return best;
}
