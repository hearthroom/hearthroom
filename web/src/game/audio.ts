/**
 * 遊戲音訊：Web Audio 一個 context、兩組音量（環境／效果）、手勢解鎖、缺檔靜默。
 *
 * 檔案放在站台 public/game/audio/ 底下（由 threejs-audio-generator 生成，不入 git 也能跑：
 * 少一個檔就少一個聲音，不報錯）。瀏覽器要求使用者先互動才能出聲，所以第一次按鍵／點擊才解鎖。
 *
 * ponytail: 沒有音量設定面板；靜音鍵在頁面上（M 鍵）。
 */


/** 峰值歸一化：把整段拉到目標峰值（太小的放大、爆音的壓下來），就地改 buffer */
function normalize(buf: AudioBuffer, target: number): AudioBuffer {
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; } }
  if (peak < 1e-4) return buf;
  const g = target / peak;
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= g; }
  return buf;
}

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private ambGain!: GainNode;
  private sfxGain!: GainNode;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private ambience: { name: string; src: AudioBufferSourceNode } | null = null;
  private lastStep = 0;
  muted = false;
  /** 每個聲音的網址；沒設的就沒有這個聲音 */
  private sources: Partial<Record<string, string>> = {};

  setSources(map: Partial<Record<string, string>> | undefined) { this.sources = map || {}; this.buffers.clear(); }

  /** 第一次使用者互動時呼叫；重複呼叫無害 */
  unlock() {
    if (this.ctx) { if (this.ctx.state === "suspended") void this.ctx.resume(); return; }
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
    this.ambGain = this.ctx.createGain(); this.ambGain.gain.value = 0.35; this.ambGain.connect(this.master);
    this.sfxGain = this.ctx.createGain(); this.sfxGain.gain.value = 0.6; this.sfxGain.connect(this.master);
    this.master.gain.value = this.muted ? 0 : 1;
  }

  setMuted(v: boolean) { this.muted = v; if (this.ctx) this.master.gain.value = v ? 0 : 1; }

  private load(name: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(name);
    if (!p) {
      const url = this.sources[name];
      if (!url) { p = Promise.resolve(null); this.buffers.set(name, p); return p; }
      p = fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((b) => this.ctx!.decodeAudioData(b))
        .then((buf) => normalize(buf, name.startsWith("ambience") ? 0.5 : 0.7))
        .catch(() => null);
      this.buffers.set(name, p);
    }
    return p;
  }

  /** 哪個來源鍵是腳步聲（作者在 audio.events.footstep 宣告） */
  private footstepKey = "";
  setFootstep(key: string) { this.footstepKey = key; }

  async play(name: string, opts: { volume?: number; rate?: number } = {}) {
    if (!this.ctx || this.muted) return;
    const buf = await this.load(name);
    if (!buf || !this.ctx) return;
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = opts.rate ?? 1;
    const g = this.ctx.createGain(); g.gain.value = opts.volume ?? 1;
    src.connect(g); g.connect(this.sfxGain); src.start();
  }

  /** 腳步：走路時每隔一小段放一下，音高微抖 */
  footstep() {
    const now = performance.now();
    if (now - this.lastStep < 320) return;
    this.lastStep = now;
    if (this.footstepKey) void this.play(this.footstepKey, { volume: 0.5, rate: 0.92 + Math.random() * 0.16 });
  }

  /** 環境音跟著光照預設換（作者在 audio.ambience 把預設 id 對到來源鍵），交叉淡入淡出；空鍵＝停掉 */
  async setAmbience(name: string) {
    if (!this.ctx) return;
    if ((this.ambience?.name || "") === name) return;
    const buf = name ? await this.load(name) : null;
    if (!this.ctx) return;
    const old = this.ambience;
    if (old) { try { old.src.stop(this.ctx.currentTime + 1.2); } catch { /* 已停 */ } }
    if (!buf) { this.ambience = null; return; }
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0, this.ctx.currentTime); g.gain.linearRampToValueAtTime(1, this.ctx.currentTime + 1.2);
    src.connect(g); g.connect(this.ambGain); src.start();
    this.ambience = { name, src };
  }

  dispose() { try { this.ambience?.src.stop(); } catch { /* ignore */ } void this.ctx?.close(); this.ctx = null; }
}
