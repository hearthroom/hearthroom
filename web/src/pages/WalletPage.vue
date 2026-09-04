<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { fetchScoreRecords, TOP_UP_URL, type ScoreRecordPage } from "@/lib/api";
import { dateOnly, dateTime, whole } from "@/lib/format";
import { pageTitle } from "@/lib/i18n";
import { useSession } from "@/lib/session";

const session = useSession();
const route = useRoute();
const router = useRouter();
const { t } = useI18n();

const records = ref<ScoreRecordPage | null>(null);
const loading = ref(true);
const error = ref("");
const page = computed(() => Math.max(1, Number(route.query.page ?? 1) || 1));

const PLAN_LABEL: Record<string, string> = { unlimited: "wallet.plan.unlimited", member: "wallet.plan.member", trial: "wallet.plan.trial" };

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    records.value = await fetchScoreRecords(token, page.value);
  } catch (err) {
    error.value = err instanceof Error ? err.message : t("state.loadFailed");
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  document.title = pageTitle(t("wallet.title"));
  // 從充值頁回來時餘額要是新的
  session.refreshWallet();
});
watch(page, load, { immediate: true });
// 分頁在別的分頁充值後切回來：視窗重新取得焦點就更新餘額
onMounted(() => window.addEventListener("focus", () => session.refreshWallet()));
</script>

<template>
  <div class="page page--narrow">
    <h1 class="display title">{{ $t("wallet.title") }}</h1>

    <section class="panel wallet">
      <div class="wallet__balance">
        <p class="eyebrow">{{ $t("wallet.balance") }}</p>
        <p class="wallet__num">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5l1.9 4.1 4.5.5-3.3 3.1.9 4.4L8 11.4l-3.9 2.2.9-4.4L1.6 6.1l4.5-.5z" /></svg>
          <span v-if="session.wallet">{{ whole(session.wallet.score + session.wallet.tempScore) }}</span>
          <span v-else class="ghost wallet__ghost" />
        </p>
        <p v-if="session.wallet?.tempScore" class="subtle">{{ $t("wallet.temp", { n: whole(session.wallet.tempScore) }) }}</p>
      </div>
      <a class="btn btn--primary" :href="TOP_UP_URL" target="_blank" rel="noopener">{{ $t("wallet.topUp") }} ↗</a>
    </section>

    <section class="panel plans">
      <p class="eyebrow">{{ $t("wallet.plan") }}</p>
      <ul v-if="session.wallet?.plans.length" class="plans__list">
        <li v-for="plan in session.wallet.plans" :key="plan.tier" class="plan">
          <span class="plan__tier" :class="`plan__tier--${plan.tier}`">{{ $t(PLAN_LABEL[plan.tier] ?? "wallet.plan") }}</span>
          <span class="subtle">{{ $t("wallet.plan.expires", { date: dateOnly(plan.expiresAt) }) }}</span>
        </li>
      </ul>
      <p v-else class="muted plans__none">{{ $t("wallet.plan.none") }}</p>
    </section>

    <section class="panel history">
      <h2 class="history__title">{{ $t("wallet.records") }}</h2>
      <p v-if="error" class="notice notice--error">{{ error }}</p>
      <div v-else-if="loading" class="history__ghosts"><div v-for="i in 6" :key="i" class="ghost" /></div>
      <p v-else-if="!records?.records.length" class="muted history__empty">{{ $t("wallet.records.empty") }}</p>
      <table v-else class="ledger">
        <thead>
          <tr>
            <th>{{ $t("wallet.records.item") }}</th>
            <th>{{ $t("wallet.records.time") }}</th>
            <th class="ledger__num">{{ $t("wallet.records.change") }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in records.records" :key="r.id">
            <td class="ledger__item">{{ r.record }}</td>
            <td class="ledger__time">{{ dateTime(r.createTime) }}</td>
            <td class="ledger__num" :class="r.recordType === 'add' ? 'ledger__num--add' : 'ledger__num--sub'">
              {{ r.recordType === "add" ? "+" : "−" }}{{ whole(r.score) }}
            </td>
          </tr>
        </tbody>
      </table>

      <nav v-if="records && (page > 1 || records.hasNextPage)" class="pager">
        <button class="btn btn--sm" :disabled="page === 1" @click="router.push({ query: { page: String(page - 1) } })">← {{ $t("pager.prev") }}</button>
        <span class="subtle">{{ $t("pager.pageOf", { n: page, total: records.pages }) }}</span>
        <button class="btn btn--sm" :disabled="!records.hasNextPage" @click="router.push({ query: { page: String(page + 1) } })">{{ $t("pager.next") }} →</button>
      </nav>
    </section>
  </div>
</template>

<style scoped>
.title { font-size: 22px; margin-bottom: var(--s-4); }
.panel + .panel { margin-top: var(--s-4); }

.wallet { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-4); padding: var(--s-5); }
.wallet__num { display: inline-flex; align-items: center; gap: 8px; margin: 4px 0 2px; font-size: 34px; font-weight: 700; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; line-height: 1.1; }
.wallet__num svg { width: 22px; height: 22px; fill: var(--gold); }
.wallet__ghost { display: inline-block; width: 120px; height: 34px; }

.plans { padding: var(--s-4) var(--s-5); }
.plans__list { list-style: none; margin: var(--s-2) 0 0; padding: 0; display: grid; gap: var(--s-2); }
.plan { display: flex; align-items: center; gap: var(--s-3); }
.plan__tier { padding: 2px 9px; border-radius: 6px; font-size: 12.5px; font-weight: 600; background: var(--surface-2); }
.plan__tier--unlimited { background: var(--accent-soft); color: var(--accent); }
.plan__tier--member { background: #fff4d6; color: #8a5a00; }
.plans__none { margin-top: 4px; font-size: 13.5px; }

.history { padding: var(--s-4) var(--s-5) var(--s-5); }
.history__title { font-size: 15px; font-weight: 600; margin-bottom: var(--s-3); }
.history__ghosts { display: grid; gap: 10px; }
.history__ghosts .ghost { height: 36px; }
.history__empty { font-size: 13.5px; padding: var(--s-5) 0; text-align: center; }

.ledger { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.ledger th { text-align: left; font-weight: 500; font-size: 12px; color: var(--text-3); padding: 0 0 8px; }
.ledger td { padding: 10px 0; box-shadow: 0 -1px 0 var(--line); vertical-align: top; }
.ledger__item { padding-right: var(--s-4); }
.ledger__time { white-space: nowrap; color: var(--text-3); font-size: 12.5px; padding-right: var(--s-4); }
.ledger__num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; font-weight: 600; }
.ledger__num--add { color: #1f9d55; }
.ledger__num--sub { color: var(--text-2); }

@media (max-width: 560px) {
  .ledger__time { display: none; }
}
</style>
