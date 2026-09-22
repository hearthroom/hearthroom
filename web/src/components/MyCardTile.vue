<script setup lang="ts">
import CardSyncPanel from "./CardSyncPanel.vue";
import { computed, ref, watch } from "vue";
import { useSession } from "@/lib/session";
import { playCopies } from "@/lib/card-workspace";
import { platformPath, type CardCopy } from "@/lib/distribution";
import { compact, hueFrom } from "@/lib/format";
import { zoneLabel } from "@/lib/i18n";
import { useLocalePath } from "@/lib/use-locale";
import { can, currentProvider, providerName, type ProviderId } from "@/lib/provider";
import type { MyCard } from "@/lib/api";

/** locked：這週的登記額度用完了。只鎖「登記」，撤銷登記照常——撤掉不佔額度。 */
const props = defineProps<{ card: MyCard & {sourceAvailable?:boolean}; busy: boolean; locked?: boolean; emails?:Partial<Record<ProviderId,string>> }>();
defineEmits<{ toggle: []; resubmit: [] }>();

const { lp } = useLocalePath();
const session=useSession();
const source=computed(()=>props.card.sourceProvider??props.card.provider??currentProvider());
const sourceId=computed(()=>props.card.sourceRoleId??props.card.roleId);
const stored=ref<CardCopy[]>([]);
const choosingPlay=ref(false);
const plays=computed(()=>playCopies(sourceId.value,source.value,stored.value,session.profile?.identities.map(i=>i.provider as ProviderId)??[source.value]));
const accountLabel=(p:ProviderId)=>props.emails?.[p] || providerName(p);

const hue = computed(() => hueFrom(props.card.name));
const initial = computed(() => [...props.card.name][0] ?? "?");
const failedArt = ref<string[]>([]);
const artwork = computed(() => [props.card.backgroundUrl, props.card.avatarUrl]
  .find((url): url is string => !!url && !failedArt.value.includes(url)));
watch(() => [props.card.roleId, props.card.backgroundUrl, props.card.avatarUrl], () => { failedArt.value = []; });
function onArtError() {
  if (artwork.value) failedArt.value.push(artwork.value);
}
</script>

<template>
  <article class="card rise">
    <div class="card__poster">
      <!-- 封面連到卡片頁：編輯有自己的鍵在下面（作者回報 2026-09-16：點自己的卡跳進編輯頁） -->
      <a :href="platformPath(lp(`/cards/${sourceId}`),source)" class="card__art">
        <img v-if="artwork" :key="artwork" :src="artwork" :alt="card.name" loading="lazy" @error="onArtError" />
        <div
          v-else
          class="card__void"
          :style="{ background: `linear-gradient(160deg, hsl(${hue} 45% 78%), hsl(${(hue + 40) % 360} 40% 62%))` }"
        >
          <span :aria-label="card.name">{{ initial }}</span>
        </div>
      </a>

      <div class="card__badges">
        <span v-if="card.registered && (!card.status || card.status === 'approved')" class="card__badge">{{ $t("mine.badge.listed") }}</span>
        <span v-else-if="card.registered && card.status" class="card__badge card__badge--muted">{{ $t(`mine.badge.${card.status}`) }}</span>
        <span v-if="!card.registered" class="card__badge card__badge--muted">{{ $t(card.sourceAvailable===false ? "workspace.unknown" : "workspace.draft") }}</span>
        <span v-if="card.registered && card.nsfw" class="card__badge card__badge--muted">{{ $t("card.nsfw") }}</span>
      </div>
      <div class="card__content">
        <div class="card__intro">
          <h3 class="card__name">{{ card.name }}</h3>
          <p class="card__hook">{{ card.summary || $t("card.noSummary") }}</p>
          <p class="card__meta">{{ zoneLabel(card.zone) }} · {{ $t("card.talkCount", { n: compact(card.talkNum) }) }}</p>
        </div>
        <!-- 工作區的操作不能藏在 hover 底下：觸控裝置根本碰不到 -->
        <div class="card__actions">
          <!-- 自己的卡不用登記也能玩：登記是上榜，不是能不能對話的門檻 -->
          <button class="btn btn--sm" :aria-expanded="choosingPlay" @click="choosingPlay=!choosingPlay">{{ $t("mine.action.play") }}</button>
          <a v-if="can('editor',source)" class="btn btn--sm" :href="platformPath(lp(`/cards/${sourceId}/edit`),source)">{{ $t("mine.action.edit") }}</a>
          <!-- 被駁回、離榜重審、被收回授權的卡：主鍵是「重新提交」，取消登記退到次要 -->
          <button
            v-if="card.registered && (card.status === 'rejected' || card.status === 'needs_review' || card.status === 'unshared')"
            class="btn btn--sm btn--primary"
            :disabled="busy || card.sourceAvailable===false"
            @click="$emit('resubmit')"
          >
            {{ busy ? "…" : $t("mine.action.submit") }}
          </button>
          <button
            class="btn btn--sm"
            :class="card.registered ? 'card__withdraw' : 'btn--primary'"
            :disabled="busy || card.sourceAvailable===false || (locked && !card.registered)"
            :title="locked && !card.registered ? $t('mine.quota.full') : undefined"
            @click="$emit('toggle')"
          >
            {{ busy ? "…" : card.registered ? $t("mine.action.unregister") : $t("mine.action.submit") }}
          </button>
        </div>
      </div>
    </div>
    <div class="card__body">
      <p v-if="card.updateStatus==='pending'" class="card__note">{{ $t("workspace.updatePending") }}</p>
      <p v-if="card.updateStatus==='rejected'" class="card__note">{{ $t("workspace.updateRejected") }}</p>
      <p v-if="card.updateStatus==='superseded'" class="card__note">{{ $t("workspace.reviewSaveRetry") }}</p>
      <p v-if="(card.status === 'rejected' || card.updateStatus==='rejected') && card.note" class="card__note">{{ $t("mine.note.rejected", { note: card.note }) }}</p>
      <section v-if="choosingPlay" class="play-choices">
        <h4>{{ $t('workspace.playTitle') }}</h4>
        <p class="subtle">{{ $t('linked.playHint') }}</p>
        <a v-for="copy in plays" :key="copy.provider" class="play-choice" :href="platformPath(lp(`/play/${copy.roleId}`),copy.provider)">
          <strong>{{ providerName(copy.provider) }}</strong><span>{{ accountLabel(copy.provider) }}</span><span aria-hidden="true">→</span>
        </a>
        <p v-if="!plays.length" class="subtle">{{ $t('workspace.noCopy') }}</p>
      </section>
      <p v-if="card.sourceAvailable===false" class="subtle">{{ $t('workspace.sourceLoading') }}</p>
      <CardSyncPanel :role-id="sourceId" :provider="source" compact @updated="stored=$event" />
    </div>
  </article>
</template>

<style scoped>
.card {
  min-width: 0; background: var(--surface); border-radius: var(--r-md);
  box-shadow: 0 0 0 1px var(--line), var(--shadow-sm); overflow: hidden;
  transition: box-shadow var(--dur) var(--ease);
}
.card:hover { box-shadow: 0 0 0 1px var(--line-strong), var(--shadow-md); }
/* 封面與操作共同構成直式卡片；內容較長時自然長高，不裁掉按鈕。 */
.card__poster { position: relative; isolation: isolate; display: flex; flex-direction: column; justify-content: space-between; aspect-ratio: 2 / 3; color: var(--on-accent); background: #17171c; }
.card__art { position: absolute; inset: 0; display: block; z-index: -1; }
.card__art img { width: 100%; height: 100%; display: block; object-fit: cover; object-position: center top; }
.card__art:focus-visible { outline-offset: -4px; }
.card__void { display: grid; place-items: center; width: 100%; height: 100%; padding-bottom: 35%; }
.card__void span { font-size: 56px; font-weight: 500; color: var(--on-accent); opacity: .8; }
.card__badges { display: flex; flex-wrap: wrap; gap: var(--s-1); padding: var(--s-3) var(--s-3) var(--s-6); background: linear-gradient(to bottom, rgba(16,16,24,.65), transparent); pointer-events: none; }
.card__badge {
  min-height: 22px; max-width: 100%; padding: 2px var(--s-2); display: inline-flex; align-items: center;
  overflow-wrap: anywhere; border-radius: var(--r-pill);
  background: var(--accent-btn); color: var(--on-accent); font-size: 11.5px; font-weight: 600;
}
.card__badge--muted { background: rgba(16,16,24,.7); }
.card__content { position: relative; display: grid; gap: var(--s-3); padding: var(--s-3); margin-top: var(--s-7); background: linear-gradient(to top, rgba(16,16,24,.97), rgba(16,16,24,.87) 65%, rgba(16,16,24,.7)); }
.card__content::before { content: ""; position: absolute; bottom: 100%; left: 0; right: 0; height: var(--s-7); background: linear-gradient(to top, rgba(16,16,24,.7), transparent); pointer-events: none; }
.card__intro { display: grid; min-width: 0; gap: var(--s-1); pointer-events: none; }
.card__name { font-size: 18px; font-weight: 600; line-height: 1.35; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; }
.card__hook { font-size: 13px; line-height: 1.5; color: rgba(255,255,255,.85); display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.card__meta { font-size: 12px; color: rgba(255,255,255,.75); font-variant-numeric: tabular-nums; }
.card__actions { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: var(--s-2); }
.card__actions > .btn { min-height: 44px; height: auto; white-space: normal; min-width: 0; padding-inline: var(--s-2); overflow-wrap: anywhere; }
.card__actions > .btn:not(.btn--primary) { color: var(--on-accent); background: rgba(255,255,255,.12); border-color: rgba(255,255,255,.24); }
.card__actions > .btn:not(.btn--primary):hover { background: rgba(255,255,255,.22); }
.card__actions > .btn:last-child:nth-child(odd) { grid-column: 1 / -1; }
.card__actions > .card__withdraw { background: transparent; }
.card__body { display: grid; min-width: 0; gap: var(--s-2); padding: var(--s-3); }
.card__note { font-size: 12px; color: var(--danger); line-height: 1.5; overflow-wrap: anywhere; }
.card__body :deep(.copy-summary) { margin-top: 0; padding-top: 0; border-top: 0; gap: var(--s-2); }
.card__body :deep(.copy-summary + .distribution) { padding-top: 0; }
.card__body :deep(.target > a) { display: inline-flex; align-items: center; min-height: 44px; }
.play-choices { display: grid; gap: var(--s-2); padding: var(--s-3); background: var(--surface-2); border-radius: var(--r-sm); }
.play-choices h4 { font-size: 14px; }
.play-choices p { font-size: 12px; line-height: 1.6; }
.play-choice { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 2px var(--s-2); padding: var(--s-3); border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--surface); font-size: 13px; }
.play-choice span { overflow-wrap: anywhere; color: var(--text-2); }
.play-choice span:nth-child(2) { grid-column: 1; }
.play-choice span:last-child { grid-column: 2; grid-row: 1/3; align-self: center; }
</style>
