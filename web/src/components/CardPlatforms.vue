<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { fetchCardPlatforms, type CardPlatform } from "@/lib/api";
import {
  accountToken,
  connectedBalance,
  connectAccount,
} from "@/lib/connections";
import { connectionMessage, platformPath } from "@/lib/distribution";
import { providerName, type ProviderId } from "@/lib/provider";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";
const props = defineProps<{
  cardId: string;
  provider?: string;
  cardNumber?: number | null;
  /** 卡片頁一進來就先發出去的查詢：不必等卡片畫完才開始找可遊玩的平台。查的是這張卡才用 */
  pending?: { id: string; request: Promise<CardPlatform[]> } | null;
}>();
const session = useSession();
const { lp } = useLocalePath();
const platforms = ref<
  { provider: ProviderId; roleId: string; playable: boolean }[]
>([]);
const selected = ref<ProviderId | null>(null);
const balances = ref<Partial<Record<ProviderId, number | null>>>({});
const error = ref("");
const loading = ref(true);
const busy = ref(false);
const choice = computed(() =>
  platforms.value.find((p) => p.provider === selected.value && p.playable)
);
const linked = (p: ProviderId) =>
  session.profile?.identities.find((i) => i.provider === p);
let generation = 0;
let prefetched =
  props.pending &&
  (props.pending.id === props.cardId || props.pending.id === String(props.cardNumber ?? ""))
    ? props.pending.request
    : null;
async function load() {
  const request = ++generation;
  loading.value = true;
  error.value = "";
  platforms.value = [];
  selected.value = null;
  try {
    const early = prefetched;
    prefetched = null;
    // 預先發的那一趟可能早於身分載好（成人卡會被擋）：失敗就照常再查一次
    const result = early
      ? await early.catch(() => fetchCardPlatforms(props.cardId))
      : await fetchCardPlatforms(props.cardId);
    if (request !== generation) return;
    platforms.value = result;
  } catch {
    if (request === generation) error.value = "linked.platformLoadFailed";
  } finally {
    if (request === generation) loading.value = false;
  }
}
watch(() => props.cardId, load, { immediate: true });
watch(
  () => [platforms.value, session.profile],
  async () => {
    for (const p of platforms.value) {
      const identity = linked(p.provider);
      if (identity && p.playable)
        balances.value[p.provider] = await connectedBalance(
          p.provider,
          identity.externalId
        );
    }
  },
  { immediate: true }
);
async function play() {
  if (!choice.value || busy.value) return;
  busy.value = true;
  const destination = platformPath(
    lp(`/play/${props.cardId}`),
    choice.value.provider
  );
  try {
    if (
      session.me &&
      (!linked(choice.value.provider) ||
        !(await accountToken(
          choice.value.provider,
          linked(choice.value.provider)?.externalId
        )))
    )
      await connectAccount(choice.value.provider, destination);
    else location.assign(destination);
  } catch (e) {
    error.value = connectionMessage(e);
    busy.value = false;
  }
}
</script>
<template>
  <div class="platforms">
    <p v-if="loading" role="status" class="subtle">
      {{ $t("linked.loading") }}
    </p>
    <p v-if="error" role="alert">
      {{ $te(error) ? $t(error) : error }}
      <button class="btn btn--sm" @click="load">
        {{ $t("linked.retry") }}
      </button>
    </p>
    <fieldset v-if="platforms.length">
      <legend>{{ $t("linked.playWith") }}</legend>
      <label v-for="p in platforms" :key="p.provider" class="platform">
        <input
          v-model="selected"
          type="radio"
          name="play-provider"
          :value="p.provider"
          :disabled="!p.playable"
        />
        <strong>{{ providerName(p.provider) }}</strong>
        <span class="subtle">{{
          !p.playable
            ? $t("linked.storedOnly")
            : linked(p.provider)
            ? balances[p.provider] == null
              ? $t("linked.balanceUnknown")
              : $t("linked.balance", { amount: balances[p.provider] })
            : $t("linked.notConnected")
        }}</span>
      </label>
    </fieldset>
    <p v-else-if="!loading && !error" class="subtle">
      {{ $t("linked.noPlayable") }}
    </p>
    <p v-if="choice" class="subtle note">{{ $t("linked.playHint") }}</p>
    <button
      v-if="choice"
      class="btn btn--primary btn--lg"
      :disabled="busy"
      @click="play"
    >
      {{
        session.me && !linked(choice.provider)
          ? $t("linked.connectPlay")
          : $t("card.play")
      }}
    </button>
  </div>
</template>
<style scoped>
.platforms {
  width: 100%;
  display: grid;
  gap: var(--s-3);
}
fieldset {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}
legend {
  font-weight: 600;
  margin-bottom: var(--s-2);
}
.platform {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  flex-wrap: wrap;
  padding: var(--s-2) 0;
  min-height: 44px;
  cursor: pointer;
}
.platform span {
  margin-left: auto;
  font-size: 12px;
}
.note {
  font-size: 12px;
  line-height: 1.5;
  margin: 0;
}
</style>
