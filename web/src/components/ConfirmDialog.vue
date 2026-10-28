<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { confirmDialog, confirmState, confirmTextMatches, settleConfirm, publicationDrafts } from "@/lib/confirm";
import LookupField, { type LookupValue } from "./LookupField.vue";
import PublicationUpdateFields from './PublicationUpdateFields.vue';
import { parseUpdateIntent, type UpdateIntent } from '../../../shared/card-update';
import { useI18n } from 'vue-i18n';
import { wrapTab } from "@/lib/focus-trap";

const {t}=useI18n();
const box = ref<HTMLElement | null>(null);
const update=ref<UpdateIntent>({updateKind:'minor',updateNote:''});
const busy=ref(false),pending=ref(false),submitError=ref(''),now=ref(Date.now());
let cooldownTimer:ReturnType<typeof setTimeout>|undefined;
function changeUpdate(value:UpdateIntent){
 update.value=value;
 const key=confirmState.current?.publication?.key;if(key)publicationDrafts.set(key,{...value});
}
function validUpdate(){
 if(!confirmState.current?.publication)return true;
 if(update.value.updateKind==='minor')return true;
 const next=confirmState.current.publication.nextMajorUpdateAt;
 if(next===undefined||next>now.value)return false;
 try{parseUpdateIntent(update.value);return true;}catch{return false;}
}
async function retryEligibility(){
 const cur=confirmState.current;if(!cur?.publication?.reloadEligibility)return;
 try{const value=await cur.publication.reloadEligibility();if(confirmState.current===cur)cur.publication.nextMajorUpdateAt=value;}catch{if(confirmState.current===cur)cur.publication.nextMajorUpdateAt=undefined;}
}
/** 要照打的字：每次開新彈窗清空 */
const typed = ref("");
/** 選填的那一格：開新彈窗時填上預設值；有 lookup 的那種還帶著對上的編號 */
const fieldText = ref("");
const fieldPick = ref<LookupValue>({ label: "" });
/** 勾選框：開新彈窗時回到預設值 */
const checked = ref(false);
const typedOk = computed(() => !!confirmState.current && confirmTextMatches(confirmState.current, typed.value) && validUpdate() && !busy.value);
/** 低權重的危險確認：只在 danger 時生效，非危險確認忽略這個選項。 */
const subdued = computed(() => !!confirmState.current?.danger && confirmState.current.dangerAppearance === "subdued");
async function confirm() {
  const cur = confirmState.current;
  if (!cur || !typedOk.value || busy.value) return;
  if(cur.valid&&!cur.valid()){settleConfirm(false);return;}
  const text=cur.field?.lookup?fieldPick.value.label:fieldText.value;
  const id=cur.field?.lookup?fieldPick.value.id:undefined;
  const intent=cur.publication?parseUpdateIntent(update.value.updateKind==='major'?update.value:{updateKind:'minor'}):{updateKind:'minor' as const,updateNote:''};
  if(cur.onConfirm){
   busy.value=true;submitError.value='';
   try{
    await cur.onConfirm({text:text.trim(),...(id?{id}:{}),update:intent});
    if(confirmState.current!==cur)return;
    if(cur.valid&&!cur.valid()){settleConfirm(false);return;}
    if(cur.publication)publicationDrafts.delete(cur.publication.key);
   }catch(error){
    if(confirmState.current!==cur)return;
    const e=error as {status?:number;code?:string;message?:string};
    pending.value=error instanceof TypeError||!!e.status&&e.status>=500;
    if(cur.publication)publicationDrafts.set(cur.publication.key,{...update.value,pending:pending.value});
    submitError.value=pending.value?t('cardUpdate.update.resultPending'):e.code==='update_notification_cooldown'?t('cardUpdate.update.noticeLimit'):e.message||t('cardUpdate.update.submitFailed');
    if(e.code==='update_notification_cooldown')await retryEligibility();
    return;
   }finally{if(confirmState.current===cur)busy.value=false;}
  }
  settleConfirm(true,typed.value,text,id,cur.check?checked.value:undefined,cur.publication?intent:undefined);
}
/** 開啟前的焦點：關掉時還回去，鍵盤使用者不會掉到頁面開頭 */
let restore: HTMLElement | null = null;

watch(() => confirmState.current, async (cur) => {
  if (!cur) { restore?.focus?.(); restore = null; return; }
  restore = document.activeElement as HTMLElement | null;
  busy.value=false;pending.value=!!(cur.publication&&publicationDrafts.get(cur.publication.key)?.pending);submitError.value=pending.value?t('cardUpdate.update.resultPending'):'';
  update.value=cur.publication?{...(publicationDrafts.get(cur.publication.key)??{updateKind:'minor',updateNote:''})}:{updateKind:'minor',updateNote:''};
  typed.value = "";
  fieldText.value = cur.field?.initial ?? "";
  checked.value = cur.check?.initial ?? false;
  fieldPick.value = { label: cur.field?.initial ?? "", ...(cur.field?.initialId ? { id: cur.field.initialId } : {}) };
  await nextTick();
  // 要照打的字：焦點直接進打字框。其他破壞性動作先站在取消鍵上：按錯 Enter 也不會刪掉東西
  const pick = cur.publication ? "[data-update-choice=minor]" : cur.requireText ? "[data-typed]" : (cur.danger || cur.focusCancel) && !cur.single ? "[data-cancel]" : "[data-confirm]";
  box.value?.querySelector<HTMLElement>(pick)?.focus();
});

watch(()=>confirmState.current?.publication?.nextMajorUpdateAt,(next)=>{
 if(cooldownTimer)clearTimeout(cooldownTimer);now.value=Date.now();
 if(next&&next>now.value)cooldownTimer=setTimeout(()=>{now.value=Date.now();},next-now.value);
});
function onKey(e: KeyboardEvent) {
  if (!confirmState.current) return;
  if (e.key === "Escape") { e.preventDefault(); if(!busy.value)settleConfirm(false); return; }
  // 焦點只在彈窗裡繞（沿用原本的範圍：停用的鍵也算一站）
  wrapTab(e, box.value);
}
onMounted(() => {
  document.addEventListener("keydown", onKey);
  if (import.meta.env.DEV) (window as unknown as { __confirmDialog: typeof confirmDialog }).__confirmDialog = confirmDialog;
});
onBeforeUnmount(() => { document.removeEventListener("keydown", onKey);if(cooldownTimer)clearTimeout(cooldownTimer); });
</script>

<template>
  <Teleport to="body">
    <div v-if="confirmState.current" class="dlg-backdrop" @click.self="!busy && settleConfirm(false)">
      <div ref="box" class="dlg panel" :class="{ 'dlg--danger-subdued': subdued, 'dlg--publication': !!confirmState.current.publication }" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title" aria-describedby="dlg-msg">
        <h2 id="dlg-title" class="dlg__title">{{ confirmState.current.title ?? confirmState.current.message }}</h2>
        <p v-if="confirmState.current.title" id="dlg-msg" class="dlg__msg">{{ confirmState.current.message }}</p>
        <PublicationUpdateFields v-if="confirmState.current.publication" :model-value="update" @update:model-value="changeUpdate" :next-major-update-at="confirmState.current.publication.nextMajorUpdateAt" :now="now" :disabled="busy||pending" @retry="retryEligibility" />
        <p v-if="submitError" class="notice notice--error" role="status">{{ submitError }}</p>
        <!-- 要讓人複製的東西：一整塊可全選，點一下就選起來 -->
        <code v-if="confirmState.current.detail" class="dlg__detail" tabindex="0" @click="($event.target as HTMLElement).ownerDocument.getSelection()?.selectAllChildren($event.target as Node)">{{ confirmState.current.detail }}</code>
        <!-- 要照打的字：打對了確認鍵才亮；Enter 也只在打對時算數 -->
        <label v-if="confirmState.current.requireText" class="dlg__typed">
          <span class="dlg__typed-hint">{{ $t("dialog.typeToConfirm", { text: confirmState.current.requireText }) }}</span>
          <input v-model="typed" class="input" type="text" autocomplete="off" spellcheck="false" data-typed
                 :placeholder="confirmState.current.placeholder ?? confirmState.current.requireText"
                 @keydown.enter.prevent="confirm" />
        </label>
        <!-- 選填的一格字（例如原作）：Enter 不送出，送出仍要按確認鍵 -->
        <label v-if="confirmState.current.field" class="dlg__field" :inert="busy||pending">
          <span class="dlg__field-label">{{ confirmState.current.field.label }}</span>
          <LookupField v-if="confirmState.current.field.lookup" v-model="fieldPick" :lookup="confirmState.current.field.lookup" :placeholder="confirmState.current.field.placeholder" :maxlength="confirmState.current.field.maxlength" :label="confirmState.current.field.label" />
          <input v-else v-model="fieldText" class="input" type="text" autocomplete="off" data-field
                 :placeholder="confirmState.current.field.placeholder" :maxlength="confirmState.current.field.maxlength" @keydown.enter.prevent="confirm" />
          <span v-if="confirmState.current.field.hint" class="subtle">{{ confirmState.current.field.hint }}</span>
        </label>
        <label v-if="confirmState.current.check" class="dlg__check">
          <input v-model="checked" type="checkbox" data-check />
          <span class="dlg__check-text">{{ confirmState.current.check.label }}<span v-if="confirmState.current.check.hint" class="dlg__check-hint">{{ confirmState.current.check.hint }}</span></span>
        </label>
        <div class="dlg__actions">
          <button v-if="!confirmState.current.single" class="btn" data-cancel :disabled="busy" @click="settleConfirm(false)">
            {{ confirmState.current.cancelText ?? $t("dialog.cancel") }}
          </button>
          <button class="btn" :class="subdued ? 'dlg__subdued' : confirmState.current.danger ? 'btn--danger-solid' : 'btn--primary'" data-confirm
                  :disabled="!typedOk" @click="confirm">
            {{ pending ? t("cardUpdate.update.checkResult") : confirmState.current.confirmText ?? $t("dialog.confirm") }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 110 而不是 100：確認框是從別的全頁浮層（世界書條目、正則規則、素材庫，都是 100）裡叫出來的。
   同為 100 時誰後掛到 body 誰在上，而這個元件掛在 App 一開始，永遠輸給後開的浮層。 */
.dlg-backdrop {
  position: fixed; inset: 0; z-index: 110;
  display: grid; place-items: center; padding: var(--s-5);
  background: rgba(16, 16, 24, 0.45);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  animation: fade var(--dur) var(--ease);
}
.dlg {
  width: min(400px, 100%);
  grid-template-columns: minmax(0, 1fr);
  padding: var(--s-5) var(--s-5) var(--s-4);
  display: grid; gap: var(--s-3);
  box-shadow: 0 0 0 1px var(--line), var(--shadow-md);
  animation: pop var(--dur-slow) var(--ease);
  max-height:calc(100dvh - var(--s-6));overflow-y:auto;
}
/* 標題與內文可能帶使用者或作者給的長字（卡名、項目 key）：不斷行會把框撐得比畫面還寬 */
.dlg > * { min-width: 0; }
.dlg--publication { width:min(420px,100%); max-height:calc(100dvh - var(--s-6)); overflow-y:auto; }
.dlg--publication .dlg__actions { min-width:0; }
.dlg__title { font-size: 16px; font-weight: 600; line-height: 1.4; overflow-wrap: anywhere; }
.dlg__msg { font-size: 14px; line-height: 1.6; color: var(--text-2); overflow-wrap: anywhere; white-space:pre-wrap; }
.dlg__detail {
  display: block; padding: 10px 12px;
  border-radius: var(--r-sm); background: var(--surface-2);
  font: 12.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--text);
  overflow-wrap: anywhere; user-select: all; cursor: text;
}
.dlg__typed { display: grid; gap: 6px; }
.dlg__typed-hint { font-size: 12.5px; color: var(--text-3); }
.dlg__typed .input { width: 100%; }
.dlg__actions { display: flex; justify-content: flex-end; gap: var(--s-2); margin-top: var(--s-1); }

@keyframes fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes pop { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: none; } }

@media (max-width: 480px) {
  .dlg-backdrop { place-items: end center; padding: var(--s-3); padding-bottom: calc(var(--s-3) + env(safe-area-inset-bottom)); }
  .dlg { width: 100%; }
  .dlg__actions { flex-direction: column-reverse; }
  .dlg__actions .btn { width: 100%; height: var(--h-lg); }
  /* 低權重的危險確認：取消在上、破壞動作在下，不讓它成為最上方最醒目的按鈕 */
  .dlg--danger-subdued .dlg__actions { flex-direction: column; }
}
/* 低權重的危險確認在韓文按詞換行（標題、內文）；長 key 仍靠 overflow-wrap: anywhere 斷開 */
.dlg--danger-subdued:lang(ko) .dlg__title, .dlg--danger-subdued:lang(ko) .dlg__msg { word-break: keep-all; }
/* 低權重的破壞動作：透明底、警示色字與細框；hover 只加淡色，不變實心紅 */
.dlg__subdued { background: transparent; color: var(--danger); border-color: color-mix(in srgb, var(--danger) 55%, transparent); }
.dlg__subdued:hover:not(:disabled) { background: color-mix(in srgb, var(--danger) 10%, transparent); color: var(--danger); border-color: var(--danger); }
.dlg__field { display: grid; gap: 6px; text-align: left; }
.dlg__check { display: flex; align-items: flex-start; gap: var(--s-2); min-height: var(--h-sm); font-size: 14px; line-height: 1.5; cursor: pointer; }
.dlg__check input { flex: none; width: 18px; height: 18px; margin: 2px 0 0; accent-color: var(--accent-btn); }
.dlg__check-text { display: grid; gap: 2px; }
.dlg__check-hint { font-size: 12px; color: var(--text-3); white-space: pre-line; }
.dlg__field-label { font-size: 13px; color: var(--text-2); }
</style>
