<script setup lang="ts">
/**
 * 遊戲模式的世界編輯器：整頁彈窗，跟正則規則編輯器同一個殼。
 *
 * 左欄先選類別（角色／地點／建築／世界），底下是那一類的清單（新增、上下移、刪除）；
 * 右欄是選中那一項的表單。編輯的是一份本地副本，按「完成」才交回給表單——關掉彈窗
 * 不等於存檔，存檔跟卡片一起。交回去的仍是同一份 JSON（shared/game-spec 的形狀），
 * 所以進階作者照樣能在分區底下直接改 JSON，兩邊互通。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { confirmDialog } from "@/lib/confirm";
import { AUDIO_KEYS, validateGameSpec, type AudioKey, type BuildingJson, type GameSpecJson, type NpcJson, type PlaceJson, type XZ } from "../../../../shared/game-spec";
import { defaultWorldFor, specTemplateFor } from "@/game/specs";

const props = defineProps<{ modelValue: GameSpecJson | null; names: string[]; roleId: string }>();
const emit = defineEmits<{ "update:modelValue": [GameSpecJson]; close: [] }>();
const { t } = useI18n();

type Cat = "npcs" | "places" | "buildings" | "world";
const CATS: Cat[] = ["npcs", "places", "buildings", "world"];
const HAIRS = ["short", "long", "twin", "bob"] as const;
const HALOS = ["hex", "ring", "arc"] as const;

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const blank = (): GameSpecJson => ({ version: 1, enabled: true, npcs: [] });
// 本地副本：改到一半按取消，外面那份不動
const spec = ref<GameSpecJson>(props.modelValue ? clone(props.modelValue) : blank());
const original = JSON.stringify(props.modelValue ?? null);
const dirty = computed(() => JSON.stringify(spec.value) !== original);
const cat = ref<Cat>("npcs");
const index = ref(0);

const list = computed<(NpcJson | PlaceJson | BuildingJson)[]>(() => (cat.value === "world" ? [] : ((spec.value[cat.value] ??= []) as (NpcJson | PlaceJson | BuildingJson)[])));
const npc = computed(() => (cat.value === "npcs" ? spec.value.npcs[index.value] : undefined));
const place = computed(() => (cat.value === "places" ? spec.value.places?.[index.value] : undefined));
const building = computed(() => (cat.value === "buildings" ? spec.value.buildings?.[index.value] : undefined));
const titleOf = (item: NpcJson | PlaceJson | BuildingJson, i: number) =>
  ("name" in item && item.name) || ("label" in item && item.label) || `${t(`gameEd.cat.${cat.value}`)} ${i + 1}`;
const subOf = (item: NpcJson | PlaceJson | BuildingJson) => ("match" in item ? item.match : item.pos ? `${item.pos[0]}, ${item.pos[1]}` : "");

const validation = computed(() => validateGameSpec(clone(spec.value)));
const issues = computed(() => (validation.value.ok ? [] : validation.value.errors));

function pick(c: Cat) { cat.value = c; index.value = 0; }
function add() {
  if (cat.value === "npcs") {
    const used = new Set(spec.value.npcs.map((n) => n.name));
    const name = props.names.find((n) => !used.has(n)) || "";
    const d = defaultWorldFor([name || "?"]).npcs[0];
    spec.value.npcs.push({ name, color: d.color, hair: d.hair, hairStyle: d.hairStyle, halo: d.halo, pos: [0, 0], face: Math.PI, wander: 2.5 });
  } else if (cat.value === "places") (spec.value.places ??= []).push({ match: "", pos: [0, 0], label: "" });
  else if (cat.value === "buildings") (spec.value.buildings ??= []).push({ pos: [0, 0], size: [8, 6, 8], label: "" });
  index.value = list.value.length - 1;
  void nextTick(() => document.getElementById("gw-first")?.focus());
}
async function remove(i: number) {
  const item = list.value[i];
  if (!(await confirmDialog({ message: t("gameEd.deleteConfirm", { name: titleOf(item, i) }), confirmText: t("list.remove"), danger: true }))) return;
  list.value.splice(i, 1);
  index.value = Math.min(index.value, list.value.length - 1);
}
function move(i: number, delta: number) {
  const to = i + delta; if (to < 0 || to >= list.value.length) return;
  const arr = list.value; [arr[i], arr[to]] = [arr[to], arr[i]];
  if (index.value === i) index.value = to; else if (index.value === to) index.value = i;
}
async function useTemplate() {
  if (spec.value.npcs.length && !(await confirmDialog({ message: t("gameEd.template.confirm"), confirmText: t("gameEd.template"), danger: true }))) return;
  spec.value = clone(specTemplateFor(props.roleId, props.names));
  index.value = 0;
}

// 朝向：存的是弧度，表單給玩家看的是度
const deg = (rad: number | undefined) => Math.round(((rad ?? 0) * 180) / Math.PI);
const setFace = (n: NpcJson, v: string) => { n.face = Math.round(((Number(v) || 0) * Math.PI) / 180 * 10000) / 10000; };
// 座標對：輸入框各綁一個分量
const xz = (item: { pos?: XZ }, k: 0 | 1, v: string) => { const p: XZ = item.pos ? [item.pos[0], item.pos[1]] : [0, 0]; p[k] = Number(v) || 0; item.pos = p; };
const size3 = (b: BuildingJson, k: 0 | 1 | 2, v: string) => { const s: [number, number, number] = [...b.size]; s[k] = Number(v) || 0; b.size = s; };
// 模型：網址留空＝不用模型（退回人偶）
function setModel(target: { model?: { url: string; height?: number } }, url: string) {
  const u = url.trim();
  if (!u) { delete target.model; return; }
  target.model = { ...(target.model || {}), url: u };
}
function setModelHeight(target: { model?: { url: string; height?: number } }, v: string) {
  if (!target.model) return;
  const n = Number(v); if (Number.isFinite(n) && n > 0) target.model.height = n; else delete target.model.height;
}
function setPlayer(url: string) { const u = url.trim(); if (!u) delete spec.value.player; else spec.value.player = { ...(spec.value.player || {}), url: u }; }
function setPlayerHeight(v: string) { if (!spec.value.player) return; const n = Number(v); if (Number.isFinite(n) && n > 0) spec.value.player.height = n; else delete spec.value.player.height; }
function setSpawn(k: 0 | 1, v: string) { const p: XZ = spec.value.spawn ? [spec.value.spawn[0], spec.value.spawn[1]] : [0, 8]; p[k] = Number(v) || 0; spec.value.spawn = p; }
function setSky(v: string) { const u = v.trim(); if (u) spec.value.sky = u; else delete spec.value.sky; }
function setAudio(key: AudioKey, v: string) {
  const u = v.trim(); const a = { ...(spec.value.audio || {}) };
  if (u) a[key] = u; else delete a[key];
  if (Object.keys(a).length) spec.value.audio = a; else delete spec.value.audio;
}
// 樹與路燈：一行一組「x, z」
const linesOf = (pts: XZ[] | undefined) => (pts || []).map((p) => `${p[0]}, ${p[1]}`).join("\n");
function setPoints(key: "trees" | "lamps", text: string) {
  const pts: XZ[] = [];
  for (const line of text.split(/\n/)) {
    const m = line.trim().split(/[\s,]+/).filter(Boolean); if (m.length < 2) continue;
    const x = Number(m[0]), z = Number(m[1]); if (Number.isFinite(x) && Number.isFinite(z)) pts.push([x, z]);
  }
  if (pts.length) spec.value[key] = pts; else delete spec.value[key];
}

function done() { emit("update:modelValue", clone(spec.value)); emit("close"); }
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
        <span class="subtle">{{ $t("editor.game.npcCount", { n: spec.npcs.length }) }}</span>
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
          <button v-if="cat !== 'world'" type="button" class="btn btn--sm" @click="add">{{ $t(`gameEd.add.${cat}`) }}</button>
          <ul v-if="cat !== 'world'" class="gw__items">
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
          <p v-if="cat !== 'world' && !list.length" class="subtle gw__empty">{{ $t("gameEd.empty") }}</p>
          <p v-if="cat === 'world'" class="subtle gw__empty">{{ $t("gameEd.world.lede") }}</p>
        </aside>

        <!-- 右：表單 -->
        <section v-if="npc" class="gw__edit">
          <div class="field">
            <label for="gw-first">{{ $t("gameEd.npc.name") }}</label>
            <input id="gw-first" v-model="npc.name" class="input" list="gw-names" maxlength="200" />
            <datalist id="gw-names"><option v-for="n in names" :key="n" :value="n" /></datalist>
            <span class="field__foot"><span class="subtle">{{ $t("gameEd.npc.name.hint") }}</span></span>
          </div>
          <div class="gw__grid">
            <div class="field"><label>{{ $t("gameEd.npc.color") }}</label><span class="gw__color"><input type="color" :value="/^#[0-9a-fA-F]{6}$/.test(npc.color || '') ? npc.color : '#888888'" @input="npc.color = ($event.target as HTMLInputElement).value" /><input v-model="npc.color" class="input mono-input" placeholder="#5ec2f5" /></span></div>
            <div class="field"><label>{{ $t("gameEd.npc.hair") }}</label><span class="gw__color"><input type="color" :value="/^#[0-9a-fA-F]{6}$/.test(npc.hair || '') ? npc.hair : '#888888'" @input="npc.hair = ($event.target as HTMLInputElement).value" /><input v-model="npc.hair" class="input mono-input" placeholder="#8fd3ff" /></span></div>
            <div class="field"><label>{{ $t("gameEd.npc.hairStyle") }}</label><select v-model="npc.hairStyle" class="input"><option v-for="h in HAIRS" :key="h" :value="h">{{ $t(`gameEd.hair.${h}`) }}</option></select></div>
            <div class="field"><label>{{ $t("gameEd.npc.halo") }}</label><select v-model="npc.halo" class="input"><option v-for="h in HALOS" :key="h" :value="h">{{ $t(`gameEd.halo.${h}`) }}</option></select></div>
            <div class="field"><label>{{ $t("gameEd.pos") }}</label><span class="gw__pair"><input class="input" type="number" step="0.5" :value="npc.pos?.[0] ?? 0" @input="xz(npc, 0, ($event.target as HTMLInputElement).value)" /><input class="input" type="number" step="0.5" :value="npc.pos?.[1] ?? 0" @input="xz(npc, 1, ($event.target as HTMLInputElement).value)" /></span></div>
            <div class="field"><label>{{ $t("gameEd.npc.face") }}</label><input class="input" type="number" step="15" :value="deg(npc.face)" @input="setFace(npc, ($event.target as HTMLInputElement).value)" /></div>
            <div class="field"><label>{{ $t("gameEd.npc.wander") }}</label><input v-model.number="npc.wander" class="input" type="number" min="0" max="20" step="0.5" /></div>
          </div>
          <div class="field">
            <label>{{ $t("gameEd.model") }}</label>
            <input class="input mono-input" :value="npc.model?.url || ''" placeholder="https://… /game/models/….glb" spellcheck="false" @change="setModel(npc, ($event.target as HTMLInputElement).value)" />
            <span class="field__foot"><span class="subtle">{{ $t("gameEd.model.hint") }}</span></span>
          </div>
          <div v-if="npc.model" class="field gw__short"><label>{{ $t("gameEd.model.height") }}</label><input class="input" type="number" min="0.5" max="10" step="0.05" :value="npc.model.height ?? ''" @change="setModelHeight(npc, ($event.target as HTMLInputElement).value)" /></div>
        </section>

        <section v-else-if="place" class="gw__edit">
          <div class="field"><label for="gw-first">{{ $t("gameEd.place.label") }}</label><input id="gw-first" v-model="place.label" class="input" maxlength="200" /></div>
          <div class="field">
            <label>{{ $t("gameEd.place.match") }}</label>
            <input v-model="place.match" class="input mono-input" spellcheck="false" :placeholder="$t('gameEd.place.match.placeholder')" />
            <span class="field__foot"><span class="subtle">{{ $t("gameEd.place.match.hint") }}</span></span>
          </div>
          <div class="field gw__short"><label>{{ $t("gameEd.pos") }}</label><span class="gw__pair"><input class="input" type="number" step="0.5" :value="place.pos[0]" @input="xz(place, 0, ($event.target as HTMLInputElement).value)" /><input class="input" type="number" step="0.5" :value="place.pos[1]" @input="xz(place, 1, ($event.target as HTMLInputElement).value)" /></span></div>
        </section>

        <section v-else-if="building" class="gw__edit">
          <div class="field"><label for="gw-first">{{ $t("gameEd.building.label") }}</label><input id="gw-first" v-model="building.label" class="input" maxlength="200" /></div>
          <div class="gw__grid">
            <div class="field"><label>{{ $t("gameEd.pos") }}</label><span class="gw__pair"><input class="input" type="number" step="0.5" :value="building.pos[0]" @input="xz(building, 0, ($event.target as HTMLInputElement).value)" /><input class="input" type="number" step="0.5" :value="building.pos[1]" @input="xz(building, 1, ($event.target as HTMLInputElement).value)" /></span></div>
            <div class="field"><label>{{ $t("gameEd.building.size") }}</label><span class="gw__pair gw__pair--3"><input v-for="k in ([0, 1, 2] as const)" :key="k" class="input" type="number" min="0.5" max="60" step="0.5" :value="building.size[k]" @input="size3(building, k, ($event.target as HTMLInputElement).value)" /></span></div>
            <div class="field"><label>{{ $t("gameEd.building.color") }}</label><span class="gw__color"><input type="color" :value="/^#[0-9a-fA-F]{6}$/.test(building.color || '') ? building.color : '#dfe6ee'" @input="building.color = ($event.target as HTMLInputElement).value" /><input v-model="building.color" class="input mono-input" placeholder="#dfe6ee" /></span></div>
          </div>
        </section>

        <section v-else-if="cat === 'world'" class="gw__edit">
          <div class="gw__grid">
            <div class="field"><label>{{ $t("gameEd.world.spawn") }}</label><span class="gw__pair"><input class="input" type="number" step="0.5" :value="spec.spawn?.[0] ?? 0" @input="setSpawn(0, ($event.target as HTMLInputElement).value)" /><input class="input" type="number" step="0.5" :value="spec.spawn?.[1] ?? 8" @input="setSpawn(1, ($event.target as HTMLInputElement).value)" /></span></div>
            <div v-if="spec.player" class="field"><label>{{ $t("gameEd.model.height") }}</label><input class="input" type="number" min="0.5" max="10" step="0.05" :value="spec.player.height ?? ''" @change="setPlayerHeight(($event.target as HTMLInputElement).value)" /></div>
          </div>
          <div class="field">
            <label>{{ $t("gameEd.world.player") }}</label>
            <input class="input mono-input" :value="spec.player?.url || ''" spellcheck="false" placeholder="https://… /game/models/….glb" @change="setPlayer(($event.target as HTMLInputElement).value)" />
            <span class="field__foot"><span class="subtle">{{ $t("gameEd.model.hint") }}</span></span>
          </div>
          <div class="field">
            <label>{{ $t("gameEd.world.sky") }}</label>
            <input class="input mono-input" :value="spec.sky || ''" spellcheck="false" placeholder="https://…/sky.jpg" @change="setSky(($event.target as HTMLInputElement).value)" />
            <span class="field__foot"><span class="subtle">{{ $t("gameEd.resources") }}</span></span>
          </div>
          <fieldset class="gw__audio">
            <legend>{{ $t("gameEd.world.audio") }}</legend>
            <div v-for="k in AUDIO_KEYS" :key="k" class="field gw__audio-row">
              <label :for="`gw-audio-${k}`">{{ $t(`gameEd.audio.${k}`) }}</label>
              <input :id="`gw-audio-${k}`" class="input mono-input" :value="spec.audio?.[k] || ''" spellcheck="false" placeholder="https://…/x.mp3" @change="setAudio(k, ($event.target as HTMLInputElement).value)" />
            </div>
          </fieldset>
          <div class="gw__grid">
            <div class="field"><label>{{ $t("gameEd.world.trees") }}</label><textarea class="input mono-input" rows="5" :value="linesOf(spec.trees)" @change="setPoints('trees', ($event.target as HTMLTextAreaElement).value)" /></div>
            <div class="field"><label>{{ $t("gameEd.world.lamps") }}</label><textarea class="input mono-input" rows="5" :value="linesOf(spec.lamps)" @change="setPoints('lamps', ($event.target as HTMLTextAreaElement).value)" /></div>
          </div>
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

.gw__body { display: grid; grid-template-columns: 300px minmax(0, 1fr); min-height: 0; }
.gw__list { display: grid; grid-template-rows: auto auto minmax(0, 1fr); gap: var(--s-2); padding: var(--s-3); box-shadow: 1px 0 0 var(--line); min-height: 0; align-content: start; }
.gw__list .seg { display: grid; grid-template-columns: repeat(4, 1fr); }
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
.gw__color { display: grid; grid-template-columns: 36px 1fr; gap: var(--s-2); align-items: center; }
.gw__color input[type="color"] { width: 36px; height: 36px; padding: 0; border: 1px solid var(--line); border-radius: var(--r-sm); background: none; cursor: pointer; }
.gw__audio { border: 1px solid var(--line); border-radius: var(--r-md); padding: var(--s-2) var(--s-3) 0; margin: 0 0 var(--s-3); }
.gw__audio legend { font-size: 13px; font-weight: 600; padding: 0 4px; }
.gw__audio-row { grid-template-columns: 140px minmax(0, 1fr); display: grid; align-items: center; }
.mono-input { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; line-height: 1.55; }

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
  .gw__audio-row { grid-template-columns: 1fr; }
}
</style>
