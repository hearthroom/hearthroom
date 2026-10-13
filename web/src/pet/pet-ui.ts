/**
 * 桌寵的互動層：把 Rig＋Driver 包成一個會被點、被拖、會看你、會冒泡泡的小人。
 *
 * 跟網站之間只靠頁面事件（window 的 "suki" CustomEvent）與 hover 提示（data-suki 屬性）：
 * 網站各處不必知道她怎麼演，只要說發生了什麼；她自己決定反應。這樣加一種反應不用動到功能本身。
 */
import { compose, PetRenderer, Rig, type PetSkeleton, type PetSkin } from "./puppet";
import { Driver } from "./driver";
import type { SukiNews } from "../../../shared/suki-care";

export type { SukiEvent } from "./events";
import type { SukiEvent } from "./events";

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
  private drag?: { dx: number; dy: number; x: number; y: number; vx: number; t: number; moved: boolean; shake: number };
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
    this.el.append(this.canvas, this.touch, this.bubble, this.menuEl);
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
    this.bind();
    // 先在定位好的地方隱形放好（不走位移動畫），再從那裡彈出來，不會從左上角飛過去
    this.el.classList.add("suki-pet--placing");
    const saved = this.restore();
    if (saved) this.place(saved);
    else if (this.opts.mobile) { this.place({ x: innerWidth - cssW, y: innerHeight - cssH - 96 }); this.tuck("right", true); }
    else this.place({ x: innerWidth - cssW - 24, y: innerHeight - cssH - 8 });
    void this.el.offsetWidth;
    requestAnimationFrame(() => { this.el.classList.remove("suki-pet--placing"); this.el.classList.add("suki-pet--pop"); });
    if (!this.tucked) this.greet();
    this.daily();
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

  stop() { this.stopped = true; this.el.remove(); }

  /** 換頁時網站把這頁的用途交給她：第一次到這頁說一句，之後只在選單裡 */
  setGuide(g: PageGuide | null) {
    this.guide = g;
    this.closeMenu();
    if (!g || this.tucked || !this.ready) return;
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
    items.push({ label: this.line("menu.tuck"), run: () => this.tuck(this.box().left < innerWidth / 2 ? "left" : "right") });
    if (this.opts.onOff) items.push({ label: this.opts.menuLabel?.() ?? "×", run: this.opts.onOff });
    this.menuEl.replaceChildren(...items.map((it) => {
      const b = document.createElement("button");
      b.type = "button"; b.setAttribute("role", "menuitem"); b.textContent = it.label;
      b.addEventListener("click", (e) => { e.stopPropagation(); this.closeMenu(); it.run(); });
      return b;
    }));
    this.bubble.hidden = true;
    this.menuEl.hidden = false;
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
    const pick = news.find((n) => n.kind === "levelUp") ?? news.find((n) => n.kind === "streak") ?? news.find((n) => n.kind === "fed")
      ?? news.find((n) => n.kind === "missed") ?? news.find((n) => n.kind === "checkIn" && n.days > 1) ?? news.find((n) => n.kind === "hungry");
    if (!pick) return;
    const later = (a: Act) => setTimeout(() => this.act(a), this.tucked ? 0 : 3400);
    switch (pick.kind) {
      case "fed": return later({ expr: "happy", say: this.line("care.fed"), hop: true });
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
      case "notice":
        if (e.mood === "party") this.kick("Die", 400);
        return this.act({ expr: e.mood === "party" ? "happy" : e.mood === "comfort" ? "shy" : "surprised", say: e.text, hop: e.mood === "party", ms: 5000, action: e.action });
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
    if (now > this.actUntil && !this.sleeping) for (const k of EXPRS) this.exprTarget[k] = 0;
    const idle = (now - this.lastInput) / 1000;
    if (idle > 40 && now > this.actUntil) { this.exprTarget.sleepy = 1; if (idle < 41) this.speak(this.line("sleepy"), 3000); }
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
    for (const k in SukiPet.LIMITS) if (p[k] !== undefined) p[k] = Math.max(SukiPet.LIMITS[k][0], Math.min(SukiPet.LIMITS[k][1], p[k]));
    // 小惡魔的尾巴梗藏在右手後面、沒畫：右手與手肘只往外、尾巴先不擺，不然梗會斷（等整條尾巴補畫好再放寬）
    if (this.skin.includes("imp")) {
      if (p.ArmR !== undefined) p.ArmR = Math.max(0, p.ArmR);
      if (p.ElbowR !== undefined) p.ElbowR = Math.max(0, p.ElbowR);
      if (p.Tail !== undefined) p.Tail = 0;
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

  private brain(now: number) {
    const quiet = !this.drag && !this.tucked && !this.hidden && this.menuEl.hidden && this.bubble.hidden && this.jumpT < 0;
    if (!quiet || this.sleeping || this.walk || now < this.nextMove || now - this.touchedAt < 12_000) return;
    this.nextMove = now + 9000 + Math.random() * 12_000;
    // 睡覺：整頁太久沒人動就睡著（白天約四分鐘，深夜一分鐘）
    const h = new Date().getHours();
    if (now - Math.max(this.lastInput, this.touchedAt) > ((h >= 23 || h < 5) ? 60_000 : 240_000)) return this.sleep();
    // 在原畫撐得住的範圍內自己動：走一段、擺擺手、東張西望（捧書、喝可可這些大動作等專門畫的手臂組）
    const r = Math.random();
    if (r < 0.5 && !this.opts.reducedMotion) return this.wander();
    if (r < 0.75) { this.waveT = 0; return; }
    // 東張西望
    this.driver.state.look = [-0.9, -0.2];
    setTimeout(() => { if (!this.drag) this.driver.state.look = [0.9, -0.1]; }, 1400);
    setTimeout(() => { if (!this.drag) this.driver.state.look = null; }, 2800);
  }

  /** 沿著原本的高度往左或右蹦蹦跳跳走一段（電腦走遠一點，手機走一小段） */
  private wander() {
    const b = this.box();
    const span = this.opts.mobile ? 70 : 260;
    const min = 8, max = innerWidth - b.width - 8;
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
    this.exprTarget = { sleepy: 1 };
    this.zzzAt = performance.now() + 2500;
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

    this.touch.addEventListener("pointerdown", (e) => {
      // 右鍵交給 contextmenu 開選單，不算抓她
      if (e.button !== 0) return;
      // 選單開著時點她：只是收起選單
      if (!this.menuEl.hidden) { e.preventDefault(); this.closeMenu(); this.dismissTap = true; return; }
      // 點在透明處：不攔，讓底下的東西照常被點到
      if (this.region(e) === null && !this.sleeping) return;
      this.touchedAt = performance.now();
      if (this.walk) { this.walk = null; this.rig.params.Jump = 0; this.el.classList.remove("suki-pet--walking"); }
      e.preventDefault();
      try { this.touch.setPointerCapture(e.pointerId); } catch { /* 拿不到也照常拖 */ }
      const r = this.box();
      this.drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, x: e.clientX, y: e.clientY, vx: 0, t: performance.now(), moved: false, shake: 0 };
      // 長按 450ms 開選單（手機的主要入口；電腦也能用）
      clearTimeout(this.pressTimer);
      this.pressTimer = window.setTimeout(() => { if (this.drag && !this.drag.moved) { this.pressed = true; this.buzz(15); this.openMenu(); } }, 450);
    });
    this.touch.addEventListener("contextmenu", (e) => { e.preventDefault(); if (!this.pressed) this.openMenu(); });
    // 系統接手手勢（長按選單、捲動）時會送 pointercancel：當作放手，不然她以為還被拎著
    this.touch.addEventListener("pointercancel", () => {
      clearTimeout(this.pressTimer);
      const held = this.drag?.moved;
      this.drag = undefined;
      this.pressed = false;
      this.el.classList.remove("suki-pet--held");
      if (held) this.act({ expr: "happy", say: this.line("land") }, true);
    });
    this.touch.addEventListener("pointerup", (e) => {
      clearTimeout(this.pressTimer);
      if (this.dismissTap) { this.dismissTap = false; return; }
      if (this.pressed) { this.pressed = false; this.drag = undefined; return; }
      const d = this.drag; this.drag = undefined;
      if (!d) return;
      if (d.moved) return this.drop(e, d.shake);
      this.poke(e);
    });
    this.touch.addEventListener("dblclick", (e) => { e.preventDefault(); this.act({ expr: "happy", hop: true, say: this.line("jump") }, true); });
    // 游標停在她身上太久：害羞
    let rest = 0;
    this.touch.addEventListener("pointermove", () => { clearTimeout(rest); rest = window.setTimeout(() => this.act({ expr: "shy", say: this.line("stare"), ms: 2400 }), 3500); });
    this.touch.addEventListener("pointerleave", () => clearTimeout(rest));
  }

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
  tuckAside() { if (!this.tucked) this.tuck(this.pos.x + this.box().width / 2 < innerWidth / 2 ? "left" : "right", true); }
  /** 躲起來的原因各記各的（手機鍵盤打開、正在打字）：全部解除才出來 */
  private away = new Set<string>();
  private hide(on: boolean, reason: string) {
    if (on) this.away.add(reason); else this.away.delete(reason);
    on = this.away.size > 0;
    if (this.hidden === on) return;
    this.hidden = on;
    this.el.classList.toggle("suki-pet--away", on);
    if (on) { this.bubble.hidden = true; this.closeMenu(); }
    else { const next = this.queue.shift(); if (next) setTimeout(() => this.act(next), 500); }
  }

  private dragMove(e: PointerEvent) {
    const d = this.drag!;
    const now = performance.now(), dt = Math.max(8, now - d.t);
    const vx = ((e.clientX - d.x) / dt) * 1000;
    const dist = Math.hypot(e.clientX - d.x, e.clientY - d.y);
    // 一動就不是長按了
    if (dist >= 3) clearTimeout(this.pressTimer);
    if (!d.moved && dist < 6) return;
    if (!d.moved) { clearTimeout(this.pressTimer); this.closeMenu(); if (this.sleeping) { this.sleeping = false; this.exprTarget = {}; } d.moved = true; this.act({ expr: "surprised", say: this.line("lift"), ms: 10_000 }, true); this.el.classList.add("suki-pet--held"); }
    // 甩：快速來回換方向才算，一路拖過去不算
    if (Math.sign(vx) !== Math.sign(d.vx) && Math.abs(vx) > 900 && Math.abs(d.vx) > 900) d.shake += 1;
    d.vx = vx; d.x = e.clientX; d.y = e.clientY; d.t = now;
    this.place({ x: e.clientX - d.dx, y: e.clientY - d.dy });
  }

  private drop(e: PointerEvent, shake: number) {
    this.el.classList.remove("suki-pet--held");
    const r = this.box();
    // 拖到螢幕邊：縮進去，只露半個頭
    const edge = r.left < -r.width * 0.25 ? "left" : r.right > innerWidth + r.width * 0.25 ? "right" : null;
    if (edge) return this.tuck(edge);
    const pos = { x: Math.max(0, Math.min(innerWidth - r.width, r.left)), y: Math.max(0, Math.min(innerHeight - r.height, r.top)) };
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
    const x = Math.floor(((e.clientX - r.left) / r.width) * this.hit.w), y = Math.floor(((e.clientY - r.top) / r.height) * this.hit.h);
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
  }
  private save(p: { x: number; y: number }) {
    const x = p.x < 0 ? -1 : p.x >= innerWidth ? 2 : p.x / innerWidth;
    try { localStorage.setItem("suki.pet.pos", JSON.stringify({ x, y: p.y / innerHeight })); } catch { /* 存不了就算了 */ }
  }
  private restore(): { x: number; y: number } | null {
    try {
      const v = JSON.parse(localStorage.getItem("suki.pet.pos") ?? "null");
      if (!v) return null;
      const r = { w: this.touch.clientWidth || 120, h: this.touch.clientHeight || 180 };
      if (v.x < 0 || v.x > 1) { setTimeout(() => this.tuck(v.x < 0 ? "left" : "right", true), 0); return { x: v.x < 0 ? 0 : innerWidth - r.w, y: v.y * innerHeight }; }
      return { x: v.x * innerWidth, y: v.y * innerHeight };
    } catch { return null; }
  }
}

export { suki } from "./events";
