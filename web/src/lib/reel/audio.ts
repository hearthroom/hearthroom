/**
 * 開箱舞台的音效與觸覺。音效全部用 WebAudio 即時合成（原創、零下載，公開 repo 不放素材），
 * 方向是明亮、像玩具：木頭棘輪、音樂盒、鐵琴，不要賭場的鈴聲與金幣聲（art.md §5）。
 * 移植自技術美術原型的 reel-audio.js（美術總監 r4 簽核）。
 *
 * 喇叭與震動兩顆鈕各管各的，記在這台裝置（hr.checkin.fx）；讀寫失敗也照常運作。
 * 頁面不在前景時不出聲、不震動。觸覺只有支援 navigator.vibrate 的瀏覽器（Android）。
 */
const KEY = "hr.checkin.fx";

interface Prefs { sound: boolean; haptic: boolean }
function readPrefs(): Prefs {
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fallback = { sound: true, haptic: !reduced };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    const v = JSON.parse(raw) as Partial<Prefs>;
    return { sound: v.sound !== false, haptic: v.haptic ?? fallback.haptic };
  } catch { return fallback; }
}

let prefs: Prefs | null = null;
const get = () => (prefs ??= readPrefs());
function save() { try { localStorage.setItem(KEY, JSON.stringify(get())); } catch { /* ignore */ } }

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;

export const canVibrate = (): boolean => typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
export const soundOn = (): boolean => get().sound;
export const hapticOn = (): boolean => get().haptic;
export function setSound(on: boolean) { get().sound = on; save(); if (master) master.gain.value = on ? 0.9 : 0; }
export function setHaptic(on: boolean) { get().haptic = on; save(); }

/**
 * 建立或喚醒音訊。舞台打開時先建（第一次建立會卡一幀），按下「簽到開箱」那一下再 resume：
 * 那次點擊就是瀏覽器要的使用者手勢。
 */
export function prepareAudio(): void {
  if (ctx) { if (ctx.state === "suspended") void ctx.resume().catch(() => undefined); return; }
  const AC = (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  // iOS 支援時用 ambient：靜音模式下不出聲
  try { const s = (navigator as unknown as { audioSession?: { type: string } }).audioSession; if (s) s.type = "ambient"; } catch { /* ignore */ }
  try {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = get().sound ? 0.9 : 0;
    master.connect(ctx.destination);
    const len = Math.floor(ctx.sampleRate * 0.5);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  } catch { ctx = null; master = null; }
}

const live = () => !!ctx && !!master && get().sound && !(typeof document !== "undefined" && document.hidden);

interface ToneOpts { type?: OscillatorType; slideTo?: number; peak?: number; attack?: number; lowpass?: number }
function tone(freq: number, t0: number, dur: number, o: ToneOpts = {}) {
  const c = ctx!;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(freq, t0);
  if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo, t0 + dur * 0.8);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(o.peak ?? 0.15, t0 + (o.attack ?? 0.006));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  let node: AudioNode = osc;
  if (o.lowpass) { const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = o.lowpass; osc.connect(f); node = f; }
  node.connect(g); g.connect(master!);
  osc.start(t0); osc.stop(t0 + dur + 0.05);
}

interface NoiseOpts { type?: BiquadFilterType; f0: number; f1?: number; q?: number; peak?: number; attack?: number }
function noise(t0: number, dur: number, o: NoiseOpts) {
  const c = ctx!;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = o.type ?? "bandpass";
  f.frequency.setValueAtTime(o.f0, t0);
  if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t0 + dur);
  f.Q.value = o.q ?? 1;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(o.peak ?? 0.1, t0 + (o.attack ?? 0.004));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f); f.connect(g); g.connect(master!);
  src.start(t0, Math.random() * 0.2); src.stop(t0 + dur + 0.05);
}

/** 開蓋：拉緞帶的「嘶」加「啵」。 */
export function playOpen() {
  if (!live()) return;
  const t = ctx!.currentTime + 0.01;
  noise(t + 0.05, 0.32, { type: "bandpass", f0: 900, f1: 4200, q: 2, peak: 0.07, attack: 0.04 });
  tone(260, t + 0.42, 0.14, { slideTo: 720, peak: 0.3 });
  tone(1318, t + 0.5, 0.35, { peak: 0.05 });
}

/** 棘輪喀噠：越快越輕（避免機關槍），越慢越清楚。speedNorm 0..1。 */
export function playTick(speedNorm: number) {
  if (!live()) return;
  const t = ctx!.currentTime;
  const loud = 0.05 + 0.1 * (1 - Math.min(1, speedNorm));
  noise(t, 0.022, { type: "bandpass", f0: 1700 + Math.random() * 500, q: 5, peak: loud * 1.6 });
  tone(620 + Math.random() * 60, t, 0.03, { type: "triangle", peak: loud * 0.7 });
}

/** 第 5、6 級經過指針：輕輕一聲閃光，慢的時候最明顯。 */
export function playShine(tier: number, speedNorm: number) {
  if (!live()) return;
  const t = ctx!.currentTime;
  const k = 0.55 + 0.45 * (1 - Math.min(1, speedNorm));
  if (tier >= 6) {
    tone(1568, t, 0.5, { peak: 0.1 * k });
    tone(2349, t, 0.45, { peak: 0.06 * k });
    tone(3136, t + 0.08, 0.5, { peak: 0.06 * k });
  } else {
    tone(1319, t, 0.4, { peak: 0.08 * k });
    tone(1976, t, 0.35, { peak: 0.045 * k });
  }
}

/** 停住：第 1、2 級單音、第 3、4 級三音和弦、第 5、6 級短號角（≤2 秒）。 */
export function playStop(kind: "neutral" | "rose" | "gold") {
  if (!live()) return;
  const t = ctx!.currentTime + 0.02;
  if (kind === "neutral") {
    tone(659, t, 0.7, { peak: 0.18 });
    tone(1318, t, 0.4, { peak: 0.04 });
  } else if (kind === "rose") {
    [523, 659, 784].forEach((f, i) => { tone(f, t + i * 0.07, 0.8, { peak: 0.13 }); tone(f * 2, t + i * 0.07, 0.45, { peak: 0.03 }); });
  } else {
    [523, 659, 784, 1047].forEach((f, i) => {
      const dur = i === 3 ? 1.15 : 0.2;
      tone(f, t + i * 0.12, dur, { type: "sawtooth", lowpass: 2400, peak: 0.07, attack: 0.012 });
      tone(f, t + i * 0.12, dur, { type: "triangle", peak: 0.1, attack: 0.012 });
    });
    tone(2093, t + 0.5, 0.9, { peak: 0.04 });
  }
}

/** 觸覺：減速段最後幾格每格一下、停住一下、大獎一串。 */
export function buzz(pattern: number | number[]) {
  if (!get().haptic || !canVibrate() || (typeof document !== "undefined" && document.hidden)) return;
  try { navigator.vibrate(pattern); } catch { /* 不支援就算了 */ }
}

/** 測試用：清掉記住的偏好與音訊。 */
export function resetAudioForTest() { prefs = null; ctx = null; master = null; noiseBuf = null; }
