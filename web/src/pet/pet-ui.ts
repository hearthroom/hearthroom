/**
 * 桌寵的互動層：把 Rig＋Driver 包成一個會被點、被拖、會看你、會冒泡泡的小人。
 *
 * 跟網站之間只靠頁面事件（window 的 "suki" CustomEvent）與 hover 提示（data-suki 屬性）：
 * 網站各處不必知道她怎麼演，只要說發生了什麼；她自己決定反應。這樣加一種反應不用動到功能本身。
 */
import { compose, PetRenderer, Rig, type PetSkeleton, type PetSkin } from "./puppet";
import { Driver } from "./driver";
import {
  bands, clampStand, defaultPeek, fitShift, fromSaved, peekCatch, peekPos, silhouettePath, PULL_FULL, pullMode, pushedIn, sideOf, standOutPos, standRange, toSaved, wallHide,
  type Frame, type Inset, type Saved, type Side,
} from "./placement";
import type { SukiNews } from "../../../shared/suki-care";

export type { SukiEvent } from "./events";
import { petSpeaking, type SukiEvent } from "./events";

type Expr = "happy" | "surprised" | "pout" | "shy" | "sleepy" | "dizzy" | "wink" | "peek";

interface Act { expr?: Expr; say?: string; ms?: number; hop?: boolean; talk?: boolean; action?: MenuItem }

/** 選單的一項：她能直接幫你做的事 */
export interface MenuItem { label: string; run: () => void }
/** 每一頁的用途：第一次到這頁說的那句、選單裡「這頁怎麼用」的問答、還沒做完的事 */
export interface PageGuide {
  id: string;
  hello?: string;
  topics?: { q: string; a: string; action?: MenuItem }[];
  todo?: () => string | null;
}

export interface PetOptions {
  base: string;
  /** 一開始穿哪一套（day、night、imp、night-imp；四套共用一副骨架） */
  skin: string;
  /** 照 key 取一句台詞（有好幾句時隨機一句）；網站用 i18n 實作 */
  line: (key: string, params?: Record<string, string | number>) => string;
  /** 給螢幕閱讀器的名字 */
  label: string;
  /** 畫面上的高度（px） */
  height: number;
  reducedMotion?: boolean;
  /** 手機：預設收在右邊、長按開選單、讓路給鍵盤與往下捲 */
  mobile?: boolean;
  /** 這一頁進來時不說開場的招呼與每日口味（頁面主要按鈕在她的泡泡底下時）；預設照常說 */
  quietGreeting?: () => boolean;
  /** 選單上的常用動作（接著上次、擲一張、搜尋…），由網站提供 */
  menu?: () => MenuItem[];
  /** 每天第一次來擲的「今天的幸運類型」 */
  dailyTag?: () => { label: string; run: () => void } | null;
  /** 最近一次在任何卡上聊天的時間（餵食）；沒登入就沒有 */
  /** 打開網站時記一次來訪、拿回她要說的事（照顧狀態在帳號裡）；沒登入回 undefined——訪客還不能聊天，照顧不算 */
  careVisit?: () => Promise<{ news: SukiNews[]; level: number; recall: boolean; state: { fullness: number; affection: number; streak: number } } | undefined>;
  /** 熟了以後她問一次「可以想你的時候叫你嗎」，答應就打開召回 */
  enableRecall?: () => Promise<void>;
  /** 熟了以後她怎麼叫你 */
  nickname?: () => string | null;
  /** 選單裡「接著上次」那一項，肚子餓時也拿來當按鈕 */
  resume?: MenuItem;
  /** 選單最後一項「不要出現」的字與動作（設定頁可以再打開） */
  menuLabel?: () => string;
  onOff?: () => void;
}

const EXPRS: Expr[] = ["happy", "surprised", "pout", "shy", "sleepy", "dizzy", "wink", "peek"];

/**
 * 這一格每個表情要淡到多少。睡著時全部收掉：表情圖的眼睛都是睜著的（想睡那張是打哈欠、張嘴），
 * 疊上去會蓋掉閉眼；睡著時頁面也一直算閒置，不能讓「閒太久會想睡」把哈欠臉帶回來。
 * 醒著：正在演的表情留著，演完回到平常；閒超過 40 秒換成想睡。
 */
export function exprTargets(cur: Partial<Record<Expr, number>>, s: { sleeping: boolean; acting: boolean; idle: number }) {
  const next = { ...cur };
  if (s.sleeping || !s.acting) for (const k of EXPRS) next[k] = 0;
  if (!s.sleeping && !s.acting && s.idle > 40) next.sleepy = 1;
  return next;
}

/** 拖她的這一下：ox/oy 是按下的地方；手機探出時分 pull（往內拉出來）與 slide（沿邊上下）兩種，站著拖是 free */
interface Drag { dx: number; dy: number; x: number; y: number; ox: number; oy: number; vx: number; t: number; moved: boolean; shake: number; mode?: "pull" | "slide" | "free"; s0: number; y0: number }

/** 探出時身體往頁面這邊歪（探頭）的角度；站出來回正 */
const LEAN = -11;
const easeBack = (t: number) => { const c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const easeIO = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export class SukiPet {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private touch: HTMLDivElement;
  private bubble: HTMLDivElement;
  private menuEl: HTMLDivElement;
  private guide: PageGuide | null = null;
  private hidden = false;
  /** 好感等級與召回開關：照顧狀態存在帳號裡，網站把它交給她 */
  private level = 0;
  private status: { fullness: number; affection: number; streak: number } | null = null;
  rig!: Rig;
  private driver!: Driver;
  private view!: PetRenderer;
  private hit?: { data: Uint8ClampedArray; w: number; h: number; names: string[] };
  private expr: Partial<Record<Expr, number>> = {};
  private exprTarget: Partial<Record<Expr, number>> = {};
  private actUntil = 0;
  private bubbleUntil = 0;
  private lastInput = performance.now();
  private clicks: number[] = [];
  private drag?: Drag;
  private jumpT = -1;
  private dangle = 0;
  private dangleV = 0;
  private tucked = false;
  private said = new Set<string>();
  private hoverTimer = 0;
  private lastScroll = { y: 0, t: 0 };
  private typed = "";
  private stopped = false;

  constructor(private opts: PetOptions) {
    this.el = document.createElement("div");
    this.el.className = "suki-pet";
    this.canvas = document.createElement("canvas");
    this.canvas.className = "suki-pet__canvas";
    this.canvas.setAttribute("aria-hidden", "true");
    // 接點擊的是跟她站直時一樣大的區塊；畫布比她大一圈（擺盪用），那圈透明邊不擋網頁
    this.touch = document.createElement("div");
    this.touch.className = "suki-pet__hit";
    this.touch.setAttribute("role", "img");
    this.touch.setAttribute("aria-label", opts.label);
    this.bubble = document.createElement("div");
    this.bubble.className = "suki-pet__bubble";
    this.bubble.hidden = true;
    this.bubble.setAttribute("role", "status");
    this.menuEl = document.createElement("div");
    this.menuEl.className = "suki-pet__menu";
    this.menuEl.hidden = true;
    this.menuEl.setAttribute("role", "menu");
    // 量 safe-area 用：定位是 JS 算的，env() 只能透過一個看不見的元素讀成像素
    this.insetProbe = document.createElement("div");
    this.insetProbe.className = "suki-pet__inset";
    this.el.append(this.canvas, this.touch, this.bubble, this.menuEl, this.insetProbe);
    if (opts.mobile) {
      // 側邊頁籤：她從它後面探出來。蓋住邊距帶（曲面屏點不到的那段），自己不靠它點；平面屏點到了就當點她
      this.tab = document.createElement("div");
      this.tab.className = "suki-pet__tab";
      this.tab.setAttribute("aria-hidden", "true");
      this.tab.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3 5 8l5 5"/></svg>';
      // 探出時的接觸區：透明、比她大一圈，手指落在她附近就算點到、拖到
      this.catcher = document.createElement("div");
      this.catcher.className = "suki-pet__catch";
      this.catcher.setAttribute("aria-hidden", "true");
    }
    // 泡泡開關的地方很多，統一從屬性看
    new MutationObserver(() => { petSpeaking.value = !this.bubble.hidden && !this.hidden; }).observe(this.bubble, { attributes: true, attributeFilter: ["hidden"] });
    if (opts.mobile) this.el.classList.add("suki-pet--mobile");
  }

  async start(parent: HTMLElement) {
    const { base, skin } = this.opts;
    const skeleton: PetSkeleton & { regions?: string[] } = await (await fetch(`${base}/skeleton.json`)).json();
    this.skeleton = skeleton;
    this.skin = skin;
    this.rig = new Rig(compose(skeleton, await (await fetch(`${base}/skin-${skin}.json`)).json() as PetSkin));
    const [W, H] = this.rig.model.size;
    const cssH = this.opts.height, cssW = (cssH * W) / H;
    const dpr = Math.min(2, devicePixelRatio || 1);
    // 四周多留：左右各 40%、上下各 12%（被拎起來最多傾斜約 26 度、跳起來 70px）
    const pad: [number, number] = [W * 0.4, H * 0.12];
    const k = cssH / H;
    this.canvas.width = Math.round((W + pad[0] * 2) * k * dpr); this.canvas.height = Math.round((H + pad[1] * 2) * k * dpr);
    Object.assign(this.canvas.style, { width: `${(W + pad[0] * 2) * k}px`, height: `${(H + pad[1] * 2) * k}px`, left: `${-pad[0] * k}px`, top: `${-pad[1] * k}px` });
    Object.assign(this.touch.style, { width: `${cssW}px`, height: `${cssH}px` });
    this.el.style.setProperty("--pw", `${cssW}px`);
    this.el.style.setProperty("--ph", `${cssH}px`);
    this.view = new PetRenderer(this.canvas, this.rig, pad);
    // 貼圖縮到畫面上的 1.5 倍（含螢幕密度）就夠清楚，再大只會讓 GPU 縮出鋸齒
    this.texScale = Math.min(1, k * dpr * 1.5);
    await this.view.load(base, this.texScale);
    this.driver = new Driver(this.rig);
    await this.loadHit(`${base}/hit-${skin}.png`, skeleton.regions ?? []);
    parent.append(this.el);
    if (this.tab) parent.append(this.tab);
    if (this.catcher) parent.append(this.catcher);
    this.bind();
    // 先在定位好的地方隱形放好（不走位移動畫），再從那裡彈出來，不會從左上角飛過去
    this.el.classList.add("suki-pet--placing");
    const saved = this.restore();
    if (saved) this.place(saved);
    // 手機讀回「探出」時 restore 已經放好了；沒存過：手機靠在右側探出，桌機站在右下角
    else if (this.opts.mobile) { if (!this.tucked) { const d = defaultPeek(this.viewport(), this.size()); this.peekAt(d.side, d.pos); } }
    else this.place({ x: innerWidth - cssW - 24, y: innerHeight - cssH - 8 });
    void this.el.offsetWidth;
    requestAnimationFrame(() => { this.el.classList.remove("suki-pet--placing"); this.el.classList.add("suki-pet--pop"); });
    // 這一頁不說話：招呼與每日口味都留到下一頁（每日那句沒說就不算說過）
    const quiet = this.opts.quietGreeting?.() ?? false;
    if (!this.tucked && !quiet) this.greet();
    if (!quiet) this.daily();
    void this.opts.careVisit?.().then((got) => {
      if (!got) return;
      this.level = got.level;
      this.status = got.state;
      this.careNews(got.news);
      if (got.level >= 2 && !got.recall && this.opts.enableRecall && this.onceEver("askRecall")) {
        setTimeout(() => this.act({ expr: "shy", say: this.line("askRecall"), ms: 9000, action: { label: this.line("askRecallYes"), run: () => void this.opts.enableRecall!() } }), 9000);
      }
    }, () => undefined);
    let last = performance.now();
    const loop = (now: number) => {
      if (this.stopped) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (!document.hidden) this.frame(dt, now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() { this.stopped = true; this.el.remove(); this.tab?.remove(); this.catcher?.remove(); petSpeaking.value = false; }

  /** 換頁時網站把這頁的用途交給她：第一次到這頁說一句，之後只在選單裡 */
  setGuide(g: PageGuide | null) {
    this.guide = g;
    this.closeMenu();
    if (!g || this.tucked || !this.ready) return;
    // 主要按鈕剛好在她泡泡位置的那幾頁：介紹留在選單裡，不自己開口（美術總監最終 r2 M8）
    if (this.opts.quietGreeting?.()) return;
    const todo = g.todo?.();
    if (todo && this.onceToday(`todo.${g.id}`)) return this.act({ say: todo, expr: "wink", ms: 3600 });
    if (g.hello && this.onceEver(`hello.${g.id}`)) this.act({ say: g.hello, expr: "happy", ms: 3600 });
  }
  private get ready() { return !!this.rig; }

  private openMenu() {
    this.touchedAt = performance.now();
    const items: MenuItem[] = [...(this.opts.menu?.() ?? [])];
    // 拓麻歌子那幾顆按鈕：看她的狀態、陪她玩、哄她睡
    if (this.status) items.push({ label: this.line("menu.status"), run: () => this.showStatus() });
    items.push({ label: this.line("menu.dice"), run: () => this.diceGame() });
    const h = new Date().getHours();
    if (h >= 21 || h < 6) items.push({ label: this.line("menu.sleep"), run: () => { this.act({ expr: "sleepy", say: this.line("act.goodnight") }, true); setTimeout(() => this.sleep(), 2600); } });
    for (const t of this.guide?.topics ?? []) items.push({ label: t.q, run: () => this.act({ say: t.a, talk: true, ms: 4200, action: t.action }, true) });
    items.push({ label: this.line("menu.tuck"), run: () => (this.opts.mobile ? this.tuckTo(sideOf(this.viewport(), this.size(), this.pos.x)) : this.tuck(this.box().left < innerWidth / 2 ? "left" : "right")) });
    if (this.opts.onOff) items.push({ label: this.opts.menuLabel?.() ?? "×", run: this.opts.onOff });
    this.menuEl.replaceChildren(...items.map((it) => {
      const b = document.createElement("button");
      b.type = "button"; b.setAttribute("role", "menuitem"); b.textContent = it.label;
      b.addEventListener("click", (e) => { e.stopPropagation(); this.closeMenu(); it.run(); });
      return b;
    }));
    this.bubble.hidden = true;
    this.menuEl.hidden = false;
    this.fitPopups();
    this.act({ expr: "happy" });
    clearTimeout(this.menuTimer);
    this.menuTimer = window.setTimeout(() => this.closeMenu(), 10_000);
    setTimeout(() => {
      document.addEventListener("pointerdown", this.outside, true);
      document.addEventListener("touchstart", this.outside, { capture: true, passive: true });
      document.addEventListener("keydown", this.escape, true);
    }, 0);
  }
  /** 點選單以外的任何地方（含她自己）都收起選單；點選單項目由項目自己收 */
  private outside = (e: Event) => {
    const t = e.target as Node;
    // 點選單項目由項目自己收；點她本人由她的按下處理（收起選單、不另外起反應）
    if (this.menuEl.contains(t) || this.touch.contains(t)) return;
    this.closeMenu();
  };
  private escape = (e: KeyboardEvent) => { if (e.key === "Escape") this.closeMenu(); };
  private menuTimer = 0;
  private closeMenu() {
    clearTimeout(this.menuTimer);
    document.removeEventListener("pointerdown", this.outside, true);
    document.removeEventListener("touchstart", this.outside, true);
    document.removeEventListener("keydown", this.escape, true);
    if (this.menuEl.hidden) return;
    this.menuEl.hidden = true;
    const next = this.queue.shift();
    if (next) setTimeout(() => this.act(next), 400);
  }

  /** 照顧的消息：餵飽了、餓了、升級、連續天數、好久不見；一次只講最重要的一件 */
  private careNews(news: SukiNews[]) {
    const pick = news.find((n) => n.kind === "levelUp") ?? news.find((n) => n.kind === "craved") ?? news.find((n) => n.kind === "streak") ?? news.find((n) => n.kind === "fed")
      ?? news.find((n) => n.kind === "missed") ?? news.find((n) => n.kind === "checkIn" && n.days > 1) ?? news.find((n) => n.kind === "hungry");
    if (!pick) return;
    const later = (a: Act) => setTimeout(() => this.act(a), this.tucked ? 0 : 3400);
    switch (pick.kind) {
      case "fed": return later({ expr: "happy", say: this.line("care.fed"), hop: true });
      case "craved": return later({ expr: "happy", say: this.line("care.craved"), hop: true, ms: 4000 });
      case "hungry": return later({ expr: "pout", say: this.line("care.hungry"), ms: 5000, action: this.opts.resume });
      case "levelUp": return later({ expr: "happy", say: this.line(`care.level.${pick.level}`) || this.line("care.levelUp"), hop: true, ms: 4500 });
      case "streak": return later({ expr: "wink", say: this.line("care.streak", { n: pick.days }), hop: true, ms: 4500 });
      case "checkIn": return later({ expr: "happy", say: this.line("care.checkIn", { n: pick.days }), hop: true, ms: 3600 });
      case "missed": return later({ expr: pick.days > 3 ? "shy" : "happy", say: this.line(pick.days > 3 ? "care.missedLong" : "care.missed"), ms: 4000 });
    }
  }

  private daily() {
    if (this.tucked) return;
    const tag = this.opts.dailyTag?.();
    if (!tag || !this.onceToday("daily")) return;
    setTimeout(() => { this.kick("Die", 500); this.act({ expr: "wink", say: this.line("daily", { tag: tag.label }), ms: 6000, action: { label: this.line("dailyGo"), run: tag.run } }); }, 4200);
  }
  private onceToday(key: string): boolean {
    const day = new Date().toDateString();
    try { if (localStorage.getItem(`suki.${key}`) === day) return false; localStorage.setItem(`suki.${key}`, day); } catch { /* 存不了：每次都算第一次 */ }
    return true;
  }
  private onceEver(key: string): boolean {
    try { if (localStorage.getItem(`suki.${key}`)) return false; localStorage.setItem(`suki.${key}`, "1"); } catch { /* 同上 */ }
    return true;
  }

  // ---- 網站事件 ----
  on(e: SukiEvent) {
    switch (e.type) {
      case "favorite": return this.act({ expr: "happy", say: this.line("favorite"), hop: true });
      case "searchEmpty": return this.act({ expr: "pout", say: this.line("searchEmpty") });
      case "searching": this.driver.state.look = [-0.6, -0.4]; this.lastInput = performance.now(); return;
      case "roll": this.kick("Die", 300); return this.act({ expr: "wink", say: this.line("roll") });
      case "notifications": if (e.count > 0) this.once("notifications", { expr: "surprised", say: this.line("notifications"), ms: 2600 }); return;
      case "update": return this.once("update", { expr: "happy", say: this.line("update"), ms: 4000 });
      case "listEnd": return this.once("listEnd", { expr: "wink", say: this.line("listEnd") });
      case "say": return this.act({ say: e.text, talk: true });
      case "summon": return this.summon();
      case "notice":
        if (e.mood === "party") this.kick("Die", 400);
        return this.act({ expr: e.mood === "party" ? "happy" : e.mood === "comfort" ? "shy" : "surprised", say: e.text, hop: e.mood === "party", ms: 5000, action: e.action });
      case "away": return this.hide(e.on, "page");
      case "cheer": return this.act({ expr: e.mood === "miss" ? "pout" : "happy", hop: e.mood === "win", ms: 2400 });
      case "daily": if (this.onceToday(`d.${e.key}`)) this.act({ expr: "wink", say: e.text, ms: 4500, action: e.action }); return;
      case "hint": if (!this.said.has(`hint:${e.text}`)) { this.said.add(`hint:${e.text}`); this.act({ expr: "wink", say: e.text, ms: 4500, action: e.action }); } return;
      case "adult": return this.act({ expr: e.on ? "wink" : "shy", say: this.line(e.on ? "adultOn" : "adultOff") });
      case "theme": return this.act({ expr: e.dark ? "sleepy" : "happy", say: this.line(e.dark ? "night" : "day") });
      case "locale": return this.act({ expr: "happy", say: this.line("hello"), hop: true });
    }
  }

  // ---- 反應 ----
  /** 一次說一句：前一句還在講，新的排隊；被點、被拖這種當下的反應插隊 */
  private queue: Act[] = [];
  private act(a: Act, urgent = false) {
    const now = performance.now();
    const busy = this.hidden || !this.menuEl.hidden || (!this.bubble.hidden && now < this.bubbleUntil - 400);
    if (a.say && !urgent && busy) { if (this.queue.length < 3) this.queue.push(a); return; }
    if (a.say && urgent) this.closeMenu();
    if (urgent) this.queue = [];
    if (a.expr) { for (const k of EXPRS) this.exprTarget[k] = 0; this.exprTarget[a.expr] = 1; }
    this.actUntil = now + (a.ms ?? 1800);
    if (a.say) this.speak(a.say, a.ms, a.action);
    if (a.hop) this.hop();
    if (a.talk || a.say) { this.driver.state.talking = true; setTimeout(() => { this.driver.state.talking = false; }, Math.min(1600, (a.say?.length ?? 6) * 90)); }
  }
  /** 同一件事每個人只主動說一次（這一頁的這次造訪） */
  private once(key: string, a: Act) { if (this.said.has(key)) return; this.said.add(key); this.act(a); }
  private skeleton!: PetSkeleton & { regions?: string[] };
  private skin = "";
  private texScale = 1;
  private swapping: Promise<void> | null = null;
  /**
   * 換衣服（深色主題換睡衣、18+ 疊小惡魔）：同一副骨架換一套部件。新貼圖先載好，
   * 再「噗」一下換上，參數（她正在看哪裡、頭髮擺到哪）照接，動作不中斷。
   */
  async setSkin(name: string) {
    if (!this.rig || name === this.skin) return;
    const run = async () => {
      const base = this.opts.base;
      const skin = await (await fetch(`${base}/skin-${name}.json`)).json() as PetSkin;
      const rig = new Rig(compose(this.skeleton, skin));
      await this.view.load(base, this.texScale, rig.model.parts);
      await this.loadHit(`${base}/hit-${name}.png`, this.skeleton.regions ?? []);
      Object.assign(rig.params, this.rig.params);
      this.el.classList.remove("suki-pet--poof"); void this.el.offsetWidth; this.el.classList.add("suki-pet--poof");
      await new Promise((r) => setTimeout(r, 140));
      this.rig = rig;
      this.view.swap(rig);
      this.driver = new Driver(rig);
      this.skin = name;
    };
    this.swapping = (this.swapping ?? Promise.resolve()).then(run, run).catch(() => undefined);
    return this.swapping;
  }

  /** 網站直接要她說一句（例如選單動作找不到東西時） */
  say(text: string) { if (text) this.act({ say: text, talk: true }, true); }
  private speak(text: string, ms = 2600, action?: MenuItem) {
    this.bubble.textContent = text;
    if (action) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "suki-pet__go"; b.textContent = action.label;
      b.addEventListener("click", (e) => { e.stopPropagation(); this.bubble.hidden = true; action.run(); });
      this.bubble.append(b);
      ms = Math.max(ms, 6000);
    }
    this.bubble.hidden = false;
    this.fitPopups();
    this.bubble.classList.remove("suki-pet__bubble--in"); void this.bubble.offsetWidth; this.bubble.classList.add("suki-pet__bubble--in");
    // 沒人理她的話，最長十秒就收起來
    this.bubbleUntil = performance.now() + Math.min(10_000, Math.max(ms, 1400 + text.length * 70));
  }
  private line(key: string, params?: Record<string, string | number>): string { return this.opts.line(key, params); }

  private hop() { if (!this.opts.reducedMotion) this.jumpT = 0; }
  private kick(param: string, v: number) { this.rig.kick(param, v); }

  private greet() {
    const h = new Date().getHours();
    if (h >= 2 && h < 5 && this.onceToday("late")) return this.act({ expr: "sleepy", say: this.line("bedtime"), ms: 4000 });
    const nick = this.level >= 2 ? this.opts.nickname?.() : null;
    const base = this.line(h < 5 ? "greet.late" : h < 11 ? "greet.morning" : h < 18 ? "greet.day" : "greet.night");
    this.act({ expr: "happy", say: nick ? this.line("greet.nick", { name: nick }) + base : base, hop: true, ms: 3200 });
  }

  // ---- 每一格 ----
  private frame(dt: number, now: number) {
    const p = this.rig.params;
    // 表情淡入淡出；演完回到平常
    const idle = (now - this.lastInput) / 1000, acting = now <= this.actUntil;
    this.exprTarget = exprTargets(this.exprTarget, { sleeping: this.sleeping, acting, idle });
    if (this.opts.mobile) {
      this.mobileFrame(dt, now);
      // 探出時是偷看的表情
      if (this.peekS < 0.5 && !acting && !this.sleeping) this.exprTarget.peek = 1;
    }
    if (idle > 40 && idle < 41 && !acting && !this.sleeping) this.speak(this.line("sleepy"), 3000);
    for (const k of EXPRS) {
      const cur = this.expr[k] ?? 0, tgt = this.exprTarget[k] ?? 0;
      this.expr[k] = cur + (tgt - cur) * (1 - Math.exp(-dt * 14));
      p[`Expr_${k}`] = this.expr[k]!;
    }
    // 跳一下：上升、落地壓扁、回彈
    if (this.jumpT >= 0) {
      this.jumpT += dt;
      const t = this.jumpT;
      if (t < 0.32) { p.Jump = -Math.sin((t / 0.32) * Math.PI) * 70; p.Squash = 0; }
      else if (t < 0.5) { p.Jump = 0; p.Squash = -Math.sin(((t - 0.32) / 0.18) * Math.PI) * 0.08; }
      else { p.Jump = 0; p.Squash = 0; this.jumpT = -1; }
      if (t < 0.02) { this.kick("Ponytail", -120); this.kick("Skirt", 40); }
    }
    // 拎著：整個人照拖的速度往反方向傾（像被拎著的布偶），手停下來速度就慢慢歸零；放開後盪回來
    // 走路：一跳一跳往目標挪，身體往走的方向傾、看著前面
    if (this.walk) {
      const w = this.walk;
      w.t += dt / 0.34;
      const hop = Math.min(w.hops, w.t), k = hop / w.hops;
      const x = w.from + (w.to - w.from) * k;
      this.place({ x, y: this.pos.y });
      p.Jump = -Math.abs(Math.sin(Math.PI * (w.t % 1))) * 10;
      // 左右腳交替：抬起的那條腿往前、膝蓋彎；手跟腳反方向擺
      const ph = Math.sin(Math.PI * w.t);
      // Q 版蹦跳走：腿只微微擺，不彎膝（彎膝會在襪套、裙下露出接縫）
      p.LegR = ph * 3; p.LegL = ph * 3;
      p.ArmR = -ph * 6; p.ArmL = -ph * 6;
      p.Squash = w.t % 1 > 0.85 ? -0.04 : 0;
      this.driver.state.look = [Math.sign(w.to - w.from) * 0.8, 0.1];
      p.Dangle = 0;
      if (w.t >= w.hops) { this.walk = null; p.Jump = 0; p.Squash = 0; p.LegR = 0; p.LegL = 0; this.driver.state.look = null; this.el.classList.remove("suki-pet--walking"); this.save(this.pos); }
    }
    // 揮手：右手舉起來晃一晃
    if (this.waveT >= 0) {
      this.waveT += dt;
      const up = Math.min(1, this.waveT / 0.25) * Math.min(1, Math.max(0, (1.6 - this.waveT) / 0.25));
      // 小幅擺手：整隻手從肩膀輕輕擺，不舉高（舉高要換揮手的手臂組）
      p.ArmR = (Math.sin(this.waveT * 12) * 10 + 4) * up;
      if (this.waveT > 1.6) { this.waveT = -1; p.ArmR = 0; }
    }
    this.playActivity(dt);
    if (this.sleeping && now > this.zzzAt) { this.zzzAt = now + 9000; this.speak("Zzz…", 2400); }
    this.brain(now);
    if (this.drag && now - this.drag.t > 60) this.drag.vx *= Math.exp(-dt * 8);
    const target = this.drag?.moved ? Math.max(-26, Math.min(26, -this.drag.vx * 0.02)) : 0;
    this.dangleV += ((target - this.dangle) * 60 - this.dangleV * (this.drag ? 9 : 4)) * dt;
    this.dangle += this.dangleV * dt;
    const arm = this.waveT >= 0 ? p.ArmR : null;
    p.Dangle = this.dangle;
    this.driver.update(dt);
    p.Dangle = this.dangle;
    if (arm !== null) p.ArmR = arm;
    // 拿望遠鏡時頭不轉：鏡筒畫在眼睛前面、掛在身體上，頭一轉就對不上；改成整個上身慢慢掃
    if (this.activity?.set === "scope") { p.AngleX = 0; p.AngleY = 0; p.AngleZ = 0; p.EyeX = 0; p.EyeY = 0; p.BodyZ = Math.sin(this.activity.t * 0.9) * 3; }
    // 探出：身體與頭往頁面這邊歪（左側整張畫布翻面，歪的方向跟著翻）
    if (this.opts.mobile && this.peekS < 1) { const k = 1 - Math.max(0, this.peekS); p.BodyZ = (p.BodyZ ?? 0) + LEAN * k; p.AngleZ = (p.AngleZ ?? 0) + LEAN * 0.6 * k; }
    for (const k in SukiPet.LIMITS) if (p[k] !== undefined) p[k] = Math.max(SukiPet.LIMITS[k][0], Math.min(SukiPet.LIMITS[k][1], p[k]));
    // 小惡魔：右手與手肘只往外（滑肩的衣服在右手後面沒補畫，往內會露出一條黑縫）。
    // 尾巴梗藏在右手後面、沒畫的那種（尾巴掛在右手上）也不擺，不然梗會斷；整條補畫好的尾巴掛在身體上，照物理擺
    if (this.skin.includes("imp")) {
      if (p.ArmR !== undefined) p.ArmR = Math.max(0, p.ArmR);
      if (p.ElbowR !== undefined) p.ElbowR = Math.max(0, p.ElbowR);
      if (p.Tail !== undefined && this.rig.model.parts.find((q) => q.id === "tail")?.node === "armR") p.Tail = 0;
    }
    // 睡著（骨架版）：閉眼、頭垂向一邊、呼吸變慢
    if (this.sleeping) { p.EyeOpen = 0; p.AngleY = 0.9; p.AngleX = 0; p.EyeX = 0; p.EyeY = 0.6; p.AngleZ = 7 + Math.sin(now / 1400) * 1.5; p.Breath = (Math.sin(now / 900) + 1) / 2; }
    if (this.opts.reducedMotion) { p.Ponytail = 0; p.HairFront = 0; p.HairBack = 0; p.Skirt = 0; p.Die = 0; p.Dangle = 0; }
    if (!this.hidden) this.view.draw();
    if (!this.bubble.hidden && now > this.bubbleUntil) { this.bubble.hidden = true; const next = this.queue.shift(); if (next) this.act(next); }
  }

  // ---- 自主行動（瑞星小獅子、Office 迴紋針、拓麻歌子：她自己會走、會換姿勢、會自己玩） ----
  /** 最後一次有人跟她互動（點、拖、開選單）；太近就不自己亂跑 */
  private touchedAt = performance.now();
  private nextMove = performance.now() + 9000;
  private walk: { from: number; to: number; t: number; hops: number } | null = null;
  private waveT = -1;
  private sleeping = false;
  private zzzAt = 0;

  /**
   * 骨架能動的範圍（度）：只能在原畫撐得住的幅度內動。轉超過，袖口切口、手形就會露餡（穿模）。
   * 大動作（捧書、喝可可、揮手、伸懶腰）要換那個姿勢專門畫的手臂組，不是把同一雙手硬轉過去。
   */
  private static LIMITS: Record<string, [number, number]> = {
    // 手只往外擺（露出的是補畫過的身側）；往內轉會露出手臂後面沒畫的東西（尾巴、衣服），最多 3 度
    ArmR: [-3, 12], ArmL: [-12, 3], ElbowR: [-15, 15], ElbowL: [-15, 15], WristR: [-15, 15], WristL: [-15, 15],
    LegR: [-8, 8], LegL: [-8, 8], KneeR: [-10, 10], KneeL: [-10, 10],
  };

  /**
   * 姿勢組（Live2D 的腕差分）：拿書、捧可可、舉手揮、叉腰、望遠鏡，各是那個姿勢整個人一起畫的一張圖，
   * 切出「上半身＋手臂」整塊換上——肩膀用同一張圖畫的，才接得上（只畫手臂的話肩膀對不準）。
   * 頭、頭髮、裙子、腿照舊由骨架帶。換上時新的上半身先在原圖上淡入，蓋滿了才收掉原本的手；
   * 收回時反過來，中間不會有兩層半透明疊在一起。上半身整塊不能單獨移動（會跟脖子、裙子錯開），
   * 小動作改用視線與表情。只用目前這套造型有畫的。
   * 坐下（sit）與抱膝打瞌睡（doze）換的是脖子以下整個身體；坐下時整個人往下沉兩張圖腳底的高度差，
   * 跟淡入同時發生（寫在各造型自己的 root 節點上：Set_sit 每 1 沉多少，每套造型各量各的）。
   */
  private static SETS = ["book", "mug", "wave", "hips", "scope", "sit", "doze"] as const;
  private activity: { set: (typeof SukiPet.SETS)[number]; t: number; until: number } | null = null;
  private setW: Record<string, number> = {};
  private hasSet(name: string) { return this.rig.model.parts.some((p) => p.id === `set-${name}`); }
  private startActivity(set: (typeof SukiPet.SETS)[number], seconds: number) {
    if (!this.hasSet(set)) return false;
    this.activity = { set, t: 0, until: seconds };
    return true;
  }
  private playActivity(dt: number) {
    const p = this.rig.params, a = this.activity;
    // 打瞌睡只在睡著時；其他的睡著就收
    const fits = a && (a.set === "doze" ? this.sleeping : !this.sleeping);
    if (a && (!fits || this.drag || this.walk || this.hidden || this.tucked || !this.menuEl.hidden || a.t > a.until || !this.hasSet(a.set))) this.activity = null;
    const cur = this.activity;
    for (const k of SukiPet.SETS) {
      const w = this.setW[k] ?? 0, tgt = cur?.set === k || (k === "wave" && this.peekWaving) ? 1 : 0;
      this.setW[k] = tgt > w ? Math.min(tgt, w + dt / 0.12) : Math.max(tgt, w - dt / 0.12);
      p[`Set_${k}`] = this.setW[k]!;
    }
    // 換上的上半身完全蓋住了才收掉原本的手；睡衣那套連胸前的長髮下段與蝴蝶結一起換成同一張圖畫的
    p.HideArms = SukiPet.SETS.some((k) => this.setW[k]! >= 1) ? 1 : 0;
    p.HideLocks = p.HideArms;
    p.HideBody = this.setW.sit! >= 1 || this.setW.doze! >= 1 ? 1 : 0;
    // 演完或被打斷：視線還給滑鼠
    if (!cur) { if (this.activityLook) { this.activityLook = false; this.driver.state.look = null; } return; }
    cur.t += dt;
    const t = cur.t;
    if (cur.set === "book") { this.driver.state.look = [0.1, 0.7]; this.activityLook = true; }
    if (cur.set === "mug") {
      // 每三秒多喝一口：低頭、瞇眼
      if (t % 3.2 < 0.9) this.act({ expr: "happy", ms: 120 });
      this.driver.state.look = [0, t % 3.2 < 0.9 ? 0.5 : 0.2]; this.activityLook = true;
    }
  }
  private activityLook = false;

  private brain(now: number) {
    const quiet = !this.drag && !this.tucked && !this.hidden && this.menuEl.hidden && this.bubble.hidden && this.jumpT < 0;
    if (!quiet || this.sleeping || this.walk || this.activity || now < this.nextMove || now - this.touchedAt < 12_000) return;
    this.nextMove = now + 9000 + Math.random() * 12_000;
    // 睡覺：整頁太久沒人動就睡著（白天約四分鐘，深夜一分鐘）
    const h = new Date().getHours();
    if (now - Math.max(this.lastInput, this.touchedAt) > ((h >= 23 || h < 5) ? 60_000 : 240_000)) return this.sleep();
    // 自己玩：走一段、揮手、看書、喝可可、拿望遠鏡偷看、叉腰；這套造型沒畫那副手臂就退回小幅擺手
    const r = Math.random();
    if (r < 0.35 && !this.opts.reducedMotion) return this.wander();
    if (r < 0.5) { if (!this.startActivity("wave", 1.8)) this.waveT = 0; return; }
    if (r < 0.8) {
      const pick = (["book", "mug", "scope", "hips"] as const)[Math.floor(Math.random() * 4)];
      const sec = { book: 9, mug: 7, scope: 5, hips: 2.5 }[pick];
      if (this.startActivity(pick, sec)) {
        const say = { book: "act.read", mug: "act.cocoa", scope: "act.telescope", hips: "act.proud" }[pick];
        if (Math.random() < 0.5) this.act({ expr: pick === "hips" ? "happy" : undefined, say: this.line(say), ms: 3000 });
        return;
      }
    }
    // 坐下來歇一會兒
    if (r < 0.9 && this.startActivity("sit", 20 + Math.random() * 15)) return;
    // 東張西望
    this.driver.state.look = [-0.9, -0.2];
    setTimeout(() => { if (!this.drag) this.driver.state.look = [0.9, -0.1]; }, 1400);
    setTimeout(() => { if (!this.drag) this.driver.state.look = null; }, 2800);
  }

  /** 沿著原本的高度往左或右蹦蹦跳跳走一段（電腦走遠一點，手機走一小段） */
  private wander() {
    const b = this.box();
    const span = this.opts.mobile ? 70 : 260;
    const r = this.opts.mobile ? standRange(this.viewport(), this.size()) : null;
    const min = r ? r.minX : 8, max = r ? r.maxX : innerWidth - b.width - 8;
    let to = b.left + (Math.random() < 0.5 ? -1 : 1) * (span * (0.4 + Math.random() * 0.6));
    if (to < min || to > max) to = b.left - (to - b.left);
    to = Math.max(min, Math.min(max, to));
    if (Math.abs(to - b.left) < 30) return;
    this.walk = { from: b.left, to, t: 0, hops: Math.max(2, Math.round(Math.abs(to - b.left) / 34)) };
    this.el.classList.add("suki-pet--walking");
  }

  /** 她的狀態（拓麻歌子的那一頁）：飽足、好感等級、陪了幾天，用愛心畫 */
  private showStatus() {
    const s = this.status;
    if (!s) return;
    const hearts = (v: number) => "♥".repeat(Math.round(v * 5)) + "♡".repeat(5 - Math.round(v * 5));
    this.act({ expr: "happy", ms: 6000, say: this.line("status", { full: hearts(s.fullness), level: this.level, days: s.streak }) }, true);
  }
  /** 跟她比骰子：各擲一顆，大的贏；一天玩幾次都行，她輸了會鼓臉 */
  private diceGame() {
    this.kick("Die", 500);
    this.act({ expr: "wink", say: this.line("dice.rolling") }, true);
    setTimeout(() => {
      const you = 1 + Math.floor(Math.random() * 6), her = 1 + Math.floor(Math.random() * 6);
      const key = you > her ? "dice.youWin" : you < her ? "dice.herWin" : "dice.tie";
      this.act({ expr: you > her ? "pout" : you < her ? "happy" : "surprised", hop: you < her, ms: 6000, say: this.line(key, { you, her }),
        action: { label: this.line("dice.again"), run: () => this.diceGame() } }, true);
    }, 1100);
  }

  private sleepStart = 0;
  private stirs: number[] = [];

  /** 睡著（骨架）：閉眼、頭垂向一邊、慢慢呼吸、偶爾冒 Zzz */
  sleep() {
    this.closeMenu();
    this.sleeping = true;
    this.sleepStart = performance.now();
    this.zzzAt = performance.now() + 2500;
    // 抱著膝蓋坐著睡（這套造型有畫的話）；醒來、被拎起來就站起來
    this.startActivity("doze", Infinity);
  }
  /**
   * 醒來。gentle：你回來動了動頁面，她揉揉眼睛、撒嬌；poked：被戳醒、被拎起來，抱怨或耍賴。
   */
  private wake(how: "gentle" | "poked") {
    if (!this.sleeping) return;
    this.sleeping = false;
    this.exprTarget = {};
    this.act({ expr: how === "poked" ? "pout" : "happy", say: this.line(`wake.${how}`), hop: how === "poked" }, true);
  }
  /** 睡著時頁面被捲動：翻個身、頭髮晃一下，不醒；兩秒內一直捲才醒 */
  private stir() {
    const now = performance.now();
    this.stirs = [...this.stirs.filter((t) => now - t < 2000), now];
    this.kick("Ponytail", 40); this.kick("HairBack", 20);
    if (this.stirs.length >= 5) this.wake("gentle");
  }

  // ---- 輸入 ----
  private bind() {
    const head = () => {
      const r = this.touch.getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height * 0.22] as const;
    };
    addEventListener("pointermove", (e) => {
      this.lastInput = performance.now();
      // 睡著時你回來動了滑鼠：她慢慢醒來（剛睡著的前幾秒不算，免得一睡就醒）
      if (this.sleeping && performance.now() - this.sleepStart > 3000) this.wake("gentle");
      if (this.drag) return this.dragMove(e);
      const [hx, hy] = head();
      const dx = (e.clientX - hx) / 300, dy = (e.clientY - hy) / 300;
      this.driver.state.look = [Math.max(-1, Math.min(1, dx)), Math.max(-1, Math.min(1, dy))];
    }, { passive: true });
    document.addEventListener("pointerleave", () => { this.driver.state.look = null; });
    addEventListener("scroll", () => {
      const now = performance.now(), y = scrollY;
      const v = (y - this.lastScroll.y) / Math.max(16, now - this.lastScroll.t);
      this.lastScroll = { y, t: now };
      if (this.sleeping) this.stir();
      else if (Math.abs(v) > 2) { this.kick("Ponytail", v * 10); this.kick("HairFront", v * 3); this.kick("Skirt", v * 4); }
      if (innerHeight + y >= document.documentElement.scrollHeight - 4) this.on({ type: "listEnd" });
      this.lastInput = now;
    }, { passive: true });
    addEventListener("keydown", (e) => {
      this.lastInput = performance.now();
      this.typed = (this.typed + e.key).slice(-4).toLowerCase();
      if (this.sleeping) this.wake("gentle");
      if (this.typed === "suki") this.act({ expr: "happy", say: this.line("suki"), hop: true, ms: 3000 });
    });
    // 分頁擺著好幾個鐘頭再回來：重新記一次來訪（不然她以為你沒來，會寄召回給正在網站上的人）
    let hiddenAt = 0;
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { hiddenAt = Date.now(); return; }
      if (hiddenAt && Date.now() - hiddenAt > 3_600_000) void this.opts.careVisit?.().then((got) => { if (got) { this.level = got.level; this.careNews(got.news); } }, () => undefined);
      if (performance.now() - this.lastInput > 60_000) this.act({ expr: "happy", say: this.line("welcomeBack") });
      // 手機：回到這頁才開始算閒置，不然一回來說完歡迎就縮回去
      if (this.opts.mobile) this.lastInput = performance.now();
    });
    addEventListener("offline", () => this.act({ expr: "pout", say: this.line("offline"), ms: 4000 }));
    // hover 提示：游標停在 data-suki 的東西上 0.7 秒，她說一句；同一種提示只說一次
    document.addEventListener("pointerover", (e) => {
      const t = (e.target as HTMLElement | null)?.closest?.("[data-suki]") as HTMLElement | null;
      clearTimeout(this.hoverTimer);
      if (!t || this.drag) return;
      this.hoverTimer = window.setTimeout(() => {
        const key = t.dataset.suki!;
        const text = t.dataset.sukiText || this.line(`hint.${key}`);
        if (!text || this.said.has(`hint.${key}${t.dataset.sukiText ? ":" + text : ""}`)) return;
        this.said.add(`hint.${key}${t.dataset.sukiText ? ":" + text : ""}`);
        this.act({ say: text, expr: key === "adult" ? "wink" : undefined, ms: 3000 });
      }, 700);
    });
    // 欄位說明：聚焦到 data-suki-help 的欄位時講那個欄位填什麼（手機沒有 hover 也能用）
    document.addEventListener("focusin", (e) => {
      const t = e.target as HTMLElement;
      const help = (t.closest?.("[data-suki-help]") as HTMLElement | null)?.dataset.sukiHelp;
      if (help && !this.said.has(`help:${help}`)) { this.said.add(`help:${help}`); this.act({ say: help, ms: 4200 }); }
      if (t.matches?.("input,textarea")) { this.on({ type: "searching" }); if (this.opts.mobile) this.hide(true, "typing"); }
    });
    document.addEventListener("focusout", () => { if (this.opts.mobile) this.hide(false, "typing"); });
    if (this.opts.mobile) this.bindMobile();
    addEventListener("suki", (e) => this.on((e as CustomEvent<SukiEvent>).detail));

    this.touch.addEventListener("pointerdown", this.down);
    this.tab?.addEventListener("pointerdown", this.down);
    this.catcher?.addEventListener("pointerdown", this.down);
    // 選單開著時點到頁籤或接觸區只是收起選單：那一下的 pointerup 落在它們身上，不在她身上，記號要在這裡清
    for (const t of [this.tab, this.catcher]) t?.addEventListener("pointerup", () => { this.dismissTap = false; });
    this.touch.addEventListener("contextmenu", (e) => { e.preventDefault(); if (!this.pressed) this.openMenu(); });
    // 系統接手手勢（長按選單、捲動、手機邊緣的返回）時會送 pointercancel：當作放手，不然她以為還被拎著
    this.touch.addEventListener("pointercancel", (e) => {
      clearTimeout(this.pressTimer);
      const d = this.drag, held = d?.moved;
      this.drag = undefined;
      this.pressed = false;
      // 手機：拉到一半、沿邊拖到一半被系統搶走，就地吸附
      if (this.opts.mobile && d?.moved) return this.drop(e, d);
      this.el.classList.remove("suki-pet--held");
      if (held) this.act({ expr: "happy", say: this.line("land") }, true);
    });
    this.touch.addEventListener("pointerup", (e) => {
      clearTimeout(this.pressTimer);
      if (this.dismissTap) { this.dismissTap = false; return; }
      if (this.pressed) { this.pressed = false; this.drag = undefined; return; }
      const d = this.drag; this.drag = undefined;
      if (!d) return;
      if (d.moved) return this.drop(e, d);
      this.poke(e);
    });
    this.touch.addEventListener("dblclick", (e) => { e.preventDefault(); this.act({ expr: "happy", hop: true, say: this.line("jump") }, true); });
    // 游標停在她身上太久：害羞
    let rest = 0;
    this.touch.addEventListener("pointermove", () => { clearTimeout(rest); rest = window.setTimeout(() => this.act({ expr: "shy", say: this.line("stare"), ms: 2400 }), 3500); });
    this.touch.addEventListener("pointerleave", () => clearTimeout(rest));
  }

  private down = (e: PointerEvent) => {
    // 右鍵交給 contextmenu 開選單，不算抓她
    if (e.button !== 0) return;
    // 選單開著時點她：只是收起選單
    if (!this.menuEl.hidden) { e.preventDefault(); this.closeMenu(); this.dismissTap = true; return; }
    // 點在透明處：不攔。手機探出時：離螢幕邊那一段（接觸區）整塊接，其餘只接她畫出來的不透明處（owner 2026-10-23）。
    // 輪廓裁好之後透明處的點擊根本到不了這裡（落到底下的網頁）；還沒裁好的那一下，照畫面的像素判斷
    if (this.opts.mobile && this.tucked) { if (!this.clipped && e.currentTarget !== this.tab && !this.inCatch(e) && !this.opaqueAt(e)) return; }
    else if (this.region(e) === null && !this.sleeping) return;
    this.touchedAt = performance.now();
    if (this.walk) { this.walk = null; this.rig.params.Jump = 0; this.el.classList.remove("suki-pet--walking"); }
    // 拉出、縮回到一半又被按住（連點兩下）：直接跳到那一段的終點，再從那裡接著算
    if (this.slide) this.finishSlide();
    e.preventDefault();
    try { this.touch.setPointerCapture(e.pointerId); } catch { /* 拿不到也照常拖 */ }
    const r = this.box();
    this.drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY, vx: 0, t: performance.now(), moved: false, shake: 0, s0: this.peekS, y0: this.pos.y };
    // 長按 450ms 開選單（手機的主要入口；電腦也能用）
    clearTimeout(this.pressTimer);
    this.pressTimer = window.setTimeout(() => { if (this.drag && !this.drag.moved) { this.pressed = true; this.buzz(15); this.openMenu(); } }, 450);
  };
  private pressTimer = 0;
  private dismissTap = false;
  private pressed = false;
  private buzz(ms: number) { try { navigator.vibrate?.(ms); } catch { /* 不支援就算了 */ } }

  /** 手機：捲動時收起選單、鍵盤打開時讓路；Android 跟手機傾斜看、搖手機會暈 */
  private bindMobile() {
    let lastY = scrollY;
    addEventListener("scroll", () => {
      const y = scrollY;
      if (Math.abs(y - lastY) > 24) { if (!this.menuEl.hidden) this.closeMenu(); lastY = y; }
    }, { passive: true });
    visualViewport?.addEventListener("resize", () => this.hide((visualViewport?.height ?? innerHeight) < innerHeight * 0.75, "keyboard"));
    addEventListener("resize", () => { this.insets = null; this.refit(); });
    // 手機點一下沒有 pointermove：也算有人在用（閒置縮回從最後一次觸控算）
    addEventListener("pointerdown", () => { this.lastInput = performance.now(); }, { capture: true, passive: true });
    // iOS 要使用者授權才給方向與動作感應：不要求，只在不需要授權的瀏覽器（Android）啟用
    const needsPermission = typeof (DeviceOrientationEvent as unknown as { requestPermission?: unknown }).requestPermission === "function";
    if (needsPermission) return;
    addEventListener("deviceorientation", (e) => {
      if (this.drag || e.gamma === null || e.beta === null) return;
      this.driver.state.look = [Math.max(-1, Math.min(1, e.gamma / 30)), Math.max(-1, Math.min(1, (e.beta - 45) / 40))];
    });
    let shakes = 0, shakeAt = 0;
    addEventListener("devicemotion", (e) => {
      const a = e.acceleration; if (!a || a.x === null) return;
      const m = Math.hypot(a.x ?? 0, a.y ?? 0, a.z ?? 0);
      const now = performance.now();
      if (m > 18) { shakes = now - shakeAt < 800 ? shakes + 1 : 1; shakeAt = now; this.kick("Ponytail", (a.x ?? 0) * 20); this.kick("Die", (a.x ?? 0) * 30); }
      if (shakes >= 4) { shakes = 0; this.buzz(30); this.act({ expr: "dizzy", say: this.line("shake"), ms: 2600 }); }
    });
  }
  /** 工作區這種滿版的頁面：她先收到最近的邊上，點一下再出來 */
  tuckAside() {
    if (this.tucked) return;
    if (this.opts.mobile) this.tuckTo(sideOf(this.viewport(), this.size(), this.pos.x), true);
    else this.tuck(this.pos.x + this.box().width / 2 < innerWidth / 2 ? "left" : "right", true);
  }
  /** 躲起來的原因各記各的（手機鍵盤打開、正在打字）：全部解除才出來 */
  private away = new Set<string>();
  private hide(on: boolean, reason: string) {
    if (on) this.away.add(reason); else this.away.delete(reason);
    on = this.away.size > 0;
    if (this.hidden === on) return;
    this.hidden = on;
    this.el.classList.toggle("suki-pet--away", on);
    this.tab?.classList.toggle("suki-pet__tab--away", on);
    this.layoutWall();
    if (on) { this.bubble.hidden = true; this.closeMenu(); }
    else { if (this.opts.mobile) this.refit(); const next = this.queue.shift(); if (next) setTimeout(() => this.act(next), 500); }
  }

  private dragMove(e: PointerEvent) {
    const d = this.drag!;
    const now = performance.now(), dt = Math.max(8, now - d.t);
    const vx = ((e.clientX - d.x) / dt) * 1000;
    const dist = Math.hypot(e.clientX - d.x, e.clientY - d.y);
    // 一動就不是長按了
    if (dist >= 3) clearTimeout(this.pressTimer);
    // 手機探出時：往內拉出來，或沿邊上下拖；不算拎起來
    if (this.opts.mobile && this.tucked) return this.peekDrag(e, d);
    if (!d.moved && dist < 6) return;
    if (!d.moved) { d.mode = "free"; clearTimeout(this.pressTimer); this.closeMenu(); if (this.sleeping) { this.sleeping = false; this.exprTarget = {}; } d.moved = true; this.act({ expr: "surprised", say: this.line("lift"), ms: 10_000 }, true); this.el.classList.add("suki-pet--held"); }
    // 甩：快速來回換方向才算，一路拖過去不算
    if (Math.sign(vx) !== Math.sign(d.vx) && Math.abs(vx) > 900 && Math.abs(d.vx) > 900) d.shake += 1;
    d.vx = vx; d.x = e.clientX; d.y = e.clientY; d.t = now;
    this.place({ x: e.clientX - d.dx, y: e.clientY - d.dy });
    // 手機：推到邊上，那一側的頁籤亮起來（放開就縮回去）
    if (this.opts.mobile) {
      const near = pushedIn(this.viewport(), this.size(), this.pos.x);
      if (near && near !== this.side) { this.side = near; this.layoutWall(); }
      this.tab?.classList.toggle("suki-pet__tab--near", !!near);
    }
  }

  private peekDrag(e: PointerEvent, d: Drag) {
    const dx = e.clientX - d.ox, dy = e.clientY - d.oy;
    if (!d.mode) {
      const m = pullMode(this.side, dx, dy);
      if (!m) return;
      d.mode = m; d.moved = true;
      // 長按開了選單之後才拉：一樣算拉，放開時要照拉的結果走
      clearTimeout(this.pressTimer); this.closeMenu(); this.pressed = false;
      this.el.classList.add("suki-pet--held");
    }
    const f = this.viewport(), s = this.size();
    if (d.mode === "pull") this.peekS = Math.max(0, Math.min(1, d.s0 + (this.side === "right" ? -dx : dx) / PULL_FULL));
    else this.pos.y = peekPos(f, s, this.side, d.y0 + dy).y;
    this.layoutPeek();
  }

  private drop(e: PointerEvent, d: Drag) {
    const shake = d.shake;
    this.el.classList.remove("suki-pet--held");
    const r = this.box();
    let pos: { x: number; y: number };
    if (this.opts.mobile) {
      // 探出時：拉過一半就站出來，沒過半縮回去；沿邊拖就留在那個高度
      if (d.mode === "pull") return this.peekS > 0.5 ? this.pullOut() : this.slideTo(0, 220, false, () => this.save(this.pos, true));
      if (d.mode === "slide") return this.save(this.pos, true);
      // 站著拖：推進邊上就縮回那一側；其他地方夾回邊距帶站著
      const f = this.viewport(), s = this.size();
      this.tab?.classList.remove("suki-pet__tab--near");
      const pushed = pushedIn(f, s, r.left);
      if (pushed) return this.tuckTo(pushed);
      pos = clampStand(f, s, { x: r.left, y: r.top });
      this.side = sideOf(f, s, pos.x);
    } else {
      // 拖到螢幕邊：縮進去，只露半個頭
      const edge = r.left < -r.width * 0.25 ? "left" : r.right > innerWidth + r.width * 0.25 ? "right" : null;
      if (edge) return this.tuck(edge);
      pos = { x: Math.max(0, Math.min(innerWidth - r.width, r.left)), y: Math.max(0, Math.min(innerHeight - r.height, r.top)) };
    }
    this.place(pos); this.save(pos);
    // 放在卡片上：讀出那張卡寫的原作與類型
    this.el.style.pointerEvents = "none";
    const under = (document.elementFromPoint(e.clientX, e.clientY + r.height * 0.4) as HTMLElement | null)?.closest?.("[data-suki-card]") as HTMLElement | null;
    this.el.style.pointerEvents = "";
    this.hop();
    if (shake >= 4) return this.act({ expr: "dizzy", say: this.line("dizzy"), ms: 2600 }, true);
    if (under) return this.act({ expr: "happy", say: under.dataset.sukiCard!, ms: 3600 }, true);
    this.act({ expr: "happy", say: this.line("land") }, true);
  }

  private tuck(edge: "left" | "right", silent = false) {
    this.tucked = true;
    const r = this.box();
    this.el.classList.add("suki-pet--tucked");
    this.el.classList.toggle("suki-pet--edge-right", edge === "right");
    this.place({ x: edge === "left" ? -r.width * 0.62 : innerWidth - r.width * 0.38, y: Math.max(0, Math.min(innerHeight - r.height, r.top)) });
    this.save({ x: edge === "left" ? -1 : innerWidth, y: Math.max(0, Math.min(innerHeight - r.height, r.top)) });
    if (!silent) this.act({ expr: "peek", say: this.line("tuck"), ms: 2600 }, true);
  }

  private poke(e: PointerEvent) {
    this.buzz(8);
    this.touchedAt = performance.now();
    if (this.sleeping) return this.wake("poked");
    if (this.tucked && this.opts.mobile) return this.pullOut();
    if (this.tucked) {
      this.tucked = false; this.el.classList.remove("suki-pet--tucked");
      const r = this.box();
      const pos = { x: Math.max(8, Math.min(innerWidth - r.width - 8, r.left)), y: r.top };
      this.place(pos); this.save(pos);
      this.act({ expr: "happy", say: this.line("untuck"), hop: true }, true);
      this.daily();
      if (this.guide) this.setGuide(this.guide);
      return;
    }
    // 正在看書、喝可可、偷看榜單時被戳：手放下來，被抓包
    if (this.activity && ["book", "mug", "scope"].includes(this.activity.set)) { this.activity = null; return this.act({ expr: "surprised", say: this.line("act.caught") }, true); }
    const now = performance.now();
    this.clicks = [...this.clicks.filter((t) => now - t < 2500), now];
    if (this.clicks.length >= 7) { this.clicks = []; return this.act({ expr: "pout", say: this.line("tooMany"), ms: 2600 }, true); }
    if (this.clicks.length === 5) return this.act({ expr: "dizzy", say: this.line("dizzy"), ms: 2200 }, true);
    const where = this.region(e);
    switch (where) {
      case "fronthair": case "backhair": this.kick("HairFront", 60);
        return this.act({ expr: "happy", say: this.line("pat") }, true);
      case "face": case "eyes": case "mouth":
        return this.act({ expr: "pout", say: this.line("cheek") }, true);
      case "ponytail": case "bow": this.kick("Ponytail", 260); this.rig.params.AngleZ = 10;
        return this.act({ expr: "pout", say: this.line("ponytail") }, true);
      case "die": this.kick("Die", 400);
        return this.act({ expr: "wink", say: this.line("roll") }, true);
      case "clip":
        return this.act({ expr: "wink", say: this.line("clip") }, true);
      default:
        this.kick("Skirt", 30);
        return this.act({ expr: "surprised", say: this.line("poke") }, true);
    }
  }

  private region(e: PointerEvent): string | null {
    if (!this.hit) return "body";
    const r = this.touch.getBoundingClientRect();
    // 坐著時整個人往下沉了：往上對回站姿的判定圖，戳頭還是算戳頭
    const root = this.rig.model.nodes.find((n) => n.id === "root");
    const down = Object.entries(root?.moveY ?? {}).reduce((v, [k, c]) => (k.startsWith("Set_") ? v + (this.rig.params[k] ?? 0) * c : v), 0);
    const sunk = (down / this.rig.model.size[1]) * this.hit.h;
    const x = Math.floor(((e.clientX - r.left) / r.width) * this.hit.w), y = Math.floor(((e.clientY - r.top) / r.height) * this.hit.h - sunk);
    if (x < 0 || y < 0 || x >= this.hit.w || y >= this.hit.h) return null;
    const v = this.hit.data[(y * this.hit.w + x) * 4];
    return v ? this.hit.names[v - 1] ?? "body" : null;
  }
  private async loadHit(url: string, names: string[]) {
    try {
      const img = new Image(); img.src = url; await img.decode();
      const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
      const g = c.getContext("2d")!; g.drawImage(img, 0, 0);
      this.hit = { data: g.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height, names };
    } catch { /* 沒有部位圖：整個人當身體 */ }
  }

  /** 她現在的位置與大小：自己記，不讀畫面（位移動畫進行中讀到的會是半路的座標） */
  private pos = { x: 0, y: 0 };
  private box() {
    const w = this.touch.clientWidth, h = this.touch.clientHeight;
    return { left: this.pos.x, top: this.pos.y, width: w, height: h, right: this.pos.x + w };
  }
  private place(p: { x: number; y: number }) {
    this.pos = { x: p.x, y: p.y };
    this.el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
    // 泡泡往畫面中間那一側展開，不會被螢幕邊緣切掉
    const w = this.touch.clientWidth || 0;
    this.el.classList.toggle("suki-pet--right", p.x + w / 2 > innerWidth / 2);
    this.layoutWall();
    this.fitPopups();
  }
  private save(p: { x: number; y: number }, peeking = false) {
    if (this.opts.mobile) {
      try { localStorage.setItem("suki.pet.pos", JSON.stringify(toSaved(this.viewport(), p, peeking ? this.side : null))); } catch { /* 存不了就算了 */ }
      return;
    }
    const x = p.x < 0 ? -1 : p.x >= innerWidth ? 2 : p.x / innerWidth;
    try { localStorage.setItem("suki.pet.pos", JSON.stringify({ x, y: p.y / innerHeight })); } catch { /* 存不了就算了 */ }
  }
  private restore(): { x: number; y: number } | null {
    try {
      const v = JSON.parse(localStorage.getItem("suki.pet.pos") ?? "null") as Saved | null;
      if (!v) return null;
      if (this.opts.mobile) {
        const got = fromSaved(this.viewport(), this.size(), v);
        if (!got.side) { this.side = sideOf(this.viewport(), this.size(), got.pos.x); return got.pos; }
        // 探出：照新格式存回去（舊版的貼邊收起、研發版的收在底邊就此改寫）
        this.peekAt(got.side, got.pos);
        this.save(got.pos, true);
        return null;
      }
      const r = { w: this.touch.clientWidth || 120, h: this.touch.clientHeight || 180 };
      if (v.x < 0 || v.x > 1) { setTimeout(() => this.tuck(v.x < 0 ? "left" : "right", true), 0); return { x: v.x < 0 ? 0 : innerWidth - r.w, y: v.y * innerHeight }; }
      // 手機存的「探出」：桌機沒有這個狀態，站回桌機的預設位置
      if (v.dock) return this.deskHome();
      return { x: v.x * innerWidth, y: v.y * innerHeight };
    } catch { return null; }
  }

  // ---- 手機的邊距帶（placement.ts）----
  private insetProbe: HTMLDivElement;
  /** 四邊 safe-area：只在轉向、視窗大小改變時重量（走路、拉出時每一格都要用） */
  private insets: Inset | null = null;
  private viewport(): Frame {
    if (!this.insets) {
      const cs = getComputedStyle(this.insetProbe);
      const px = (v: string) => parseFloat(v) || 0;
      this.insets = { top: px(cs.paddingTop), right: px(cs.paddingRight), bottom: px(cs.paddingBottom), left: px(cs.paddingLeft) };
    }
    return { w: innerWidth, h: innerHeight, inset: this.insets };
  }
  private size() { return { w: this.touch.clientWidth || 88, h: this.touch.clientHeight || 132 }; }
  /** 轉向、視窗大小改變、躲完出來：照現在的視窗重夾一次（不存，存的比例座標本來就跟視窗大小無關） */
  private refit() {
    if (this.drag || this.hidden || this.slide) return;
    const f = this.viewport(), s = this.size();
    if (this.tucked) return this.peekAt(this.side, peekPos(f, s, this.side, this.pos.y));
    const pos = clampStand(f, s, this.pos);
    if (pos.x !== this.pos.x || pos.y !== this.pos.y) this.place(pos);
  }

  // ---- 手機：靠在側邊探出（ui-v3.md）----
  private tab?: HTMLDivElement;
  private catcher?: HTMLDivElement;
  private side: Side = "right";
  /** 0＝探出、1＝站出來；拉出、縮回時在兩者之間 */
  private peekS = 1;
  /** 站著那一端的 x：推進邊上放開時是放開的地方，其他時候是那一側的邊距帶 */
  private standX: number | null = null;
  private slide: { from: number; to: number; t: number; ms: number; back: boolean; done?: () => void } | null = null;
  private flip = 1;
  private peekClock = 0;
  private peekWaving = false;
  private peekLook = false;
  private deskHome() { const r = this.box(); return { x: innerWidth - r.width - 24, y: innerHeight - r.height - 8 }; }

  /** 點在探出時的接觸區裡（她的泡泡、選單開著時她浮在接觸區上面，接觸區收不到，要自己算） */
  private inCatch(e: PointerEvent) {
    const c = this.catcher;
    if (!c || c.hidden) return false;
    const r = c.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  }
  /** 那一點現在畫出來是不是她身上（探頭的歪身、左側翻面都照畫面算；部位圖是站姿，對不上） */
  private opaqueAt(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    let u = (e.clientX - r.left) / r.width;
    if (this.flip < 0) u = 1 - u;
    return this.view.alphaAt(u, (e.clientY - r.top) / r.height) > 0.1;
  }
  /** 直接放在 side 那一側探出（沒有動畫）：進站、讀回、轉向時用 */
  private peekAt(side: Side, pos: { x: number; y: number }) {
    this.tucked = true; this.el.classList.add("suki-pet--tucked");
    this.side = side; this.peekS = 0; this.standX = null;
    this.place(pos);
  }
  /** 探出到站出來之間的位置：x 在兩端之間，高度不變 */
  private layoutPeek() {
    const f = this.viewport(), s = this.size();
    const peek = peekPos(f, s, this.side, this.pos.y);
    const stand = this.standX ?? standOutPos(f, s, this.side, peek.y).x;
    this.place({ x: peek.x + (stand - peek.x) * this.peekS, y: peek.y });
  }
  private finishSlide() {
    const sl = this.slide!;
    this.slide = null; this.peekS = sl.to;
    this.el.classList.remove("suki-pet--sliding");
    this.layoutPeek();
    sl.done?.();
  }
  private slideTo(to: number, ms: number, back: boolean, done?: () => void) {
    if (this.opts.reducedMotion) { this.peekS = to; this.layoutPeek(); done?.(); return; }
    this.slide = { from: this.peekS, to, t: 0, ms, back, done };
    this.el.classList.add("suki-pet--sliding");
  }
  /** 從頁籤後滑出來、站直、跳一下、說一句 */
  private pullOut() {
    this.tucked = false; this.el.classList.remove("suki-pet--tucked");
    this.standX = null;
    this.slideTo(1, 380, true, () => {
      this.save(this.pos);
      this.act({ expr: "happy", say: this.line("untuck"), hop: true }, true);
      this.daily();
      if (this.guide) this.setGuide(this.guide);
    });
  }
  /** 縮回 side 那一側：從現在站的地方滑回頁籤後面 */
  private tuckTo(side: Side, silent = false) {
    this.tucked = true; this.el.classList.add("suki-pet--tucked");
    this.standX = this.pos.x; this.side = side;
    this.closeMenu();
    if (silent) this.bubble.hidden = true;
    this.slideTo(0, 320, false, () => { this.standX = null; this.save(this.pos, true); });
    if (!silent) this.act({ expr: "peek", say: this.line("tuck"), ms: 2600 }, true);
  }
  /** 設定頁的「叫她出來」：回到預設的位置，拉出來打招呼 */
  private summon() {
    if (this.sleeping) { this.sleeping = false; this.exprTarget = {}; }
    if (this.opts.mobile) { const d = defaultPeek(this.viewport(), this.size()); this.peekAt(d.side, d.pos); return this.pullOut(); }
    this.tucked = false; this.el.classList.remove("suki-pet--tucked");
    const pos = this.deskHome();
    this.place(pos); this.save(pos);
    this.act({ expr: "happy", say: this.line("untuck"), hop: true }, true);
  }
  /**
   * 探出時把她的外框照畫出來的輪廓裁掉透明處，那裡的點擊（含捲動）就落到底下的網頁（owner 2026-10-23）。
   * 她會呼吸、揮手、眨眼，輪廓每 0.6 秒重描一次；只讀她外框那一塊。站出來就拿掉，回到原本的判斷。
   */
  private clipped = false;
  private clipAt = 0;
  private clipSide: Side = "right";
  private clipMirror = false;
  private updateClip(now: number) {
    const want = this.tucked && this.peekS < 0.5 && !this.drag && !this.hidden;
    if (!want) { if (this.clipped) { this.touch.style.clipPath = ""; this.clipped = false; } return; }
    // 左側翻面是動畫：翻到一半就重描，不等 0.6 秒
    const mirror = this.flip < 0;
    if (this.clipped && now - this.clipAt < 600 && this.clipSide === this.side && this.clipMirror === mirror) return;
    this.clipAt = now; this.clipSide = this.side; this.clipMirror = mirror;
    const cs = this.canvas.style, cw = parseFloat(cs.width), ch = parseFloat(cs.height), cl = -parseFloat(cs.left), ct = -parseFloat(cs.top);
    const tw = this.touch.clientWidth, th = this.touch.clientHeight;
    if (!cw || !ch || !tw || !th) return;
    // 畫布左右留的邊一樣寬，翻面後她的外框還是對著同一塊
    const { px, w, h } = this.view.readRect(cl / cw, ct / ch, (cl + tw) / cw, (ct + th) / ch);
    if (!w || !h) return;
    const d = silhouettePath(px, w, h, { sx: tw / w, sy: th / h, mirror, step: Math.max(1, Math.round(h / 44)), gap: Math.round(w / 44) });
    this.touch.style.clipPath = d ? `path("${d}")` : "inset(50%)";
    this.clipped = true;
  }

  /** 手機每一格：拉出縮回的動畫、探出時看著頁面與揮手、左側翻面、站著閒置太久自己縮回 */
  private mobileFrame(dt: number, now: number) {
    const sl = this.slide;
    if (sl) {
      sl.t += dt * 1000;
      const k = Math.min(1, sl.t / sl.ms);
      this.peekS = sl.from + (sl.to - sl.from) * (sl.back ? easeBack(k) : easeIO(k));
      if (k >= 1) this.finishSlide();
      else this.layoutPeek();
    }
    // 探出時每隔約 9 秒揮一下手，提醒她在這裡
    const peeking = this.tucked && this.peekS < 0.5 && !this.drag && !this.hidden && !this.opts.reducedMotion;
    this.peekClock = peeking ? this.peekClock + dt : 0;
    const w = this.peekClock % 9;
    this.peekWaving = peeking && w > 7.2 && w < 8.8 && this.hasSet("wave");
    if (this.tucked && !this.drag) { this.driver.state.look = [-0.8, 0.1]; this.peekLook = true; }
    else if (this.peekLook) { this.peekLook = false; this.driver.state.look = null; }
    const ft = this.side === "left" && this.peekS < 0.97 ? -1 : 1;
    this.flip = this.opts.reducedMotion || Math.abs(ft - this.flip) < 0.01 ? ft : this.flip + (ft - this.flip) * (1 - Math.exp(-dt * 16));
    this.canvas.style.transform = this.flip === 1 ? "" : `scaleX(${this.flip})`;
    this.updateClip(now);
    // 站著 60 秒沒有人碰頁面：靜靜縮回比較近的一側（ui-v3.md §2.3，接在 40 秒的想睡之後）
    const busy = this.slide || this.drag || this.walk || this.activity || this.sleeping || this.hidden || this.jumpT >= 0 || now <= this.actUntil;
    if (!this.tucked && !busy && this.bubble.hidden && this.menuEl.hidden && now - this.lastInput > 60_000) {
      this.tuckTo(sideOf(this.viewport(), this.size(), this.pos.x), true);
    }
  }
  /** 牆：探出的部分只畫到邊距帶內側，其餘被頁籤蓋住；頁籤探出時蓋滿邊距帶，站出來後縮成細條 */
  private layoutWall() {
    if (!this.opts.mobile) return;
    const f = this.viewport(), size = this.size(), s = Math.max(0, Math.min(1, this.peekS));
    const hide = s < 1 ? wallHide(f, size, this.side, this.pos.x) : 0;
    // 上下留整個視窗高：選單項目多的時候往上長得很高，不能被裁掉
    this.el.style.clipPath = !hide ? "" : this.side === "right" ? `inset(-100vh ${hide}px -100vh -300px)` : `inset(-100vh -300px -100vh ${hide}px)`;
    const tab = this.tab;
    if (!tab) return;
    const b = bands(f), band = this.side === "right" ? b.right : b.left;
    const tw = band + (8 - band) * s, th = size.h + 8 + (56 - size.h - 8) * s;
    Object.assign(tab.style, { width: `${tw}px`, height: `${th}px`, transform: `translate(${this.side === "right" ? f.w - tw : 0}px, ${Math.round(this.pos.y + (size.h - th) / 2)}px)` });
    tab.classList.toggle("suki-pet__tab--left", this.side === "left");
    tab.style.setProperty("--chev", String(1 - s));
    // 接觸區只在探出時有；站出來後回到只接她身上
    // 縮回的動畫走到一半才出現：還站在畫面中間時不先在邊上攔點擊
    const c = this.catcher!, on = this.tucked && !this.hidden && this.peekS < 0.5;
    c.hidden = !on;
    if (on) { const r = peekCatch(f, size, this.side, this.pos.y); Object.assign(c.style, { width: `${r.w}px`, height: `${r.h}px`, transform: `translate(${r.x}px, ${Math.round(r.y)}px)` }); }
  }
  /** 泡泡與選單的左右緣留在邊距帶內：她站在畫面中段時，往中間展開的泡泡會從另一邊溢出去 */
  private fitPopups() {
    if (!this.opts.mobile) return;
    // 拖著、走路時每一格都會呼叫：兩個都收著就不量
    if (this.bubble.hidden && this.menuEl.hidden && !this.bubble.style.left && !this.menuEl.style.left) return;
    const f = this.viewport();
    for (const el of [this.bubble, this.menuEl]) {
      el.style.left = ""; el.style.right = "";
      el.style.removeProperty("--tail-dx");
      if (el.hidden) continue;
      const left = el.offsetLeft, dx = fitShift(f, this.pos.x + left, el.offsetWidth);
      if (!dx) continue;
      el.style.left = `${left + dx}px`; el.style.right = "auto";
      // 尖角挪回原本指著她的地方（挪的量最多七十幾 px，泡泡比這寬，尖角不會跑出去）
      el.style.setProperty("--tail-dx", `${-dx}px`);
    }
  }
}

export { suki } from "./events";
