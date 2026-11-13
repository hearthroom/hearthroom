<script setup lang="ts">
/**
 * 擴充編輯器（ui.md §3.6、§3.8 製作者端、§4.6）。骨架照卡片編輯頁：分區導覽（桌機在左、手機在頂端一排）、
 * 表單、底部黏著的工具列「試玩｜儲存」。分區只有五個：基本資料、世界書、正規表示式、開局、發布。
 *
 * 跟卡片編輯頁不同的地方與理由：
 * - 一次只顯示一個分區，分區記在網址 ?section=：通知（被退回、被隱藏、審核結果）要能直達「發布」，
 *   而「發布分區時儲存降為次要」也要有一個明確的「現在在哪一區」。
 * - 整份草稿一次存（Provider 一支 draft/save），帶 expectedRevision 與 idempotencyKey：
 *   別處改過就回 draft_stale，這時保留畫面上的修改、停掉儲存，只在作者按「重新載入」時才換成伺服器那份，
 *   不覆蓋別處的修改。逾時後重送同一份內容沿用同一把 key，存進去了的那次不會被誤判成 draft_stale。
 * - 不提供原卡內容的檢視：原卡設定是原作者的資產（ui.md §3.6）。
 *
 * 寫卡頁的元件原樣沿用（世界書、正規表示式、開局、橫式背景圖），不 fork。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { ApiError, uploadImage } from "@/lib/api";
import {
  CONSTANT_CHAR_LIMIT, appealWorkshop, constantChars, deleteWorkshop, fetchDraft, fetchMyWorkshops, publishChecklist,
  publishState, saveDraft, submitWorkshop, withdrawWorkshop,
  type AppealState, type DraftWrite, type MineItem, type MineStatus, type OwnerState, type WorkshopDraft,
} from "@/lib/workshop";
import { emptyRuleSet, ruleSetFromImport, ruleSetToExport, type OpeningMode } from "@/lib/regex-rules";
import { fallbackLimits, type WorldbookEntryDraft } from "@/lib/role-draft";
import { worldbookToExport } from "@/lib/tavern";
import { downloadBlob, safeFileName } from "@/lib/save-file";
import { askRating, rate, usable } from "@/lib/rating";
import { isRating, type RatingAnswers } from "../../../../../shared/content-rating";
import { confirmDialog, confirmForm } from "@/lib/confirm";
import { compact } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";
import FieldText from "@/components/editor/FieldText.vue";
import ImageField from "@/components/editor/ImageField.vue";
import WorldbookEditor from "@/components/editor/WorldbookEditor.vue";
import RegexRulesEditor from "@/components/editor/RegexRulesEditor.vue";
import OpeningEditor from "@/components/editor/OpeningEditor.vue";
import ReadmeView from "@/components/ReadmeView.vue";
import RatingMark from "@/components/RatingMark.vue";
import WorkshopIcon from "../WorkshopIcon.vue";
import PublishPane from "./PublishPane.vue";
import TrialPanel, { type TrialOption } from "./TrialPanel.vue";

const props = defineProps<{ workshopId: string }>();
const route = useRoute();
const router = useRouter();
const session = useSession();
const { lp, locale } = useLocalePath();
const { t } = useI18n();

/** 擴充名稱上限（ui.md §7：格子上兩行放得下） */
const NAME_MAX = 16;

const SECTIONS = ["basic", "world", "regex", "opening", "publish"] as const;
type Section = (typeof SECTIONS)[number];
const SECTION_LABEL: Record<Section, string> = {
  basic: "workshop.editor.section.basic",
  world: "editor.section.worldbook",
  regex: "workshop.editor.section.regex",
  opening: "editor.section.opening",
  publish: "editor.section.publish",
};
const section = computed<Section>(() => {
  const q = route.query.section;
  return typeof q === "string" && (SECTIONS as readonly string[]).includes(q) ? (q as Section) : "basic";
});
const formTop = ref<HTMLElement | null>(null);
async function go(next: Section) {
  if (next === section.value) return;
  await router.replace({ query: { ...route.query, section: next } });
  // 換區後回到表單頂：上一區捲到很深時，新的一區不該從半路開始
  formTop.value?.scrollIntoView?.({ block: "start" });
}

// ── 草稿 ──────────────────────────────────────────────────────────

const loading = ref(true);
const loadError = ref("");
const draft = ref<WorkshopDraft | null>(null);
const revision = ref(0);
/** 上次存進去（或載入）的可寫欄位；「有沒有改過」對照它 */
const baseline = ref("");
/** 開局呈現在載入時的樣子：OpeningEditor 拿它判斷「切換了」並提示另一邊會被移除 */
const savedOpening = ref<OpeningMode>("greeting");
const status = ref<MineStatus>("draft");
const ownerState = ref<OwnerState>("visible");
const ownerReason = ref<string | null>(null);
const rejectNote = ref<string | null>(null);
const appeal = ref<AppealState>(null);
const joinCount = ref(0);

const saving = ref(false);
const busy = ref(false);
/** 別處改過：停掉儲存，等作者自己按重新載入 */
const stale = ref(false);
const deleted = ref(false);
const error = ref("");
const regexOpen = ref(false);
const trialOpen = ref(false);
const readmeTab = ref<"write" | "preview">("write");

function writable(d: WorkshopDraft): DraftWrite {
  return {
    name: d.name, summary: d.summary, readme: d.readme, coverUrl: d.coverUrl, rating: d.rating, ratingAnswers: d.ratingAnswers,
    worldbook: d.worldbook, rules: d.rules, opening: d.opening, updateNote: d.updateNote,
  };
}
const dirty = computed(() => Boolean(draft.value) && JSON.stringify(writable(draft.value!)) !== baseline.value);

function apply(d: WorkshopDraft) {
  // 伺服器沒給的欄位補成空的：元件都假設陣列與字串存在
  const next: WorkshopDraft = {
    ...d,
    name: d.name ?? "", summary: d.summary ?? "", readme: d.readme ?? "", coverUrl: d.coverUrl ?? "", updateNote: d.updateNote ?? "",
    worldbook: d.worldbook ?? [],
    rules: d.rules ?? emptyRuleSet(),
    opening: {
      mode: d.opening?.mode ?? "greeting", welcome: d.opening?.welcome ?? "", alternates: d.opening?.alternates ?? [],
      prologue: d.opening?.prologue ?? [], openingPage: d.opening?.openingPage ?? "",
    },
  };
  draft.value = JSON.parse(JSON.stringify(next)) as WorkshopDraft;
  revision.value = d.revision;
  baseline.value = JSON.stringify(writable(draft.value));
  savedOpening.value = draft.value.opening.mode;
  pendingSave = null;
  stale.value = false;
}

function applyItem(item: MineItem | undefined) {
  if (!item) return;
  status.value = item.status;
  ownerState.value = item.ownerState ?? "visible";
  ownerReason.value = item.ownerReason ?? null;
  rejectNote.value = item.rejectNote ?? null;
  appeal.value = item.appeal ?? null;
  joinCount.value = item.joinCount ?? 0;
}
/** 狀態只住在「我的擴充」：存檔可能取消送審、讓已發布變成「有修改」，存完都要重讀 */
async function refreshItem(token: string) {
  try {
    const mine = await fetchMyWorkshops(token);
    applyItem(mine.items.find((i) => i.id === props.workshopId));
  } catch { /* 讀不到就維持畫面上的狀態，不擋編輯 */ }
}

async function token(): Promise<string> {
  const value = await session.accessToken();
  if (!value) throw new Error(t("auth.expired"));
  return value;
}
const message = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : t(fallback));

async function load() {
  loading.value = true;
  loadError.value = "";
  error.value = "";
  try {
    const tk = await token();
    const [d, mine] = await Promise.all([fetchDraft(props.workshopId, tk), fetchMyWorkshops(tk).catch(() => null)]);
    apply(d);
    // 剛建立的擴充可能還不在清單裡：當草稿看，不擋編輯
    if (!mine?.items.some((i) => i.id === props.workshopId)) status.value = d.published ? (d.changedSincePublish ? "live_changed" : "live") : "draft";
    applyItem(mine?.items.find((i) => i.id === props.workshopId));
    tried.value = readTried();
  } catch (err) {
    loadError.value = message(err, "state.loadFailed");
  } finally {
    loading.value = false;
  }
}
onMounted(load);

let pendingSave: { payload: string; key: string } | null = null;
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

/** 存整份草稿。成功（就算 errors 非空，例如常駐超過上限，也是存進去了）回 true。 */
async function save(): Promise<boolean> {
  const d = draft.value;
  if (!d || saving.value || stale.value) return false;
  if (!dirty.value) return true;
  const payload = JSON.stringify(writable(d));
  const key = pendingSave?.payload === payload ? pendingSave.key : newKey();
  pendingSave = { payload, key };
  const wasLive = status.value === "live";
  saving.value = true;
  error.value = "";
  try {
    const tk = await token();
    const res = await saveDraft(props.workshopId, revision.value, key, JSON.parse(payload) as DraftWrite, tk);
    revision.value = res.revision;
    // 超過常駐上限也照存（errors 帶 constant_char_limit），畫面上的字數條已經標紅，送審時再擋
    // 基準是送出去的那份，不是現在的畫面：存檔途中又打的字仍算未存
    baseline.value = payload;
    pendingSave = null;
    flash(t("workshop.editor.toast.saved"));
    await refreshItem(tk);
    // 草稿存在 Provider、狀態清單在本站：清單還沒跟上時，已發布又存了修改就是「有修改尚未提交」，
    // 不然存完 dirty 歸零，「提交新版審核」會消失，存下的修改送不出去
    if (wasLive && status.value === "live") status.value = "live_changed";
    return true;
  } catch (err) {
    if (err instanceof ApiError && err.code === "draft_stale") stale.value = true;
    else error.value = message(err, "state.saveFailed");
    return false;
  } finally {
    saving.value = false;
  }
}

/** 重新載入伺服器那份（只在別處改過之後、作者自己按的時候） */
function reload() { void load(); }

// ── 發布 ──────────────────────────────────────────────────────────

const effectiveStatus = computed<MineStatus>(() =>
  // 已發布而畫面上有未存的修改：當成「有修改尚未提交」，主按鈕直接是「提交新版審核」（送出前會先存）
  status.value === "live" && dirty.value ? "live_changed" : status.value);
const pubState = computed(() => publishState(effectiveStatus.value, ownerState.value));
/** 名稱上限只有這一頁知道（共用的檢查清單不看長度）：超過就讓「名稱與簡介」不打勾、送不出去 */
const checklist = computed(() => {
  const d = draft.value;
  if (!d) return [];
  const nameOk = Array.from(d.name.trim()).length <= NAME_MAX;
  return publishChecklist(d).map((c) => (c.key === "basics" ? { ...c, ok: c.ok && nameOk } : c));
});
const residentUsed = computed(() => (draft.value ? constantChars(draft.value.worldbook) : 0));
// 跟伺服器同口徑（啟用＋常駐條目的字元數），存檔回的 constant_char_limit 不另外記：改少之後要立刻轉綠
const residentOver = computed(() => residentUsed.value > CONSTANT_CHAR_LIMIT);

const SUBMIT_ERRORS: Record<string, string> = {
  cover_required: "workshop.editor.error.cover",
  rating_required: "workshop.editor.error.rating",
  content_required: "workshop.editor.error.content",
  constant_char_limit: "workshop.editor.resident.over",
  update_note_required: "workshop.editor.error.note",
};

async function submit() {
  const d = draft.value;
  if (!d || busy.value) return;
  if (dirty.value && !(await save())) return;
  // 畫面上的按鈕已經依檢查清單鎖住；這裡再擋一次，鍵盤或連點也送不出不完整的版本
  const needsNote = Boolean(d.published);
  if (checklist.value.some((c) => !c.ok && (c.key !== "note" || needsNote))) return;
  busy.value = true;
  error.value = "";
  try {
    const tk = await token();
    const res = await submitWorkshop(props.workshopId, needsNote ? d.updateNote.trim() : "", tk);
    status.value = res.status;
    flash(t("workshop.publish.toast.submitted"));
    await refreshItem(tk);
  } catch (err) {
    const key = err instanceof ApiError ? SUBMIT_ERRORS[err.code] : undefined;
    error.value = key ? t(key, { max: new Intl.NumberFormat(String(locale.value)).format(CONSTANT_CHAR_LIMIT) }) : message(err, "state.actionFailed");
  } finally {
    busy.value = false;
  }
}

async function withdraw() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    const tk = await token();
    const res = await withdrawWorkshop(props.workshopId, tk);
    status.value = res.status;
    flash(t("workshop.publish.toast.canceled"));
  } catch (err) {
    error.value = message(err, "state.actionFailed");
  } finally {
    busy.value = false;
  }
}

async function appealNow() {
  if (busy.value) return;
  const answer = await confirmForm({
    title: t("workshop.appeal.title"), message: t("workshop.appeal.body"), phraseWrap: true,
    confirmText: t("workshop.appeal.submit"), cancelText: t("dialog.cancel"), focusCancel: true,
    field: { label: t("workshop.appeal.label"), required: true, multiline: true, maxlength: 500 },
  });
  const reason = answer?.text.trim();
  if (!reason) return;
  busy.value = true;
  error.value = "";
  try {
    const tk = await token();
    const res = await appealWorkshop(props.workshopId, reason, tk);
    appeal.value = res.appeal ?? "pending";
    flash(t("workshop.appeal.toast"));
  } catch (err) {
    // 已經送過一次：照實畫成申訴中，不再給按鈕
    if (err instanceof ApiError && err.code === "appeal_exists") appeal.value = "pending";
    else error.value = message(err, "state.actionFailed");
  } finally {
    busy.value = false;
  }
}

async function remove() {
  const d = draft.value;
  if (!d || busy.value) return;
  const name = d.name.trim() || t("workshop.mine.row.untitled");
  const ok = await confirmDialog({
    title: t("workshop.delete.title", { name }),
    message: joinCount.value > 0 ? t("workshop.delete.body", { count: compact(joinCount.value) }) : t("workshop.delete.bodyNone"),
    confirmText: t("workshop.delete.confirm"), cancelText: t("dialog.cancel"), danger: true, phraseWrap: true,
  });
  if (!ok) return;
  busy.value = true;
  error.value = "";
  try {
    await deleteWorkshop(props.workshopId, await token());
    deleted.value = true;
    await router.push(lp("/mine?tab=workshops"));
  } catch (err) {
    error.value = message(err, "state.actionFailed");
  } finally {
    busy.value = false;
  }
}

// ── 基本資料 ──────────────────────────────────────────────────────

async function onPickImage(file: File, ok: (url: string) => void, fail: (message: string) => void) {
  try {
    // 不帶原卡的 roleId：擴充作者通常不是原卡作者，圖放在他自己的資源庫
    ok(await uploadImage(file, await token()));
  } catch (err) {
    fail(message(err, "state.uploadFailed"));
  }
}

const ratingShown = computed(() => {
  const d = draft.value;
  if (!d) return null;
  const answers = usable(d.ratingAnswers as RatingAnswers | null);
  const result = answers ? rate(answers) : null;
  if (result) return { rating: result.rating, descriptors: result.descriptors };
  return isRating(d.rating) ? { rating: d.rating, descriptors: [] } : null;
});
/** 分級沿用卡片的分級問卷：答案跟著草稿存，送審時伺服器用同一份重算 */
async function editRating() {
  const d = draft.value;
  if (!d) return;
  const answers = await askRating(usable(d.ratingAnswers as RatingAnswers | null));
  if (!answers || draft.value !== d) return;
  d.ratingAnswers = answers as unknown as Record<string, unknown>;
  d.rating = rate(answers)?.rating ?? null;
}

// ── 世界書 ────────────────────────────────────────────────────────

const numberFmt = computed(() => new Intl.NumberFormat(String(locale.value)));
function onBookImported(payload: { entries: WorldbookEntryDraft[] }) {
  if (draft.value) draft.value.worldbook = payload.entries;
}
const fileName = () => safeFileName(draft.value?.name ?? "", "extension");
function exportBook() {
  const d = draft.value;
  if (!d) return;
  downloadBlob(new Blob([JSON.stringify(worldbookToExport(d.name || fileName(), d.worldbook), null, 2)], { type: "application/json" }), `${fileName()}-worldbook.json`);
}

// ── 正規表示式 ────────────────────────────────────────────────────

const regexFile = ref<HTMLInputElement | null>(null);
function onRegexFile(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  target.value = "";
  if (!file || !draft.value) return;
  void (async () => {
    try {
      const imported = ruleSetFromImport(JSON.parse(await file.text()));
      if (!imported) throw new Error("regex_invalid");
      const skipped = imported.skippedPromptOnly ? t("import.drop.promptOnlyRules", { n: imported.skippedPromptOnly }) : "";
      if (!imported.set.rules.length && skipped) { error.value = skipped; return; }
      // 擴充的開局住在 opening 裡，不跟規則檔走；規則檔帶的首屏與開局設定一律不採用
      draft.value!.rules = { ...imported.set, openingMode: draft.value!.rules.openingMode, openingPage: draft.value!.rules.openingPage };
      if (skipped) error.value = `${t("regex.imported", { n: imported.set.rules.length })} ${skipped}`;
      else flash(t("regex.imported", { n: imported.set.rules.length }));
    } catch {
      error.value = t("regex.importFailed");
    }
  })();
}
function exportRegex() {
  const d = draft.value;
  if (!d) return;
  downloadBlob(new Blob([JSON.stringify(ruleSetToExport(d.rules, d.opening.welcome), null, 2)], { type: "application/json" }), `${fileName()}-regex.json`);
}

// ── 開局 ──────────────────────────────────────────────────────────

const welcomeMax = computed(() => fallbackLimits(String(locale.value)).roleWelcome);
const openingCount = computed(() => {
  const o = draft.value?.opening;
  if (!o) return 0;
  return o.mode === "page" ? (o.openingPage.trim() ? 1 : 0) : (o.welcome.trim() ? 1 : 0) + o.alternates.filter((a) => a.trim()).length;
});

// ── 試玩 ──────────────────────────────────────────────────────────

const TRIED_KEY = (id: string) => `hearthroom.workshop.tried.${id}`;
const tried = ref(false);
function readTried(): boolean {
  try { return localStorage.getItem(TRIED_KEY(props.workshopId)) === "1"; } catch { return false; }
}
/** 開場還沒有 id（stage 的開場 id 由伺服器發），試玩用位置代號：主開場 welcome、備選 alt-<第幾個，從 1 起> */
const excerpt = (text: string) => {
  const line = text.replace(/<[^>]*>/g, " ").split("\n").map((s) => s.trim()).find(Boolean) ?? "";
  return Array.from(line).length > 20 ? `${Array.from(line).slice(0, 20).join("")}…` : line;
};
const trialOptions = computed<TrialOption[]>(() => {
  const d = draft.value;
  const list: TrialOption[] = [{ key: "base", label: t("workshop.test.baseOpening") }];
  if (!d) return list;
  const o = d.opening;
  if (o.mode === "page") {
    if (o.openingPage.trim()) list.push({ key: "welcome", label: t("workshop.test.thisOpening", { name: d.name.trim() || t("workshop.mine.row.untitled") }) });
  } else {
    if (o.welcome.trim()) list.push({ key: "welcome", label: t("workshop.test.thisOpening", { name: excerpt(o.welcome) }) });
    o.alternates.forEach((a, i) => { if (a.trim()) list.push({ key: `alt-${i + 1}`, label: t("workshop.test.thisOpening", { name: excerpt(a) }) }); });
  }
  return list;
});
const trialHref = (key: string) =>
  router.resolve({ path: lp(`/play/${draft.value?.card.num ?? ""}`), query: { wsTrial: props.workshopId, wsOpening: key } }).href;
function trialStarted() {
  tried.value = true;
  try { localStorage.setItem(TRIED_KEY(props.workshopId), "1"); } catch { /* 記不住只是清單上少一個勾 */ }
  trialOpen.value = false;
  flash(t("workshop.test.toast"));
}

// ── 提示、離開 ────────────────────────────────────────────────────

const toast = ref("");
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function flash(text: string) {
  toast.value = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = ""; }, 3200);
}

/* 改到一半離開要問一聲：站內換頁與關分頁都攔；換分區只換 query，不算離開 */
onBeforeRouteLeave(async () =>
  deleted.value || !dirty.value || (await confirmDialog({ message: t("edit.discard"), confirmText: t("dialog.leave"), danger: true })));
const guard = (e: BeforeUnloadEvent) => { if (dirty.value && !deleted.value) e.preventDefault(); };
/* Ctrl/⌘+S 存檔，跟卡片編輯頁一樣 */
const onKey = (e: KeyboardEvent) => {
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "s") {
    e.preventDefault();
    void save();
  }
};
onMounted(() => { window.addEventListener("beforeunload", guard); window.addEventListener("keydown", onKey); });
onBeforeUnmount(() => { window.removeEventListener("beforeunload", guard); window.removeEventListener("keydown", onKey); clearTimeout(toastTimer); });

/** 錯誤放在表單頂端：作者多半在某一區的深處按下按鈕，訊息要自己走到他眼前 */
watch(error, async (text) => {
  if (!text) return;
  await nextTick();
  formTop.value?.querySelector<HTMLElement>("[role=alert]")?.scrollIntoView?.({ block: "center", behavior: "smooth" });
});
</script>

<template>
  <div class="ws-ed">
    <header class="ws-ed__head">
      <p class="eyebrow">{{ $t("mine.eyebrow") }}</p>
      <h1 class="display">{{ $t("workshop.mine.edit") }}</h1>
      <span v-if="draft" class="chip ws-chip--on ws-ed__for" data-for-card><WorkshopIcon name="layers" />{{ $t("workshop.editor.forChip", { card: draft.card.name }) }}</span>
    </header>

    <div v-if="loading" class="ws-ed__ghosts" aria-hidden="true">
      <div class="ghost" style="height: 40px" /><div class="ghost" style="height: 160px" /><div class="ghost" style="height: 260px" />
    </div>

    <div v-else-if="loadError || !draft" class="notice notice--error ws-ed__fail" role="alert">
      <span>{{ loadError || $t("state.loadFailed") }}</span>
      <button type="button" class="btn btn--sm" @click="load">{{ $t("library.retry") }}</button>
    </div>

    <template v-else>
      <div class="ws-ed__grid">
        <nav class="ws-ed__nav" :aria-label="$t('editor.sections')">
          <button v-for="key in SECTIONS" :key="key" type="button" class="ws-ed__tab" :class="{ 'ws-ed__tab--on': section === key }"
                  :aria-current="section === key ? 'true' : undefined" :data-section-tab="key" @click="go(key)">
            <span class="ws-ed__tab-label">{{ $t(SECTION_LABEL[key]) }}</span>
            <span v-if="key === 'world' && residentOver" class="ws-ed__dot" role="img" :aria-label="$t('editor.section.missing')" />
            <span v-else-if="key === 'world' && draft.worldbook.length" class="ws-ed__n">{{ draft.worldbook.length }}</span>
            <span v-else-if="key === 'regex' && draft.rules.rules.length" class="ws-ed__n">{{ draft.rules.rules.length }}</span>
            <span v-else-if="key === 'opening' && openingCount" class="ws-ed__n">{{ openingCount }}</span>
          </button>
        </nav>

        <div ref="formTop" class="ws-ed__body">
          <div v-if="stale" class="notice notice--error ws-ed__stale" role="alert" data-stale>
            <span class="ws-text">{{ $t("workshop.editor.stale") }}</span>
            <button type="button" class="btn btn--sm" @click="reload">{{ $t("visibility.reload") }}</button>
          </div>
          <p v-if="error" class="notice notice--error ws-text" role="alert" data-error>{{ error }}</p>

          <!-- 基本資料 -->
          <section v-if="section === 'basic'" class="pane" data-section="basic">
            <h2 class="pane__title">{{ $t("workshop.editor.section.basic") }}</h2>
            <p class="notice ws-text">{{ $t("workshop.editor.forCard", { card: draft.card.name }) }}</p>
            <FieldText id="ws-name" v-model="draft.name" :label="$t('workshop.editor.name')" required :max="NAME_MAX"
                       :hint="$t('workshop.editor.name.hint', { max: NAME_MAX })" />
            <FieldText id="ws-summary" v-model="draft.summary" :label="$t('workshop.editor.summary')" required :rows="2" />
            <ImageField v-model="draft.coverUrl" :label="$t('workshop.editor.cover')" :hint="$t('workshop.editor.cover.hint')"
                        :pick-label="$t('editor.image.pick')" :clear-label="$t('editor.image.clear')" :library-label="$t('editor.image.library')"
                        :uploading="$t('editor.image.uploading')" ratio="wide" @pick="onPickImage" />
            <div class="field ws-ed__rating" data-rating>
              <label>{{ $t("workshop.editor.rating") }}</label>
              <div class="ws-ed__rating-row">
                <RatingMark v-if="ratingShown" :rating="ratingShown.rating" :descriptors="ratingShown.descriptors" variant="chip" />
                <span v-else class="chip">{{ $t("editor.rating.empty") }}</span>
                <button type="button" class="btn btn--sm" @click="editRating">{{ $t("workshop.editor.rating.set") }}</button>
              </div>
              <span class="subtle ws-text">{{ $t("workshop.editor.rating.hint") }}</span>
            </div>
            <div class="field">
              <div class="readme-head">
                <label for="ws-readme">{{ $t("workshop.editor.intro") }}</label>
                <div class="seg seg--sm" role="tablist" :aria-label="$t('workshop.editor.intro')">
                  <button type="button" class="seg__item" :class="{ 'seg__item--on': readmeTab === 'write' }" role="tab" :aria-selected="readmeTab === 'write'" @click="readmeTab = 'write'">{{ $t("editor.readme.write") }}</button>
                  <button type="button" class="seg__item" :class="{ 'seg__item--on': readmeTab === 'preview' }" role="tab" :aria-selected="readmeTab === 'preview'" @click="readmeTab = 'preview'">{{ $t("editor.readme.preview") }}</button>
                </div>
              </div>
              <FieldText v-show="readmeTab === 'write'" id="ws-readme" v-model="draft.readme" label="" :rows="10" />
              <div v-if="readmeTab === 'preview'" class="readme-preview">
                <ReadmeView v-if="draft.readme.trim()" :source="draft.readme" />
                <p v-else class="subtle">{{ $t("editor.readme.empty") }}</p>
              </div>
            </div>
          </section>

          <!-- 世界書：頂部是常駐內容的字數條，下面是寫卡頁的世界書元件原樣 -->
          <section v-else-if="section === 'world'" class="pane" data-section="world">
            <h2 class="pane__title">{{ $t("editor.section.worldbook") }}</h2>
            <p class="muted pane__lede ws-text">{{ $t("workshop.editor.lore.hint") }}</p>
            <div class="panel ws-ed__resident" :class="{ 'is-over': residentOver }" data-resident>
              <div class="ws-ed__resident-row">
                <h3>{{ $t("workshop.editor.resident.title") }}</h3>
                <span class="ws-ed__resident-n" data-resident-count>{{ $t("workshop.editor.resident.meter", { used: numberFmt.format(residentUsed), max: numberFmt.format(CONSTANT_CHAR_LIMIT) }) }}</span>
              </div>
              <div class="ws-ed__meter" role="meter" :aria-label="$t('workshop.editor.resident.title')" aria-valuemin="0"
                   :aria-valuemax="CONSTANT_CHAR_LIMIT" :aria-valuenow="residentUsed">
                <span :style="{ width: `${Math.min(100, (residentUsed / CONSTANT_CHAR_LIMIT) * 100)}%` }" />
              </div>
              <p class="subtle ws-text">{{ $t("workshop.editor.resident.hint", { max: numberFmt.format(CONSTANT_CHAR_LIMIT) }) }}</p>
            </div>
            <p v-if="residentOver" class="notice notice--error ws-text" role="alert" data-resident-over>{{ $t("workshop.editor.resident.over") }}</p>
            <!-- 擴充的世界書是草稿內嵌的條目，沒有「綁一本書」這回事：以已綁定、書名鎖住的樣子沿用，只編條目 -->
            <div class="ws-ed__wb">
              <WorldbookEditor v-model="draft.worldbook" :book-name="draft.name" book-desc="" bound meta-locked :language="String(locale)"
                               @imported="onBookImported" @export-book="exportBook" />
            </div>
          </section>

          <!-- 正規表示式：照寫卡頁「顯示」分區那一條，按下開整頁彈窗 -->
          <section v-else-if="section === 'regex'" class="pane" data-section="regex">
            <h2 class="pane__title">{{ $t("workshop.editor.section.regex") }}</h2>
            <p class="notice ws-text">{{ $t("workshop.editor.regex.hint") }}</p>
            <div class="rxbar">
              <p class="rxbar__hint">{{ $t("regex.bar.hint") }}</p>
              <div class="rxbar__acts">
                <button type="button" class="btn btn--sm btn--primary" @click="regexOpen = true">
                  {{ $t("regex.open") }}
                  <span v-if="draft.rules.rules.length" class="chip">{{ draft.rules.rules.length }}</span>
                </button>
                <button type="button" class="btn btn--sm" @click="regexFile?.click()">{{ $t("regex.import") }}</button>
                <button type="button" class="btn btn--sm" :disabled="!draft.rules.rules.length" @click="exportRegex">{{ $t("regex.export") }}</button>
                <input ref="regexFile" type="file" accept=".json,application/json" class="sr-only" @change="onRegexFile" />
              </div>
            </div>
          </section>

          <!-- 開局：寫卡頁的開局元件原樣 -->
          <section v-else-if="section === 'opening'" class="pane" data-section="opening">
            <h2 class="pane__title">{{ $t("editor.section.opening") }}</h2>
            <p class="muted pane__lede ws-text">{{ $t("workshop.editor.opening.hint") }}</p>
            <OpeningEditor v-model:mode="draft.opening.mode" v-model:welcome="draft.opening.welcome" v-model:alternates="draft.opening.alternates"
                           v-model:prologue="draft.opening.prologue" v-model:opening-page="draft.opening.openingPage"
                           :saved-mode="savedOpening" page-available :rules="draft.rules.rules" :card-format="draft.rules.format"
                           :role-name="draft.card.name" :welcome-max="welcomeMax" :missing="false" @edit-rules="go('regex')" />
          </section>

          <!-- 發布 -->
          <section v-else class="pane" data-section="publish">
            <h2 class="pane__title">{{ $t("editor.section.publish") }}</h2>
            <PublishPane :state="pubState" :draft="draft" :checklist="checklist" :reject-note="rejectNote" :owner-reason="ownerReason"
                         :appeal="appeal" :tried="tried" :busy="busy || saving || stale" v-model:note="draft.updateNote"
                         @submit="submit" @withdraw="withdraw" @appeal="appealNow" @delete="remove" />
          </section>
        </div>
      </div>

      <div class="ws-ed__bar">
        <span v-if="dirty" class="subtle ws-ed__unsaved">{{ $t("editor.unsaved") }}</span>
        <button type="button" class="btn" data-trial-open @click="trialOpen = true">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M5 3.5v9l7-4.5-7-4.5Z" /></svg>
          {{ $t("workshop.editor.toolbar.test") }}
        </button>
        <button type="button" class="btn" :class="{ 'btn--primary': section !== 'publish' }" data-save
                :disabled="saving || stale || !dirty" @click="save">
          {{ saving ? $t("edit.saving") : $t("workshop.editor.toolbar.save") }}
        </button>
      </div>
    </template>

    <div class="toast" role="status" :hidden="!toast">{{ toast }}</div>
    <RegexRulesEditor v-if="regexOpen && draft" v-model="draft.rules" @close="regexOpen = false" />
    <TrialPanel v-if="trialOpen && draft" :options="trialOptions" :href="trialHref" :stale="dirty" @close="trialOpen = false" @started="trialStarted" />
  </div>
</template>

<style scoped>
.ws-ed { display: grid; gap: var(--s-4); max-width: 1040px; width: 100%; margin: 0 auto; }
.ws-ed__head { display: grid; gap: var(--s-1); justify-items: start; }
.ws-ed__head h1 { margin: 0; font-size: 22px; }
.ws-ed__head .eyebrow { margin: 0; }
.ws-ed__for { gap: 6px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ws-ed__for svg { width: 14px; height: 14px; flex: none; }
.ws-ed__ghosts { display: grid; gap: var(--s-4); }
.ws-ed__fail, .ws-ed__stale { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-3); }
.ws-ed__fail > span, .ws-ed__stale > span { flex: 1 1 220px; min-width: 0; }

/* 兩欄：左側分區導覽（黏著）＋表單 */
.ws-ed__grid { display: grid; grid-template-columns: 176px minmax(0, 1fr); gap: var(--s-6); align-items: start; }
.ws-ed__nav { position: sticky; top: 76px; display: grid; gap: 2px; }
.ws-ed__tab {
  display: flex; align-items: center; gap: var(--s-2); height: 38px; padding: 0 var(--s-3);
  border: 0; border-radius: var(--r-pill); background: transparent; color: var(--text-2);
  font: inherit; font-size: 14px; font-weight: 500; text-align: left; cursor: pointer;
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
}
.ws-ed__tab:hover { background: var(--surface-2); color: var(--text); }
.ws-ed__tab--on { background: var(--surface); color: var(--text); box-shadow: 0 0 0 1px var(--line), var(--shadow-sm); }
.ws-ed__tab-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ws-ed__n { font-size: 12px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.ws-ed__dot { width: 6px; height: 6px; border-radius: 50%; background: var(--danger); flex: none; }

.ws-ed__body { display: grid; gap: var(--s-4); min-width: 0; scroll-margin-top: 76px; }
.ws-ed__body > .notice { margin: 0; }
.pane { display: grid; gap: var(--s-4); }
.pane__title { margin: 0; padding-bottom: var(--s-2); font-size: 17px; border-bottom: 1px solid var(--line); }
.pane__lede { margin: calc(-1 * var(--s-2)) 0 0; }
.pane > .notice { margin: 0; }
.pane :deep(.field) { margin-bottom: 0; gap: 6px; }
.pane :deep(textarea.input) { field-sizing: content; max-height: 70vh; }

.ws-ed__rating-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); }
.ws-ed__rating > label { font-size: 13px; font-weight: 600; }
.readme-head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); }
.readme-head label { font-size: 13px; font-weight: 600; }
.readme-head .seg__item { height: 28px; padding: 0 12px; font-size: 12.5px; }
.readme-preview { min-height: 180px; padding: var(--s-4); border-radius: var(--r-md); background: var(--surface); box-shadow: inset 0 0 0 1px var(--line); overflow: auto; }

/* 常駐內容：字數一條，超過變紅 */
.ws-ed__resident { padding: var(--s-4); display: grid; gap: var(--s-2); }
.ws-ed__resident h3 { margin: 0; font-size: 15px; }
.ws-ed__resident .subtle { margin: 0; }
.ws-ed__resident-row { display: flex; align-items: baseline; justify-content: space-between; gap: var(--s-3); }
.ws-ed__resident-n { font-size: 13px; color: var(--text-2); font-variant-numeric: tabular-nums; }
.ws-ed__meter { height: 6px; border-radius: 3px; background: var(--surface-2); overflow: hidden; }
.ws-ed__meter > span { display: block; height: 100%; border-radius: inherit; background: var(--accent); transition: width var(--dur) var(--ease); }
.ws-ed__resident.is-over .ws-ed__resident-n { color: var(--danger); font-weight: 600; }
.ws-ed__resident.is-over .ws-ed__meter > span { background: var(--danger); }
/*
 * 世界書元件沿用寫卡頁的，但擴充沒有「綁哪一本書」：書名那一列（含「換一本」）在這裡沒有意義，先藏起來。
 * 元件之後若加「只編條目」的開關就拿掉這條（回報給共用層）。
 */
.ws-ed__wb :deep(.field:has(#wb-name)) { display: none; }

/* 正規表示式那一條：照寫卡頁「顯示」分區 */
.rxbar { display: grid; gap: var(--s-2); padding: var(--s-3) var(--s-4); background: var(--surface-2); border-radius: var(--r-md); box-shadow: inset 0 0 0 1px var(--line); }
.rxbar__hint { margin: 0; font-size: 13px; color: var(--text-3); }
.rxbar__acts { display: flex; gap: var(--s-2); align-items: center; flex-wrap: wrap; }
.rxbar .chip { margin-left: 4px; height: 20px; padding: 0 7px; font-variant-numeric: tabular-nums; }

/* 底部工具列：黏在視窗底，左邊是狀態、右邊是「試玩｜儲存」 */
.ws-ed__bar {
  position: sticky; bottom: 0; z-index: 12;
  display: flex; align-items: center; justify-content: flex-end; gap: var(--s-2);
  margin: 0 calc(-1 * var(--s-2)); padding: var(--s-3) var(--s-2) calc(var(--s-3) + env(safe-area-inset-bottom, 0px));
  border-top: 1px solid var(--line); background: color-mix(in srgb, var(--hr-page-bg) 92%, transparent);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
}
.ws-ed__unsaved { margin-right: auto; font-size: 13px; }
.ws-ed__bar svg { flex: none; }

@media (max-width: 760px) {
  .ws-ed__grid { grid-template-columns: minmax(0, 1fr); gap: var(--s-3); }
  /* 手機：分區變成頂端一排膠囊，橫向捲，黏在站台頁首下面 */
  .ws-ed__nav {
    top: 52px; z-index: 5; display: flex; overflow-x: auto; scrollbar-width: none;
    margin: 0 calc(-1 * var(--s-4)); padding: var(--s-2) var(--s-4); background: var(--hr-page-bg);
  }
  .ws-ed__nav::-webkit-scrollbar { display: none; }
  .ws-ed__tab { flex: none; height: var(--h-sm); font-size: 13px; }
  .ws-ed__body { scroll-margin-top: 104px; }
  .ws-ed__bar .btn { flex: 1 1 0; min-height: var(--h-lg); }
  .ws-ed__unsaved { display: none; }
}
</style>
