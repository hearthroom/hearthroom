<script setup lang="ts">
/**
 * 角色卡編輯器。建立與編輯共用同一頁——兩者的差別只有「有沒有 roleId」。
 *
 * 為什麼建立時也是整份表單而不是分步精靈：作者手上多半已經有一張想搬過來的卡（自己寫的
 * 草稿、或一張酒館卡），分步會逼他按我們的順序重走一遍。整份表單加上分區導覽，
 * 想從哪裡填就從哪裡填，匯入也才能一次把每一區都填好。
 *
 * 儲存是一次動作、多個請求：建卡 → 寫欄位 → 寫開場白 → 寫世界書。順序不能換，
 * 後面每一步都需要前一步產生的 id。任何一步失敗就停下並保留草稿，不做局部回滾——
 * 上游沒有跨資源的交易，硬回滾只會在失敗之上再疊一次失敗。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterLink, onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import {
  createRole,
  createWorldbook,
  fetchRoleDetail,
  fetchRoleWorldbooks,
  fetchRoleValidation,
  fetchWorldbookEntries,
  patchRoleDocument,
  patchRoleWelcome,
  patchWorldbookDocument,
  submitRoleForReview,
  uploadImage,
  type WorldbookDocumentEntry,
} from "@/lib/api";
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
import { draftToTavern, embedIntoPng, type ImportResult } from "@/lib/tavern";
import { useLocalePath } from "@/lib/use-locale";
import { useSession } from "@/lib/session";
import { confirmDialog } from "@/lib/confirm";
import { track } from "@/lib/track";
import FieldText from "@/components/editor/FieldText.vue";
import ListEditor from "@/components/editor/ListEditor.vue";
import ImageField from "@/components/editor/ImageField.vue";
import ImportPanel from "@/components/editor/ImportPanel.vue";
import WorldbookEditor from "@/components/editor/WorldbookEditor.vue";

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

const worldbookId = ref("");
const worldbookName = ref("");
const worldbookEntries = ref<WorldbookEntryDraft[]>([]);
const worldbookOriginal = ref<WorldbookEntryDraft[]>([]);
/** 剛匯入、還沒送出去的那本。儲存時要先建再寫。 */
const worldbookPending = ref(false);

const limits = ref(resolveLimits(null));
const blockers = ref<string[]>([]);
const loading = ref(!!roleId.value);
const saving = ref(false);
const error = ref("");
const saved = ref(false);

const SECTIONS = ["basic", "persona", "dialogue", "media", "worldbook", "publish"] as const;
type Section = (typeof SECTIONS)[number];
const section = ref<Section>("basic");

const dirty = computed(
  () =>
    JSON.stringify(draft.value) !== JSON.stringify(original.value ?? pristine.value) ||
    JSON.stringify(worldbookEntries.value) !== JSON.stringify(worldbookOriginal.value) ||
    worldbookPending.value,
);

const missing = computed(() => missingRequired(draft.value));
const canPublish = computed(() => !isNew.value && !missing.value.length && !dirty.value);

watch(tagsText, (raw) => {
  draft.value.roleTag = parseTags(raw);
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
  if (!roleId.value) return;
  try {
    const token = await session.accessToken();
    const raw = await fetchRoleDetail(roleId.value, token ?? undefined);
    draft.value = draftFromRoleDetail(raw, locale.value);
    tagsText.value = formatTags(draft.value.roleTag);
    original.value = cloneDraft(draft.value);
    if (token) await loadWorldbook(token);
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
onMounted(() => window.addEventListener("beforeunload", guard));
onBeforeUnmount(() => window.removeEventListener("beforeunload", guard));

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

// ── 世界書 ────────────────────────────────────────────────────────

function createWorldbookDraft() {
  worldbookPending.value = true;
  worldbookName.value = draft.value.roleName || "";
  if (!worldbookEntries.value.length) {
    worldbookEntries.value = [{ name: "", content: "", keywords: [], isEnabled: true, isConstant: false }];
  }
}

/** 草稿與上次存下的樣子比對，算出要 create / update / delete 哪些條目。 */
function worldbookOps(): WorldbookDocumentEntry[] {
  const ops: WorldbookDocumentEntry[] = [];
  const keptIds = new Set(worldbookEntries.value.map((e) => e.entryId).filter(Boolean) as string[]);
  for (const before of worldbookOriginal.value) {
    if (before.entryId && !keptIds.has(before.entryId)) ops.push({ op: "delete", entryId: before.entryId });
  }
  for (const entry of worldbookEntries.value) {
    // 空條目不送：作者按了「新增」又沒填，那不是一條要存的資料。
    if (!entry.content.trim()) continue;
    const payload = {
      name: entry.name.trim() || entry.keywords[0] || t("wb.entry.untitled"),
      content: entry.content,
      keywords: entry.keywords,
      isEnabled: entry.isEnabled,
      isConstant: entry.isConstant,
    };
    if (!entry.entryId) ops.push({ op: "create", ...payload });
    else if (JSON.stringify(entry) !== JSON.stringify(worldbookOriginal.value.find((e) => e.entryId === entry.entryId))) {
      ops.push({ op: "update", entryId: entry.entryId, ...payload });
    }
  }
  return ops;
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
      { name: worldbookName.value.trim() || draft.value.roleName, language: draft.value.language },
      token,
    );
    firstBind = true;
  }
  await patchWorldbookDocument(bookId, { entries: ops, ...(firstBind ? { binding: { roleId: targetRoleId } } : {}) }, token);
  worldbookId.value = bookId;
  worldbookPending.value = false;
  // 條目 id 只有重新讀一次才拿得到，不然下一次儲存會把剛建的條目再建一遍。
  worldbookEntries.value = await fetchWorldbookEntries(bookId, token).catch(() => worldbookEntries.value);
  worldbookOriginal.value = JSON.parse(JSON.stringify(worldbookEntries.value));
}

// ── 儲存 ──────────────────────────────────────────────────────────

async function save() {
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

    original.value = cloneDraft(draft.value);
    saved.value = true;
    track("card_edit", { subject: targetRoleId });
    void loadValidation();

    // 建立完成後把網址換成編輯頁：重新整理不該回到一張空表單。
    if (wasNew) await router.replace(lp(`/cards/${targetRoleId}/edit`));
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

function applyImport(result: ImportResult) {
  const language = draft.value.language;
  draft.value = { ...result.draft, language };
  tagsText.value = formatTags(draft.value.roleTag);
  track("card_import", { detail: result.image ? "png" : "json" });
  if (result.worldbook) {
    worldbookPending.value = true;
    worldbookName.value = result.worldbook.name || draft.value.roleName;
    // 匯入的條目一律沒有 entryId：它們在上游還不存在，儲存時要走 create。
    worldbookEntries.value = result.worldbook.entries.map((entry) => ({ ...entry, entryId: undefined }));
  }
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
 * 優先走 PNG：那是這個生態的通用載體，拖進任何客戶端都認得。頭像取不到（跨網域沒開
 * CORS、或作者根本沒設頭像）就退回 JSON，而不是報錯——作者要的是那份設定，
 * 不是那張圖。
 */
async function exportCard(format: "png" | "json") {
  error.value = "";
  const card = draftToTavern(draft.value, worldbookEntries.value.filter((e) => e.content.trim()));
  if (format === "json") {
    download(new Blob([JSON.stringify(card, null, 2)], { type: "application/json" }), `${safeName()}.json`);
    track("card_export", { detail: "json" });
    return;
  }
  try {
    if (!draft.value.roleAvatar) throw new Error("no_avatar");
    const res = await fetch(draft.value.roleAvatar);
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
  <div class="page">
    <p class="eyebrow">{{ $t("mine.eyebrow") }}</p>
    <h1 class="display">{{ isNew ? $t("editor.title.new") : $t("editor.title.edit") }}</h1>
    <p class="muted lede">{{ isNew ? $t("editor.lede.new") : $t("editor.lede.edit") }}</p>

    <div v-if="loading" class="ghosts" aria-hidden="true">
      <div class="ghost" style="height: 40px" />
      <div class="ghost" style="height: 120px" />
      <div class="ghost" style="height: 260px" />
    </div>

    <template v-else>
      <nav class="seg sections" :aria-label="$t('editor.sections')">
        <button
          v-for="key in SECTIONS"
          :key="key"
          type="button"
          class="seg__item"
          :class="{ 'seg__item--on': section === key }"
          :aria-current="section === key ? 'true' : undefined"
          @click="section = key"
        >
          {{ $t(`editor.section.${key}`) }}
          <span v-if="key === 'basic' && missing.includes('roleName')" class="dot" aria-hidden="true" />
          <span v-if="key === 'persona' && missing.includes('roleDetailDesc')" class="dot" aria-hidden="true" />
          <span v-if="key === 'dialogue' && missing.includes('roleWelcome')" class="dot" aria-hidden="true" />
        </button>
      </nav>

      <form class="body" @submit.prevent="save">
        <!-- 基础 -->
        <section v-show="section === 'basic'" class="pane">
          <ImportPanel v-if="isNew" :language="draft.language" @apply="applyImport" />

          <FieldText id="f-name" v-model="draft.roleName" :label="$t('editor.name')" required :max="60"
                     :placeholder="$t('create.name.placeholder')" />

          <div v-if="isNew" class="field">
            <label for="f-lang">{{ $t("create.language") }}</label>
            <select id="f-lang" v-model="draft.language" class="input">
              <option v-for="l in LANGUAGES" :key="l.value" :value="l.value">{{ l.label }}</option>
            </select>
            <span class="subtle">{{ $t("editor.language.hint") }}</span>
          </div>

          <FieldText id="f-desc" v-model="draft.roleDesc" :label="$t('editor.summary')" :rows="3"
                     :max="limits.roleDesc" :hint="$t('edit.summary.hint')" />

          <div class="field">
            <label for="f-tags">{{ $t("edit.tags") }}</label>
            <input id="f-tags" v-model="tagsText" class="input" :placeholder="$t('edit.tags.placeholder')" />
            <span class="subtle">{{ $t("edit.tags.hint") }}</span>
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
                <textarea v-model="turn.content" class="input" rows="2"
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
                {{ $t("editor.talkExample.addUser") }}
              </button>
              <button type="button" class="btn btn--sm"
                      @click="draft.talkExample.push({ roleType: 'ai', content: '' })">
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
                           :bound="Boolean(worldbookId) || worldbookPending" @create="createWorldbookDraft" />
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
            <p v-if="dirty" class="subtle">{{ $t("editor.publish.saveFirst") }}</p>
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

        <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
        <p v-else-if="saved && !dirty" class="notice" role="status">{{ $t("edit.saved") }}</p>

        <div class="bar">
          <button class="btn btn--primary" type="submit" :disabled="saving || (!dirty && !isNew)">
            {{ saving ? $t("edit.saving") : isNew ? $t("editor.saveDraft") : $t("edit.save") }}
          </button>
          <RouterLink class="btn" :class="{ 'is-off': saving }" :aria-disabled="saving || undefined"
                      :to="{ path: lp('/mine'), query: { fresh: '1' } }">
            {{ $t("edit.back") }}
          </RouterLink>
          <span v-if="dirty" class="subtle">{{ $t("editor.unsaved") }}</span>
        </div>
      </form>
    </template>
  </div>
</template>

<style scoped>
h1 { margin: 2px 0 var(--s-2); font-size: 24px; }
.lede { margin: 0 0 var(--s-5); max-width: 52ch; }
.ghosts { display: grid; gap: var(--s-4); }
.sections { margin-bottom: var(--s-5); flex-wrap: wrap; }
.seg__item { position: relative; }
.dot {
  display: inline-block; width: 5px; height: 5px; border-radius: 50%;
  background: var(--danger); vertical-align: 3px; margin-left: 5px;
}
/* 底部那條是 sticky 的，內容要留出它的高度，不然最後一顆按鈕會被壓在下面點不到 */
.body { max-width: 760px; padding-bottom: 72px; }
.pane { display: grid; gap: var(--s-5); }
.hint { margin: 0 0 var(--s-2); }
.turns { list-style: none; margin: 0 0 var(--s-2); padding: 0; display: grid; gap: var(--s-2); }
.turn { display: flex; gap: var(--s-2); align-items: flex-start; }
.turn .input { flex: 1; resize: vertical; }
.input--who { flex: none; width: 96px; }
.acts { display: flex; gap: var(--s-2); flex-wrap: wrap; }
.panel { padding: var(--s-4); display: grid; gap: var(--s-3); }
.panel h2 { margin: 0; font-size: 15px; }
.panel .muted { margin: 0; }
.panel .btn { justify-self: start; }
.checklist ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; font-size: 14px; color: var(--text-3); }
.checklist li.ok { color: var(--success); }
.bar {
  position: sticky; bottom: 0; display: flex; gap: var(--s-3); align-items: center; flex-wrap: wrap;
  margin: var(--s-6) 0 calc(var(--s-3) * -1); padding: var(--s-3) 0;
  background: linear-gradient(to top, var(--page) 70%, transparent);
}
.is-off { pointer-events: none; opacity: 0.45; }
</style>
