<script setup lang="ts">
import CommunityAvatar from "@/components/CommunityAvatar.vue";
import CommunityName from "@/components/CommunityName.vue";
import ReportCommentDialog from "@/components/ReportCommentDialog.vue";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { createComment, deleteComment, fetchComments, fetchReplies, likeComment, type Comment } from "@/lib/api";
import { hueFrom, relativeTime } from "@/lib/format";
import { useLocalePath } from "@/lib/use-locale";
import { useSession } from "@/lib/session";
import { confirmDialog } from "@/lib/confirm";
import { track } from "@/lib/track";
import { loginPath } from "@/lib/login-return";

/** 本站的卡 id：留言掛在本站的卡上，不看這張卡住在哪一家供應商。roleId 只給埋點用。 */
const props = defineProps<{ cardId: string; roleId: string; myScore?: number | null }>();
const emit = defineEmits<{ count: [n: number] }>();

const session = useSession();
const route = useRoute();
const router = useRouter();
const { lp } = useLocalePath();
const { t } = useI18n();

const comments = ref<Comment[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(true);
const error = ref("");
const draft = ref("");
const sending = ref(false);
/** 送出、檢舉之後的一句提示：說完就走 */
const toast = ref("");
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function say(text: string) { toast.value = text; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.value = ""; }, 4000); }
onBeforeUnmount(() => clearTimeout(toastTimer));
/** 正在檢舉哪一則 */
const reporting = ref<Comment | null>(null);
/** 正在回覆哪一則（根評論或它底下的回覆）。 */
const replyTo = ref<{ root: Comment; target: Comment } | null>(null);
const replyDraft = ref("");
/** 展開的回覆串：一頁一頁往下接，不是整包覆蓋 */
const expanded = ref<Record<string, { replies: Comment[]; page: number; hasMore: boolean }>>({});

const MAX = 500;

// 自己剛改了星數：自己那幾則留言上的星數跟著換，不必重讀整串
watch(() => props.myScore, (score) => {
  if (score === undefined) return;
  for (const c of comments.value) if (c.isOwner) c.score = score;
});

async function tokenOrNull() {
  return session.me ? await session.accessToken() : null;
}

async function load(reset = false) {
  if (reset) { page.value = 1; comments.value = []; }
  loading.value = true;
  error.value = "";
  try {
    const res = await fetchComments(props.cardId, page.value, (await tokenOrNull()) ?? undefined);
    // 回應形狀不對（代理回了別的東西）就當成沒有留言，不讓整個面板崩掉
    const got = Array.isArray(res.comments) ? res.comments : [];
    comments.value = reset || page.value === 1 ? got : [...comments.value, ...got];
    total.value = Number(res.total) || 0;
    emit("count", total.value);
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
    const created = await createComment(props.cardId, { content: text, parentId: target?.commentId, rootId: root?.commentId }, token);
    if (root) { replyDraft.value = ""; replyTo.value = null; delete expanded.value[root.commentId]; } else draft.value = "";
    await load(true);
    // 列表裡的回覆預覽只放讚數前幾則；新回覆零讚擠不進去，翻回覆串本身把它找出來，留在原位（審核中的也是，只有本人看得到）
    const fresh = root && comments.value.find((c) => c.commentId === root.commentId);
    if (fresh && !fresh.replies?.some((r) => r.commentId === created.commentId)) {
      do await showAllReplies(fresh);
      while (!repliesOf(fresh).some((r) => r.commentId === created.commentId) && expanded.value[fresh.commentId]?.hasMore);
    }
    const held = created.status === "held";
    // 審核中的留言別人看不到——說一聲，不然像是已經公開了
    if (held) say(t("comment.submitted"));
    track("comment_post", { detail: root ? "comment_reply" : "comment_root", subject: props.roleId, ok: !held });
  } catch (err) {
    track("comment_post", { detail: root ? "comment_reply" : "comment_root", subject: props.roleId, ok: false });
    error.value = err instanceof Error ? err.message : t("state.actionFailed");
  } finally {
    sending.value = false;
  }
}

async function toggleLike(c: Comment) {
  if (!session.me) return router.push(lp(loginPath(route.fullPath)));
  const token = await session.accessToken();
  if (!token) return;
  // 樂觀更新：失敗再翻回來
  c.isLiked = !c.isLiked;
  c.likeCount += c.isLiked ? 1 : -1;
  try {
    await likeComment(c.commentId, c.isLiked, token);
    track("comment_like", { detail: c.isLiked ? "like_on" : "like_off", subject: props.roleId });
  } catch { c.isLiked = !c.isLiked; c.likeCount += c.isLiked ? 1 : -1; }
}

function report(c: Comment) {
  if (!session.me) return router.push(lp(loginPath(route.fullPath)));
  reporting.value = c;
}
function reported() {
  reporting.value = null;
  say(t("comment.reportThanks"));
}
/** 別人的公開留言才能檢舉 */
const reportable = (c: Comment) => !c.isOwner && c.status === "visible";

async function remove(c: Comment) {
  if (!(await confirmDialog({ message: t("comment.confirmDelete"), confirmText: t("dialog.delete"), danger: true }))) return;
  const token = await session.accessToken();
  if (!token) return;
  try {
    await deleteComment(c.commentId, token);
    track("comment_delete", { subject: props.roleId });
    await load(true);
  } catch (err) {
    track("comment_delete", { subject: props.roleId, ok: false });
    error.value = err instanceof Error ? err.message : t("state.actionFailed");
  }
}

async function showAllReplies(root: Comment) {
  const cur = expanded.value[root.commentId];
  const page = cur ? cur.page + 1 : 1;
  const res = await fetchReplies(props.cardId, root.commentId, page, (await tokenOrNull()) ?? undefined);
  const got = Array.isArray(res.replies) ? res.replies : [];
  const replies = cur ? [...cur.replies, ...got] : got;
  expanded.value[root.commentId] = { replies, page, hasMore: replies.length < root.replyCount && got.length > 0 };
}
const repliesOf = (root: Comment) => expanded.value[root.commentId]?.replies ?? root.replies ?? [];
const moreReplies = (root: Comment) => (expanded.value[root.commentId] ? expanded.value[root.commentId]!.hasMore : root.replyCount > repliesOf(root).length);

watch([() => props.cardId, () => session.me?.accountNumId], () => load(true), { immediate: true });
</script>

<template>
  <section class="cmt">
    <!-- 發表區：登入才能寫；沒登入放一顆登入鍵，不藏 -->
    <div v-if="session.me" class="cmt__composer">
      <img v-if="session.me.avatar" :src="session.me.avatar" alt="" class="cmt__face" />
      <div class="cmt__box">
        <textarea v-model="draft" class="input cmt__input" :maxlength="MAX" :placeholder="$t('comment.placeholder')" rows="2" />
        <div class="cmt__box-foot">
          <span class="subtle">{{ draft.length }}/{{ MAX }}<template v-if="myScore"> · {{ $t("score.attached", { n: myScore }) }}</template></span>
          <button class="btn btn--primary btn--sm" :disabled="sending || !draft.trim()" @click="submit()">{{ $t("comment.submit") }}</button>
        </div>
      </div>
    </div>
    <RouterLink v-else-if="session.ready" class="btn cmt__login" :to="lp(loginPath(route.fullPath))">{{ $t("comment.login") }}</RouterLink>

    <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>

    <div v-if="loading && !comments.length" class="cmt__ghosts"><div v-for="i in 4" :key="i" class="ghost" /></div>
    <p v-else-if="!comments.length" class="cmt__empty muted">{{ $t("comment.empty") }}</p>

    <ul v-else class="cmt__list">
      <li v-for="c in comments" :key="c.commentId" class="cmt__item">
        <CommunityAvatar v-if="!c.removed" :handle="c.handle" :src="c.accountAvatar" :name="c.accountNickName" class="cmt__face" />
        <div class="cmt__body">
          <!-- 被移除的頂層只留一行說明；底下的回覆照常 -->
          <p v-if="c.removed" class="cmt__removed">{{ $t("comment.removed") }}</p>
          <template v-else>
          <div class="cmt__head">
            <CommunityName :handle="c.handle" :name="c.accountNickName" class="cmt__name" />
            <span v-if="c.isCreator" class="cmt__badge">{{ $t("comment.creator") }}</span>
            <span v-if="c.isPinned" class="cmt__badge cmt__badge--pin">{{ $t("comment.pinned") }}</span>
            <span v-if="c.status === 'held'" class="cmt__badge cmt__badge--held">{{ $t("comment.held") }}</span>
            <span v-if="c.score" class="cmt__stars" role="img" :aria-label="$t('score.stars', { n: c.score })">{{ "★".repeat(c.score) }}<span class="cmt__stars-off">{{ "★".repeat(5 - c.score) }}</span></span>
            <span class="subtle">{{ relativeTime(Date.parse(c.createTime)) }}</span>
          </div>
          <p class="cmt__text">{{ c.content }}</p>
          <div class="cmt__actions">
            <!-- 審核中的還沒公開：不能按讚、不能回覆 -->
            <template v-if="c.status !== 'held'">
              <button class="cmt__act" :class="{ 'is-on': c.isLiked }" @click="toggleLike(c)">
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13.6S2.5 10.2 2.5 6.4A2.9 2.9 0 0 1 8 4.9a2.9 2.9 0 0 1 5.5 1.5c0 3.8-5.5 7.2-5.5 7.2z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" /></svg>
                {{ c.likeCount || "" }}
              </button>
              <button v-if="session.me" class="cmt__act" @click="replyTo = { root: c, target: c }; replyDraft = ''">{{ $t("comment.reply") }}</button>
            </template>
            <button v-if="c.canDelete" class="cmt__act cmt__act--danger" @click="remove(c)">{{ $t("comment.delete") }}</button>
            <button v-if="reportable(c)" class="cmt__act cmt__act--report" @click="report(c)">{{ $t("comment.report") }}</button>
          </div>
          </template>

          <ul v-if="repliesOf(c).length" class="cmt__replies">
            <li v-for="r in repliesOf(c)" :key="r.commentId" class="cmt__reply">
              <CommunityAvatar :handle="r.handle" :src="r.accountAvatar" :name="r.accountNickName" class="cmt__face cmt__face--sm" />
              <div class="cmt__body">
                <div class="cmt__head">
                  <CommunityName :handle="r.handle" :name="r.accountNickName" class="cmt__name" />
                  <span v-if="r.isCreator" class="cmt__badge">{{ $t("comment.creator") }}</span>
                  <span v-if="r.status === 'held'" class="cmt__badge cmt__badge--held">{{ $t("comment.held") }}</span>
                  <span class="subtle">{{ relativeTime(Date.parse(r.createTime)) }}</span>
                </div>
                <p class="cmt__text"><span v-if="r.replyToNickName && r.parentId !== c.commentId" class="cmt__to">@{{ r.replyToNickName }} </span>{{ r.content }}</p>
                <div class="cmt__actions">
                  <template v-if="r.status !== 'held'">
                    <button class="cmt__act" :class="{ 'is-on': r.isLiked }" @click="toggleLike(r)">
                      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13.6S2.5 10.2 2.5 6.4A2.9 2.9 0 0 1 8 4.9a2.9 2.9 0 0 1 5.5 1.5c0 3.8-5.5 7.2-5.5 7.2z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" /></svg>
                      {{ r.likeCount || "" }}
                    </button>
                    <button v-if="session.me" class="cmt__act" @click="replyTo = { root: c, target: r }; replyDraft = ''">{{ $t("comment.reply") }}</button>
                  </template>
                  <button v-if="r.canDelete" class="cmt__act cmt__act--danger" @click="remove(r)">{{ $t("comment.delete") }}</button>
                  <button v-if="reportable(r)" class="cmt__act cmt__act--report" @click="report(r)">{{ $t("comment.report") }}</button>
                </div>
              </div>
            </li>
          </ul>
          <button v-if="moreReplies(c)" class="cmt__more" @click="showAllReplies(c)">{{ expanded[c.commentId] ? $t("comment.loadMore") : $t("comment.viewReplies", { n: c.replyCount }) }}</button>

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
    <ReportCommentDialog v-if="reporting" :comment-id="reporting.commentId" @close="reporting = null" @reported="reported" />
    <div class="toast" role="status" :hidden="!toast">{{ toast }}</div>
  </section>
</template>

<style scoped>
.cmt { display: grid; gap: var(--s-4); }
.cmt__composer { display: flex; gap: var(--s-3); }
.cmt__face { width: 36px; height: 36px; border-radius: 999px; object-fit: cover; flex: none; }
.cmt__face--sm { width: 28px; height: 28px; }
.cmt__face.mono { font-size: 14px; }
.cmt__face--sm.mono { font-size: 12px; }
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
a.cmt__name:hover { color: var(--accent-text); }
.cmt__badge { padding: 1px 6px; border-radius: 5px; font-size: 11px; font-weight: 600; background: var(--accent-tint); color: var(--accent-text); }
.cmt__badge--pin, .cmt__badge--held { background: var(--surface-2); color: var(--text-2); }
.cmt__removed { margin: 0; font-size: 13.5px; color: var(--text-3); }
.cmt__text { margin: 0; font-size: 14px; line-height: 1.65; white-space: pre-wrap; word-break: break-word; }
.cmt__to { color: var(--accent-text); }
.cmt__actions { display: flex; gap: var(--s-3); margin-top: 2px; }
.cmt__act { display: inline-flex; align-items: center; gap: 4px; padding: 2px 0; background: none; border: 0; font-size: 12.5px; color: var(--text-3); cursor: pointer; }
.cmt__act svg { width: 14px; height: 14px; }
.cmt__act:hover { color: var(--text); }
.cmt__act.is-on { color: var(--accent-text); }
.cmt__act.is-on svg path { fill: var(--accent-text); stroke: var(--accent-text); }
.cmt__act--danger:hover { color: var(--danger); }
/* 檢舉排在最後、靠右，跟讚與回覆分開，不會誤按 */
.cmt__act--report { margin-left: auto; }
.cmt__replies { margin-top: var(--s-2); gap: var(--s-3); }
.cmt__reply { display: flex; gap: var(--s-2); }
.cmt__more { width: fit-content; margin-top: 4px; padding: 0; background: none; border: 0; font-size: 12.5px; font-weight: 500; color: var(--accent-text); cursor: pointer; }
.cmt__load { justify-self: center; }
.cmt__stars { color: var(--gold); font-size: 12px; letter-spacing: 1px; line-height: 1; }
.cmt__stars-off { color: var(--border-strong); }
</style>
