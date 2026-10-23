/**
 * 蘇綺桌寵的小型 2D 骨架渲染器：網格變形＋骨架＋鐘擺物理，WebGL1 就能跑，不用 wasm。
 *
 * 模型（pet.json）由腳本從對齊好的整張分層圖產生：每個部件是一張裁好的貼圖、一張網格，
 * 掛在一個節點上。節點是可轉動的骨架（身體 → 頭）；部件自己還可以有「彎曲」（頭髮、裙擺）
 * 與「假 3D 轉頭」（越靠前的部件位移越多）。參數由待機動作、滑鼠與物理一起決定。
 */

export interface PetNode {
  id: string;
  parent?: string;
  /** 畫布座標的轉軸 */
  pivot: [number, number];
  /** 角度（度）＝ Σ 參數 × 係數 */
  rotate?: Record<string, number>;
  /** 位移（px）＝ Σ 參數 × 係數 */
  moveX?: Record<string, number>;
  moveY?: Record<string, number>;
  /** 以轉軸為中心的縱向伸縮：1 + Σ 參數 × 係數 */
  scaleY?: Record<string, number>;
}

export interface Bend {
  /** 根部（不動）與尖端方向 */
  root: [number, number];
  tip: [number, number];
  /** 尖端彎幾度＝ Σ 參數 × 係數；越靠尖端彎越多 */
  angle: Record<string, number>;
  /** 越靠尖端越多的程度（1＝線性，2＝尾端才明顯） */
  power?: number;
}

export interface PetPart {
  id: string;
  tex: string;
  /** 貼圖在畫布上的位置 */
  rect: [number, number, number, number];
  node: string;
  z: number;
  grid?: [number, number];
  /** 假 3D：轉頭時這個部件跟著位移的比例（px／單位參數） */
  depth?: { x?: Record<string, number>; y?: Record<string, number> };
  /** 頭部橢圓：越靠中間位移越大，邊緣收回，看起來像轉了一個球面 */
  sphere?: { center: [number, number]; radius: [number, number] };
  bend?: Bend;
  /** 不透明度＝ clamp(Σ 參數 × 係數 + base) */
  opacity?: { base?: number; by?: Record<string, number> };
  /** 這個部件只畫在 mask 部件裡面（眼珠只畫在眼白裡） */
  clipTo?: string;
}

export interface Pendulum {
  /** 寫進哪個參數 */
  param: string;
  /** 由哪些參數的變化帶動（係數是慣性方向） */
  drive: Record<string, number>;
  stiffness: number;
  damping: number;
  limit: number;
}

export interface PetModel {
  size: [number, number];
  nodes: PetNode[];
  parts: PetPart[];
  physics?: Pendulum[];
}

type Params = Record<string, number>;
const sum = (m: Record<string, number> | undefined, p: Params) => {
  let v = 0;
  if (m) for (const k in m) v += (p[k] ?? 0) * m[k];
  return v;
};

/** 2D 仿射：[a, b, c, d, e, f] → x' = a x + c y + e, y' = b x + d y + f */
type Mat = [number, number, number, number, number, number];
const ID: Mat = [1, 0, 0, 1, 0, 0];
const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
function local(n: PetNode, p: Params): Mat {
  const a = (sum(n.rotate, p) * Math.PI) / 180;
  const sy = 1 + sum(n.scaleY, p);
  const [px, py] = n.pivot;
  const c = Math.cos(a), s = Math.sin(a);
  // 平移到轉軸 → 縱向伸縮 → 旋轉 → 移回 → 位移
  const t1: Mat = [1, 0, 0, 1, -px, -py];
  const sc: Mat = [1, 0, 0, sy, 0, 0];
  const r: Mat = [c, s, -s, c, 0, 0];
  const t2: Mat = [1, 0, 0, 1, px + sum(n.moveX, p), py + sum(n.moveY, p)];
  return mul(t2, mul(r, mul(sc, t1)));
}

interface Mesh { base: Float32Array; uv: Float32Array; idx: Uint16Array; out: Float32Array }
function grid(part: PetPart): Mesh {
  const [x, y, w, h] = part.rect;
  const [cols, rows] = part.grid ?? [2, 2];
  const n = (cols + 1) * (rows + 1);
  const base = new Float32Array(n * 2), uv = new Float32Array(n * 2);
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
    const k = (j * (cols + 1) + i) * 2;
    uv[k] = i / cols; uv[k + 1] = j / rows;
    base[k] = x + w * uv[k]; base[k + 1] = y + h * uv[k + 1];
  }
  const idx = new Uint16Array(cols * rows * 6);
  let q = 0;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
    idx.set([a, b, c, b, d, c], q); q += 6;
  }
  return { base, uv, idx, out: new Float32Array(n * 2) };
}

/** 依參數算出每個部件網格的頂點（畫布座標）；跟繪圖分開，無頭測試也能直接檢查 */
export class Rig {
  /** 沒動到的參數：眼睛張開，其他歸零 */
  readonly params: Params = { EyeOpen: 1 };
  private meshes = new Map<string, Mesh>();
  private nodes = new Map<string, PetNode>();
  private vel: Params = {};
  private prev: Params = {};
  constructor(readonly model: PetModel) {
    for (const n of model.nodes) this.nodes.set(n.id, n);
    for (const part of model.parts) this.meshes.set(part.id, grid(part));
  }
  private world(id: string | undefined, p: Params, seen = 0): Mat {
    if (!id || seen > 16) return ID;
    const n = this.nodes.get(id);
    if (!n) return ID;
    return mul(this.world(n.parent, p, seen + 1), local(n, p));
  }
  /** 物理：每個鐘擺被帶動參數的加速度推一下，再彈回來 */
  step(dt: number) {
    const p = this.params;
    for (const pen of this.model.physics ?? []) {
      let force = 0;
      for (const k in pen.drive) {
        const v = p[k] ?? 0, before = this.prev[k] ?? v;
        force += ((v - before) / Math.max(dt, 1e-3)) * pen.drive[k];
      }
      const x = p[pen.param] ?? 0;
      let v = this.vel[pen.param] ?? 0;
      v += (force - pen.stiffness * x - pen.damping * v) * dt;
      const nx = Math.max(-pen.limit, Math.min(pen.limit, x + v * dt));
      this.vel[pen.param] = v; p[pen.param] = nx;
    }
    for (const k in p) this.prev[k] = p[k];
  }
  vertices(part: PetPart): Float32Array {
    const m = this.meshes.get(part.id)!, p = this.params;
    const W = this.world(part.node, p);
    const dx = sum(part.depth?.x, p), dy = sum(part.depth?.y, p);
    const b = part.bend;
    let bx = 0, by = 0, len = 1, ang = 0, pow = 1;
    if (b) {
      bx = b.tip[0] - b.root[0]; by = b.tip[1] - b.root[1];
      len = Math.hypot(bx, by) || 1; bx /= len; by /= len;
      ang = (sum(b.angle, p) * Math.PI) / 180; pow = b.power ?? 1.5;
    }
    for (let k = 0; k < m.base.length; k += 2) {
      let x = m.base[k], y = m.base[k + 1];
      if (b && ang) {
        const t = Math.max(0, Math.min(1, ((x - b.root[0]) * bx + (y - b.root[1]) * by) / len));
        const a = ang * Math.pow(t, pow), c = Math.cos(a), s = Math.sin(a);
        const rx = x - b.root[0], ry = y - b.root[1];
        x = b.root[0] + rx * c - ry * s; y = b.root[1] + rx * s + ry * c;
      }
      if (dx || dy) {
        let f = 1;
        if (part.sphere) {
          const u = (x - part.sphere.center[0]) / part.sphere.radius[0];
          const v = (y - part.sphere.center[1]) / part.sphere.radius[1];
          f = Math.max(0, 1 - 0.6 * (u * u + v * v));
        }
        x += dx * f; y += dy * f;
      }
      m.out[k] = W[0] * x + W[2] * y + W[4];
      m.out[k + 1] = W[1] * x + W[3] * y + W[5];
    }
    return m.out;
  }
  /** 從外面推一下某個鐘擺（被拉馬尾、點骰子、捲動太快） */
  kick(param: string, v: number) { this.vel[param] = (this.vel[param] ?? 0) + v; }
  opacity(part: PetPart): number {
    if (!part.opacity) return 1;
    return Math.max(0, Math.min(1, (part.opacity.base ?? 0) + sum(part.opacity.by, this.params)));
  }
  mesh(part: PetPart) { return this.meshes.get(part.id)!; }
}

const VS = `attribute vec2 p;attribute vec2 t;uniform vec2 s;uniform vec2 o;varying vec2 v;void main(){v=t;vec2 q=p+o;gl_Position=vec4(q.x/s.x*2.-1.,1.-q.y/s.y*2.,0,1);}`;
const FS = `precision mediump float;varying vec2 v;uniform sampler2D tex;uniform float a;void main(){gl_FragColor=texture2D(tex,v)*a;}`;

/** 高品質縮小：每次最多縮一半，一路縮到目標大小（一次縮很多倍會掉線條） */
function shrink(img: HTMLImageElement, scale: number): TexImageSource {
  if (scale >= 0.99) return img;
  let src: HTMLImageElement | HTMLCanvasElement = img;
  let w = img.naturalWidth, h = img.naturalHeight;
  const tw = Math.max(1, Math.round(w * scale)), th = Math.max(1, Math.round(h * scale));
  while (w > tw || h > th) {
    const nw = Math.max(tw, Math.round(w / 2)), nh = Math.max(th, Math.round(h / 2));
    const c = document.createElement("canvas");
    c.width = nw; c.height = nh;
    const g = c.getContext("2d");
    if (!g) return img;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.drawImage(src, 0, 0, nw, nh);
    src = c; w = nw; h = nh;
  }
  return src;
}

/** WebGL 繪圖：預乘 alpha、照 z 排序、眼珠用 stencil 夾在眼白裡 */
export class PetRenderer {
  private gl: WebGLRenderingContext;
  private prog: WebGLProgram;
  private tex = new Map<string, WebGLTexture>();
  private buf: { p: WebGLBuffer; t: WebGLBuffer; i: WebGLBuffer };
  private order: PetPart[];
  /**
   * pad：畫布比人四周多留的邊（模型座標）。被拎起來傾斜、跳起來時身體會超出站直的範圍，
   * 沒有這圈邊就會被畫布切掉。
   */
  constructor(readonly canvas: HTMLCanvasElement, public rig: Rig, readonly pad: [number, number] = [0, 0]) {
    const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, stencil: true, antialias: true });
    if (!gl) throw new Error("webgl unavailable");
    this.gl = gl;
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
    this.prog = gl.createProgram()!;
    gl.attachShader(this.prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(this.prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(this.prog);
    this.buf = { p: gl.createBuffer()!, t: gl.createBuffer()!, i: gl.createBuffer()! };
    this.order = [...rig.model.parts].sort((a, b) => a.z - b.z);
  }
  /**
   * scale：貼圖縮到畫面上實際大小的幾倍再上傳。原圖約 1000px 寬、畫出來只有一百多 px，
   * 直接交給 GPU 縮（WebGL1 非 2 的次方貼圖不能做 mipmap）黑線會鋸齒；先用畫布高品質縮小。
   */
  async load(base: string, scale = 1, parts: PetPart[] = this.rig.model.parts) {
    const gl = this.gl;
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    await Promise.all(parts.map(async (part) => {
      if (this.tex.has(part.tex)) return;
      const img = new Image();
      img.src = `${base}/${part.tex}`;
      await img.decode();
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, shrink(img, scale));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.tex.set(part.tex, t);
    }));
  }
  /** 換一套造型：新的骨架實例（同一副骨架、不同部件），用不到的舊貼圖放掉 */
  swap(rig: Rig) {
    this.rig = rig;
    this.order = [...rig.model.parts].sort((a, b) => a.z - b.z);
    const keep = new Set(rig.model.parts.map((p) => p.tex));
    for (const [name, t] of this.tex) if (!keep.has(name)) { this.gl.deleteTexture(t); this.tex.delete(name); }
  }
  private drawPart(part: PetPart, alpha: number) {
    const gl = this.gl, m = this.rig.mesh(part);
    const pos = this.rig.vertices(part);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.p); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
    const lp = gl.getAttribLocation(this.prog, "p"); gl.enableVertexAttribArray(lp); gl.vertexAttribPointer(lp, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.t); gl.bufferData(gl.ARRAY_BUFFER, m.uv, gl.DYNAMIC_DRAW);
    const lt = gl.getAttribLocation(this.prog, "t"); gl.enableVertexAttribArray(lt); gl.vertexAttribPointer(lt, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buf.i); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.idx, gl.DYNAMIC_DRAW);
    gl.bindTexture(gl.TEXTURE_2D, this.tex.get(part.tex)!);
    gl.uniform1f(gl.getUniformLocation(this.prog, "a"), alpha);
    gl.drawElements(gl.TRIANGLES, m.idx.length, gl.UNSIGNED_SHORT, 0);
  }
  /**
   * 畫布上 (u, v)（0–1，左上為原點，畫布本身的座標，不含 CSS 翻面）那一點現在畫出來有多不透明。
   * 先畫這一格再馬上讀，畫面不必保留（preserveDrawingBuffer 關著）；歪身、轉頭、表情都照實算。
   */
  alphaAt(u: number, v: number): number {
    this.draw();
    // 畫布緩衝區在記憶體吃緊的裝置上可能比 canvas.width 小：用實際的大小換算
    const gl = this.gl, w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const x = Math.min(w - 1, Math.max(0, Math.floor(u * w))), y = Math.min(h - 1, Math.max(0, Math.floor((1 - v) * h)));
    const px = new Uint8Array(4);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px[3] / 255;
  }
  draw() {
    const gl = this.gl, [W, H] = this.rig.model.size;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0); gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.uniform2f(gl.getUniformLocation(this.prog, "s"), W + this.pad[0] * 2, H + this.pad[1] * 2);
    gl.uniform2f(gl.getUniformLocation(this.prog, "o"), this.pad[0], this.pad[1]);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const masks = new Map<string, number>();
    for (const part of this.order) if (part.clipTo && !masks.has(part.clipTo)) masks.set(part.clipTo, masks.size + 1);
    for (const part of this.order) {
      const a = this.rig.opacity(part);
      const maskId = masks.get(part.id);
      if (part.clipTo) {
        gl.enable(gl.STENCIL_TEST);
        gl.stencilFunc(gl.EQUAL, masks.get(part.clipTo)!, 0xff);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      } else if (maskId) {
        // 遮罩本身照常畫，同時在不透明處寫下自己的編號
        gl.enable(gl.STENCIL_TEST);
        gl.stencilFunc(gl.ALWAYS, maskId, 0xff);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
      } else gl.disable(gl.STENCIL_TEST);
      if (a > 0.003) this.drawPart(part, a);
    }
    gl.disable(gl.STENCIL_TEST);
  }
}

/**
 * 四套造型共用一副骨架：白天／晚上是兩套衣服（skin），小惡魔是疊在任一套上的一層（overlay）。
 * 骨架只寫一次（節點、轉軸、物理）；衣服與疊加層只帶部件。後面的同名部件取代前面的
 * （例：小惡魔把軀幹換成滑肩那張），新的物理（尾巴）跟著疊加層一起帶進來。
 * 前提：四套的母圖站姿與構圖完全相同，晚上與小惡魔都是從白天那張改出來的。
 */
export interface PetSkeleton { size: [number, number]; nodes: PetNode[]; physics?: Pendulum[] }
export interface PetSkin { parts: PetPart[]; nodes?: PetNode[]; physics?: Pendulum[] }
export function compose(skeleton: PetSkeleton, ...skins: PetSkin[]): PetModel {
  const nodes = new Map(skeleton.nodes.map((n) => [n.id, n]));
  const parts = new Map<string, PetPart>();
  const physics = new Map((skeleton.physics ?? []).map((p) => [p.param, p]));
  for (const skin of skins) {
    for (const n of skin.nodes ?? []) nodes.set(n.id, n);
    for (const p of skin.physics ?? []) physics.set(p.param, p);
    for (const part of skin.parts) parts.set(part.id, part);
  }
  return { size: skeleton.size, nodes: [...nodes.values()], parts: [...parts.values()], physics: [...physics.values()] };
}
