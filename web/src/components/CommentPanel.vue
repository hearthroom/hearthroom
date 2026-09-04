<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";
import { createComment, deleteComment, fetchComments, fetchReplies, likeComment, type Comment } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { contentLang } from "@/lib/i18n";
import { useLocalePath } from "@/lib/use-locale";
import { useSession } from "@/lib/session";

const props = defineProps<{ roleId: string }>();
const emit = defineEmits<{ count: [n: number] }>();

const session = useSession();
const route = useRoute();
const { locale, lp } = useLocalePath();
const { t } = useI18n();
const lang = computed(() => contentLang(locale.value));

const comments = ref<Comment[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(true);
const error = ref("");
const draft = ref("");
const sending = ref(false);
const submittedHidden = ref(false);
/** 正在回覆哪一則（根評論或它底下的回覆）。 */
const replyTo = ref<{ root: Comment; target: Comment } | null>(null);
const replyDraft = ref("");
const expanded = ref<Record<string, Comment[]>>({});

const MAX = 500;

async function tokenOrNull() {
  return session.me ? await session.accessToken() : null;
}

async function load(reset = false) {
  if (reset) { page.value = 1; comments.value = []; }
  loading.value = true;
  error.value = "";
  try {
    const res = await fetchComments(props.roleId, page.value, lang.value, (await tokenOrNull()) ?? undefined);
    comments.value = reset || page.value === 1 ? res.comments : [...comments.value, ...res.comments];
    total.value = res.total;
    emit("count", res.total);
  } catch (err) {
    error.value = err instanceof Error ? err.message : t("state.loadFailed");
  } finally {
    loading.value = false;
  }
}
const hasMore = computed(() => comments.value.length < total.value);
function more() { page.value += 1; load(); }

async function submit(root?: Comment, target?: Comment) {
  const text = (root ? replyDraft.value : draft.value).trim();
  if (!text || sending.value) return;
  sending.value = true;
  error.value = "";
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    const created = await createComment(
      { roleId: props.roleId, content: text, parentId: target?.commentId, rootId: root?.commentId, replyToNickName: target?.accountNickName },
      token, lang.value,
    );
    if (root) { replyDraft.value = ""; replyTo.value = null; delete expanded.value[root.commentId]; } else draft.value = "";
    await load(true);
    // 審核中的留言列表裡看不到——說一聲，不然像是沒送出去
    const visible = comments.value.some((c) => c.commentId === created.commentId || c.replies?.some((r) => r.commentId === created.commentId));
    submittedHidden.value = !visible;
  } catch (err) {
    error.value = err instanceof Error ? err.message : t("state.actionFailed");
  } finally {
    sending.value = false;
  }
}

async function toggleLike(c: Comment) {
  if (!session.me) return session.login(route.fullPath);
  const token = await session.accessToken();
  if (!token) return;
  // 樂觀更新：失敗再翻回來
  c.isLiked = !c.isLiked;
  c.likeCount += c.isLiked ? 1 : -1;
  try { await likeComment(c.commentId, c.isLiked, token); }
  catch { c.isLiked = !c.isLiked; c.likeCount += c.isLiked ? 1 : -1; }
}

async function remove(c: Comment) {
  if (!window.confirm(t("comment.confirmDelete"))) return;
  const token = await session.accessToken();
  if (!token) return;
  try { await deleteComment(c.commentId, props.roleId, token); await load(true); }
  catch (err) { error.value = err instanceof Error ? err.message : t("state.actionFailed"); }
}

async function showAllReplies(root: Comment) {
  const res = await fetchReplies(props.roleId, root.commentId, 1, lang.value, (await tokenOrNull()) ?? undefined);
  expanded.value[root.commentId] = res.replies;
}
const repliesOf = (root: Comment) => expanded.value[root.commentId] ?? root.replies ?? [];

watch([() => props.roleId, lang, () => session.me?.accountNumId], () => load(true), { immediate: true });
</script>

<template>
  <section class="cmt">
    <!-- 發表區：登入才能寫；沒登入放一顆登入鍵，不藏 -->
    <div v-if="session.me" class="cmt__composer">
      <img v-if="session.me.avatar" :src="session.me.avatar" alt="" class="cmt__face" />
      <div class="cmt__box">
        <textarea v-model="draft" class="input cmt__input" :maxlength="MAX" :placeholder="$t('comment.placeholder')" rows="2" />
        <div class="cmt__box-foot">
          <span class="subtle">{{ draft.length }}/{{ MAX }}</span>
          <button class="btn btn--primary btn--sm" :disabled="sending || !draft.trim()" @click="submit()">{{ $t("comment.submit") }}</button>
        </div>
      </div>
    </div>
    <button v-else-if="session.ready" class="btn cmt__login" @click="session.login(route.fullPath)">{{ $t("comment.login") }}</button>

    <p v-if="submittedHidden" class="notice">{{ $t("comment.submitted") }}</p>
    <p v-if="error" class="notice notice--error">{{ error }}</p>

    <div v-if="loading && !comments.length" class="cmt__ghosts"><div v-for="i in 4" :key="i" class="ghost" /></div>
    <p v-else-if="!comments.length" class="cmt__empty muted">{{ $t("comment.empty") }}</p>

    <ul v-else class="cmt__list">
      <li v-for="c in comments" :key="c.commentId" class="cmt__item">
        <img v-if="c.accountAvatar" :src="c.accountAvatar" alt="" class="cmt__face" />
        <span v-else class="cmt__face cmt__face--void">{{ [...(c.accountNickName || '?')][0] }}</span>
        <div class="cmt__body">
          <div class="cmt__head">
            <RouterLink v-if="c.accountNumId" :to="lp(`/authors/${c.accountNumId}`)" class="cmt__name">{{ c.accountNickName }}</RouterLink>
            <span v-else class="cmt__name">{{ c.accountNickName }}</span>
            <span v-if="c.isCreator" class="cmt__badge">{{ $t("comment.creator") }}</span>
            <span v-if="c.isPinned" class="cmt__badge cmt__badge--pin">{{ $t("comment.pinned") }}</span>
            <span class="subtle">{{ relativeTime(Date.parse(c.createTime)) }}</span>
          </div>
          <p class="cmt__text">{{ c.content }}</p>
          <div class="cmt__actions">
            <button class="cmt__act" :class="{ 'is-on': c.isLiked }" @click="toggleLike(c)">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13.6S2.5 10.2 2.5 6.4A2.9 2.9 0 0 1 8 4.9a2.9 2.9 0 0 1 5.5 1.5c0 3.8-5.5 7.2-5.5 7.2z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" /></svg>
              {{ c.likeCount || "" }}
            </button>
            <button v-if="session.me" class="cmt__act" @click="replyTo = { root: c, target: c }; replyDraft = ''">{{ $t("comment.reply") }}</button>
            <button v-if="c.canDelete" class="cmt__act cmt__act--danger" @click="remove(c)">{{ $t("comment.delete") }}</button>
          </div>

          <ul v-if="repliesOf(c).length" class="cmt__replies">
            <li v-for="r in repliesOf(c)" :key="r.commentId" class="cmt__reply">
              <img v-if="r.accountAvatar" :src="r.accountAvatar" alt="" class="cmt__face cmt__face--sm" />
              <span v-else class="cmt__face cmt__face--sm cmt__face--void">{{ [...(r.accountNickName || '?')][0] }}</span>
              <div class="cmt__body">
                <div class="cmt__head">
                  <span class="cmt__name">{{ r.accountNickName }}</span>
                  <span v-if="r.isCreator" class="cmt__badge">{{ $t("comment.creator") }}</span>
                  <span class="subtle">{{ relativeTime(Date.parse(r.createTime)) }}</span>
                </div>
                <p class="cmt__text"><span v-if="r.replyToNickName && r.parentId !== c.commentId" class="cmt__to">@{{ r.replyToNickName }} </span>{{ r.content }}</p>
                <div class="cmt__actions">
                  <button class="cmt__act" :class="{ 'is-on': r.isLiked }" @click="toggleLike(r)">
                    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13.6S2.5 10.2 2.5 6.4A2.9 2.9 0 0 1 8 4.9a2.9 2.9 0 0 1 5.5 1.5c0 3.8-5.5 7.2-5.5 7.2z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" /></svg>
                    {{ r.likeCount || "" }}
                  </button>
                  <button v-if="session.me" class="cmt__act" @click="replyTo = { root: c, target: r }; replyDraft = ''">{{ $t("comment.reply") }}</button>
                  <button v-if="r.canDelete" class="cmt__act cmt__act--danger" @click="remove(r)">{{ $t("comment.delete") }}</button>
                </div>
              </div>
            </li>
          </ul>
          <button v-if="c.replyCount > repliesOf(c).length" class="cmt__more" @click="showAllReplies(c)">{{ $t("comment.viewReplies", { n: c.replyCount }) }}</button>

          <div v-if="replyTo?.root.commentId === c.commentId" class="cmt__box cmt__box--reply">
            <textarea v-model="replyDraft" class="input cmt__input" :maxlength="MAX" :placeholder="$t('comment.replyTo', { name: replyTo!.target.accountNickName })" rows="2" autofocus />
            <div class="cmt__box-foot">
              <button class="btn btn--ghost btn--sm" @click="replyTo = null">{{ $t("comment.cancel") }}</button>
              <button class="btn btn--primary btn--sm" :disabled="sending || !replyDraft.trim()" @click="submit(replyTo!.root, replyTo!.target)">{{ $t("comment.submit") }}</button>
            </div>
          </div>
        </div>
      </li>
    </ul>

    <button v-if="hasMore && !loading" class="btn btn--sm cmt__load" @click="more()">{{ $t("comment.loadMore") }}</button>
  </section>
</template>

<style scoped>
.cmt { display: grid; gap: var(--s-4); }
.cmt__composer { display: flex; gap: var(--s-3); }
.cmt__face { width: 36px; height: 36px; border-radius: 999px; object-fit: cover; flex: none; }
.cmt__face--sm { width: 28px; height: 28px; }
.cmt__face--void { display: grid; place-items: center; background: var(--surface-2); color: var(--text-2); font-size: 14px; font-weight: 600; }
.cmt__box { flex: 1; min-width: 0; display: grid; gap: var(--s-2); }
.cmt__box--reply { margin-top: var(--s-3); }
.cmt__input { resize: vertical; min-height: 64px; line-height: 1.6; padding: 10px 12px; }
.cmt__box-foot { display: flex; justify-content: flex-end; align-items: center; gap: var(--s-2); }
.cmt__box-foot .subtle { margin-right: auto; font-variant-numeric: tabular-nums; }
.cmt__login { width: fit-content; }
.cmt__ghosts { display: grid; gap: var(--s-3); }
.cmt__ghosts .ghost { height: 64px; }
.cmt__empty { padding: var(--s-6) 0; text-align: center; font-size: 13.5px; }

.cmt__list, .cmt__replies { list-style: none; margin: 0; padding: 0; display: grid; }
.cmt__item { display: flex; gap: var(--s-3); padding: var(--s-4) 0; box-shadow: 0 -1px 0 var(--line); }
.cmt__item:first-child { box-shadow: none; padding-top: 0; }
.cmt__body { flex: 1; min-width: 0; display: grid; gap: 4px; }
.cmt__head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.cmt__name { font-size: 13.5px; font-weight: 600; }
a.cmt__name:hover { color: var(--accent); }
.cmt__badge { padding: 1px 6px; border-radius: 5px; font-size: 11px; font-weight: 600; background: var(--accent-soft); color: var(--accent); }
.cmt__badge--pin { background: var(--surface-2); color: var(--text-2); }
.cmt__text { margin: 0; font-size: 14px; line-height: 1.65; white-space: pre-wrap; word-break: break-word; }
.cmt__to { color: var(--accent); }
.cmt__actions { display: flex; gap: var(--s-3); margin-top: 2px; }
.cmt__act { display: inline-flex; align-items: center; gap: 4px; padding: 2px 0; background: none; border: 0; font-size: 12.5px; color: var(--text-3); cursor: pointer; }
.cmt__act svg { width: 14px; height: 14px; }
.cmt__act:hover { color: var(--text); }
.cmt__act.is-on { color: var(--accent); }
.cmt__act.is-on svg path { fill: var(--accent); stroke: var(--accent); }
.cmt__act--danger:hover { color: var(--danger); }
.cmt__replies { margin-top: var(--s-2); gap: var(--s-3); }
.cmt__reply { display: flex; gap: var(--s-2); }
.cmt__more { width: fit-content; margin-top: 4px; padding: 0; background: none; border: 0; font-size: 12.5px; font-weight: 500; color: var(--accent); cursor: pointer; }
.cmt__load { justify-self: center; }
</style>
