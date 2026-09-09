/**
 * 3D 世界：three.js 場景、可操作的玩家、會閒逛的 NPC、光照預設、地點傳送、對話鏡頭、小地圖。
 *
 * 畫面走「動畫遊戲」的路：卡通著色（MeshToonMaterial + 三階漸層）、角色描邊（背面法線外擴）、
 * 光環與霓虹走 Bloom。世界從一份 WorldSpec 生出來：光照預設、地面、天空、建築、樹、路燈、擺設、
 * NPC 外觀與出生點、鏡頭與移動參數，全部是資料（shared/game-spec v2）。這裡沒有題材知識——
 * 「校園」只是 environment.kit === "campus" 時多長出來的一組程序化零件（道路、廣場、樹籬、全息終端）；
 * 酒館、飛船、地牢靠 kit "none" + props 擺出來，不改程式。
 *
 * 邊界：這裡只管畫面與操作，不知道 AI、對話或卡片協定。頁面把狀態（主數值、心情、目標、
 * 光照、地點、誰在說話）翻譯成這裡的方法呼叫；這裡把「靠近了誰」丟回去。
 *
 * ponytail: 碰撞只有圓對 AABB 的推出；沒有尋路、沒有物理引擎；要更多再接。
 */
import * as THREE from "three";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import type { Accessory, BuildingJson, EnvironmentSpec, LightPresetJson, LookJson, ModelJson, NpcSpec, NpcState, PropJson, WorldEvents, WorldSpec, XZ } from "./world-types";

export type { Accessory, BuildingJson, EnvironmentSpec, LightPresetJson, LookJson, ModelJson, NpcSpec, NpcState, PlaceSpec, PropJson, WorldEvents, WorldSpec, XZ } from "./world-types";

type HaloShape = "hex" | "ring" | "arc";
/**
 * 模型規格＝配置的 ModelJson，外加 FBX 綁骨流程才用得到的三個欄位（配置驗證不會放行它們，
 * 但 Tripo v1.0 的 FBX 路徑仍靠它們：FBX 動畫只能配 FBX 自己的骨架，貼圖從同任務的 GLB 搬）。
 */
type ModelSpec = ModelJson & {
  /** 額外動畫檔（一檔一個 clip）；本體是 FBX 時這些也要是同一綁骨任務輸出的 FBX */
  extra?: { name: string; url: string }[];
  /** 本體是 FBX 時，PBR 貼圖從這個 GLB 搬過來——FBX 匯出的材質只有 Phong 且常缺貼圖 */
  texturesFrom?: string;
  /** 本體自帶那段動畫的名字（FBX 一檔一段） */
  ownClip?: string;
};

const TALK_RANGE = 2.6;
const NPC_SPEED = 1.4;
/** 生成模型的走路 clip 在 timeScale=1 時大約前進 1.6 單位/秒（Tripo preset 步幅估值）；照實際速度縮放，腳才不會滑 */
const WALK_CLIP_SPEED = 1.6;
const PLAYER_R = 0.55;
/** 太陽強度到這個值就當「全日光」：雲、地平線板、玩家補光都用它換算白天程度 */
const DAYLIGHT_SUN = 2.6;
const WHITE = new THREE.Color(0xffffff);

/** 配置裡的顏色是 CSS 字串；three 只認逗號版的 hsl()/rgb()，空白分隔的先轉一下 */
function col(s: string | undefined, fallback: THREE.ColorRepresentation = 0xffffff): THREE.Color {
  if (!s) return new THREE.Color(fallback);
  const m = /^(hsla?|rgba?)\(([^)]*)\)$/i.exec(s.trim());
  if (m && !m[2].includes(",")) return new THREE.Color(`${m[1]}(${m[2].trim().split("/")[0].trim().split(/\s+/).join(", ")})`);
  return new THREE.Color(s);
}
/** 0（夜）..1（白天）：預設的太陽強度相對全日光 */
const daylight = (p: LightPresetJson) => THREE.MathUtils.clamp(p.sunIntensity / DAYLIGHT_SUN, 0, 1);
/** 雲與地平線板的色調：白天是白的，越暗越貼近天空底色 */
const hazeColor = (p: LightPresetJson) => col(p.skyBottom).lerp(WHITE, daylight(p));
/** 建築飾邊（窗帶、邊線、門、雨棚）從牆色推：淺牆壓深、深牆提亮，並加飽和；灰牆保持無彩 */
function accentOf(c: THREE.Color): THREE.Color {
  const hsl = { h: 0, s: 0, l: 0 }; c.getHSL(hsl);
  const s = hsl.s < 0.05 ? 0 : Math.min(1, hsl.s + 0.4);
  return new THREE.Color().setHSL(hsl.h, s, hsl.l > 0.5 ? Math.max(0.2, hsl.l - 0.3) : Math.min(0.8, hsl.l + 0.3));
}

// 三階漸層：卡通著色的明暗分界
const TOON_GRADIENT = (() => {
  const data = new Uint8Array([90, 170, 255]);
  const t = new THREE.DataTexture(data, 3, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();
const toon = (color: THREE.ColorRepresentation, extra: Partial<THREE.MeshToonMaterialParameters> = {}) =>
  new THREE.MeshToonMaterial({ color, gradientMap: TOON_GRADIENT, ...extra });
const OUTLINE = new THREE.MeshBasicMaterial({ color: 0x1b1d2e, side: THREE.BackSide });

/** 角色描邊：同一份幾何放大一點、只畫背面 */
function outlined(geo: THREE.BufferGeometry, mat: THREE.Material, grow = 1.06): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  const o = new THREE.Mesh(geo, OUTLINE);
  o.scale.setScalar(grow);
  m.add(o);
  return m;
}
/** 小零件：不描邊、不投影，省繪製 */
function plain(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh { return new THREE.Mesh(geo, mat); }

/** 暗角：把視線收到畫面中央，鏡頭邊緣的 HUD 也更好讀 */
const VIGNETTE = {
  uniforms: { tDiffuse: { value: null }, strength: { value: 0.35 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float strength; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv); float d = distance(vUv, vec2(0.5)); c.rgb *= 1.0 - smoothstep(0.45, 0.95, d) * strength; gl_FragColor = c; }`,
};

function softDisc(size = 128, inner = "rgba(255,255,255,0.9)", outer = "rgba(255,255,255,0)"): THREE.Texture {
  const c = document.createElement("canvas"); c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner); g.addColorStop(1, outer);
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

interface Figure { group: THREE.Group; halo: THREE.Mesh | null; legs: THREE.Mesh[]; arms: THREE.Mesh[]; head: THREE.Group; /** 生成模型才有：動畫混合器與各動作 */ anim?: { mixer: THREE.AnimationMixer; idle?: THREE.AnimationAction; walk?: THREE.AnimationAction; talk?: THREE.AnimationAction; current?: THREE.AnimationAction } }

/** 只把根骨的水平位移歸零：垂直分量是跳與起伏，保留（Tripo 的 in-place 選項會毀掉烘焙，這裡在匯入時處理） */
function stripRootMotion(clip: THREE.AnimationClip) {
  // Tripo 的走路 clip 把前進位移烘焙在 Hip（Root 底下第一根骨）的位置軌道上：一個循環網格在群組裡
  // 往前漂兩個多單位，循環結束彈回原點——玩家看到的就是「滑步」與「停下來倒退」。
  // 把那一軸的線性趨勢扣掉（保留同軸的上下起伏），角色就原地踏步、位移全交給群組。
  for (const tr of clip.tracks) {
    if (!/(^|\.|\|)(Hip|Hips|Pelvis)\.position$/.test(tr.name)) continue;
    const v = tr.values as Float32Array; const times = tr.times as Float32Array; const n = times.length;
    if (n < 2) continue;
    const dur = times[n - 1] - times[0]; if (dur <= 0) continue;
    let axis = 0, best = 0;
    for (let a = 0; a < 3; a++) { const d = Math.abs(v[(n - 1) * 3 + a] - v[a]); if (d > best) { best = d; axis = a; } }
    if (best < 1e-4) continue;
    const slope = (v[(n - 1) * 3 + axis] - v[axis]) / dur;
    for (let i = 0; i < n; i++) v[i * 3 + axis] -= slope * (times[i] - times[0]);
  }
  // FBX 的 Armature（物件層）變換是 FBX 自己的座標慣例，套到 GLB 上會讓整個人轉向、縮放；
  // GLB 的 Armature 靜止變換才是對的，這些軌道直接丟掉
  for (const tr of clip.tracks) {
    if (!/(^|\.|\|)Root\.position$/.test(tr.name)) continue;
    const v = tr.values as Float32Array; const x0 = v[0], z0 = v[2];
    for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; }
  }
}

/**
 * 載入生成的角色模型，包成跟人偶同介面的 Figure：縮到目標身高、腳踩 y=0、面向 +z、
 * 光環照舊程序化掛在頭頂。載入失敗回 null，呼叫端退回人偶。
 */
async function loadModelFigure(spec: ModelSpec, color: string, accessory: Accessory): Promise<Figure | null> {
  const halo = haloOf(accessory);
  try {
    const loader = new GLTFLoader();
    const fbxLoader = new FBXLoader();
    const isFbx = /\.fbx(\?|$)/i.test(spec.url);
    let root: THREE.Object3D; let ownClips: THREE.AnimationClip[] = [];
    if (isFbx) {
      const obj = await fbxLoader.loadAsync(spec.url);
      root = obj;
      // 同一個 take 會出現路徑深淺兩個版本，取淺的
      const takes = obj.animations.slice().sort((a, b) => a.name.split("|").length - b.name.split("|").length);
      if (takes[0]) { takes[0].name = spec.ownClip || "idle"; ownClips = [takes[0]]; }
      // 材質：FBX 只有 Phong，換成 Standard；貼圖從同一綁骨任務的 GLB 搬（UV 相同）
      let pbr: THREE.MeshStandardMaterial | null = null;
      if (spec.texturesFrom) {
        try { const g = await loader.loadAsync(spec.texturesFrom); g.scene.traverse((o) => { const m = o as THREE.Mesh; if (!pbr && m.isMesh && (m.material as THREE.MeshStandardMaterial).isMeshStandardMaterial) pbr = m.material as THREE.MeshStandardMaterial; }); }
        catch (e) { console.warn("[world] texturesFrom failed", e); }
      }
      root.traverse((o) => {
        const m = o as THREE.Mesh; if (!m.isMesh) return;
        const old = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshPhongMaterial;
        // GLB 貼圖是 flipY=false（glTF 慣例），FBX 網格的 UV 是 flipY=true 那一套：複製一份翻回來，否則整張貼圖上下顛倒、膚色變成頭髮色
        const flip = (t: THREE.Texture | null | undefined) => { if (!t) return null; const c = t.clone(); c.flipY = true; c.needsUpdate = true; return c; };
        // FBX 自帶的內嵌貼圖 UV 跟它自己的網格一致，優先用；沒有才從 GLB 搬（要翻 Y）
        const map = old.map || (pbr ? flip(pbr.map) : null);
        const normalMap = old.normalMap || (pbr ? flip(pbr.normalMap) : null);
        const mat = new THREE.MeshStandardMaterial({ map, normalMap, roughness: 0.85, metalness: 0, color: map ? 0xffffff : (old.color || new THREE.Color(0xdddddd)) });
        if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
        (m as THREE.SkinnedMesh).material = mat;
      });
    } else {
      const gltf: GLTF = await loader.loadAsync(spec.url);
      root = gltf.scene; ownClips = gltf.animations;
    }
    root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.frustumCulled = false; } });
    // 正規化：量包圍盒，縮到目標身高、底部貼地、水平置中
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const s = (spec.height ?? 2.2) / (size.y || 1);
    root.scale.setScalar(s);
    box.setFromObject(root);
    root.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
    // 朝向：包一層把模型原生朝向轉成 +z（跟人偶、移動與鏡頭同一套）
    const facing = new THREE.Group(); facing.rotation.y = spec.yaw ?? (isFbx ? -Math.PI / 2 : 0); facing.add(root);
    const g = new THREE.Group(); g.add(facing);
    const head = new THREE.Group(); head.position.y = (spec.height ?? 2.2) * 0.8; g.add(head);
    let haloMesh: THREE.Mesh | null = null;
    if (halo) {
      const geo = halo === "hex" ? new THREE.TorusGeometry(0.46, 0.045, 8, 6) : halo === "arc" ? new THREE.TorusGeometry(0.44, 0.05, 8, 32, Math.PI * 1.35) : new THREE.TorusGeometry(0.44, 0.04, 8, 40);
      haloMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.8), toneMapped: false }));
      haloMesh.position.y = (spec.height ?? 2.2) + 0.3; haloMesh.rotation.x = Math.PI / 2;
      if (halo === "arc") haloMesh.rotation.z = Math.PI * 0.82;
      g.add(haloMesh);
      const glow = new THREE.PointLight(new THREE.Color(color), 1.2, 4); glow.position.y = (spec.height ?? 2.2) + 0.2; g.add(glow);
    }
    // 動畫：本體帶的 + 額外檔（一檔一個 clip）
    const clips: THREE.AnimationClip[] = [...ownClips];
    // 額外動畫檔：GLB 直接取 animations[0]；FBX 用 FBXLoader，同一個 take 會出現兩個路徑深淺不同的版本，取路徑淺的那個
    for (const ex of spec.extra || []) {
      try {
        if (/\.fbx(\?|$)/i.test(ex.url)) {
          const obj = await fbxLoader.loadAsync(ex.url);
          const takes = obj.animations.slice().sort((a, b) => (a.name.split("|").length - b.name.split("|").length));
          const clip = takes[0];
          if (clip) { clip.name = ex.name; clips.push(clip); }
        } else {
          const extra = await loader.loadAsync(ex.url);
          if (extra.animations[0]) { extra.animations[0].name = ex.name; clips.push(extra.animations[0]); }
        }
      } catch (e) { console.warn("[world] extra clip failed", ex.name, e); }
    }
    let anim: Figure["anim"];
    if (clips.length) {
      clips.forEach(stripRootMotion);
      const mixer = new THREE.AnimationMixer(root);
      const pick = (want?: string, fallbackIdx?: number) => {
        const c = (want && clips.find((x) => x.name === want || x.name.toLowerCase().includes(want.toLowerCase()))) || (fallbackIdx !== undefined ? clips[fallbackIdx] : undefined);
        return c ? mixer.clipAction(c) : undefined;
      };
      anim = { mixer, idle: pick(spec.clips?.idle || "idle", 0), walk: pick(spec.clips?.walk || "walk"), talk: pick(spec.clips?.talk || "talk") };
      anim.current = anim.idle; anim.idle?.play();
      console.info("[world] model clips:", clips.map((c) => `${c.name} ${c.tracks.length} tracks ${c.duration.toFixed(2)}s`).join(", "));
    }
    return { group: g, halo: haloMesh, legs: [], arms: [], head, anim };
  } catch (e) {
    console.warn("[world] model load failed, using procedural figure:", spec.url, e);
    return null;
  }
}
interface Npc {
  spec: NpcSpec; fig: Figure; home: THREE.Vector3; target: THREE.Vector3 | null; nextWander: number;
  label: HTMLDivElement; mood: HTMLDivElement; moodText: string; quest: HTMLSpanElement; hearts: HTMLSpanElement; seed: number; speaking: boolean;
}

const GEO = new Map<string, THREE.BufferGeometry>();
const geo = <T extends THREE.BufferGeometry>(key: string, make: () => T): T => {
  let g = GEO.get(key) as T | undefined;
  if (!g) { g = make(); GEO.set(key, g); }
  return g;
};

const haloOf = (a: Accessory): HaloShape | null => (a === "none" ? null : (a.slice(5) as HaloShape));

function figure(color: string, look: LookJson, accessory: Accessory): Figure {
  const g = new THREE.Group();
  const halo = haloOf(accessory);
  const skin = toon(col(look.skin, 0xffe6d6));
  const top = toon(col(look.top, 0xf7f9ff));
  // 沒指定下身：裙子用角色主色、腿露膚色（制服感）；指定了就腿與裙同色（褲裝／長袍）
  const bottom = toon(look.bottom ? col(look.bottom) : col(color));
  const legMat = look.bottom ? bottom : skin;
  const accent = toon(col(look.accent, 0xc9223f));
  const shoeMat = toon(0x2a2f48);
  const hairMat = toon(col(look.hair, 0x3a2a22));
  const legs: THREE.Mesh[] = [];
  for (const x of [-0.16, 0.16]) {
    const leg = plain(geo(`CapsuleGeometry:0.12, 0.38, 4, 10`, () => new THREE.CapsuleGeometry(0.12, 0.38, 4, 10)), legMat);
    leg.position.set(x, 0.34, 0); g.add(leg); legs.push(leg);
    const shoe = plain(geo(`SphereGeometry:0.15, 10, 8`, () => new THREE.SphereGeometry(0.15, 10, 8)), shoeMat);
    shoe.position.set(x, 0.1, 0.04); shoe.scale.set(1, 0.7, 1.3); g.add(shoe);
  }
  // 身體：上衣 ＋ 裙襬 ＋ 領巾
  const body = outlined(geo(`CapsuleGeometry:0.34, 0.46, 6, 14`, () => new THREE.CapsuleGeometry(0.34, 0.46, 6, 14)), top);
  body.position.y = 0.98; g.add(body);
  const skirt = outlined(geo(`ConeGeometry:0.52, 0.46, 18, 1, false`, () => new THREE.ConeGeometry(0.52, 0.46, 18, 1, false)), bottom, 1.04);
  skirt.position.y = 0.72; g.add(skirt);
  const collar = plain(geo(`ConeGeometry:0.2, 0.28, 3`, () => new THREE.ConeGeometry(0.2, 0.28, 3)), accent);
  collar.position.set(0, 1.28, 0.3); collar.rotation.x = Math.PI; g.add(collar);
  const arms: THREE.Mesh[] = [];
  for (const x of [-0.42, 0.42]) {
    const arm = plain(geo(`CapsuleGeometry:0.09, 0.44, 4, 8`, () => new THREE.CapsuleGeometry(0.09, 0.44, 4, 8)), skin);
    arm.position.set(x, 1.02, 0); g.add(arm); arms.push(arm);
  }
  // 頭是一個子群組：點頭、看人都轉它。Q 版比例，頭大一點
  const head = new THREE.Group(); head.position.y = 1.76; g.add(head);
  head.add(outlined(geo(`SphereGeometry:0.46, 24, 18`, () => new THREE.SphereGeometry(0.46, 24, 18)), skin));
  const cap = outlined(geo(`SphereGeometry:0.5, 24, 18, 0, Math.PI * 2, 0, Math.PI * 0.6`, () => new THREE.SphereGeometry(0.5, 24, 18, 0, Math.PI * 2, 0, Math.PI * 0.6)), hairMat, 1.05);
  cap.position.set(0, 0.06, -0.04); head.add(cap);
  // 瀏海：三撮
  for (const [x, rz] of [[-0.22, 0.3], [0, 0], [0.22, -0.3]] as [number, number][]) {
    const bang = plain(geo(`ConeGeometry:0.12, 0.34, 6`, () => new THREE.ConeGeometry(0.12, 0.34, 6)), hairMat);
    bang.position.set(x, 0.12, 0.4); bang.rotation.x = Math.PI + 0.35; bang.rotation.z = rz; head.add(bang);
  }
  const style = look.hairStyle;
  if (style === "long") {
    const back = outlined(geo(`CapsuleGeometry:0.32, 0.8, 6, 12`, () => new THREE.CapsuleGeometry(0.32, 0.8, 6, 12)), hairMat);
    back.position.set(0, -0.5, -0.26); back.scale.set(1.15, 1, 0.55); head.add(back);
  } else if (style === "twin") {
    for (const x of [-0.52, 0.52]) {
      const tail = outlined(geo(`CapsuleGeometry:0.14, 0.78, 6, 10`, () => new THREE.CapsuleGeometry(0.14, 0.78, 6, 10)), hairMat);
      tail.position.set(x, -0.34, -0.08); tail.rotation.z = x > 0 ? -0.28 : 0.28; head.add(tail);
      const rib = plain(geo(`SphereGeometry:0.1, 8, 8`, () => new THREE.SphereGeometry(0.1, 8, 8)), toon(0xffffff));
      rib.position.set(x * 0.9, 0.08, -0.02); head.add(rib);
    }
  } else if (style === "bob") {
    const bob = outlined(geo(`CylinderGeometry:0.5, 0.42, 0.44, 22, 1, true`, () => new THREE.CylinderGeometry(0.5, 0.42, 0.44, 22, 1, true)), hairMat, 1.04);
    bob.position.set(0, -0.14, -0.02); head.add(bob);
    const bow = plain(geo(`BoxGeometry:0.34, 0.12, 0.08`, () => new THREE.BoxGeometry(0.34, 0.12, 0.08)), toon(0xffffff));
    bow.position.set(0.28, 0.32, 0.1); bow.rotation.z = -0.5; head.add(bow);
  }
  // 眼睛：大而亮，帶高光
  const iris = toon(0x2a3f7a); const glint = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (const x of [-0.16, 0.16]) {
    const eye = new THREE.Mesh(geo(`SphereGeometry:0.075, 10, 10`, () => new THREE.SphereGeometry(0.075, 10, 10)), iris);
    eye.position.set(x, -0.02, 0.41); eye.scale.set(0.9, 1.3, 0.5); head.add(eye);
    const hl = new THREE.Mesh(geo(`SphereGeometry:0.025, 6, 6`, () => new THREE.SphereGeometry(0.025, 6, 6)), glint);
    hl.position.set(x + 0.025, 0.02, 0.45); head.add(hl);
  }
  const blush = new THREE.MeshBasicMaterial({ color: 0xffb2c0, transparent: true, opacity: 0.55 });
  for (const x of [-0.3, 0.3]) {
    const b = new THREE.Mesh(geo(`CircleGeometry:0.07, 10`, () => new THREE.CircleGeometry(0.07, 10)), blush);
    b.position.set(x, -0.12, 0.36); b.lookAt(x * 3, -0.2, 2); head.add(b);
  }
  let haloMesh: THREE.Mesh | null = null;
  if (halo) {
    const haloGeo = halo === "hex" ? geo(`TorusGeometry:0.46, 0.045, 8, 6`, () => new THREE.TorusGeometry(0.46, 0.045, 8, 6))
      : halo === "arc" ? geo(`TorusGeometry:0.44, 0.05, 8, 32, Math.PI * 1.35`, () => new THREE.TorusGeometry(0.44, 0.05, 8, 32, Math.PI * 1.35))
      : geo(`TorusGeometry:0.44, 0.04, 8, 40`, () => new THREE.TorusGeometry(0.44, 0.04, 8, 40));
    // 光環用自發光的 Basic：Bloom 會把它抓出來發光
    haloMesh = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.8), toneMapped: false }));
    haloMesh.position.y = 2.56; haloMesh.rotation.x = Math.PI / 2;
    if (halo === "arc") haloMesh.rotation.z = Math.PI * 0.82;
    g.add(haloMesh);
    const glow = new THREE.PointLight(new THREE.Color(color), 1.2, 4); glow.position.y = 2.5; g.add(glow);
  }
  return { group: g, halo: haloMesh, legs, arms, head };
}

function plazaTexture(): THREE.Texture {
  const c = document.createElement("canvas"); c.width = c.height = 512;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#f1f4f9"; ctx.fillRect(0, 0, 512, 512);
  ctx.strokeStyle = "rgba(90,130,180,0.28)"; ctx.lineWidth = 3;
  const r = 36, h = Math.sqrt(3) * r;
  for (let row = -1; row < 512 / h + 1; row++) for (let col = -1; col < 512 / (1.5 * r) + 1; col++) {
    const cx = col * 1.5 * r, cy = row * h + (col % 2 ? h / 2 : 0);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = (Math.PI / 3) * i; ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
    ctx.closePath(); ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

function gridTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = "rgba(60,90,140,0.28)"; ctx.lineWidth = 2; ctx.strokeRect(1, 1, 254, 254);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 天空：一顆反面的大球，頂到底的漸層寫在頂點色上，換色溫時重算 */
function skyDome(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(220, 24, 12);
  geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  m.renderOrder = -1;
  return m;
}
function paintSky(sky: THREE.Mesh, top: string, bottom: string) {
  const pos = sky.geometry.attributes.position; const attr = sky.geometry.attributes.color as THREE.BufferAttribute;
  const a = col(top), b = col(bottom), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    c.copy(b).lerp(a, THREE.MathUtils.clamp((pos.getY(i) / 220) * 1.8, 0, 1));
    attr.setXYZ(i, c.r, c.g, c.b);
  }
  attr.needsUpdate = true;
}

export class World {
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private labels: CSS2DRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private sky: THREE.Mesh;
  /** 地平線全景帶：生成的天空板貼在大圓柱內側，鏡像重複免接縫；換色溫用顏色乘法 */
  private horizon: THREE.Mesh | null = null;
  private ground: THREE.Mesh;
  /** 地面的基底色（environment.ground.color）；每次換光照乘上預設的 ground 色 */
  private groundBase: THREE.Color;
  /** 會隨光照預設 lamp 值一起亮暗的材質：路燈、窗帶、窗格、發光擺設 */
  private lampMats: THREE.MeshStandardMaterial[] = [];
  private presets = new Map<string, LightPresetJson>();
  private preset: LightPresetJson;
  private env: EnvironmentSpec;
  /** 可走範圍半徑（也是小地圖的視野）：跟著地面大小走 */
  private bound: number;
  private clouds: THREE.Sprite[] = [];
  private holo: THREE.Group | null = null;
  private talkRing: THREE.Mesh;
  private dust: { m: THREE.Sprite; life: number }[] = [];
  private dustTimer = 0;
  private frame = 0;
  private fill!: THREE.PointLight;
  private roofBits: { x: number; z: number; w: number; h: number; d: number }[] = [];
  private player: Figure;
  private playerLabel: HTMLDivElement;
  private npcs: Npc[] = [];
  private blockers: THREE.Box2[] = [];
  private keys = new Set<string>();
  private target: THREE.Vector3 | null = null;
  private locked = false;
  private focusNpc: Npc | null = null;
  private near: string | null = null;
  private clock = new THREE.Clock();
  private raf = 0;
  private ray = new THREE.Raycaster();
  private yaw = 0;
  private dist: number;
  private drag: { x: number; yaw: number; button: number; startX: number; startY: number; moved: boolean } | null = null;
  private minimap: HTMLCanvasElement | null = null;
  private disposed = false;
  /** 截圖／檢查用：暫停模擬，畫面照常渲染 */
  paused = false;
  private ro: ResizeObserver;

  constructor(private canvas: HTMLCanvasElement, labelsEl: HTMLElement, private spec: WorldSpec, private events: WorldEvents) {
    for (const p of spec.lighting.presets) this.presets.set(p.id, p);
    this.preset = this.presetFor(spec.lighting.default);
    const env = this.env = spec.environment;
    const size = env.ground.size;
    this.bound = size * 0.41;
    this.dist = spec.camera.distance;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    const lowEnd = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, lowEnd ? 1.5 : 2));
    // 手機沒有陰影：陰影 pass 會把整個場景再畫一遍
    this.renderer.shadowMap.enabled = !lowEnd;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.info.autoReset = false;
    this.labels = new CSS2DRenderer({ element: labelsEl });
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 600);
    this.scene.fog = new THREE.Fog(0xc8dcf6, this.preset.fogNear, this.preset.fogFar);
    this.sky = skyDome(); this.scene.add(this.sky);
    if (env.sky) new THREE.TextureLoader().load(env.sky, (tex) => {
      if (this.disposed) return;
      tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.MirroredRepeatWrapping; tex.repeat.x = 3; tex.anisotropy = 4;
      const geo = new THREE.CylinderGeometry(190, 190, 150, 64, 1, true);
      const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false, transparent: true });
      this.horizon = new THREE.Mesh(geo, mat); this.horizon.position.y = 60; this.horizon.renderOrder = -1;
      this.scene.add(this.horizon);
      this.applyHorizonTint();
    });

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x8899bb, 1);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -size / 4; sc.right = sc.top = size / 4; sc.far = 160;
    this.scene.add(this.sun);

    this.groundBase = col(env.ground.color, 0xb9cfe0);
    const groundMat = new THREE.MeshStandardMaterial({ map: this.groundTexture(env.ground.texture, size), roughness: 0.95 });
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), groundMat);
    this.ground.rotation.x = -Math.PI / 2; this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    if (env.kit === "campus") this.addCampusGround();
    for (const b of env.buildings) this.addBuilding(b);
    this.addTrees(env.trees);
    this.addLamps(env.lamps);
    for (const p of env.props) this.addProp(p);
    if (env.kit === "campus") {
      this.addBenches();
      this.addBuildingBits();
      this.addHedges();
      this.addTerminal(spec.npcs[0]?.pos ?? [0, -3]);
    }
    if (env.skyline) this.addSkyline();
    if (env.clouds) this.addClouds();
    // 對話範圍：走進誰的範圍，誰腳下亮一圈
    this.talkRing = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.3, 40), new THREE.MeshBasicMaterial({ color: 0x8fd6ff, transparent: true, opacity: 0.85, toneMapped: false, side: THREE.DoubleSide }));
    this.talkRing.rotation.x = -Math.PI / 2; this.talkRing.position.y = 0.03; this.talkRing.visible = false;
    this.scene.add(this.talkRing);
    const dustTex = softDisc(64, "rgba(255,255,255,0.7)");
    for (let i = 0; i < 14; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dustTex, transparent: true, opacity: 0, depthWrite: false }));
      s.scale.setScalar(0.5); s.visible = false; this.scene.add(s); this.dust.push({ m: s, life: 0 });
    }

    this.player = figure(spec.player.look.top ?? "#2b2f45", spec.player.look, "none");
    this.player.group.position.set(spec.player.spawn[0], 0, spec.player.spawn[1]);
    this.player.group.rotation.y = Math.PI;
    this.scene.add(this.player.group);
    this.playerLabel = document.createElement("div");
    this.playerLabel.className = "w-label w-label--you";
    const pl = new CSS2DObject(this.playerLabel); pl.position.y = 3.1; this.player.group.add(pl);

    spec.npcs.forEach((n, i) => this.addNpc(n, i));
    if (spec.player.model) void this.setPlayerModel(spec.player.model);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.18, 0.5, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new ShaderPass(VIGNETTE));
    this.composer.addPass(new OutputPass());

    this.fill = new THREE.PointLight(0xffe2b8, 0, 9, 1.5); this.fill.position.set(0.6, 2.6, 1.2); this.player.group.add(this.fill);
    this.setTint(spec.lighting.default);
    this.camera.position.copy(this.player.group.position).add(this.camOffset());
    this.camera.lookAt(this.player.group.position);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement || canvas);
    this.resize();
    this.bind();
    this.loop();
    // 開發時把世界掛到 window，方便在主控台驅動（正式 build 會被剝掉）
    if (import.meta.env.DEV) (window as unknown as { __world?: World }).__world = this;
  }

  // ---- 建造 ---------------------------------------------------------------

  private presetFor(id: string): LightPresetJson {
    return this.presets.get(id) ?? this.presets.get(this.spec.lighting.default) ?? this.spec.lighting.presets[0];
  }

  /** 地面貼圖：內建兩種程序化（格線／六角地磚）、不貼、或作者的網址；重複次數跟著地面大小 */
  private groundTexture(kind: string, size: number): THREE.Texture | null {
    if (kind === "plain") return null;
    if (kind === "grid") { const t = gridTexture(); t.repeat.set(size / 6, size / 6); return t; }
    if (kind === "plaza") { const t = plazaTexture(); t.repeat.set(size / 8, size / 8); return t; }
    return new THREE.TextureLoader().load(kind, (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(size / 8, size / 8); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.needsUpdate = true; });
  }

  /** 校園套件的地面層：草坪、十字主路、中央廣場與發光環 */
  private addCampusGround() {
    const grass = new THREE.MeshStandardMaterial({ color: 0x9fd39a, roughness: 1 });
    for (const [x, z] of [[-30, 30], [30, 30], [-30, -34], [30, -34]] as XZ[]) {
      const g = new THREE.Mesh(new THREE.CircleGeometry(16, 28), grass);
      g.rotation.x = -Math.PI / 2; g.position.set(x, 0.005, z); g.receiveShadow = true; this.scene.add(g);
    }
    const pathM = new THREE.MeshStandardMaterial({ color: 0xe9eef7, roughness: 0.9 });
    const lineM = new THREE.MeshBasicMaterial({ color: 0x8fd6ff, toneMapped: false });
    for (const [w, d] of [[7, 160], [160, 7]] as XZ[]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), pathM);
      p.rotation.x = -Math.PI / 2; p.position.y = 0.01; p.receiveShadow = true; this.scene.add(p);
      const l = new THREE.Mesh(new THREE.PlaneGeometry(w > d ? w : 0.12, w > d ? 0.12 : d), lineM);
      l.rotation.x = -Math.PI / 2; l.position.y = 0.02; this.scene.add(l);
    }
    const plazaTex = plazaTexture(); plazaTex.repeat.set(2.2, 2.2);
    const plaza = new THREE.Mesh(new THREE.CircleGeometry(9, 40), new THREE.MeshStandardMaterial({ map: plazaTex, roughness: 0.8 }));
    plaza.rotation.x = -Math.PI / 2; plaza.position.y = 0.015; plaza.receiveShadow = true; this.scene.add(plaza);
    const ring = new THREE.Mesh(new THREE.RingGeometry(8.6, 9, 48), lineM);
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.025; this.scene.add(ring);
  }

  private addBuilding(b: BuildingJson) {
    const [x, z] = b.pos; const [w, h, d] = b.size;
    const wall = col(b.color, 0xf6f8fc);
    const accent = accentOf(wall);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: wall, roughness: 0.55, metalness: 0.05 }));
    m.position.set(x, h / 2, z); m.castShadow = true; m.receiveShadow = true; this.scene.add(m);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: accent, toneMapped: false }));
    edges.position.copy(m.position); this.scene.add(edges);
    // 玻璃帶：一層層的窗，晚上會亮；顏色跟牆色同系
    const rows = Math.max(1, Math.floor(h / 2.6));
    const bandMat = new THREE.MeshStandardMaterial({ color: accent.clone().lerp(WHITE, 0.3), emissive: accent, emissiveIntensity: this.preset.lamp, roughness: 0.2, metalness: 0.4 });
    this.lampMats.push(bandMat);
    for (let r = 0; r < rows; r++) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, 0.7, d + 0.06), bandMat);
      band.position.set(x, 1.6 + r * 2.6, z); this.scene.add(band);
    }
    // 屋頂飾條；屋頂設備（空調箱、天線）只有校園套件會長
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.25, d + 0.4), new THREE.MeshStandardMaterial({ color: accent.clone().multiplyScalar(0.6), roughness: 0.5 }));
    roof.position.set(x, h + 0.12, z); this.scene.add(roof);
    this.roofBits.push({ x, z, w, h, d });
    // 窗格：四個立面各鋪一格網，實例化一次畫完
    const cols = Math.max(2, Math.floor(w / 1.6)), colsD = Math.max(2, Math.floor(d / 1.6)), floors = Math.max(1, Math.floor(h / 2.6));
    const count = (cols * 2 + colsD * 2) * floors;
    const winMat = new THREE.MeshStandardMaterial({ color: accent.clone().lerp(WHITE, 0.45), emissive: accent, emissiveIntensity: this.preset.lamp, roughness: 0.25, metalness: 0.3 });
    this.lampMats.push(winMat);
    const win = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.9, 1.2), winMat, count);
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), s1 = new THREE.Vector3(1, 1, 1);
    let k = 0;
    const place = (px: number, py: number, pz: number, ry: number) => { q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry); mtx.compose(new THREE.Vector3(px, py, pz), q, s1); win.setMatrixAt(k++, mtx); };
    for (let f = 0; f < floors; f++) {
      const py = 1.0 + f * 2.6;
      for (let i = 0; i < cols; i++) {
        const px = x - w / 2 + (i + 0.5) * (w / cols);
        place(px, py, z + d / 2 + 0.03, 0); place(px, py, z - d / 2 - 0.03, Math.PI);
      }
      for (let i = 0; i < colsD; i++) {
        const pz = z - d / 2 + (i + 0.5) * (d / colsD);
        place(x + w / 2 + 0.03, py, pz, Math.PI / 2); place(x - w / 2 - 0.03, py, pz, -Math.PI / 2);
      }
    }
    win.count = k; win.instanceMatrix.needsUpdate = true; this.scene.add(win);

    // 門廊：有名字的建築正面（+z）開一扇門加雨棚與踏階
    if (b.label) {
      const door = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.6, 0.2), new THREE.MeshStandardMaterial({ color: accent.clone().multiplyScalar(0.5), emissive: accent, emissiveIntensity: 0.15, roughness: 0.3 }));
      door.position.set(x, 1.3, z + d / 2 + 0.1); this.scene.add(door);
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(4, 0.16, 1.8), new THREE.MeshStandardMaterial({ color: accent, transparent: true, opacity: 0.55, roughness: 0.1, metalness: 0.3 }));
      canopy.position.set(x, 3.1, z + d / 2 + 0.9); canopy.castShadow = true; this.scene.add(canopy);
      const stepM = new THREE.MeshStandardMaterial({ color: 0xd5dde9, roughness: 0.8 });
      for (let i = 0; i < 2; i++) { const st = new THREE.Mesh(new THREE.BoxGeometry(4.6 - i, 0.18, 1.2 - i * 0.4), stepM); st.position.set(x, 0.09 + i * 0.18, z + d / 2 + 1.2 - i * 0.4); st.receiveShadow = true; this.scene.add(st); }
    }
    if (b.label) {
      const el = document.createElement("div"); el.className = "w-label w-label--place"; el.textContent = b.label;
      const o = new CSS2DObject(el); o.position.set(x, h + 1.4, z); this.scene.add(o);
    }
    this.blockers.push(new THREE.Box2(new THREE.Vector2(x - w / 2 - PLAYER_R, z - d / 2 - PLAYER_R), new THREE.Vector2(x + w / 2 + PLAYER_R, z + d / 2 + PLAYER_R)));
  }

  /**
   * 擺設：方塊／圓柱／球，或一個 GLB。尺寸 [w,h,d]，底部放在 y（預設地面），繞 y 轉 rotation。
   * 有 emissive 的跟路燈一起隨光照預設亮暗；solid 預設擋路（旋轉後取外接 AABB，夠用）。
   */
  private addProp(p: PropJson) {
    const [w, h, d] = p.size; const [x, z] = p.pos; const ry = p.rotation ?? 0;
    const g = new THREE.Group(); g.position.set(x, p.y ?? 0, z); g.rotation.y = ry; this.scene.add(g);
    const mat = new THREE.MeshStandardMaterial({ color: col(p.color, 0xc9ced8), emissive: p.emissive ? col(p.emissive) : 0x000000, emissiveIntensity: this.preset.lamp, roughness: 0.7 });
    if (p.emissive) this.lampMats.push(mat);
    const primitive = () => {
      const geo = p.shape === "cylinder" ? new THREE.CylinderGeometry(w / 2, w / 2, h, 20) : p.shape === "sphere" ? new THREE.SphereGeometry(w / 2, 20, 14) : new THREE.BoxGeometry(w, h, d);
      const m = new THREE.Mesh(geo, mat); m.position.y = h / 2; m.castShadow = m.receiveShadow = true; g.add(m);
    };
    if (p.shape === "model" && p.url) {
      new GLTFLoader().load(p.url, (gltf) => {
        if (this.disposed) return;
        const root = gltf.scene;
        root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.castShadow = m.receiveShadow = true; });
        // 縮到目標高度、底部貼地、水平置中——跟角色模型同一套正規化
        const box = new THREE.Box3().setFromObject(root);
        root.scale.setScalar(h / (box.getSize(new THREE.Vector3()).y || 1));
        box.setFromObject(root);
        root.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
        g.add(root);
      }, undefined, (e) => { console.warn("[world] prop model failed, using box:", p.url, e); if (!this.disposed) primitive(); });
    } else primitive();
    if (p.label) {
      const el = document.createElement("div"); el.className = "w-label w-label--place"; el.textContent = p.label;
      const o = new CSS2DObject(el); o.position.y = h + 0.6; g.add(o);
    }
    if (p.solid !== false) {
      const fd = p.shape === "box" || p.shape === "model" ? d : w;
      const c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry));
      const ex = (c * w + s * fd) / 2 + PLAYER_R, ez = (s * w + c * fd) / 2 + PLAYER_R;
      this.blockers.push(new THREE.Box2(new THREE.Vector2(x - ex, z - ez), new THREE.Vector2(x + ex, z + ez)));
    }
  }

  /** 所有樹一起畫：樹幹、兩層樹冠各一個實例網格，外加描邊版 */
  private addTrees(spots: XZ[]) {
    if (!spots.length) return;
    const parts: [THREE.BufferGeometry, THREE.Material, (x: number, z: number) => THREE.Vector3, number][] = [
      [new THREE.CylinderGeometry(0.16, 0.24, 1.7, 8), toon(0x8a6a4a), (x, z) => new THREE.Vector3(x, 0.85, z), 1.05],
      [new THREE.IcosahedronGeometry(1.5, 1), toon(0x7ccf8c), (x, z) => new THREE.Vector3(x, 2.7, z), 1.03],
      [new THREE.IcosahedronGeometry(1.0, 1), toon(0x9be0a0), (x, z) => new THREE.Vector3(x + 0.5, 3.6, z - 0.3), 1.04],
    ];
    const mtx = new THREE.Matrix4();
    for (const [g, m, at, grow] of parts) {
      const im = new THREE.InstancedMesh(g, m, spots.length);
      const ol = new THREE.InstancedMesh(g, OUTLINE, spots.length);
      spots.forEach(([x, z], i) => {
        const p = at(x, z);
        im.setMatrixAt(i, mtx.compose(p, new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)));
        ol.setMatrixAt(i, mtx.compose(p, new THREE.Quaternion(), new THREE.Vector3(grow, grow, grow)));
      });
      im.castShadow = true; this.scene.add(im, ol);
    }
    for (const [x, z] of spots) this.blockers.push(new THREE.Box2(new THREE.Vector2(x - 0.6, z - 0.6), new THREE.Vector2(x + 0.6, z + 0.6)));
  }

  /** 所有燈柱一起畫：桿、燈、旗桿、旗、旗上白條各一個實例網格 */
  private addLamps(spots: XZ[]) {
    if (!spots.length) return;
    const dark = new THREE.MeshStandardMaterial({ color: 0x3b4560 });
    const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff1c0, emissive: 0xffd77a, emissiveIntensity: 0.1 });
    this.lampMats.push(bulbMat);
    const parts: [THREE.BufferGeometry, THREE.Material, THREE.Vector3, THREE.Euler, boolean][] = [
      [new THREE.CylinderGeometry(0.06, 0.09, 3.6, 8), dark, new THREE.Vector3(0, 1.8, 0), new THREE.Euler(), true],
      [new THREE.CapsuleGeometry(0.16, 0.3, 6, 10), bulbMat, new THREE.Vector3(0, 3.75, 0), new THREE.Euler(), false],
      [new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6), dark, new THREE.Vector3(0.4, 2.9, 0), new THREE.Euler(0, 0, Math.PI / 2), false],
      [new THREE.PlaneGeometry(0.7, 1.1), new THREE.MeshStandardMaterial({ color: 0x5ec2f5, side: THREE.DoubleSide, roughness: 0.8 }), new THREE.Vector3(0.5, 2.3, 0), new THREE.Euler(), false],
      [new THREE.PlaneGeometry(0.7, 0.18), new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide }), new THREE.Vector3(0.5, 2.55, 0.005), new THREE.Euler(), false],
    ];
    const mtx = new THREE.Matrix4(); const one = new THREE.Vector3(1, 1, 1);
    for (const [g, m, off, rot, shadow] of parts) {
      const im = new THREE.InstancedMesh(g, m, spots.length);
      spots.forEach(([x, z], i) => im.setMatrixAt(i, mtx.compose(new THREE.Vector3(x + off.x, off.y, z + off.z), new THREE.Quaternion().setFromEuler(rot), one)));
      im.castShadow = shadow; this.scene.add(im);
    }
  }

  /** 建築的重複構件（角柱、屋頂空調箱、桅杆、信標）：全部建築收齊後各畫一次 */
  private addBuildingBits() {
    const bits = this.roofBits; if (!bits.length) return;
    const mtx = new THREE.Matrix4(); const q = new THREE.Quaternion();
    const pillars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 1, 0.5), new THREE.MeshStandardMaterial({ color: 0xe4ebf5, roughness: 0.5 }), bits.length * 4);
    const acs = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.9, 1), new THREE.MeshStandardMaterial({ color: 0xd9e2ee, roughness: 0.7 }), bits.length);
    const masts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.07, 3.2, 6), new THREE.MeshStandardMaterial({ color: 0x9aa7bd }), bits.length);
    const beacons = new THREE.InstancedMesh(new THREE.SphereGeometry(0.14, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff6b7a, toneMapped: false }), bits.length);
    bits.forEach(({ x, z, w, h, d }, i) => {
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz], k) => pillars.setMatrixAt(i * 4 + k, mtx.compose(new THREE.Vector3(x + sx * w / 2, (h + 0.3) / 2, z + sz * d / 2), q, new THREE.Vector3(1, h + 0.3, 1))));
      acs.setMatrixAt(i, mtx.compose(new THREE.Vector3(x - w * 0.25, h + 0.7, z + d * 0.15), q, new THREE.Vector3(Math.min(2.4, w * 0.3), 1, Math.min(1.6, d * 0.3))));
      masts.setMatrixAt(i, mtx.compose(new THREE.Vector3(x + w * 0.3, h + 1.7, z - d * 0.2), q, new THREE.Vector3(1, 1, 1)));
      beacons.setMatrixAt(i, mtx.compose(new THREE.Vector3(x + w * 0.3, h + 3.4, z - d * 0.2), q, new THREE.Vector3(1, 1, 1)));
    });
    pillars.castShadow = true; acs.castShadow = true;
    this.scene.add(pillars, acs, masts, beacons);
  }

  /** 綠籬：沿主路兩側一段段的方塊灌木，實例化 */
  private addHedges() {
    const geo = new THREE.BoxGeometry(3, 0.7, 0.8);
    const mat = toon(0x6fbf7d);
    const spots: [number, number, number][] = [];
    for (let z = -40; z <= 40; z += 8) { if (Math.abs(z) < 12) continue; spots.push([-5.2, z, 0], [5.2, z, 0]); }
    for (let x = -40; x <= 40; x += 8) { if (Math.abs(x) < 12) continue; spots.push([x, -5.2, Math.PI / 2], [x, 5.2, Math.PI / 2]); }
    const im = new THREE.InstancedMesh(geo, mat, spots.length);
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion();
    spots.forEach(([x, z, ry], i) => { q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry); mtx.compose(new THREE.Vector3(x, 0.35, z), q, new THREE.Vector3(1, 1, 1)); im.setMatrixAt(i, mtx); });
    im.castShadow = true; im.receiveShadow = true; this.scene.add(im);
  }

  /** 遠景：一圈高低不一的深色樓影，撐出城市的尺度；不投影、不吃碰撞 */
  private addSkyline() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x9fb4d6, roughness: 1, flatShading: true });
    const count = 46;
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, count);
    const mtx = new THREE.Matrix4(); const q = new THREE.Quaternion();
    let seed = 7; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rnd() * 0.1, r = 105 + rnd() * 30;
      const h = 14 + rnd() * 34, wdt = 8 + rnd() * 10;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
      mtx.compose(new THREE.Vector3(Math.cos(a) * r, h / 2, Math.sin(a) * r), q, new THREE.Vector3(wdt, h, wdt));
      im.setMatrixAt(i, mtx);
    }
    this.scene.add(im);
    // 樓頂燈：夜裡一排紅點
    const lights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 6, 6), new THREE.MeshBasicMaterial({ color: 0xff5566, toneMapped: false }), count);
    for (let i = 0; i < count; i++) { im.getMatrixAt(i, mtx); const p = new THREE.Vector3().setFromMatrixPosition(mtx); const s = new THREE.Vector3().setFromMatrixScale(mtx); lights.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, s.y + 0.6, p.z)); }
    this.scene.add(lights);
  }

  /** 雲：幾張柔邊的大貼圖，高高地慢慢飄 */
  private addClouds() {
    const tex = softDisc(256, "rgba(255,255,255,0.95)", "rgba(255,255,255,0)");
    let seed = 3; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    for (let i = 0; i < 16; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.85, depthWrite: false, fog: false }));
      s.position.set((rnd() - 0.5) * 240, 40 + rnd() * 25, (rnd() - 0.5) * 240);
      s.scale.set(22 + rnd() * 26, 9 + rnd() * 8, 1);
      this.scene.add(s); this.clouds.push(s);
    }
  }

  /** 什亭之匣終端：阿羅娜旁邊的全息台——底座、旋轉的六角環、半透明面板 */
  private addTerminal([nx, nz]: XZ) {
    const g = new THREE.Group();
    const base = outlined(new THREE.CylinderGeometry(0.9, 1.1, 0.5, 8), toon(0x2f3a5a), 1.03); base.position.y = 0.25; g.add(base);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 1.2, 8), new THREE.MeshStandardMaterial({ color: 0xcfe0f5, roughness: 0.3, metalness: 0.4 })); stem.position.y = 1.1; g.add(stem);
    const holoM = new THREE.MeshBasicMaterial({ color: 0x8fd6ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, toneMapped: false, depthWrite: false });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.1), holoM); panel.position.y = 2.3; g.add(panel);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.03, 6, 6), new THREE.MeshBasicMaterial({ color: 0xb9e8ff, toneMapped: false })); ring.rotation.x = Math.PI / 2; ring.position.y = 1.75; ring.name = "ring"; g.add(ring);
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.025, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })); ring2.rotation.x = Math.PI / 2; ring2.position.y = 2.0; ring2.name = "ring2"; g.add(ring2);
    const light = new THREE.PointLight(0x8fd6ff, 1.5, 6); light.position.y = 2.2; g.add(light);
    g.position.set(nx + 2.4, 0, nz - 0.6);
    this.scene.add(g); this.holo = g;
    this.blockers.push(new THREE.Box2(new THREE.Vector2(g.position.x - 1.1, g.position.z - 1.1), new THREE.Vector2(g.position.x + 1.1, g.position.z + 1.1)));
  }

  private addBenches() {
    const wood = toon(0xc99a66); const iron = toon(0x2f3550);
    for (const [x, z, ry] of [[-6, 10, 0], [6, 10, 0], [-6, 18, Math.PI], [6, 18, Math.PI]] as [number, number, number][]) {
      const g = new THREE.Group();
      const seat = outlined(new THREE.BoxGeometry(2.2, 0.12, 0.6), wood, 1.03); seat.position.y = 0.5; g.add(seat);
      const back = outlined(new THREE.BoxGeometry(2.2, 0.5, 0.1), wood, 1.03); back.position.set(0, 0.85, -0.28); g.add(back);
      for (const lx of [-0.9, 0.9]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.5), iron); leg.position.set(lx, 0.25, 0); g.add(leg); }
      g.position.set(x, 0, z); g.rotation.y = ry; this.scene.add(g);
      this.blockers.push(new THREE.Box2(new THREE.Vector2(x - 1.3, z - 0.6), new THREE.Vector2(x + 1.3, z + 0.6)));
    }
  }

  private addNpc(spec: NpcSpec, i: number) {
    const fig = figure(spec.color, spec.look, spec.accessory);
    fig.group.position.set(spec.pos[0], 0, spec.pos[1]);
    fig.group.rotation.y = spec.face;
    this.scene.add(fig.group);
    if (spec.model) void this.swapNpcModel(spec.name, spec.model, spec.color, spec.accessory);
    const label = document.createElement("div");
    label.className = "w-label w-label--npc";
    label.style.setProperty("--c", spec.color);
    const quest = document.createElement("span"); quest.className = "w-quest"; quest.textContent = "!"; quest.hidden = true;
    const name = document.createElement("b"); name.textContent = spec.name;
    const hearts = document.createElement("span"); hearts.className = "w-hearts";
    label.append(quest, name, hearts);
    const lo = new CSS2DObject(label); lo.position.y = 3.15; fig.group.add(lo);
    const mood = document.createElement("div"); mood.className = "w-mood"; mood.hidden = true;
    const mo = new CSS2DObject(mood); mo.position.y = 4; fig.group.add(mo);
    this.npcs.push({ spec, fig, home: fig.group.position.clone(), target: null, nextWander: 2 + Math.random() * 4, label, mood, moodText: "", quest, hearts, seed: i * 1.7, speaking: false });
  }

  /** 生成模型載好後換掉人偶：位置、朝向、標籤與心情泡泡原樣搬過去 */
  private async swapNpcModel(name: string, model: ModelSpec, color: string, accessory: Accessory) {
    const loaded = await loadModelFigure(model, color, accessory);
    const n = this.npcs.find((x) => x.spec.name === name);
    if (!loaded || !n || this.disposed) return;
    const old = n.fig.group;
    loaded.group.position.copy(old.position); loaded.group.rotation.copy(old.rotation);
    for (const child of [...old.children]) if (child instanceof CSS2DObject) { old.remove(child); loaded.group.add(child); }
    this.scene.remove(old);
    this.scene.add(loaded.group);
    n.fig = loaded;
    if (this.focusNpc === n) this.focusNpc = n;
  }

  /** 玩家也可以換生成模型 */
  async setPlayerModel(model: ModelJson) {
    const loaded = await loadModelFigure(model, this.spec.player.look.top ?? "#2b2f45", "none");
    if (!loaded || this.disposed) return;
    const old = this.player.group;
    loaded.group.position.copy(old.position); loaded.group.rotation.copy(old.rotation);
    for (const child of [...old.children]) if (child instanceof CSS2DObject) { old.remove(child); loaded.group.add(child); }
    if (this.fill) { old.remove(this.fill); loaded.group.add(this.fill); }
    this.scene.remove(old); this.scene.add(loaded.group);
    this.player = loaded;
  }

  // ---- 外部狀態 -----------------------------------------------------------

  private applyHorizonTint() {
    if (!this.horizon) return;
    const m = this.horizon.material as THREE.MeshBasicMaterial;
    m.color.copy(hazeColor(this.preset));
    m.opacity = 0.85 + 0.15 * daylight(this.preset);
  }

  /** 換光照預設（id 來自 spec.lighting.presets；不認識的退回 default） */
  setTint(id: string) {
    const p = this.preset = this.presetFor(id);
    this.applyHorizonTint();
    paintSky(this.sky, p.skyTop, p.skyBottom);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(col(p.fog)); fog.near = p.fogNear; fog.far = p.fogFar;
    (this.ground.material as THREE.MeshStandardMaterial).color.copy(this.groundBase).multiply(col(p.ground));
    this.sun.color.copy(col(p.sun)); this.sun.intensity = p.sunIntensity; this.sun.position.set(...p.sunPos);
    this.hemi.intensity = p.hemi;
    for (const m of this.lampMats) m.emissiveIntensity = p.lamp;
    const haze = hazeColor(p);
    for (const cl of this.clouds) (cl.material as THREE.SpriteMaterial).color.copy(haze);
    this.bloom.strength = p.bloom;
    // 玩家補光：越暗越亮，讓臉在夜裡還看得到
    this.fill.intensity = (1 - daylight(p)) * 2.2;
  }

  setNpcState(name: string, s: NpcState) {
    const n = this.npcs.find((x) => x.spec.name === name);
    if (!n) return;
    if (s.meter !== undefined && s.meter !== null) {
      const k = Math.max(0, Math.min(5, Math.round(s.meter * 5)));
      n.hearts.textContent = "♥".repeat(k) + "♡".repeat(5 - k);
      n.hearts.title = `${Math.round(s.meter * 100)}%`;
    }
    if (s.mood !== undefined) { n.moodText = s.mood; n.mood.textContent = s.mood; }
    if (s.quest !== undefined) n.quest.hidden = !s.quest;
  }

  /** 角色頭上飄一行字（好感變化之類），一秒多後自己消失 */
  floatText(name: string, text: string, cls = "") {
    const n = this.npcs.find((x) => x.spec.name === name);
    if (!n) return;
    const el = document.createElement("div");
    el.className = `w-float ${cls}`.trim(); el.textContent = text;
    const o = new CSS2DObject(el); o.position.y = 3.6; n.fig.group.add(o);
    setTimeout(() => { n.fig.group.remove(o); el.remove(); }, 1500);
  }

  setSpeaking(name: string | null) { for (const n of this.npcs) n.speaking = n.spec.name === name; }
  setPlayerName(name: string) { this.playerLabel.textContent = name; }
  npcNames(): string[] { return this.npcs.map((n) => n.spec.name); }

  /** 對話開著：不走路、不吃鍵盤，鏡頭切到過肩看著對方 */
  lock(v: boolean, facing?: string | null) {
    this.locked = v;
    if (v) { this.keys.clear(); this.target = null; }
    this.focusNpc = v && facing ? this.npcs.find((n) => n.spec.name === facing) || null : null;
    if (!v) this.setSpeaking(null);
  }

  /** 把場景「地點」文字對到一個地方，玩家傳送過去。回傳地點標籤；對不到回空字串。 */
  travelTo(text: string): string {
    const p = this.spec.places.find((pl) => pl.match.test(text));
    if (!p) return "";
    this.player.group.position.set(p.pos[0], 0, p.pos[1]);
    this.target = null;
    this.camera.position.copy(this.player.group.position).add(this.camOffset());
    return p.label;
  }

  /** 走到某個 NPC 面前（點名字時用） */
  goTo(name: string) {
    const n = this.npcs.find((x) => x.spec.name === name);
    if (!n || this.locked) return;
    const dir = new THREE.Vector3().subVectors(this.player.group.position, n.fig.group.position).setY(0).normalize();
    if (!dir.lengthSq()) dir.set(0, 0, 1);
    this.target = n.fig.group.position.clone().add(dir.multiplyScalar(TALK_RANGE * 0.7));
  }

  /** 小地圖畫在這張 canvas 上（每幀重畫，很便宜） */
  attachMinimap(c: HTMLCanvasElement | null) { this.minimap = c; }

  // ---- 操作 ---------------------------------------------------------------

  private onKey = (e: KeyboardEvent) => {
    if (this.locked) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    const k = e.key.toLowerCase();
    if (!["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) return;
    e.preventDefault();
    if (e.type === "keydown") { this.keys.add(k); this.target = null; } else this.keys.delete(k);
  };

  private onPointerDown = (e: PointerEvent) => {
    // 先都當成可能的拖曳；左鍵沒拖動就在放開時當「點地／點人」
    this.drag = { x: e.clientX, yaw: this.yaw, button: e.button, startX: e.clientX, startY: e.clientY, moved: false };
    if (e.button === 2 || e.shiftKey) this.drag.moved = true;
  };

  private clickAt = (clientX: number, clientY: number) => {
    if (this.locked) return;
    const r = this.canvas.getBoundingClientRect();
    const e = { clientX, clientY };
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const hitNpc = this.ray.intersectObjects(this.npcs.map((n) => n.fig.group), true)[0];
    if (hitNpc) {
      const n = this.npcs.find((x) => x.fig.group.getObjectById(hitNpc.object.id));
      if (n) { this.goTo(n.spec.name); return; }
    }
    const hit = this.ray.intersectObject(this.ground)[0];
    if (hit) this.target = hit.point.clone().setY(0);
  };
  private onPointerMove = (e: PointerEvent) => {
    const d = this.drag; if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 6) d.moved = true;
    if (d.moved) this.yaw = d.yaw - (e.clientX - d.x) * 0.008;
  };
  private onPointerUp = (e: PointerEvent) => {
    const d = this.drag; this.drag = null;
    if (d && !d.moved && d.button === 0) this.clickAt(e.clientX, e.clientY);
  };
  private onWheel = (e: WheelEvent) => { e.preventDefault(); this.dist = THREE.MathUtils.clamp(this.dist + e.deltaY * 0.01, this.spec.camera.minDistance, this.spec.camera.maxDistance); };
  private onContext = (e: Event) => e.preventDefault();

  private bind() {
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKey);
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.canvas.addEventListener("contextmenu", this.onContext);
  }

  private resize() {
    const el = this.canvas.parentElement || this.canvas;
    const w = el.clientWidth || 1, h = el.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private camOffset(): THREE.Vector3 {
    // 直式螢幕視野窄，鏡頭要拉遠一點才看得到路和人
    const d = this.dist * (this.camera.aspect < 0.8 ? 1.45 : 1);
    // 高度跟距離等比：作者給的 height 是在 distance 時的鏡頭高，滾輪拉近拉遠仍維持同一俯角
    const { distance, height } = this.spec.camera;
    return new THREE.Vector3(Math.sin(this.yaw) * d, d * (height / distance), Math.cos(this.yaw) * d);
  }

  /** 圓對 AABB：撞到就把那一軸的位移退掉 */
  private slide(from: THREE.Vector3, next: THREE.Vector3) {
    const p2 = new THREE.Vector2(next.x, next.z);
    for (const b of this.blockers) {
      if (!b.containsPoint(p2)) continue;
      if (!b.containsPoint(new THREE.Vector2(next.x, from.z))) next.z = from.z; else next.x = from.x;
    }
    next.x = THREE.MathUtils.clamp(next.x, -this.bound, this.bound);
    next.z = THREE.MathUtils.clamp(next.z, -this.bound, this.bound);
  }

  private animateWalk(f: Figure, moving: boolean, t: number, rate = 14, talking = false) {
    if (f.anim) {
      const want = moving ? f.anim.walk || f.anim.idle : talking ? f.anim.talk || f.anim.idle : f.anim.idle;
      if (want && want !== f.anim.current) { f.anim.current?.fadeOut(0.2); want.reset().fadeIn(0.2).play(); f.anim.current = want; }
      if (moving && f.anim.walk) f.anim.walk.timeScale = (rate === 14 ? this.spec.player.speed : NPC_SPEED) / WALK_CLIP_SPEED;
      return;
    }
    const swing = moving ? Math.sin(t * rate) * 0.5 : 0;
    f.legs[0].rotation.x = swing; f.legs[1].rotation.x = -swing;
    f.arms[0].rotation.x = -swing * 0.7; f.arms[1].rotation.x = swing * 0.7;
  }

  private step(dt: number) {
    const t = this.clock.elapsedTime;
    const pos = this.player.group.position;
    const move = new THREE.Vector3();
    if (!this.locked) {
      if (this.keys.has("w") || this.keys.has("arrowup")) move.z -= 1;
      if (this.keys.has("s") || this.keys.has("arrowdown")) move.z += 1;
      if (this.keys.has("a") || this.keys.has("arrowleft")) move.x -= 1;
      if (this.keys.has("d") || this.keys.has("arrowright")) move.x += 1;
      // 鍵盤方向跟著鏡頭轉
      if (move.lengthSq()) move.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
      if (!move.lengthSq() && this.target) {
        move.subVectors(this.target, pos).setY(0);
        if (move.length() < 0.15) { this.target = null; move.set(0, 0, 0); }
      }
    }
    const moving = move.lengthSq() > 0;
    if (moving) {
      move.normalize().multiplyScalar(this.spec.player.speed * dt);
      const next = pos.clone().add(move);
      this.slide(pos, next);
      pos.copy(next);
      this.player.group.rotation.y = Math.atan2(move.x, move.z);
    }
    this.animateWalk(this.player, moving, t);
    if (this.player.anim) { this.player.anim.mixer.update(dt); pos.y = 0; }
    else pos.y = moving ? Math.abs(Math.sin(t * 14)) * 0.06 : 0;
    // 腳步塵土：走動時每 0.12 秒在腳邊冒一小團
    this.dustTimer -= dt;
    if (moving && this.dustTimer <= 0) {
      this.dustTimer = 0.12;
      this.events.onFootstep?.();
      const d = this.dust.find((x) => x.life <= 0);
      if (d) { d.life = 1; d.m.visible = true; d.m.position.set(pos.x + (Math.random() - 0.5) * 0.4, 0.15, pos.z + (Math.random() - 0.5) * 0.4); d.m.scale.setScalar(0.35); }
    }
    for (const d of this.dust) {
      if (d.life <= 0) { d.m.visible = false; continue; }
      d.life -= dt * 2.2;
      (d.m.material as THREE.SpriteMaterial).opacity = Math.max(0, d.life) * 0.45;
      d.m.scale.setScalar(0.35 + (1 - d.life) * 0.7);
      d.m.position.y += dt * 0.6;
    }
    if (this.holo) { const r = this.holo.getObjectByName("ring"); const r2 = this.holo.getObjectByName("ring2"); if (r) r.rotation.z += dt * 0.8; if (r2) r2.rotation.z -= dt * 1.3; this.holo.children[2].position.y = 2.3 + Math.sin(t * 1.5) * 0.06; }
    for (const c of this.clouds) { c.position.x += dt * 0.6; if (c.position.x > 130) c.position.x = -130; }

    // 鏡頭：平時跟在後面；對話時切側面雙人鏡頭（作者可設 camera.dialogue = follow 維持跟隨）
    if (this.focusNpc) this.player.group.rotation.y = Math.atan2(this.focusNpc.fig.group.position.x - pos.x, this.focusNpc.fig.group.position.z - pos.z);
    if (this.focusNpc && this.spec.camera.dialogue !== "follow") {
      const npc = this.focusNpc.fig.group.position;
      const back = new THREE.Vector3().subVectors(pos, npc).setY(0).normalize();
      const side = new THREE.Vector3(-back.z, 0, back.x);
      // 過肩：退到玩家斜後方，玩家佔左下角一小塊，對方站在畫面上半部中央
      // 側面雙人鏡頭：站到兩人連線的側邊，玩家在左、對方在右，兩張臉都看得到
      const mid = npc.clone().lerp(pos, 0.5);
      const far = this.camera.aspect < 0.8 ? 7.6 : 5.2;
      const want = mid.clone().add(side.multiplyScalar(-far)).add(back.multiplyScalar(0.9)).setY(this.camera.aspect < 0.8 ? 2.4 : 2.1);
      this.camera.position.lerp(want, 1 - Math.pow(0.002, dt));
      this.camera.lookAt(mid.x, 1.25, mid.z);
    } else {
      const want = pos.clone().add(this.camOffset());
      this.camera.position.lerp(want, 1 - Math.pow(0.001, dt));
      const ahead = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).multiplyScalar(6);
      this.camera.lookAt(pos.x + ahead.x, 3.2, pos.z + ahead.z);
    }

    // NPC：閒逛、起伏、光環慢轉、靠近時轉頭、說話時點頭
    let nearest: Npc | null = null; let nd = TALK_RANGE;
    for (const n of this.npcs) {
      const g = n.fig.group;
      const d = g.position.distanceTo(pos);
      if (d < nd) { nd = d; nearest = n; }
      const engaged = d < 6 || this.focusNpc === n;
      let walking = false;
      if (!engaged && n.spec.wander > 0) {
        n.nextWander -= dt;
        if (!n.target && n.nextWander <= 0) {
          const r = n.spec.wander;
          n.target = n.home.clone().add(new THREE.Vector3((Math.random() * 2 - 1) * r, 0, (Math.random() * 2 - 1) * r));
          n.nextWander = 3 + Math.random() * 6;
        }
        if (n.target) {
          const dir = new THREE.Vector3().subVectors(n.target, g.position).setY(0);
          if (dir.length() < 0.2) n.target = null;
          else {
            dir.normalize().multiplyScalar(NPC_SPEED * dt);
            const next = g.position.clone().add(dir); this.slide(g.position, next); g.position.copy(next);
            g.rotation.y = Math.atan2(dir.x, dir.z); walking = true;
          }
        }
      } else {
        n.target = null;
        const want = Math.atan2(pos.x - g.position.x, pos.z - g.position.z);
        let diff = want - g.rotation.y; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        g.rotation.y += diff * Math.min(1, dt * 4);
      }
      this.animateWalk(n.fig, walking, t, 10, n.speaking);
      if (n.fig.anim) { n.fig.anim.mixer.update(dt); g.position.y = 0; }
      else {
        g.position.y = walking ? Math.abs(Math.sin(t * 10)) * 0.05 : Math.sin(t * 1.6 + n.seed) * 0.04;
        n.fig.head.rotation.x = n.speaking ? Math.sin(t * 9) * 0.06 : 0;
      }
      if (n.fig.halo) n.fig.halo.rotation.z += dt * 0.6;
      n.mood.hidden = !(n.moodText && d < 5);
    }
    const nearName = nearest ? nearest.spec.name : null;
    if (nearName !== this.near) { this.near = nearName; this.events.onNear(nearName); }
    this.talkRing.visible = !!nearest && !this.locked;
    if (nearest) { this.talkRing.position.x = nearest.fig.group.position.x; this.talkRing.position.z = nearest.fig.group.position.z; this.talkRing.rotation.z += dt * 0.9; const sc = 1 + Math.sin(t * 4) * 0.05; this.talkRing.scale.set(sc, sc, 1); }
  }

  private drawMinimap() {
    const c = this.minimap; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    // 可走半徑那麼多世界單位 = 整張圖
    const W = c.width, H = c.height, S = W / this.bound;
    const px = this.player.group.position;
    const sx = (x: number) => W / 2 + (x - px.x) * S, sz = (z: number) => H / 2 + (z - px.z) * S;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(10,12,22,0.55)"; ctx.beginPath(); ctx.arc(W / 2, H / 2, W / 2, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.arc(W / 2, H / 2, W / 2 - 1, 0, Math.PI * 2); ctx.clip();
    if (this.env.kit === "campus") {
      ctx.fillStyle = "rgba(255,255,255,0.14)";
      ctx.fillRect(sx(-3.5), sz(-80), 7 * S, 160 * S); ctx.fillRect(sx(-80), sz(-3.5), 160 * S, 7 * S);
    }
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    for (const b of this.env.buildings) ctx.fillRect(sx(b.pos[0] - b.size[0] / 2), sz(b.pos[1] - b.size[2] / 2), b.size[0] * S, b.size[2] * S);
    for (const n of this.npcs) {
      ctx.fillStyle = n.spec.color; ctx.beginPath(); ctx.arc(sx(n.fig.group.position.x), sz(n.fig.group.position.z), 3.2, 0, Math.PI * 2); ctx.fill();
      if (!n.quest.hidden) { ctx.fillStyle = "#ffd54a"; ctx.beginPath(); ctx.arc(sx(n.fig.group.position.x), sz(n.fig.group.position.z) - 6, 2.2, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.restore();
    ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(-this.player.group.rotation.y);
    ctx.fillStyle = "#ffe9a8"; ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4.5, 5); ctx.lineTo(-4.5, 5); ctx.closePath(); ctx.fill(); ctx.restore();
    ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(W / 2, H / 2, W / 2 - 1, 0, Math.PI * 2); ctx.stroke();
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    if (!this.paused) this.step(dt);
    this.renderer.info.reset();
    this.composer.render();
    this.labels.render(this.scene, this.camera);
    this.drawMinimap();
    // 渲染診斷：畫布檢查器讀這個物件對照預算
    if (import.meta.env.DEV && (this.frame++ % 30) === 0) {
      const info = this.renderer.info;
      (window as unknown as { __THREE_GAME_DIAGNOSTICS__: unknown }).__THREE_GAME_DIAGNOSTICS__ = {
        renderer: { calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures },
        postPasses: 2, shadowMapSize: 2048, shadowCasters: 1, dpr: this.renderer.getPixelRatio(),
      };
    }
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("keyup", this.onKey);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("contextmenu", this.onContext);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose?.();
    });
    this.composer.dispose();
    this.renderer.dispose();
  }
}
