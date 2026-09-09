<script setup lang="ts">
/**
 * 遊戲模式的世界編輯器：整頁彈窗，跟正則規則編輯器同一個殼。
 *
 * 左欄先選類別。有清單的類別（角色／地點／建築／擺設／光照）底下是那一類的清單（新增、上下移、刪除），
 * 右欄是選中那一項的表單；沒有清單的類別（環境／玩家與鏡頭／協定與面板／音效）右欄直接是表單。
 * 編輯的是一份本地副本，按「完成」才交回給表單——關掉彈窗不等於存檔，存檔跟卡片一起。
 * 交回去的是驗過、補滿預設的 v2 JSON（shared/game-spec），所以進階作者照樣能在分區底下直接改 JSON，兩邊互通。
 *
 * 配置 v2 的每一個欄位在這裡都有一格：換題材（酒館、飛船、宮鬥）只改配置，不改程式。
 */
import { computed, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { confirmDialog } from "@/lib/confirm";
import {
  ACCESSORIES, AUDIO_EVENTS, DEFAULT_GAME_SPEC, HAIR_STYLES, PROP_SHAPES, validateGameSpec,
  type BuildingJson, type CharacterJson, type GameSpecJson, type LightPresetJson, type ModelJson, type PlaceJson, type PropJson, type XZ,
} from "../../../../shared/game-spec";
import { defaultCharacter, specTemplateFor } from "@/game/specs";

const props = defineProps<{ modelValue: GameSpecJson | null; names: string[] }>();
const emit = defineEmits<{ "update:modelValue": [GameSpecJson]; close: [] }>();
const { t } = useI18n();

type Cat = "characters" | "places" | "buildings" | "props" | "environment" | "lighting" | "player" | "protocol" | "audio";
type Item = CharacterJson | PlaceJson | BuildingJson | PropJson | LightPresetJson;
const CATS: Cat[] = ["characters", "places", "buildings", "props", "environment", "lighting", "player", "protocol", "audio"];
const LIST_CATS = new Set<Cat>(["characters", "places", "buildings", "props", "lighting"]);
const LOOK_KEYS = ["skin", "hair", "top", "bottom", "accent"] as const;
const LIGHT_COLORS = ["skyTop", "skyBottom", "ground", "sun", "fog"] as const;
const LIGHT_NUMS = [["sunIntensity", 0, 10, 0.1], ["hemi", 0, 5, 0.05], ["fogNear", 1, 1000, 1], ["fogFar", 2, 2000, 1], ["lamp", 0, 5, 0.05], ["bloom", 0, 2, 0.02]] as const;
const CAMERA_NUMS = [["distance", 2, 40], ["minDistance", 1, 40], ["maxDistance", 2, 80], ["height", 0.5, 40]] as const;
const TEXTURES = ["grid", "plaza", "plain"] as const;
const BLOCKS = ["title", "hud", "roles"] as const;
const SECTIONS = ["hero", "scene", "actions"] as const;
const PROTO_FIELDS = ["name", "mood", "time", "place", "objective", "round", "note", "unset"] as const;
const HUD_LISTS = ["hero", "scene", "role"] as const;
const GATES = ["roles", "hud", "none"] as const;
const QUEST_MODES = ["objective-mentions-name", "field-truthy", "none"] as const;
const DIALOGUE_CAMS = ["two-shot", "follow"] as const;

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
// 本地副本：改到一半按取消，外面那份不動。沒有配置就從攤開的預設範本起手
const spec = ref<GameSpecJson>(props.modelValue ? clone(props.modelValue) : specTemplateFor(props.names));
const original = JSON.stringify(spec.value);
const dirty = computed(() => JSON.stringify(spec.value) !== original);
const cat = ref<Cat>("characters");
const index = ref(0);

const hasList = computed(() => LIST_CATS.has(cat.value));
const list = computed<Item[]>(() => {
  const s = spec.value;
  switch (cat.value) {
    case "characters": return s.characters;
    case "places": return s.environment.places;
    case "buildings": return s.environment.buildings;
    case "props": return s.environment.props;
    case "lighting": return s.lighting.presets;
    default: return [];
  }
});
const character = computed(() => (cat.value === "characters" ? spec.value.characters[index.value] : undefined));
const place = computed(() => (cat.value === "places" ? spec.value.environment.places[index.value] : undefined));
const building = computed(() => (cat.value === "buildings" ? spec.value.environment.buildings[index.value] : undefined));
const prop = computed(() => (cat.value === "props" ? spec.value.environment.props[index.value] : undefined));
const preset = computed(() => (cat.value === "lighting" ? spec.value.lighting.presets[index.value] : undefined));
const titleOf = (item: Item, i: number) =>
  ("name" in item && item.name) || ("id" in item && item.id) || ("label" in item && item.label) || ("shape" in item && t(`gameEd.shape.${item.shape}`)) || `${t(`gameEd.cat.${cat.value}`)} ${i + 1}`;
const subOf = (item: Item) => ("match" in item ? item.match || "" : "pos" in item ? `${item.pos[0]}, ${item.pos[1]}` : "");

const validation = computed(() => validateGameSpec(clone(spec.value)));
const issues = computed(() => (validation.value.ok ? [] : validation.value.errors));
const sourceKeys = computed(() => Object.keys(spec.value.audio.sources));

function pick(c: Cat) { cat.value = c; index.value = 0; }
function add() {
  const s = spec.value;
  if (cat.value === "characters") {
    const used = new Set(s.characters.map((c) => c.name));
    const name = props.names.find((n) => !used.has(n)) || "";
    s.characters.push({ ...defaultCharacter(name || "?", s.characters.length, s.environment.kit === "campus"), name });
  } else if (cat.value === "places") s.environment.places.push({ match: "", pos: [0, 0], label: "" });
  else if (cat.value === "buildings") s.environment.buildings.push({ pos: [0, 0], size: [8, 6, 8] });
  else if (cat.value === "props") s.environment.props.push({ shape: "box", pos: [0, 0], size: [1, 1, 1], solid: true });
  else if (cat.value === "lighting") {
    // 新的一套從目前的預設光照複製，作者只改差異
    const base = s.lighting.presets.find((p) => p.id === s.lighting.default) ?? s.lighting.presets[0] ?? DEFAULT_GAME_SPEC.lighting.presets[0];
    let n = s.lighting.presets.length + 1; while (s.lighting.presets.some((p) => p.id === `preset-${n}`)) n++;
    const copy = clone(base); delete copy.match;
    s.lighting.presets.push({ ...copy, id: `preset-${n}` });
  }
  index.value = list.value.length - 1;
  void nextTick(() => document.getElementById("gw-first")?.focus());
}
async function remove(i: number) {
  const item = list.value[i];
  if (!(await confirmDialog({ message: t("gameEd.deleteConfirm", { name: titleOf(item, i) }), confirmText: t("list.remove"), danger: true }))) return;
  list.value.splice(i, 1);
  if (cat.value === "lighting") {
    // 刪掉預設那套：預設改成剩下的第一套；環境音對照也跟著清
    const L = spec.value.lighting, id = (item as LightPresetJson).id;
    delete spec.value.audio.ambience[id];
    if (L.default === id && L.presets[0]) L.default = L.presets[0].id;
  }
  index.value = Math.min(index.value, list.value.length - 1);
}
function move(i: number, delta: number) {
  const to = i + delta; if (to < 0 || to >= list.value.length) return;
  const arr = list.value; [arr[i], arr[to]] = [arr[to], arr[i]];
  if (index.value === i) index.value = to; else if (index.value === to) index.value = i;
}
async function useTemplate() {
  if (!(await confirmDialog({ message: t("gameEd.template.confirm"), confirmText: t("gameEd.template"), danger: true }))) return;
  spec.value = specTemplateFor(props.names);
  sources.value = rowsOf(spec.value);
  index.value = 0;
}
/** 光照代號改名：預設與環境音對照都指著它，一起改 */
function renamePreset(p: LightPresetJson, id: string) {
  const L = spec.value.lighting, A = spec.value.audio.ambience;
  if (L.default === p.id) L.default = id;
  if (A[p.id] !== undefined) { A[id] = A[p.id]; delete A[p.id]; }
  p.id = id;
}

// 角度：存的是弧度，表單給作者看的是度
const deg = (rad: number | undefined) => (rad === undefined ? "" : Math.round((rad * 180) / Math.PI));
const rad = (v: string) => Math.round((((Number(v) || 0) * Math.PI) / 180) * 10000) / 10000;
const optNum = (v: string) => (v.trim() === "" ? undefined : Number(v));
const optRad = (v: string) => (v.trim() === "" ? undefined : rad(v));
/** 選填欄位：清空＝拿掉這個鍵，讓驗證器補預設 */
function setOpt(o: object | undefined, k: string, v: number | string | undefined) {
  if (!o) return;
  const r = o as Record<string, unknown>;
  if (v === undefined || v === "") delete r[k]; else r[k] = v;
}
// 模型：網址留空＝不用模型（退回人偶）
function setModel(o: { model?: ModelJson }, url: string) {
  const u = url.trim();
  if (!u) delete o.model; else o.model = { ...(o.model || {}), url: u };
}
// 地面貼圖：三種內建或自訂網址
const textureKind = computed<string>({
  get: () => ((TEXTURES as readonly string[]).includes(spec.value.environment.ground.texture) ? spec.value.environment.ground.texture : "url"),
  set: (v) => { spec.value.environment.ground.texture = v === "url" ? "" : v; },
});
// 樹與路燈：一行一組「x, z」
const linesOf = (pts: XZ[]) => pts.map((p) => `${p[0]}, ${p[1]}`).join("\n");
function setPoints(key: "trees" | "lamps", text: string) {
  const pts: XZ[] = [];
  for (const line of text.split(/\n/)) {
    const m = line.trim().split(/[\s,]+/).filter(Boolean); if (m.length < 2) continue;
    const x = Number(m[0]), z = Number(m[1]); if (Number.isFinite(x) && Number.isFinite(z)) pts.push([x, z]);
  }
  spec.value.environment[key] = pts;
}
// 音源是「鍵→網址」物件，表單上當列表編，每次改動寫回去
const rowsOf = (s: GameSpecJson) => Object.entries(s.audio.sources).map(([key, url]) => ({ key, url }));
const sources = ref(rowsOf(spec.value));
watch(sources, (rows) => { spec.value.audio.sources = Object.fromEntries(rows.map((r) => [r.key, r.url])); }, { deep: true });

/** 色票＋文字：文字不是 #rrggbb 時（hsl、rgb、#rgb）換算成 hex 給原生色票，不然色票會一直顯示灰色 */
let ctx2d: CanvasRenderingContext2D | null | undefined;
function toHex(c: string | undefined): string {
  if (!c) return "#888888";
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c;
  if (ctx2d === undefined) ctx2d = document.createElement("canvas").getContext("2d");
  if (!ctx2d) return "#888888";
  ctx2d.fillStyle = "#888888"; ctx2d.fillStyle = c;
  const v = String(ctx2d.fillStyle);
  return /^#[0-9a-f]{6}$/.test(v) ? v : "#888888";
}
const ColorField = defineComponent({
  props: { modelValue: { type: String, default: "" }, label: { type: String, default: "" }, placeholder: { type: String, default: "#888888" } },
  emits: ["update:modelValue"],
  setup(p, { emit: em }) {
    const set = (e: Event) => em("update:modelValue", (e.target as HTMLInputElement).value);
    return () => {
      const pair = h("span", { class: "gw__color" }, [
        h("input", { type: "color", value: toHex(p.modelValue), "aria-label": p.label || undefined, onInput: set }),
        h("input", { class: "input mono-input", value: p.modelValue, placeholder: p.placeholder, spellcheck: false, "aria-label": p.label || undefined, onInput: set }),
      ]);
      return p.label ? h("div", { class: "field" }, [h("label", p.label), pair]) : pair;
    };
  },
});

function done() {
  const v = validateGameSpec(clone(spec.value));
  if (!v.ok) return;
  emit("update:modelValue", v.spec); emit("close");
}
async function cancel() {
  if (dirty.value && !(await confirmDialog({ message: t("gameEd.discard"), confirmText: t("dialog.leave"), danger: true }))) return;
  emit("close");
}
const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") void cancel(); };
onMounted(() => { document.body.style.overflow = "hidden"; window.addEventListener("keydown", onKey); });
onBeforeUnmount(() => { document.body.style.overflow = ""; window.removeEventListener("keydown", onKey); });
</script>

<template>
  <div class="gw" role="dialog" aria-modal="true" :aria-label="$t('gameEd.title')">
    <div class="gw__scrim" @click="cancel" />
    <div class="gw__panel panel">
      <header class="gw__head">
        <h2>{{ $t("gameEd.title") }}</h2>
        <span class="subtle">{{ $t("editor.game.npcCount", { n: spec.characters.length }) }}</span>
        <div class="gw__head-acts">
          <button type="button" class="btn btn--sm" @click="useTemplate">{{ $t("gameEd.template") }}</button>
          <button type="button" class="btn btn--sm btn--ghost" @click="cancel">{{ $t("dialog.cancel") }}</button>
          <button type="button" class="btn btn--sm btn--primary" :disabled="issues.length > 0" @click="done">{{ $t("regex.done") }}</button>
        </div>
      </header>

      <div class="gw__body">
        <!-- 左：類別 + 清單 -->
        <aside class="gw__list">
          <div class="seg" role="tablist">
            <button v-for="c in CATS" :key="c" type="button" class="seg__item" :class="{ 'seg__item--on': cat === c }" role="tab" :aria-selected="cat === c" @click="pick(c)">{{ $t(`gameEd.cat.${c}`) }}</button>
          </div>
          <div v-if="cat === 'lighting'" class="field gw__default">
            <label for="gw-light-default">{{ $t("gameEd.light.default") }}</label>
            <select id="gw-light-default" v-model="spec.lighting.default" class="input"><option v-for="p in spec.lighting.presets" :key="p.id" :value="p.id">{{ p.id }}</option></select>
          </div>
          <button v-if="hasList" type="button" class="btn btn--sm" @click="add">{{ $t(`gameEd.add.${cat}`) }}</button>
          <ul v-if="hasList" class="gw__items">
            <li v-for="(item, i) in list" :key="i" class="gw__item" :class="{ 'gw__item--on': i === index }">
              <button type="button" class="gw__item-name" @click="index = i">
                <span class="gw__item-title">{{ titleOf(item, i) }}</span>
                <span class="subtle gw__item-sub">{{ subOf(item) }}</span>
              </button>
              <span class="gw__item-tools">
                <button type="button" class="btn btn--icon btn--sm btn--ghost" :aria-label="$t('list.up')" :title="$t('list.up')" :disabled="i === 0" @click="move(i, -1)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" /></svg>
                </button>
                <button type="button" class="btn btn--icon btn--sm btn--ghost" :aria-label="$t('list.down')" :title="$t('list.down')" :disabled="i === list.length - 1" @click="move(i, 1)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M18 13l-6 6-6-6" /></svg>
                </button>
                <button type="button" class="btn btn--icon btn--sm btn--ghost btn--danger" :aria-label="$t('list.remove')" :title="$t('list.remove')" @click="remove(i)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7h14M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" /></svg>
                </button>
              </span>
            </li>
          </ul>
          <p v-if="hasList && !list.length" class="subtle gw__empty">{{ $t("gameEd.empty") }}</p>
          <p v-if="!hasList" class="subtle gw__empty">{{ $t(`gameEd.lede.${cat}`) }}</p>
        </aside>

        <!-- 右：表單 -->
        <section v-if="character" class="gw__edit">
          <div class="field">
            <label for="gw-first">{{ $t("gameEd.char.name") }}</label>
            <input id="gw-first" v-model="character.name" class="input" list="gw-names" maxlength="60" />
            <datalist id="gw-names"><option v-for="n in names" :key="n" :value="n" /></datalist>
            <span class="field__foot"><span class="subtle">{{ $t("gameEd.char.name.hint") }}</span></span>
          </div>
          <div class="gw__grid">
            <ColorField v-model="character.color" :label="$t('gameEd.char.color')" placeholder="#5ec2f5" />
            <div class="field"><label>{{ $t("gameEd.char.accessory") }}</label><select v-model="character.accessory" class="input"><option v-for="a in ACCESSORIES" :key="a" :value="a">{{ $t(`gameEd.accessory.${a}`) }}</option></select></div>
            <div class="field"><label>{{ $t("gameEd.pos") }}</label><span class="gw__pair"><input v-model.number="character.pos[0]" class="input" type="number" step="0.5" /><input v-model.number="character.pos[1]" class="input" type="number" step="0.5" /></span></div>
            <div class="field"><label>{{ $t("gameEd.char.face") }}</label><input class="input" type="number" step="15" :value="deg(character.face)" @input="character.face = rad(($event.target as HTMLInputElement).value)" /></div>
            <div class="field"><label>{{ $t("gameEd.char.wander") }}</label><input v-model.number="character.wander" class="input" type="number" min="0" max="20" step="0.5" /></div>
          </div>
          <fieldset class="gw__set">
            <legend>{{ $t("gameEd.look") }}</legend>
            <div class="gw__grid">
              <ColorField v-for="k in LOOK_KEYS" :key="k" v-model="character.look[k]" :label="$t(`gameEd.look.${k}`)" />
              <div class="field"><label>{{ $t("gameEd.look.hairStyle") }}</label><select v-model="character.look.hairStyle" class="input"><option v-for="hs in HAIR_STYLES" :key="hs" :value="hs">{{ $t(`gameEd.hair.${hs}`) }}</option></select></div>
            </div>
          </fieldset>
          <div class="field">
            <label>{{ $t("gameEd.model") }}</label>
            <input class="input mono-input" :value="character.model?.url || ''" placeholder="https://… /game/models/….glb" spellcheck="false" @change="setModel(character, ($event.target as HTMLInputElement).value)" />
            <span class="field__foot"><span class="subtle">{{ $t("gameEd.model.hint") }}</span></span>
          </div>
          <div v-if="character.model" class="gw__grid">
            <div class="field"><label>{{ $t("gameEd.model.height") }}</label><input class="input" type="number" min="0.5" max="10" step="0.05" :value="character.model.height ?? ''" @change="setOpt(character.model, 'height', optNum(($event.target as HTMLInputElement).value))" /></div>
            <div class="field"><label>{{ $t("gameEd.model.yaw") }}</label><input class="input" type="number" step="15" :value="deg(character.model.yaw)" @change="setOpt(character.model, 'yaw', optRad(($event.target as HTMLInputElement).value))" /></div>
          </div>
        </section>

        <section v-else-if="place" class="gw__edit">
          <div class="field"><label for="gw-first">{{ $t("gameEd.place.label") }}</label><input id="gw-first" v-model="place.label" class="input" maxlength="60" /></div>
          <div class="field">
            <label>{{ $t("gameEd.place.match") }}</label>
            <input v-model="place.match" class="input mono-input" spellcheck="false" :placeholder="$t('gameEd.place.match.placeholder')" />
            <span class="field__foot"><span class="subtle">{{ $t("gameEd.place.match.hint") }}</span></span>
          </div>
          <div class="field gw__short"><label>{{ $t("gameEd.pos") }}</label><span class="gw__pair"><input v-model.number="place.pos[0]" class="input" type="number" step="0.5" /><input v-model.number="place.pos[1]" class="input" type="number" step="0.5" /></span></div>
        </section>

        <section v-else-if="building" class="gw__edit">
          <div class="field"><label for="gw-first">{{ $t("gameEd.building.label") }}</label><input id="gw-first" v-model="building.label" class="input" maxlength="200" /></div>
          <div class="gw__grid">
            <div class="field"><label>{{ $t("gameEd.pos") }}</label><span class="gw__pair"><input v-model.number="building.pos[0]" class="input" type="number" step="0.5" /><input v-model.number="building.pos[1]" class="input" type="number" step="0.5" /></span></div>
            <div class="field"><label>{{ $t("gameEd.size") }}</label><span class="gw__pair gw__pair--3"><input v-for="k in ([0, 1, 2] as const)" :key="k" v-model.number="building.size[k]" class="input" type="number" min="0.5" max="60" step="0.5" /></span></div>
            <ColorField v-model="building.color" :label="$t('gameEd.color')" placeholder="#dfe6ee" />
          </div>
        </section>

        <section v-else-if="prop" class="gw__edit">
          <div class="gw__grid">
            <div class="field"><label for="gw-first">{{ $t("gameEd.prop.shape") }}</label><select id="gw-first" v-model="prop.shape" class="input"><option v-for="s in PROP_SHAPES" :key="s" :value="s">{{ $t(`gameEd.shape.${s}`) }}</option></select></div>
            <div class="field"><label>{{ $t("gameEd.prop.label") }}</label><input v-model="prop.label" class="input" maxlength="200" /></div>
          </div>
          <div v-if="prop.shape === 'model'" class="field">
            <label>{{ $t("gameEd.prop.url") }}</label>
            <input v-model="prop.url" class="input mono-input" placeholder="https://… /game/models/….glb" spellcheck="false" />
            <span class="field__foot"><span class="subtle">{{ $t("gameEd.resources") }}</span></span>
          </div>
          <div class="gw__grid">
            <div class="field"><label>{{ $t("gameEd.pos") }}</label><span class="gw__pair"><input v-model.number="prop.pos[0]" class="input" type="number" step="0.5" /><input v-model.number="prop.pos[1]" class="input" type="number" step="0.5" /></span></div>
            <div class="field"><label>{{ $t("gameEd.prop.y") }}</label><input class="input" type="number" step="0.1" :value="prop.y ?? ''" @change="setOpt(prop, 'y', optNum(($event.target as HTMLInputElement).value))" /></div>
            <div class="field"><label>{{ $t("gameEd.size") }}</label><span class="gw__pair gw__pair--3"><input v-for="k in ([0, 1, 2] as const)" :key="k" v-model.number="prop.size[k]" class="input" type="number" min="0.05" max="60" step="0.1" /></span></div>
            <div class="field"><label>{{ $t("gameEd.prop.rotation") }}</label><input class="input" type="number" step="15" :value="deg(prop.rotation)" @change="setOpt(prop, 'rotation', optRad(($event.target as HTMLInputElement).value))" /></div>
            <ColorField v-model="prop.color" :label="$t('gameEd.color')" />
            <ColorField v-model="prop.emissive" :label="$t('gameEd.prop.emissive')" />
          </div>
          <label class="gw__check"><input v-model="prop.solid" type="checkbox" /> {{ $t("gameEd.prop.solid") }}</label>
        </section>

        <section v-else-if="preset" class="gw__edit">
          <div class="gw__grid">
            <div class="field"><label for="gw-first">{{ $t("gameEd.light.id") }}</label><input id="gw-first" class="input mono-input" :value="preset.id" maxlength="40" spellcheck="false" @input="renamePreset(preset, ($event.target as HTMLInputElement).value)" /></div>
            <div class="field">
              <label>{{ $t("gameEd.light.match") }}</label>
              <input v-model="preset.match" class="input mono-input" spellcheck="false" />
              <span class="field__foot"><span class="subtle">{{ $t("gameEd.light.match.hint") }}</span></span>
            </div>
          </div>
          <div class="gw__grid">
            <ColorField v-for="k in LIGHT_COLORS" :key="k" v-model="preset[k]" :label="$t(`gameEd.light.${k}`)" />
            <div class="field"><label>{{ $t("gameEd.light.sunPos") }}</label><span class="gw__pair gw__pair--3"><input v-for="k in ([0, 1, 2] as const)" :key="k" v-model.number="preset.sunPos[k]" class="input" type="number" min="-200" max="200" step="1" /></span></div>
            <div v-for="[k, lo, hi, step] in LIGHT_NUMS" :key="k" class="field"><label>{{ $t(`gameEd.light.${k}`) }}</label><input v-model.number="preset[k]" class="input" type="number" :min="lo" :max="hi" :step="step" /></div>
          </div>
        </section>

        <section v-else-if="cat === 'environment'" class="gw__edit">
          <div class="gw__grid">
            <div class="field"><label>{{ $t("gameEd.env.kit") }}</label><select v-model="spec.environment.kit" class="input"><option value="campus">{{ $t("gameEd.kit.campus") }}</option><option value="none">{{ $t("gameEd.kit.none") }}</option></select></div>
            <ColorField v-model="spec.environment.ground.color" :label="$t('gameEd.env.ground.color')" />
            <div class="field"><label>{{ $t("gameEd.env.ground.texture") }}</label><select v-model="textureKind" class="input"><option v-for="x in TEXTURES" :key="x" :value="x">{{ $t(`gameEd.texture.${x}`) }}</option><option value="url">{{ $t("gameEd.texture.url") }}</option></select></div>
            <div class="field"><label>{{ $t("gameEd.env.ground.size") }}</label><input v-model.number="spec.environment.ground.size" class="input" type="number" min="20" max="600" step="10" /></div>
          </div>
          <div v-if="textureKind === 'url'" class="field">
            <label>{{ $t("gameEd.texture.url") }}</label>
            <input v-model="spec.environment.ground.texture" class="input mono-input" spellcheck="false" placeholder="https://…/ground.jpg" />
          </div>
          <div class="field">
            <label>{{ $t("gameEd.env.sky") }}</label>
            <input v-model="spec.environment.sky" class="input mono-input" spellcheck="false" placeholder="https://…/sky.jpg" />
            <span class="field__foot"><span class="subtle">{{ $t("gameEd.resources") }}</span></span>
          </div>
          <div class="gw__checks">
            <label class="gw__check"><input v-model="spec.environment.skyline" type="checkbox" /> {{ $t("gameEd.env.skyline") }}</label>
            <label class="gw__check"><input v-model="spec.environment.clouds" type="checkbox" /> {{ $t("gameEd.env.clouds") }}</label>
          </div>
          <div class="gw__grid">
            <div class="field"><label>{{ $t("gameEd.env.trees") }}</label><textarea class="input mono-input" rows="6" :value="linesOf(spec.environment.trees)" @change="setPoints('trees', ($event.target as HTMLTextAreaElement).value)" /></div>
            <div class="field"><label>{{ $t("gameEd.env.lamps") }}</label><textarea class="input mono-input" rows="6" :value="linesOf(spec.environment.lamps)" @change="setPoints('lamps', ($event.target as HTMLTextAreaElement).value)" /></div>
          </div>
        </section>

        <section v-else-if="cat === 'player'" class="gw__edit">
          <div class="gw__grid">
            <div class="field"><label>{{ $t("gameEd.player.spawn") }}</label><span class="gw__pair"><input v-model.number="spec.player.spawn[0]" class="input" type="number" step="0.5" /><input v-model.number="spec.player.spawn[1]" class="input" type="number" step="0.5" /></span></div>
            <div class="field"><label>{{ $t("gameEd.player.speed") }}</label><input v-model.number="spec.player.speed" class="input" type="number" min="1" max="12" step="0.5" /></div>
          </div>
          <fieldset class="gw__set">
            <legend>{{ $t("gameEd.look") }}</legend>
            <div class="gw__grid">
              <ColorField v-for="k in LOOK_KEYS" :key="k" v-model="spec.player.look[k]" :label="$t(`gameEd.look.${k}`)" />
              <div class="field"><label>{{ $t("gameEd.look.hairStyle") }}</label><select v-model="spec.player.look.hairStyle" class="input"><option v-for="hs in HAIR_STYLES" :key="hs" :value="hs">{{ $t(`gameEd.hair.${hs}`) }}</option></select></div>
            </div>
          </fieldset>
          <div class="field">
            <label>{{ $t("gameEd.player.model") }}</label>
            <input class="input mono-input" :value="spec.player.model?.url || ''" spellcheck="false" placeholder="https://… /game/models/….glb" @change="setModel(spec.player, ($event.target as HTMLInputElement).value)" />
            <span class="field__foot"><span class="subtle">{{ $t("gameEd.model.hint") }}</span></span>
          </div>
          <div v-if="spec.player.model" class="gw__grid">
            <div class="field"><label>{{ $t("gameEd.model.height") }}</label><input class="input" type="number" min="0.5" max="10" step="0.05" :value="spec.player.model.height ?? ''" @change="setOpt(spec.player.model, 'height', optNum(($event.target as HTMLInputElement).value))" /></div>
            <div class="field"><label>{{ $t("gameEd.model.yaw") }}</label><input class="input" type="number" step="15" :value="deg(spec.player.model.yaw)" @change="setOpt(spec.player.model, 'yaw', optRad(($event.target as HTMLInputElement).value))" /></div>
          </div>
          <fieldset class="gw__set">
            <legend>{{ $t("gameEd.camera") }}</legend>
            <div class="gw__grid">
              <div v-for="[k, lo, hi] in CAMERA_NUMS" :key="k" class="field"><label>{{ $t(`gameEd.camera.${k}`) }}</label><input v-model.number="spec.camera[k]" class="input" type="number" :min="lo" :max="hi" step="0.5" /></div>
              <div class="field"><label>{{ $t("gameEd.camera.dialogue") }}</label><select v-model="spec.camera.dialogue" class="input"><option v-for="d in DIALOGUE_CAMS" :key="d" :value="d">{{ $t(`gameEd.dialogue.${d}`) }}</option></select></div>
            </div>
          </fieldset>
        </section>

        <section v-else-if="cat === 'protocol'" class="gw__edit">
          <fieldset class="gw__set">
            <legend>{{ $t("gameEd.proto.blocks") }}</legend>
            <p class="subtle gw__hint">{{ $t("gameEd.proto.blocks.hint") }}</p>
            <div class="gw__grid">
              <div v-for="k in BLOCKS" :key="k" class="field"><label>{{ $t(`gameEd.proto.block.${k}`) }}</label><input v-model="spec.protocol.blocks[k]" class="input mono-input" maxlength="40" spellcheck="false" /></div>
              <div v-for="k in SECTIONS" :key="k" class="field"><label>{{ $t(`gameEd.proto.section.${k}`) }}</label><input v-model="spec.protocol.sections[k]" class="input" maxlength="40" /></div>
              <div class="field"><label>{{ $t("gameEd.proto.titleSeparator") }}</label><input v-model="spec.protocol.titleSeparator" class="input mono-input" maxlength="4" /></div>
              <div class="field"><label>{{ $t("gameEd.proto.gate") }}</label><select v-model="spec.protocol.gate" class="input"><option v-for="g in GATES" :key="g" :value="g">{{ $t(`gameEd.gate.${g}`) }}</option></select></div>
            </div>
          </fieldset>
          <fieldset class="gw__set">
            <legend>{{ $t("gameEd.proto.fields") }}</legend>
            <p class="subtle gw__hint">{{ $t("gameEd.proto.fields.hint") }}</p>
            <div class="gw__grid">
              <div v-for="k in PROTO_FIELDS" :key="k" class="field"><label>{{ $t(`gameEd.proto.field.${k}`) }}</label><input v-model="spec.protocol.fields[k]" class="input" :class="{ 'mono-input': k === 'unset' }" maxlength="200" /></div>
              <div class="field"><label>{{ $t("gameEd.proto.actions.full") }}</label><input v-model="spec.protocol.actions.full" class="input mono-input" maxlength="60" /></div>
              <div class="field"><label>{{ $t("gameEd.proto.actions.short") }}</label><input v-model="spec.protocol.actions.short" class="input mono-input" maxlength="60" /></div>
            </div>
            <p class="subtle gw__hint">{{ $t("gameEd.proto.actions.hint", { n: "{n}" }) }}</p>
          </fieldset>
          <fieldset v-for="k in HUD_LISTS" :key="k" class="gw__set">
            <legend>{{ $t(`gameEd.hud.${k}`) }}</legend>
            <div v-for="(f, i) in spec.hud[k]" :key="i" class="gw__row gw__row--field">
              <input v-model="f.key" class="input" maxlength="60" :placeholder="$t('gameEd.hud.key')" :aria-label="$t('gameEd.hud.key')" />
              <input v-model="f.label" class="input" maxlength="200" :placeholder="$t('gameEd.hud.label')" :aria-label="$t('gameEd.hud.label')" />
              <button type="button" class="btn btn--icon btn--sm btn--ghost btn--danger" :aria-label="$t('list.remove')" :title="$t('list.remove')" @click="spec.hud[k].splice(i, 1)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7h14M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" /></svg>
              </button>
            </div>
            <button type="button" class="btn btn--sm gw__row-add" @click="spec.hud[k].push({ key: '' })">{{ $t("gameEd.hud.addField") }}</button>
          </fieldset>
          <fieldset class="gw__set">
            <legend>{{ $t("gameEd.hud.meters") }}</legend>
            <p class="subtle gw__hint">{{ $t("gameEd.hud.meters.hint") }}</p>
            <div v-for="(m, i) in spec.hud.meters" :key="i" class="gw__row gw__row--meter">
              <input v-model="m.key" class="input" maxlength="60" :placeholder="$t('gameEd.hud.key')" :aria-label="$t('gameEd.hud.key')" />
              <input v-model="m.label" class="input" maxlength="200" :placeholder="$t('gameEd.hud.label')" :aria-label="$t('gameEd.hud.label')" />
              <input v-model.number="m.min" class="input" type="number" :placeholder="$t('gameEd.hud.meter.min')" :aria-label="$t('gameEd.hud.meter.min')" />
              <input v-model.number="m.max" class="input" type="number" :placeholder="$t('gameEd.hud.meter.max')" :aria-label="$t('gameEd.hud.meter.max')" />
              <ColorField v-model="m.color" />
              <button type="button" class="btn btn--icon btn--sm btn--ghost btn--danger" :aria-label="$t('list.remove')" :title="$t('list.remove')" @click="spec.hud.meters.splice(i, 1)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7h14M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" /></svg>
              </button>
            </div>
            <button type="button" class="btn btn--sm gw__row-add" @click="spec.hud.meters.push({ key: '', min: 0, max: 100 })">{{ $t("gameEd.hud.addMeter") }}</button>
          </fieldset>
          <fieldset class="gw__set">
            <legend>{{ $t("gameEd.hud.quest") }}</legend>
            <div class="gw__grid">
              <div class="field"><label>{{ $t("gameEd.hud.quest.mode") }}</label><select v-model="spec.hud.questRule.mode" class="input"><option v-for="q in QUEST_MODES" :key="q" :value="q">{{ $t(`gameEd.quest.${q}`) }}</option></select></div>
              <div v-if="spec.hud.questRule.mode === 'field-truthy'" class="field"><label>{{ $t("gameEd.hud.quest.field") }}</label><input v-model="spec.hud.questRule.field" class="input" maxlength="200" /></div>
            </div>
          </fieldset>
        </section>

        <section v-else-if="cat === 'audio'" class="gw__edit">
          <fieldset class="gw__set">
            <legend>{{ $t("gameEd.audio.sources") }}</legend>
            <p class="subtle gw__hint">{{ $t("gameEd.audio.sources.hint") }}</p>
            <div v-for="(r, i) in sources" :key="i" class="gw__row gw__row--src">
              <input v-model="r.key" class="input mono-input" maxlength="40" pattern="[a-zA-Z0-9_-]+" spellcheck="false" :placeholder="$t('gameEd.audio.key')" :aria-label="$t('gameEd.audio.key')" />
              <input v-model="r.url" class="input mono-input" spellcheck="false" placeholder="https://…/x.mp3" :aria-label="$t('gameEd.audio.url')" />
              <button type="button" class="btn btn--icon btn--sm btn--ghost btn--danger" :aria-label="$t('list.remove')" :title="$t('list.remove')" @click="sources.splice(i, 1)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7h14M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" /></svg>
              </button>
            </div>
            <button type="button" class="btn btn--sm gw__row-add" @click="sources.push({ key: '', url: '' })">{{ $t("gameEd.audio.addSource") }}</button>
            <p class="subtle gw__hint">{{ $t("gameEd.resources") }}</p>
          </fieldset>
          <fieldset class="gw__set">
            <legend>{{ $t("gameEd.audio.events") }}</legend>
            <div class="gw__grid">
              <div v-for="e in AUDIO_EVENTS" :key="e" class="field">
                <label :for="`gw-ev-${e}`">{{ $t(`gameEd.audio.event.${e}`) }}</label>
                <select :id="`gw-ev-${e}`" v-model="spec.audio.events[e]" class="input"><option value="">{{ $t("gameEd.none") }}</option><option v-for="k in sourceKeys" :key="k" :value="k">{{ k }}</option></select>
              </div>
            </div>
          </fieldset>
          <fieldset class="gw__set">
            <legend>{{ $t("gameEd.audio.ambience") }}</legend>
            <div class="gw__grid">
              <div v-for="p in spec.lighting.presets" :key="p.id" class="field">
                <label :for="`gw-amb-${p.id}`">{{ p.id }}</label>
                <select :id="`gw-amb-${p.id}`" v-model="spec.audio.ambience[p.id]" class="input"><option value="">{{ $t("gameEd.none") }}</option><option v-for="k in sourceKeys" :key="k" :value="k">{{ k }}</option></select>
              </div>
            </div>
          </fieldset>
        </section>

        <section v-else class="gw__edit gw__edit--empty">
          <p class="muted">{{ $t("gameEd.pick") }}</p>
        </section>
      </div>

      <footer class="gw__foot">
        <ul v-if="issues.length" class="notice notice--error gw__issues" role="alert">
          <li v-for="e in issues" :key="e">{{ e }}</li>
        </ul>
        <p v-else class="subtle gw__ok">{{ $t("gameEd.resources") }}</p>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.gw { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; padding: var(--s-4); }
.gw__scrim { position: absolute; inset: 0; background: rgba(10, 10, 14, 0.55); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
.gw__panel {
  position: relative; width: min(1240px, 100%); height: min(92vh, 900px);
  display: grid; grid-template-rows: auto minmax(0, 1fr) auto; overflow: hidden;
  box-shadow: var(--shadow-md), 0 0 0 1px var(--line);
}
.gw__head { display: flex; align-items: center; gap: var(--s-3); padding: var(--s-3) var(--s-4); box-shadow: 0 1px 0 var(--line); }
.gw__head h2 { font-size: 16px; }
.gw__head-acts { margin-left: auto; display: flex; gap: var(--s-2); }

.gw__body { display: grid; grid-template-columns: 320px minmax(0, 1fr); min-height: 0; }
.gw__list { display: grid; grid-template-rows: auto auto auto minmax(0, 1fr); gap: var(--s-2); padding: var(--s-3); box-shadow: 1px 0 0 var(--line); min-height: 0; align-content: start; }
/* 九個類別一排塞不下：讓它換行，每格撐滿那一排 */
.gw__list .seg { display: flex; flex-wrap: wrap; border-radius: var(--r-md); }
.gw__list .seg__item { flex: 1 1 auto; padding: 0 10px; border-radius: var(--r-sm); }
.gw__default { margin: 0; gap: 4px; }
.gw__items { list-style: none; margin: 0; padding: 0; overflow-y: auto; display: grid; gap: 2px; align-content: start; }
.gw__item { display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: var(--r-sm); }
.gw__item:hover { background: var(--surface-2); }
.gw__item--on { background: var(--accent-tint); box-shadow: inset 2px 0 0 var(--accent); }
.gw__item-name { flex: 1; min-width: 0; display: grid; text-align: left; background: none; border: 0; padding: 2px 0; cursor: pointer; }
.gw__item-title { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gw__item-sub { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gw__item-tools { display: none; }
.gw__item:hover .gw__item-tools, .gw__item--on .gw__item-tools { display: inline-flex; }
.gw__empty { text-align: center; padding: var(--s-5) var(--s-2); }

.gw__edit { padding: var(--s-3) var(--s-4); min-height: 0; overflow-y: auto; align-content: start; }
.gw__edit--empty { display: grid; place-items: center; }
.gw__edit .field { margin-bottom: var(--s-3); gap: 6px; }
.gw__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); column-gap: var(--s-3); }
.gw__short { max-width: 220px; }
.gw__pair { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s-2); }
.gw__pair--3 { grid-template-columns: 1fr 1fr 1fr; }
/* 色票元件是同檔的小 render component，內層拿不到 scoped 屬性，要穿透 */
.gw__panel :deep(.gw__color) { display: grid; grid-template-columns: 36px 1fr; gap: var(--s-2); align-items: center; }
.gw__panel :deep(.gw__color input[type="color"]) { width: 36px; height: 36px; padding: 0; border: 1px solid var(--line); border-radius: var(--r-sm); background: none; cursor: pointer; }
.gw__panel :deep(.mono-input) { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; line-height: 1.55; }
.gw__set { border: 1px solid var(--line); border-radius: var(--r-md); padding: var(--s-2) var(--s-3) 0; margin: 0 0 var(--s-3); min-width: 0; }
.gw__set legend { font-size: 13px; font-weight: 600; padding: 0 4px; }
.gw__hint { margin: 0 0 var(--s-2); font-size: 12.5px; }
.gw__checks { display: flex; flex-wrap: wrap; gap: var(--s-2) var(--s-4); margin-bottom: var(--s-3); }
.gw__check { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; margin-bottom: var(--s-3); cursor: pointer; }
.gw__row { display: grid; gap: var(--s-2); align-items: center; margin-bottom: var(--s-2); }
.gw__row--field { grid-template-columns: 1fr 1fr auto; }
.gw__row--meter { grid-template-columns: 1.3fr 1fr 80px 80px 1.3fr auto; }
.gw__row--src { grid-template-columns: 160px 1fr auto; }
.gw__row-add { margin-bottom: var(--s-3); }

.gw__foot { padding: var(--s-2) var(--s-4); box-shadow: 0 -1px 0 var(--line); max-height: 140px; overflow-y: auto; }
.gw__issues { margin: 0; padding-left: var(--s-5); display: grid; gap: 2px; font-size: 13px; }
.gw__ok { margin: 0; font-size: 13px; }

@media (max-width: 900px) {
  .gw { padding: 0; }
  .gw__panel { display: block; height: 100dvh; width: 100%; border-radius: 0; overflow-y: auto; }
  .gw__head { position: sticky; top: 0; z-index: 1; background: var(--surface); flex-wrap: wrap; }
  .gw__body { display: block; }
  .gw__list { display: block; box-shadow: 0 1px 0 var(--line); }
  .gw__list > * + * { margin-top: var(--s-2); }
  .gw__items { max-height: 240px; }
  .gw__edit { overflow: visible; }
  .gw__row--field, .gw__row--src { grid-template-columns: 1fr 1fr auto; }
  .gw__row--meter { grid-template-columns: 1fr 1fr auto; }
}
</style>
