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
const broken = ref(false);
watch(() => props.card.avatarUrl, () => { broken.value = false; });
const hasArt = computed(() => !!props.card.avatarUrl && !broken.value);
</script>

<template>
  <article class="card rise">
    <!-- 封面連到卡片頁：編輯有自己的鍵在下面（作者回報 2026-09-16：點自己的卡跳進編輯頁） -->
    <a :href="platformPath(lp(`/cards/${sourceId}`),source)" class="card__art">
      <img v-if="hasArt" :src="card.avatarUrl!" alt="" loading="lazy" @error="broken = true" />
      <div
        v-else
        class="card__void"
        :style="{ background: `linear-gradient(160deg, hsl(${hue} 45% 78%), hsl(${(hue + 40) % 360} 40% 62%))` }"
      >
        <span>{{ initial }}</span>
      </div>
      <!-- 在榜上是這頁最重要的一個位元，標在圖上；還沒過審、被駁回、要重審的也在這裡說 -->
      <span v-if="card.registered && (!card.status || card.status === 'approved')" class="card__badge">{{ $t("mine.badge.listed") }}</span>
      <span v-else-if="card.registered && card.status" class="card__badge card__badge--muted">{{ $t(`mine.badge.${card.status}`) }}</span>
      <span v-if="!card.registered" class="card__badge card__badge--muted">{{ $t(card.sourceAvailable===false ? "workspace.unknown" : "workspace.draft") }}</span>
      <span v-if="card.registered && card.nsfw" class="card__badge card__badge--nsfw">{{ $t("card.nsfw") }}</span>
    </a>

    <div class="card__body">
      <h3 class="card__name">{{ card.name }}</h3>
      <p class="card__hook">{{ card.summary || $t("card.noSummary") }}</p>
      <p class="card__meta">{{ zoneLabel(card.zone) }} · {{ $t("card.talkCount", { n: compact(card.talkNum) }) }}</p>
      <p v-if="card.updateStatus==='pending'" class="card__note">{{ $t("workspace.updatePending") }}</p>
      <p v-if="card.updateStatus==='rejected'" class="card__note">{{ $t("workspace.updateRejected") }}</p>
      <p v-if="card.updateStatus==='superseded'" class="card__note">{{ $t("workspace.reviewSaveRetry") }}</p>
      <p v-if="(card.status === 'rejected' || card.updateStatus==='rejected') && card.note" class="card__note">{{ $t("mine.note.rejected", { note: card.note }) }}</p>
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
  display: flex; flex-direction: column; min-width: 0;
  background: var(--surface);
  border-radius: var(--r-md);
  box-shadow: 0 0 0 1px var(--line), var(--shadow-sm);
  overflow: hidden;
  transition: box-shadow var(--dur) var(--ease), transform var(--dur) var(--ease);
}
.card:hover { box-shadow: 0 0 0 1px var(--line-strong), var(--shadow-md); }
.card__art { position: relative; display: block; aspect-ratio: 2 / 1; max-height: 160px; background: var(--surface-2); overflow: hidden; }
.card__art img { width: 100%; height: 100%; object-fit: cover; transition: transform var(--dur-slow) var(--ease); }

.card__art::after { content: ""; position: absolute; inset: 0; box-shadow: inset 0 0 0 1px rgba(16, 16, 24, 0.05); pointer-events: none; }
/* 圖上壓一層漸暗，只在 hover 出現——動作按鈕在下面，這只是告訴人圖也能點 */
.card__art::before {
  content: ""; position: absolute; inset: 0; z-index: 1;
  background: linear-gradient(to top, rgba(16, 16, 24, 0.35), transparent 40%);
  opacity: 0; transition: opacity var(--dur) var(--ease);
}
.card:hover .card__art::before { opacity: 1; }
.card__void { display: grid; place-items: center; width: 100%; height: 100%; }
.card__void span { font-size: 28px; font-weight: 500; color: rgba(255, 255, 255, 0.7); }

.card__badge {
  position: absolute; top: 8px; left: 8px; z-index: 2;
  height: 22px; padding: 0 8px; display: inline-flex; align-items: center;
  border-radius: var(--r-pill);
  background: var(--accent); color: var(--on-accent);
  font-size: 11.5px; font-weight: 600;
}
/* 還沒上榜的狀態用灰底：跟「在榜上」一眼分得開 */
.card__badge--muted { background: rgba(16, 16, 24, 0.7); color: #fff; }
.card__note { font-size: 12px; color: var(--danger); line-height: 1.5; }

.card__body { display: grid; gap: var(--s-2); padding: var(--s-3); }
.card__name { font-size: 16px; font-weight: 600; line-height: 1.35; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card__hook {
  font-size: 13px; line-height: 1.5; color: var(--text-2);
  display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  min-height: calc(13px * 1.5 * 2);
}
.card__meta { font-size: 12px; color: var(--text-3); font-variant-numeric: tabular-nums; }
/* 工作區保留三個常用操作；長翻譯可換行，觸控高度不縮小。 */
.card__actions { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.5fr); gap: var(--s-2); margin-top: var(--s-2); }
.card__actions > .btn { min-height:44px; height:auto; white-space:normal; min-width: 0; padding-left: var(--s-2); padding-right: var(--s-2); overflow-wrap:anywhere; }
.card__actions > .btn:nth-child(4) { grid-column: 1 / -1; }
.card__withdraw{color:var(--text-3);border-color:transparent;background:transparent;}
.card__body :deep(.copy-summary) { margin-top: 0; padding-top: var(--s-2); gap: var(--s-2); }
.card__body :deep(.copy-summary + .distribution) { padding-top: 0; }
.play-choices{display:grid;gap:var(--s-2);padding:var(--s-3);background:var(--surface-2);border-radius:var(--r-sm);margin-top:var(--s-2)}
.play-choices h4{font-size:14px}.play-choices p{font-size:12px;line-height:1.6}
.play-choice{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px var(--s-2);padding:var(--s-3);border:1px solid var(--line);border-radius:var(--r-sm);background:var(--surface);font-size:13px}
.play-choice span{overflow-wrap:anywhere;color:var(--text-2)}.play-choice span:nth-child(2){grid-column:1}.play-choice span:last-child{grid-column:2;grid-row:1/3;align-self:center}
</style>
