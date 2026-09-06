<script setup lang="ts">
/**
 * 角色卡編輯器。建立與編輯共用同一頁——兩者的差別只有「有沒有 roleId」。
 *
 * 為什麼建立時也是整份表單而不是分步精靈：作者手上多半已經有一張想搬過來的卡（自己寫的
 * 草稿、或一張酒館卡），分步會逼他按我們的順序重走一遍。整份表單加上分區導覽，
 * 想從哪裡填就從哪裡填，匯入也才能一次把每一區都填好。
 *
 * 版面是三欄：左邊是分區導覽（哪一區缺必填、哪一區已經有內容一眼看得到），中間是表單，
 * 右邊是這張卡在榜單上會長的樣子與儲存動作。寬螢幕上表單只佔中間一欄，因為多行文字
 * 超過七十幾個字元一行就難讀；空出來的右邊拿來放預覽，作者邊填邊看，不必存了再去榜單找。
 * 窄螢幕退成一欄：導覽變成頂部一排，預覽收掉，動作落到底部黏著的那條。
 *
 * 儲存是一次動作、多個請求：建卡 → 寫欄位 → 寫開場白 → 寫世界書。順序不能換，
 * 後面每一步都需要前一步產生的 id。任何一步失敗就停下並保留草稿，不做局部回滾——
 * 上游沒有跨資源的交易，硬回滾只會在失敗之上再疊一次失敗。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterLink, onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import {
  createRole,
  createWorldbook,
  fetchAuthorAsset,
  fetchRoleDetail,
  fetchRoleWorldbooks,
  fetchRoleValidation,
  fetchWorldbookEntries,
  patchRoleDocument,
  patchRoleWelcome,
  patchWorldbookDocument,
  saveAuthorAsset,
  submitRoleForReview,
  uploadImage,
  type WorldbookDocumentEntry,
} from "@/lib/api";
import { emptyRuleSet, ruleSetFromAuthorAsset, ruleSetFromImport, ruleSetToAuthorAsset, ruleSetToExport, type RegexRuleSet } from "@/lib/regex-rules";
import RegexRulesEditor from "@/components/editor/RegexRulesEditor.vue";
import {
  LANGUAGES,
  cloneDraft,
  documentPatch,
  draftFromRoleDetail,
  formatTags,
  hasAnyField,
  makeDraft,
  missingRequired,
  parseTags,
  resolveLimits,
  welcomeChanged,
  type RoleDraft,
  type WorldbookEntryDraft,
} from "@/lib/role-draft";
import { draftToTavern, embedIntoPng, imageFetchUrl, type ImportResult } from "@/lib/tavern";
import type { CommunityCard } from "@/lib/types";
import { useLocalePath } from "@/lib/use-locale";
import { useSession } from "@/lib/session";
import { confirmDialog } from "@/lib/confirm";
import { track } from "@/lib/track";
import CardTile from "@/components/CardTile.vue";
import FieldText from "@/components/editor/FieldText.vue";
import ListEditor from "@/components/editor/ListEditor.vue";
import ImageField from "@/components/editor/ImageField.vue";
import ImportPanel from "@/components/editor/ImportPanel.vue";
import WorldbookEditor from "@/components/editor/WorldbookEditor.vue";
import TagPicker from "@/components/editor/TagPicker.vue";

const route = useRoute();
const router = useRouter();
const session = useSession();
const { lp, locale } = useLocalePath();
const { t } = useI18n();

/** 有 roleId 就是編輯既有的卡；沒有就是建立。 */
const roleId = ref<string>((route.params.roleId as string) ?? "");
const isNew = computed(() => !roleId.value);

// 預設跟介面語言：看英文介面的人，第一張卡多半也是英文的
const draft = ref<RoleDraft>(makeDraft(locale.value));
/**
 * 上次成功寫入的樣子。null＝還沒存過，於是 documentPatch 會把所有欄位都送出去。
 *
 * 「有沒有改過」不能拿它當基準：新卡的 original 是 null，那樣一進頁面就算「改過了」，
 * 離開時會彈一個文不對題的「放棄修改？」。所以髒判定另外對照一份原始空草稿。
 */
const original = ref<RoleDraft | null>(null);
const pristine = ref<RoleDraft>(makeDraft(locale.value));
const tagsText = ref("");
const TAGS_MAX = 10;

const worldbookId = ref("");
const worldbookName = ref("");
/** 匯入酒館／MMD 世界書時是 "tavern"：上游會讓這本書先走酒館自己的關鍵字規則。 */
const worldbookFormat = ref<"tavern" | undefined>();
const worldbookEntries = ref<WorldbookEntryDraft[]>([]);
const worldbookOriginal = ref<WorldbookEntryDraft[]>([]);
/** 剛匯入、還沒送出去的那本。儲存時要先建再寫。 */
const worldbookPending = ref(false);

/** 正則規則：整份存、整份換。version 是上游的樂觀鎖，沒規則時是 0。 */
const regexSet = ref<RegexRuleSet>(emptyRuleSet());
const regexOriginal = ref<RegexRuleSet>(emptyRuleSet());
const regexVersion = ref(0);
const regexOpen = ref(false);
const regexFile = ref<HTMLInputElement | null>(null);
const regexDirty = computed(() => JSON.stringify(regexSet.value) !== JSON.stringify(regexOriginal.value));

const saveLabel = computed(() => {
  if (!saving.value) return isNew.value ? t("editor.saveDraft") : t("edit.save");
  return saveProgress.value ? t("edit.savingProgress", saveProgress.value) : t("edit.saving");
});
const limits = ref(resolveLimits(null));
const blockers = ref<string[]>([]);
const loading = ref(!!roleId.value);
const saving = ref(false);
/** 世界書分段送出時的進度；沒在送就是 null。 */
const saveProgress = ref<{ done: number; total: number } | null>(null);
const error = ref("");
const saved = ref(false);
/** 右下角那一條「已儲存」。說完就走，不佔版面。 */
const toast = ref("");
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function flash(message: string) {
  toast.value = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = ""; }, 2600);
}

const SECTIONS = ["basic", "persona", "dialogue", "media", "worldbook", "publish"] as const;
type Section = (typeof SECTIONS)[number];
const section = ref<Section>("basic");
const body = ref<HTMLElement | null>(null);

/** 換分區時把表單捲回頂端：分區之間長短差很多，停在上一區的深處會看到一片空白。 */
function goto(next: Section) {
  if (section.value === next) return;
  section.value = next;
  const top = body.value?.getBoundingClientRect().top ?? 0;
  if (top < 0) body.value?.scrollIntoView({ block: "start" });
}

const dirty = computed(
  () =>
    JSON.stringify(draft.value) !== JSON.stringify(original.value ?? pristine.value) ||
    JSON.stringify(worldbookEntries.value) !== JSON.stringify(worldbookOriginal.value) ||
    worldbookPending.value ||
    regexDirty.value,
);

const missing = computed(() => missingRequired(draft.value));
const canPublish = computed(() => !isNew.value && !missing.value.length && !dirty.value);

/** 各分區缺哪個必填。導覽上的紅點與發布前的清單都看這個。 */
const REQUIRED_OF: Partial<Record<Section, string>> = {
  basic: "roleName",
  persona: "roleDetailDesc",
  dialogue: "roleWelcome",
};
const lacks = (key: Section) => Boolean(REQUIRED_OF[key] && missing.value.includes(REQUIRED_OF[key] as string));
/** 這一區已經有東西了。給導覽畫一個勾，作者才知道自己走到哪。 */
const filled = computed<Record<Section, boolean>>(() => ({
  basic: Boolean(draft.value.roleName.trim()),
  persona: Boolean(draft.value.roleDetailDesc.trim()),
  dialogue: Boolean(draft.value.roleWelcome.trim()),
  media: Boolean(draft.value.roleAvatar || draft.value.roleBackground),
  worldbook: worldbookEntries.value.some((e) => e.content.trim()),
  publish: false,
}));

watch(tagsText, (raw) => {
  draft.value.roleTag = parseTags(raw);
});

/**
 * 新卡的草稿存在本機。
 *
 * 建卡多半要寫上千字，中途關掉分頁、瀏覽器當掉、或不小心點到別處，全部重來是最傷人的事。
 * 存的是整份草稿加世界書條目，回來時原樣還原並說一聲；作者不要就按「清空重來」。
 * 只給新卡：既有的卡有上游那份當底，而且兩張卡的草稿混在一個鍵底下會互相覆蓋。
 * 存成功之後就刪——那份已經在上游了。
 */
const DRAFT_KEY = "hearthroom.draft.create";
const restoredDraft = ref(false);
interface StoredDraft { draft: RoleDraft; tagsText: string; worldbook: { name: string; format?: "tavern"; entries: WorldbookEntryDraft[] } | null; savedAt: number }
function storeDraft() {
  if (!isNew.value) return;
  try {
    if (!dirty.value) {
      localStorage.removeItem(DRAFT_KEY);
      return;
    }
    const stored: StoredDraft = {
      draft: draft.value,
      tagsText: tagsText.value,
      worldbook: worldbookPending.value ? { name: worldbookName.value, format: worldbookFormat.value, entries: worldbookEntries.value } : null,
      savedAt: Date.now(),
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(stored));
  } catch {
    /* 隱私模式寫不進去：那就沒有這層保護，功能照常 */
  }
}
function restoreDraft() {
  if (!isNew.value) return;
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    const stored = JSON.parse(raw) as StoredDraft;
    if (!stored?.draft?.roleName && !stored?.draft?.roleDetailDesc && !stored?.draft?.roleWelcome) return;
    draft.value = { ...makeDraft(stored.draft.language || locale.value), ...stored.draft };
    tagsText.value = stored.tagsText ?? formatTags(draft.value.roleTag);
    if (stored.worldbook?.entries?.length) {
      worldbookPending.value = true;
      worldbookName.value = stored.worldbook.name;
      worldbookFormat.value = stored.worldbook.format;
      worldbookEntries.value = stored.worldbook.entries;
    }
    restoredDraft.value = true;
  } catch {
    localStorage.removeItem(DRAFT_KEY);
  }
}
function discardDraft() {
  draft.value = makeDraft(locale.value);
  tagsText.value = "";
  worldbookPending.value = false;
  worldbookName.value = "";
  worldbookFormat.value = undefined;
  worldbookEntries.value = [];
  restoredDraft.value = false;
  localStorage.removeItem(DRAFT_KEY);
}
let draftTimer: ReturnType<typeof setTimeout> | undefined;
watch([draft, worldbookEntries, worldbookName, worldbookPending], () => {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(storeDraft, 400);
}, { deep: true });

const SEXES = ["", "man", "women", "other"] as const;

/** 從分類詞表點一個標籤：加進去或拿掉，走同一條標籤文字，計數與 chip 預覽都跟著動。 */
function toggleTag(name: string) {
  const tags = draft.value.roleTag.includes(name)
    ? draft.value.roleTag.filter((tag) => tag !== name)
    : [...draft.value.roleTag, name];
  tagsText.value = formatTags(tags);
}

/** 剛從 PNG 卡帶進來、還在上傳的立繪。預覽先用本機那份，上傳完換成正式網址。 */
const pendingAvatar = ref("");

/** 右欄那張卡：榜單上會長的樣子。作者是登入的自己，數字全是零——那是別人看到之後才有的事。 */
const previewCard = computed<CommunityCard>(() => {
  const empty = { zh: "", en: "", ja: "", ko: "" };
  const lang = draft.value.language;
  return {
    id: roleId.value || "draft",
    roleId: roleId.value || "draft",
    zone: lang.startsWith("zh") ? "zh" : lang === "en" || lang === "ja" || lang === "ko" ? lang : "all",
    name: draft.value.roleName.trim() || t("import.review.unnamed"),
    summary: draft.value.roleDesc,
    names: empty,
    summaries: empty,
    avatarUrl: draft.value.roleAvatar || pendingAvatar.value || null,
    backgroundUrl: null,
    slug: null,
    tags: draft.value.roleTag,
    author: {
      accountNumId: session.me?.accountNumId ?? 0,
      name: session.me?.nickName ?? "",
      avatar: session.me?.avatar ?? "",
    },
    talkNum: 0,
    followNum: 0,
    trending: 0,
    registeredAt: 0,
    syncedAt: 0,
  };
});

async function loadValidation() {
  const token = await session.accessToken();
  if (!token || !roleId.value) return;
  try {
    const report = await fetchRoleValidation(roleId.value, token);
    limits.value = resolveLimits(report.tokenBudget?.limits ?? null);
    blockers.value = report.blockers ?? [];
  } catch {
    // 上限拿不到就用保守預設。這只影響字數提示，不影響能不能存。
  }
}

/**
 * 這張卡綁著的世界書。只取第一本：介面一次只編一本，而上游允許綁多本——
 * 多綁的那幾本在這裡看不到也編不了，這是已知的天花板，不是漏掉。
 */
async function loadWorldbook(token: string) {
  const bound = await fetchRoleWorldbooks(roleId.value, token).catch(() => []);
  const book = bound[0];
  if (!book) return;
  worldbookId.value = book.worldbookId;
  worldbookName.value = book.name;
  worldbookEntries.value = await fetchWorldbookEntries(book.worldbookId, token).catch(() => []);
  worldbookOriginal.value = JSON.parse(JSON.stringify(worldbookEntries.value));
}

onMounted(async () => {
  if (!roleId.value) {
    restoreDraft();
    return;
  }
  try {
    const token = await session.accessToken();
    const raw = await fetchRoleDetail(roleId.value, token ?? undefined);
    draft.value = draftFromRoleDetail(raw, locale.value);
    tagsText.value = formatTags(draft.value.roleTag);
    original.value = cloneDraft(draft.value);
    if (token) {
      await loadWorldbook(token);
      await loadRegexRules(token);
    }
    void loadValidation();
  } catch (err) {
    error.value = err instanceof Error ? err.message : t("state.loadFailed");
  } finally {
    loading.value = false;
  }
});

/* 改到一半離開要問一聲：站內換頁與關分頁都攔。儲存中不放行——鍵盤也走得到返回連結，
   那時彈「放棄修改？」文不對題。 */
onBeforeRouteLeave(
  async () =>
    saving.value === false &&
    (!dirty.value || (await confirmDialog({ message: t("edit.discard"), confirmText: t("dialog.leave"), danger: true }))),
);
const guard = (e: BeforeUnloadEvent) => {
  if (dirty.value) e.preventDefault();
};
/* Ctrl/⌘+S 存檔：寫長文的人手已經在鍵盤上，不該為了存一次去找按鈕。攔下瀏覽器的「另存網頁」。 */
const onKey = (e: KeyboardEvent) => {
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "s") {
    e.preventDefault();
    void save();
  }
};
onMounted(() => {
  window.addEventListener("beforeunload", guard);
  window.addEventListener("keydown", onKey);
});
onBeforeUnmount(() => {
  window.removeEventListener("beforeunload", guard);
  window.removeEventListener("keydown", onKey);
  clearTimeout(toastTimer);
  clearTimeout(draftTimer);
  storeDraft();
  if (pendingAvatar.value) URL.revokeObjectURL(pendingAvatar.value);
});

/** 錯誤訊息放在表單頂端。作者多半在某一區的深處按下儲存，訊息要自己走到他眼前。 */
watch(error, async (message) => {
  if (!message) return;
  await nextTick();
  body.value?.querySelector<HTMLElement>("[role=alert]")?.scrollIntoView({ block: "center", behavior: "smooth" });
});

// ── 圖片 ──────────────────────────────────────────────────────────

async function onPickImage(file: File, ok: (url: string) => void, fail: (message: string) => void) {
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    ok(await uploadImage(file, token, roleId.value || undefined));
  } catch (err) {
    fail(err instanceof Error ? err.message : t("state.uploadFailed"));
  }
}

// ── 正則規則 ──────────────────────────────────────────────────────

// 上游把「正則規則 + 功能欄」叫作者資產（author asset）；本站只是換個說法，存的是同一份。
async function loadRegexRules(token: string) {
  try {
    const asset = await fetchAuthorAsset(roleId.value, token);
    regexSet.value = ruleSetFromAuthorAsset(asset);
    regexOriginal.value = JSON.parse(JSON.stringify(regexSet.value));
    regexVersion.value = asset.version;
  } catch {
    // 讀不到就當沒有：舊上游沒這條路，不擋編輯
  }
}

/** 卡片存完才存規則：新卡要先有 roleId。沒改就不送。 */
async function saveRegex(token: string, targetRoleId: string) {
  if (!regexDirty.value) return;
  const saved = await saveAuthorAsset(targetRoleId, ruleSetToAuthorAsset(regexSet.value, regexVersion.value), token);
  regexVersion.value = saved.version;
  regexOriginal.value = JSON.parse(JSON.stringify(regexSet.value));
}

function onRegexFile(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  target.value = "";
  if (!file) return;
  void (async () => {
    try {
      const imported = ruleSetFromImport(JSON.parse(await file.text()));
      if (!imported) throw new Error("regex_invalid");
      regexSet.value = imported.set;
      // 魅魔島的檔帶著「第一句話」：開場白還是空的才幫他填，不蓋掉已經寫好的
      if (imported.welcome && !draft.value.roleWelcome.trim()) draft.value.roleWelcome = imported.welcome;
      flash(t("regex.imported", { n: imported.set.rules.length }));
      track("card_import", { detail: "regex" });
    } catch {
      error.value = t("regex.importFailed");
    }
  })();
}

function exportRegex() {
  const file = ruleSetToExport(regexSet.value, draft.value.roleWelcome);
  download(new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }), `${safeName()}-regex.json`);
  track("card_export", { detail: "regex" });
}

// ── 世界書 ────────────────────────────────────────────────────────

function createWorldbookDraft() {
  worldbookPending.value = true;
  worldbookName.value = draft.value.roleName || "";
  if (!worldbookEntries.value.length) {
    worldbookEntries.value = [{ name: "", content: "", keywords: [], secondaryKeywords: [], isEnabled: true, isConstant: false }];
  }
}

/** 從酒館世界書檔匯入的條目。還沒綁書就先把書建起來，名字用檔裡的、沒有就用角色名。 */
function onWorldbookImported(payload: { name: string; entries: WorldbookEntryDraft[] }) {
  if (!worldbookId.value && !worldbookPending.value) {
    worldbookPending.value = true;
    worldbookName.value = payload.name || draft.value.roleName || "";
  }
  worldbookEntries.value = payload.entries.map((entry) => ({ ...entry }));
}

/** 草稿與上次存下的樣子比對，算出要 create / update / delete 哪些條目。 */
/** 一個要送出去的操作，連同它對應的本地條目（delete 沒有），送成功後拿來對齊本地狀態。 */
interface WorldbookOp { op: WorldbookDocumentEntry; entry?: WorldbookEntryDraft }

function worldbookOps(): WorldbookOp[] {
  const ops: WorldbookOp[] = [];
  const keptIds = new Set(worldbookEntries.value.map((e) => e.entryId).filter(Boolean) as string[]);
  for (const before of worldbookOriginal.value) {
    if (before.entryId && !keptIds.has(before.entryId)) ops.push({ op: { op: "delete", entryId: before.entryId } });
  }
  for (const entry of worldbookEntries.value) {
    // 空條目不送：作者按了「新增」又沒填，那不是一條要存的資料。
    if (!entry.content.trim()) continue;
    const payload = {
      name: entry.name.trim() || entry.keywords[0] || t("wb.entry.untitled"),
      content: entry.content,
      keywords: entry.keywords,
      secondaryKeywords: entry.secondaryKeywords ?? [],
      ...(entry.matchOptions ? { matchOptions: entry.matchOptions } : {}),
      isEnabled: entry.isEnabled,
      isConstant: entry.isConstant,
    };
    if (!entry.entryId) ops.push({ op: { op: "create", ...payload }, entry });
    else if (JSON.stringify(entry) !== JSON.stringify(worldbookOriginal.value.find((e) => e.entryId === entry.entryId))) {
      ops.push({ op: { op: "update", entryId: entry.entryId, ...payload }, entry });
    }
  }
  return ops;
}

/**
 * 一次送多少個操作。幾百條的匯入切成幾段送：每段幾秒內完成，不會撞到反向代理的逾時；
 * 每段成功就把本地狀態對齊伺服器，中途斷線再按一次儲存只會送剩下的，不會重建已經建好的條目。
 */
const WORLDBOOK_OPS_PER_REQUEST = 100;

/** 一段送成功之後：刪掉的從原始清單移除、改過的更新原始清單、新建的拿到 id 並加進原始清單。 */
function reconcileWorldbookChunk(chunk: WorldbookOp[], createdIds: string[]) {
  let k = 0;
  for (const { op, entry } of chunk) {
    if (op.op === "delete") {
      worldbookOriginal.value = worldbookOriginal.value.filter((e) => e.entryId !== op.entryId);
    } else if (op.op === "update" && entry) {
      worldbookOriginal.value = worldbookOriginal.value.map((e) => (e.entryId === entry.entryId ? JSON.parse(JSON.stringify(entry)) : e));
    } else if (op.op === "create" && entry) {
      const id = createdIds[k++];
      if (!id) continue;
      entry.entryId = id;
      worldbookOriginal.value.push(JSON.parse(JSON.stringify(entry)));
    }
  }
}

async function saveWorldbook(token: string, targetRoleId: string) {
  const ops = worldbookOps();
  const needsBook = worldbookPending.value || Boolean(worldbookId.value);
  if (!needsBook || (!ops.length && worldbookId.value)) return;

  let bookId = worldbookId.value;
  let firstBind = false;
  if (!bookId) {
    if (!ops.length) {
      // 按了「建一本」卻一條都沒填：不建空書，也要把待建旗標放掉——
      // 留著的話這張卡會永遠算「有未儲存的修改」，再也送不出審核。
      worldbookPending.value = false;
      return;
    }
    bookId = await createWorldbook(
      {
        name: worldbookName.value.trim() || draft.value.roleName,
        language: draft.value.language,
        ...(worldbookFormat.value ? { format: worldbookFormat.value } : {}),
      },
      token,
    );
    // 書建好就記住：之後任何一段失敗，重試都寫同一本，不會每按一次就多一本孤兒書。
    worldbookId.value = bookId;
    worldbookPending.value = false;
    firstBind = true;
  }
  saveProgress.value = { done: 0, total: ops.length };
  try {
    for (let i = 0; i < ops.length; i += WORLDBOOK_OPS_PER_REQUEST) {
      const chunk = ops.slice(i, i + WORLDBOOK_OPS_PER_REQUEST);
      // 綁定跟第一段一起送；上游的綁定是覆蓋式的，重送也不會出事
      const result = await patchWorldbookDocument(
        bookId,
        { entries: chunk.map((c) => c.op), ...(firstBind ? { binding: { roleId: targetRoleId } } : {}) },
        token,
      );
      firstBind = false;
      reconcileWorldbookChunk(chunk, result?.createdEntryIds ?? []);
      saveProgress.value = { done: Math.min(i + chunk.length, ops.length), total: ops.length };
    }
  } finally {
    saveProgress.value = null;
  }
  // 全部送完再讀一次：順序與 id 以伺服器為準（舊版伺服器不回 createdEntryIds 時也靠這一步補上）。
  worldbookEntries.value = await fetchWorldbookEntries(bookId, token).catch(() => worldbookEntries.value);
  worldbookOriginal.value = JSON.parse(JSON.stringify(worldbookEntries.value));
}

// ── 儲存 ──────────────────────────────────────────────────────────

async function save() {
  if (saving.value || loading.value) return;
  if (!dirty.value && !isNew.value) return;
  if (!draft.value.roleName.trim()) {
    section.value = "basic";
    error.value = t("editor.needName");
    return;
  }
  const wasNew = isNew.value;
  saving.value = true;
  error.value = "";
  saved.value = false;
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));

    let targetRoleId = roleId.value;
    if (!targetRoleId) {
      const created = await createRole(
        { roleName: draft.value.roleName.trim(), language: draft.value.language },
        token,
      );
      if (!created.roleId) throw new Error(t("state.createFailed"));
      targetRoleId = created.roleId;
      roleId.value = targetRoleId;
      track("card_create", { subject: targetRoleId });
    }

    const fields = documentPatch(draft.value, original.value);
    if (hasAnyField(fields)) await patchRoleDocument(targetRoleId, fields, token);

    if (welcomeChanged(draft.value, original.value) && draft.value.roleWelcome.trim()) {
      await patchRoleWelcome(
        targetRoleId,
        {
          roleWelcome: draft.value.roleWelcome,
          alternates: draft.value.alternates.filter((a) => a.trim()),
          prologue: draft.value.prologue.filter((p) => p.trim()),
        },
        token,
      );
    }

    await saveWorldbook(token, targetRoleId);
    await saveRegex(token, targetRoleId);

    original.value = cloneDraft(draft.value);
    saved.value = true;
    restoredDraft.value = false;
    if (wasNew) localStorage.removeItem(DRAFT_KEY);
    flash(t("edit.saved"));
    track("card_edit", { subject: targetRoleId });
    void loadValidation();

    // 建立完成後把網址換成編輯頁：重新整理不該回到一張空表單。
    //
    // 只改網址、不走 router.replace：換路由會把這個元件整個重掛，畫面閃一下骨架、剛出現的
    // 「已儲存」也跟著消失，還要再向上游讀一次剛寫進去的東西。而且 replace 在 saving 期間
    // 會被上面那個離開守衛擋掉（它在儲存中一律不放行），等於什麼都沒發生——之前就是這樣。
    //
    // 判斷用「網址還停在 /create」而不是 wasNew：上一次儲存若在建卡之後、寫世界書時失敗，roleId 已經有了，
    // 重試時 wasNew 是 false，網址卻還是 /create，不換的話重新整理照樣回到空表單。
    if (wasNew || route.path.endsWith("/create")) {
      window.history.replaceState(window.history.state, "", lp(`/cards/${targetRoleId}/edit`));
    }
  } catch (err) {
    track(wasNew ? "card_create" : "card_edit", { ok: false });
    error.value = err instanceof Error ? err.message : t("state.saveFailed");
  } finally {
    saving.value = false;
  }
}

// ── 送審 ──────────────────────────────────────────────────────────

async function publish() {
  if (!canPublish.value) return;
  if (!(await confirmDialog({ message: t("editor.publish.confirm"), confirmText: t("editor.publish.submit") }))) return;
  saving.value = true;
  error.value = "";
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    // 上游要求確認摘要至少 8 個字：那是給審核方看的一句話，不是一個旗標。
    await submitRoleForReview(roleId.value, t("editor.publish.summary", { name: draft.value.roleName }), token);
    saved.value = true;
    await router.push({ path: lp("/mine"), query: { fresh: "1" } });
  } catch (err) {
    error.value = err instanceof Error ? err.message : t("state.saveFailed");
  } finally {
    saving.value = false;
  }
}

// ── 匯入 / 匯出 ────────────────────────────────────────────────────

/**
 * PNG 卡自帶的立繪拿去當頭像。
 *
 * 上傳與套用表單是分開的兩步：套用是同步的、立刻看得到；上傳要等網路。中間預覽先用本機
 * 那張，傳好了換成正式網址。傳失敗不算匯入失敗——設定都進來了，只是圖要作者自己再選一次。
 */
async function adoptImage(image: Blob) {
  if (pendingAvatar.value) URL.revokeObjectURL(pendingAvatar.value);
  pendingAvatar.value = URL.createObjectURL(image);
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    const file = new File([image], "card.png", { type: image.type || "image/png" });
    const url = await uploadImage(file, token, roleId.value || undefined);
    if (!draft.value.roleAvatar) draft.value.roleAvatar = url;
  } catch {
    error.value = t("import.avatarFailed");
  } finally {
    URL.revokeObjectURL(pendingAvatar.value);
    pendingAvatar.value = "";
  }
}

function applyImport(result: ImportResult) {
  const language = draft.value.language;
  draft.value = { ...result.draft, language };
  tagsText.value = formatTags(draft.value.roleTag);
  track("card_import", { detail: result.spec === "mmd" ? "mmd" : result.image ? "png" : "json" });
  if (result.worldbook) {
    worldbookPending.value = true;
    worldbookName.value = result.worldbook.name || draft.value.roleName;
    worldbookFormat.value = result.worldbook.format;
    // 匯入的條目一律沒有 entryId：它們在上游還不存在，儲存時要走 create。
    worldbookEntries.value = result.worldbook.entries.map((entry) => ({ ...entry, entryId: undefined }));
  }
  if (result.image) void adoptImage(result.image);
  if (result.regex) regexSet.value = result.regex;
  section.value = "basic";
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const safeName = () => (draft.value.roleName || "card").replace(/[/\\?%*:|"<>]/g, "_").slice(0, 60);

/**
 * 匯出成酒館卡。
 *
 * 優先走 PNG：那是這個生態的通用載體，拖進任何客戶端都認得。頭像取不到（作者根本沒設、
 * 或代抓失敗）就退回 JSON，而不是報錯——作者要的是那份設定，不是那張圖。
 */
async function exportCard(format: "png" | "json") {
  error.value = "";
  const card = draftToTavern(draft.value, worldbookEntries.value.filter((e) => e.content.trim()), { regex: regexSet.value });
  if (format === "json") {
    download(new Blob([JSON.stringify(card, null, 2)], { type: "application/json" }), `${safeName()}.json`);
    track("card_export", { detail: "json" });
    return;
  }
  try {
    if (!draft.value.roleAvatar) throw new Error("no_avatar");
    // 頭像在上游的圖片主機上、沒開 CORS：經本站代抓，不然這裡永遠退回 JSON
    const res = await fetch(imageFetchUrl(draft.value.roleAvatar, window.location.origin));
    if (!res.ok) throw new Error("fetch_failed");
    const png = embedIntoPng(new Uint8Array(await res.arrayBuffer()), card);
    // slice() 是為了拿到一塊剛好這麼大、型別上也確定是 ArrayBuffer 的緩衝區：
    // 直接餵 .buffer 會依賴「輸出永遠不是 subarray」這個外部不變式，卡片大小的一次複製不值得賭。
    download(new Blob([png.slice().buffer], { type: "image/png" }), `${safeName()}.png`);
    track("card_export", { detail: "png" });
  } catch {
    download(new Blob([JSON.stringify(card, null, 2)], { type: "application/json" }), `${safeName()}.json`);
    error.value = t("export.pngFallback");
    track("card_export", { detail: "png", ok: false });
  }
}
</script>

<template>
  <div class="page editor">
    <header class="head">
      <p class="eyebrow">{{ $t("mine.eyebrow") }}</p>
      <h1 class="display">{{ isNew ? $t("editor.title.new") : $t("editor.title.edit") }}</h1>
      <p class="muted lede">{{ isNew ? $t("editor.lede.new") : $t("editor.lede.edit") }}</p>
    </header>

    <div v-if="loading" class="ghosts" aria-hidden="true">
      <div class="ghost" style="height: 40px" />
      <div class="ghost" style="height: 120px" />
      <div class="ghost" style="height: 260px" />
    </div>

    <div v-else class="layout">
      <!-- 左：分區導覽。紅點＝缺必填；勾＝已經有內容 -->
      <nav class="side" :aria-label="$t('editor.sections')">
        <button
          v-for="key in SECTIONS"
          :key="key"
          type="button"
          class="side__item"
          :class="{ 'side__item--on': section === key }"
          :aria-current="section === key ? 'true' : undefined"
          @click="goto(key)"
        >
          <span class="side__label">{{ $t(`editor.section.${key}`) }}</span>
          <!-- 世界書條目數：一本六十條跟一本三條在導覽上就看得出來 -->
          <span v-if="key === 'worldbook' && worldbookEntries.length" class="side__n">{{ worldbookEntries.length }}</span>
          <span v-if="lacks(key)" class="side__dot" role="img" :aria-label="$t('editor.section.missing')" />
          <svg v-else-if="filled[key]" class="side__check" viewBox="0 0 16 16" role="img"
               :aria-label="$t('editor.section.filled')" fill="none" stroke="currentColor" stroke-width="1.8"
               stroke-linecap="round" stroke-linejoin="round">
            <path d="M3.5 8.5l3 3 6-7" />
          </svg>
        </button>
      </nav>

      <!-- 中：表單 -->
      <form ref="body" class="body" @submit.prevent="save">
        <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
        <p v-else-if="restoredDraft" class="notice restored" role="status">
          <span>{{ $t("editor.draftRestored") }}</span>
          <button type="button" class="btn btn--sm btn--ghost" @click="discardDraft">{{ $t("editor.draftDiscard") }}</button>
        </p>

        <!-- 基础 -->
        <section v-show="section === 'basic'" class="pane">
          <ImportPanel v-if="isNew" :language="draft.language" :detail-max="limits.roleDetailDesc" @apply="applyImport" />

          <FieldText id="f-name" v-model="draft.roleName" :label="$t('editor.name')" required :max="60"
                     :placeholder="$t('create.name.placeholder')" />

          <div v-if="isNew" class="field">
            <label for="f-lang">{{ $t("create.language") }}</label>
            <select id="f-lang" v-model="draft.language" class="input">
              <option v-for="l in LANGUAGES" :key="l.value" :value="l.value">{{ l.label }}</option>
            </select>
            <span class="subtle">{{ $t("editor.language.hint") }}</span>
          </div>

          <div class="field">
            <label for="f-sex">{{ $t("editor.sex") }}</label>
            <select id="f-sex" v-model="draft.roleSex" class="input">
              <option v-for="value in SEXES" :key="value" :value="value">{{ $t(`editor.sex.${value || "none"}`) }}</option>
            </select>
          </div>

          <FieldText id="f-desc" v-model="draft.roleDesc" :label="$t('editor.summary')" :rows="3"
                     :max="limits.roleDesc" :hint="$t('edit.summary.hint')" />

          <div class="field">
            <label for="f-tags">{{ $t("edit.tags") }}</label>
            <input id="f-tags" v-model="tagsText" class="input" :placeholder="$t('edit.tags.placeholder')" />
            <span class="field__foot">
              <span class="subtle">{{ $t("edit.tags.hint") }}</span>
              <span class="subtle count" :class="{ over: draft.roleTag.length > TAGS_MAX }">
                {{ draft.roleTag.length }} / {{ TAGS_MAX }}
              </span>
            </span>
            <!-- 拆好的標籤：作者一眼確認分隔符有沒有被認出來 -->
            <ul v-if="draft.roleTag.length" class="tags" aria-hidden="true">
              <li v-for="(tag, i) in draft.roleTag" :key="i" class="chip" :class="{ 'chip--over': i >= TAGS_MAX }">{{ tag }}</li>
            </ul>
            <!-- 站內榜單認得的分類：點了就加進標籤，跟手打的是同一條 -->
            <TagPicker :selected="draft.roleTag" :language="draft.language" :max="TAGS_MAX" @toggle="toggleTag" />
          </div>

          <FieldText id="f-user" v-model="draft.userName" :label="$t('editor.userName')"
                     :hint="$t('editor.userName.hint')" :placeholder="$t('editor.userName.placeholder')" />
        </section>

        <!-- 人设 -->
        <section v-show="section === 'persona'" class="pane">
          <FieldText id="f-detail" v-model="draft.roleDetailDesc" :label="$t('editor.detail')" required :rows="16"
                     :max="limits.roleDetailDesc" :hint="$t('editor.detail.hint')" />
          <FieldText id="f-contract" v-model="draft.roleOutputContract" :label="$t('editor.contract')" :rows="6"
                     :max="limits.roleOutputContract" :hint="$t('editor.contract.hint')" />
          <FieldText id="f-jb" v-model="draft.jailbreak" :label="$t('editor.jailbreak')" :rows="6"
                     :max="limits.jailbreak" :hint="$t('editor.jailbreak.hint')" />
        </section>

        <!-- 对话 -->
        <section v-show="section === 'dialogue'" class="pane">
          <FieldText id="f-welcome" v-model="draft.roleWelcome" :label="$t('editor.welcome')" required :rows="8"
                     :max="limits.roleWelcome" :hint="$t('editor.welcome.hint')" />

          <!-- 正則規則跟開場白待在一起（對齊魅魔島）：AI 回覆在玩家瀏覽器裡先過一遍「找到→換成」再顯示 -->
          <div class="rxbar">
            <button type="button" class="btn btn--sm" @click="regexOpen = true">
              {{ $t("regex.open") }}
              <span v-if="regexSet.rules.length" class="chip">{{ regexSet.rules.length }}</span>
            </button>
            <button type="button" class="btn btn--sm btn--ghost" @click="regexFile?.click()">{{ $t("regex.import") }}</button>
            <button type="button" class="btn btn--sm btn--ghost" :disabled="!regexSet.rules.length" @click="exportRegex">{{ $t("regex.export") }}</button>
            <input ref="regexFile" type="file" accept=".json,application/json" class="sr-only" @change="onRegexFile" />
            <span class="subtle">{{ $t("regex.bar.hint") }}</span>
          </div>

          <ListEditor v-model="draft.alternates" :label="$t('editor.alternates')" :hint="$t('editor.alternates.hint')"
                      :rows="4" :add-label="$t('editor.alternates.add')" :remove-label="$t('list.remove')"
                      :up-label="$t('list.up')" :down-label="$t('list.down')" />

          <ListEditor v-model="draft.prologue" :label="$t('editor.prologue')" :hint="$t('editor.prologue.hint')"
                      :add-label="$t('editor.prologue.add')" :remove-label="$t('list.remove')"
                      :up-label="$t('list.up')" :down-label="$t('list.down')" />

          <div class="field">
            <label>{{ $t("editor.talkExample") }}</label>
            <p class="subtle hint">{{ $t("editor.talkExample.hint") }}</p>
            <ul class="turns">
              <li v-for="(turn, i) in draft.talkExample" :key="i" class="turn">
                <select v-model="turn.roleType" class="input input--who" :aria-label="$t('editor.talkExample.who')">
                  <option value="user">{{ $t("editor.talkExample.user") }}</option>
                  <option value="ai">{{ $t("editor.talkExample.ai") }}</option>
                </select>
                <textarea v-model="turn.content" class="input" rows="2" style="min-height: calc(2 * 1.7em + 26px)"
                          :aria-label="$t('editor.talkExample.content')" />
                <button type="button" class="btn btn--icon btn--sm btn--danger" :aria-label="$t('list.remove')"
                        :title="$t('list.remove')" @click="draft.talkExample.splice(i, 1)">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7"
                       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M5 7h14M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" />
                  </svg>
                </button>
              </li>
            </ul>
            <div class="acts">
              <button type="button" class="btn btn--sm"
                      @click="draft.talkExample.push({ roleType: 'user', content: '' })">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                {{ $t("editor.talkExample.addUser") }}
              </button>
              <button type="button" class="btn btn--sm"
                      @click="draft.talkExample.push({ roleType: 'ai', content: '' })">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                {{ $t("editor.talkExample.addAi") }}
              </button>
            </div>
          </div>

        </section>

        <!-- 形象 -->
        <section v-show="section === 'media'" class="pane">
          <ImageField v-model="draft.roleAvatar" :label="$t('editor.avatar')" :hint="$t('editor.avatar.hint')"
                      :pick-label="$t('editor.image.pick')" :clear-label="$t('editor.image.clear')"
                      :uploading="$t('editor.image.uploading')" ratio="square" @pick="onPickImage" />
          <ImageField v-model="draft.roleBackground" :label="$t('editor.background')"
                      :hint="$t('editor.background.hint')" :pick-label="$t('editor.image.pick')"
                      :clear-label="$t('editor.image.clear')" :uploading="$t('editor.image.uploading')"
                      ratio="wide" @pick="onPickImage" />
        </section>

        <!-- 世界书 -->
        <section v-show="section === 'worldbook'" class="pane">
          <p class="muted">{{ $t("wb.lede") }}</p>
          <WorldbookEditor v-model="worldbookEntries" v-model:book-name="worldbookName"
                           :bound="Boolean(worldbookId) || worldbookPending" @create="createWorldbookDraft"
                           @imported="onWorldbookImported" />
        </section>

        <!-- 发布 -->
        <section v-show="section === 'publish'" class="pane">
          <div class="panel checklist">
            <h2>{{ $t("editor.checklist") }}</h2>
            <ul>
              <li v-for="key in ['roleName', 'roleWelcome', 'roleDetailDesc']" :key="key"
                  :class="{ ok: !missing.includes(key) }">
                <span aria-hidden="true">{{ missing.includes(key) ? "○" : "●" }}</span>
                {{ $t(`editor.required.${key}`) }}
              </li>
            </ul>
            <p v-if="blockers.length" class="subtle">{{ $t("editor.blockers", { n: blockers.length }) }}</p>
          </div>

          <div class="panel">
            <h2>{{ $t("editor.publish") }}</h2>
            <p class="muted">{{ $t("editor.publish.hint") }}</p>
            <p v-if="dirty || isNew" class="subtle">{{ $t("editor.publish.saveFirst") }}</p>
            <button type="button" class="btn btn--primary" :disabled="!canPublish || saving" @click="publish">
              {{ $t("editor.publish.submit") }}
            </button>
          </div>

          <div class="panel">
            <h2>{{ $t("export.title") }}</h2>
            <p class="muted">{{ $t("export.hint") }}</p>
            <div class="acts">
              <button type="button" class="btn btn--sm" @click="exportCard('png')">{{ $t("export.png") }}</button>
              <button type="button" class="btn btn--sm" @click="exportCard('json')">{{ $t("export.json") }}</button>
            </div>
          </div>
        </section>

        <!-- 窄螢幕的動作條：右欄收掉時由它接手 -->
        <div class="bar">
          <button class="btn btn--primary" type="submit" :disabled="saving || (!dirty && !isNew)">
            {{ saveLabel }}
          </button>
          <RouterLink class="btn" :class="{ 'is-off': saving }" :aria-disabled="saving || undefined"
                      :to="{ path: lp('/mine'), query: { fresh: '1' } }">
            {{ $t("edit.back") }}
          </RouterLink>
          <span v-if="dirty" class="subtle">{{ $t("editor.unsaved") }}</span>
        </div>
      </form>

      <!-- 右：預覽與動作 -->
      <aside class="rail">
        <p class="eyebrow rail__eyebrow">{{ $t("editor.preview") }}</p>
        <div class="rail__tile" inert>
          <CardTile :card="previewCard" />
        </div>

        <ul class="rail__check">
          <li v-for="key in ['roleName', 'roleDetailDesc', 'roleWelcome']" :key="key"
              :class="{ ok: !missing.includes(key) }">
            <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"
                 stroke-linecap="round" stroke-linejoin="round">
              <path v-if="!missing.includes(key)" d="M3.5 8.5l3 3 6-7" />
              <circle v-else cx="8" cy="8" r="5.5" />
            </svg>
            {{ $t(`editor.required.${key}`) }}
          </li>
        </ul>

        <div class="rail__acts">
          <button class="btn btn--primary" type="button" :disabled="saving || (!dirty && !isNew)" title="⌘/Ctrl + S"
                  @click="save">
            {{ saveLabel }}
          </button>
          <button v-if="!isNew" type="button" class="btn" :disabled="!canPublish || saving" @click="publish">
            {{ $t("editor.publish.submit") }}
          </button>
          <RouterLink class="btn btn--ghost" :class="{ 'is-off': saving }" :aria-disabled="saving || undefined"
                      :to="{ path: lp('/mine'), query: { fresh: '1' } }">
            {{ $t("edit.back") }}
          </RouterLink>
        </div>
        <p class="subtle rail__state">
          <template v-if="dirty">{{ $t("editor.unsaved") }}</template>
          <template v-else-if="saved">{{ $t("edit.saved") }}</template>
        </p>
      </aside>
    </div>

    <div class="toast" role="status" :hidden="!toast">{{ toast }}</div>
    <RegexRulesEditor v-if="regexOpen" v-model="regexSet" @close="regexOpen = false" />
  </div>
</template>

<style scoped>
/* 這一頁比別頁寬一點：三欄要站得開。1200 是給榜單的，卡片網格在那個寬度剛好；編輯器多要 120px 給右欄。 */
.editor { max-width: 1320px; }
.head { margin-bottom: var(--s-4); }
h1 { margin: 0 0 var(--s-1); font-size: 22px; }
.lede { margin: 0; max-width: 52ch; }
.ghosts { display: grid; gap: var(--s-4); }

.layout {
  display: grid; grid-template-columns: 176px minmax(0, 1fr) 240px;
  gap: var(--s-5); align-items: start;
}

/* ---- 左欄 ---------------------------------------------------------------- */
.side {
  position: sticky; top: calc(var(--header-h) + var(--s-4));
  display: grid; gap: 2px;
}
.side__item {
  display: flex; align-items: center; gap: var(--s-2);
  height: 34px; padding: 0 var(--s-3);
  border: 0; border-radius: var(--r-sm);
  background: transparent; color: var(--text-2);
  font-size: 14px; font-weight: 500; text-align: left; cursor: pointer;
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
}
.side__item:hover { background: var(--surface-2); color: var(--text); }
.side__item--on { background: var(--surface); color: var(--text); box-shadow: 0 0 0 1px var(--line), var(--shadow-sm); }
/* 選中那一格左邊一道強調色：跟主要按鈕同一個顏色，是「你在這裡」的唯一標記 */
.side__item--on::before {
  content: ""; width: 3px; height: 16px; margin-left: -6px; border-radius: 2px;
  background: var(--accent);
}
.side__label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.side__n { font-size: 12px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.side__dot { width: 6px; height: 6px; border-radius: 50%; background: var(--danger); flex: none; }
.side__check { width: 14px; height: 14px; color: var(--success); flex: none; }

/* ---- 中欄 ---------------------------------------------------------------- */
.body { min-width: 0; }
.body > [role="alert"], .body > .restored { margin-bottom: var(--s-4); }
.restored { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); }
/* 欄位之間只留 pane 的 gap：.field 自己還有 24px 下邊距，兩個疊起來就是 48px 的空洞 */
/* 換分區時淡入：v-show 從 display:none 回來會重新起一次動畫，不用另外觸發 */
.pane { display: grid; gap: var(--s-4); animation: fade var(--dur) var(--ease) both; }
.pane > .field, .pane :deep(.field) { margin-bottom: 0; }
/*
 * 多行欄位跟著內容長高（原生 field-sizing，不用 JS 量高）：寫上千字的人設不該在一個小框裡捲。
 * rows 在 field-sizing: content 下不算數，所以最小高度由各欄位自己用 min-height 給；
 * 最高七成螢幕，再長就框內捲，不然頁面會被一段兩萬字的人設撐到找不到儲存鈕。
 */
.pane :deep(textarea.input) { field-sizing: content; max-height: 70vh; }
.pane :deep(.field) { gap: 6px; }
.pane :deep(.field > label) { line-height: 1.3; }
.pane :deep(.field__foot) { margin-top: -2px; }
.hint { margin: 0 0 var(--s-2); }
.count { font-variant-numeric: tabular-nums; }
.over { color: var(--danger); }
.tags { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.chip { cursor: default; }
.chip--over { color: var(--danger); box-shadow: inset 0 0 0 1px var(--danger); }
.turns { list-style: none; margin: 0 0 var(--s-2); padding: 0; display: grid; gap: var(--s-2); }
.turn { display: flex; gap: var(--s-2); align-items: flex-start; }
.turn .input { flex: 1; resize: vertical; }
.input--who { flex: none; width: 96px; }
.acts { display: flex; gap: var(--s-2); flex-wrap: wrap; }
.rxbar { display: flex; gap: var(--s-2); align-items: center; flex-wrap: wrap; }
.rxbar .chip { margin-left: 4px; height: 20px; padding: 0 7px; font-variant-numeric: tabular-nums; }
.panel { padding: var(--s-4); display: grid; gap: var(--s-2); }
.panel h2 { margin: 0; font-size: 15px; }
.panel .muted { margin: 0; }
.panel .btn { justify-self: start; }
.checklist ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; font-size: 14px; color: var(--text-3); }
.checklist li.ok { color: var(--success); }
/* 寬螢幕時動作在右欄；這條只給窄螢幕 */
.bar { display: none; }
.is-off { pointer-events: none; opacity: 0.45; }

/* ---- 右欄 ---------------------------------------------------------------- */
.rail {
  position: sticky; top: calc(var(--header-h) + var(--s-4));
  display: grid; gap: var(--s-4);
}
.rail__eyebrow { margin: 0 0 calc(var(--s-2) * -1); }
/* 預覽只是看的：inert 擋掉點擊與焦點，hover 的浮起也一起沒了，它就安靜地待在那 */
.rail__tile { pointer-events: none; }
.rail__check { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; font-size: 13px; color: var(--text-3); }
.rail__check li { display: flex; align-items: center; gap: 8px; }
.rail__check li.ok { color: var(--success); }
.rail__check svg { width: 14px; height: 14px; flex: none; }
.rail__acts { display: grid; gap: var(--s-2); }
.rail__acts .btn { width: 100%; }
.rail__state { margin: 0; min-height: 1.6em; }

/* ---- 窄一點：右欄收掉，動作回到底部黏著的那條 ---------------------------------- */
@media (max-width: 1100px) {
  .layout { grid-template-columns: 160px minmax(0, 1fr); }
  .rail { display: none; }
  .body { padding-bottom: 72px; }
  .bar {
    position: sticky; bottom: 0; display: flex; gap: var(--s-3); align-items: center; flex-wrap: wrap;
    margin: var(--s-6) 0 calc(var(--s-3) * -1); padding: var(--s-3) 0;
    background: linear-gradient(to top, var(--bg) 70%, transparent);
  }
}

/* ---- 再窄：導覽變成頂部一排，一欄到底 -------------------------------------------- */
@media (max-width: 760px) {
  .layout { grid-template-columns: minmax(0, 1fr); gap: var(--s-4); }
  .side {
    position: sticky; top: var(--header-h); z-index: 5;
    display: flex; gap: 2px; overflow-x: auto; scrollbar-width: none;
    margin: 0 calc(var(--s-4) * -1); padding: var(--s-2) var(--s-4);
    background: color-mix(in srgb, var(--bg) 88%, transparent);
    backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
    /* 右緣淡出：提示還有分區在後面，不然「發布」剛好被切在邊上像是沒了 */
    mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent);
    -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent);
  }
  .side::-webkit-scrollbar { display: none; }
  .side__item { flex: none; height: var(--h-sm); border-radius: var(--r-pill); font-size: 13px; }
  .side__item--on::before { display: none; }
}
</style>
