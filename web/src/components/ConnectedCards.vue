<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useSession } from "@/lib/session";
import { fetchMyCards, type MyCard, type MyCardPage } from "@/lib/api";
import { accountToken, connectAccount, needsReauthorization } from "@/lib/connections";
import { useRoute } from "vue-router";
import { connectionMessage, platformPath } from "@/lib/distribution";
import { can, providerName, type ProviderId } from "@/lib/provider";
import { useLocalePath } from "@/lib/use-locale";
const session = useSession();
const quota=ref<MyCardPage["quota"]|null>(null);
const { lp } = useLocalePath();
const rows = ref<Partial<Record<ProviderId, MyCard[]>>>({});
const pages = ref<Partial<Record<ProviderId, number>>>({});
const more = ref<Partial<Record<ProviderId, boolean>>>({});
const busy = ref<Partial<Record<ProviderId, boolean>>>({});
const errors = ref<Partial<Record<ProviderId, string>>>({});
const reauth = ref<Partial<Record<ProviderId, boolean>>>({});
const route = useRoute();
// 授權掉了就在原地重新授權，授權完回到這一頁。
async function reconnect(provider: ProviderId) {
  try { await connectAccount(provider, route.fullPath); } catch (e) { errors.value[provider] = connectionMessage(e); }
}
const providers = computed(
  () => session.profile?.identities.map((i) => i.provider as ProviderId) ?? []
);
const cards = computed(() => {
  const unique = new Map<string, MyCard>();
  for (const provider of providers.value)
    for (const card of rows.value[provider] ?? []) {
      const key = card.workId ?? `${provider}:${card.roleId}`;
      if (!unique.has(key) || card.sourceProvider === provider)
        unique.set(key, { ...card, provider });
    }
  return [...unique.values()];
});
async function load(provider: ProviderId, append = false) {
  if (busy.value[provider]) return;
  busy.value[provider] = true;
  errors.value[provider] = "";
  reauth.value[provider] = false;
  try {
    const token = await accountToken(
      provider,
      session.profile?.identities.find((i) => i.provider === provider)
        ?.externalId
    );
    if (!token) throw new Error("connection_source_expired");
    const page = append ? (pages.value[provider] ?? 0) + 1 : 1;
    const result = await fetchMyCards(token, { provider, page, fresh: true });
    quota.value=result.quota;
    rows.value[provider] = append
      ? [...(rows.value[provider] ?? []), ...result.items]
      : result.items;
    pages.value[provider] = page;
    more.value[provider] = result.hasNext;
  } catch (e) {
    errors.value[provider] = connectionMessage(e);
    reauth.value[provider] = needsReauthorization(e);
  } finally {
    busy.value[provider] = false;
  }
}
watch(
  () => providers.value.join(","),
  () => {
    for (const p of providers.value) void load(p);
  },
  { immediate: true }
);
</script>
<template>
  <section>
    <p v-if="quota" role="status">{{ $t("services.quota",{used:quota.used,limit:quota.limit}) }}</p>
    <p class="subtle">{{ $t("linked.mineHint") }}</p>
    <div class="services">
      <div v-for="p in providers" :key="p" class="service panel">
        <strong>{{ providerName(p) }}</strong>
        <a class="btn btn--sm" :href="platformPath(lp('/mine?single=1'), p)">{{
          $t("linked.manage")
        }}</a>
        <span v-if="busy[p]" role="status">{{ $t("linked.loading") }}</span>
        <p v-if="errors[p]" role="alert">
          {{ errors[p] }}
        </p>
        <button v-if="errors[p] && reauth[p]" class="btn btn--sm btn--primary" @click="reconnect(p)">
          {{ $t("me.reauthorize") }}
        </button>
        <button v-else-if="errors[p]" class="btn btn--sm" @click="load(p)">
          {{ $t("linked.retry") }}
        </button>
      </div>
    </div>
    <div class="works">
      <article
        v-for="card in cards"
        :key="card.workId ?? `${card.provider}:${card.roleId}`"
        class="panel work"
      >
        <img
          v-if="card.avatarUrl"
          :src="card.avatarUrl"
          alt=""
          loading="lazy"
        />
        <h2>{{ card.name }}</h2>
        <p>{{ card.summary }}</p>
        <a
          class="btn btn--sm"
          :href="platformPath(lp(can('editor',card.provider) ? `/cards/${card.num ?? card.detailId}/edit` : '/mine?single=1'),(card.sourceProvider ?? card.provider)!)"
          >{{
            $t("linked.manageOn", { provider: providerName(card.provider!) })
          }}</a
        >
      </article>
    </div>
    <p
      v-if="
        !cards.length &&
        !Object.values(busy).some(Boolean) &&
        !Object.values(errors).some(Boolean)
      "
      class="subtle"
    >
      {{ $t("linked.empty") }}
    </p>
    <div class="services">
      <button
        v-for="p in providers.filter((p) => more[p])"
        :key="p"
        class="btn"
        :disabled="busy[p]"
        @click="load(p, true)"
      >
        {{ $t("linked.more", { provider: providerName(p) }) }}
      </button>
    </div>
  </section>
</template>
<style scoped>
.services {
  display: flex;
  gap: var(--s-3);
  flex-wrap: wrap;
  margin: var(--s-4) 0;
}
.service {
  padding: var(--s-3);
  display: flex;
  gap: var(--s-3);
  align-items: center;
  flex-wrap: wrap;
}
.service p {
  flex-basis: 100%;
}
.works {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr));
  gap: var(--s-4);
}
.work {
  padding: var(--s-4);
  min-width: 0;
}
.work > img {
  width: 64px;
  height: 64px;
  object-fit: cover;
  border-radius: var(--r-sm);
}
.work > p {
  overflow-wrap: anywhere;
  font-size: 14px;
}
.work h2 {
  font-size: 19px;
}
</style>
