<script setup lang="ts">
/**
 * 設定 › 外觀與語言：外觀（深淺色、主題）、語言、蘇綺。
 * 外觀與語言跟頁首的彈層共用同一份狀態（AppearanceControls、localeSwitchTarget），在這裡改了頁首立刻跟著變；
 * 頁首那兩個入口沒登入也要能用，所以兩邊都在（ui.md §6）。
 * 「此裝置」只標真的只存在這個瀏覽器的設定：外觀與「顯示蘇綺」。語言放在網址上、召回存在帳號，都不標。
 */
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import AppearanceControls from "@/components/AppearanceControls.vue";
import { LOCALES } from "@/lib/i18n";
import { localeSwitchTarget } from "@/lib/locale-switch";
import { communityRequest } from "@/lib/community";
import { useSession } from "@/lib/session";
import { track } from "@/lib/track";
import { petEnabled } from "@/pet/enabled";
import { localeOf } from "@/router";

const route = useRoute();
const router = useRouter();
const session = useSession();

function switchLocale(code: string) {
  if (code === localeOf(route)) return;
  track("locale_switch", { subject: code });
  void router.push(localeSwitchTarget(route, code));
}

/** 蘇綺的召回：存在帳號裡，預設關閉（設定集「一個角色，三個存在」）；讀不到就不畫這一列 */
const recall = ref<boolean | null>(null);
const recallBusy = ref(false);
onMounted(async () => {
  const token = await session.accessToken().catch(() => null);
  if (!token) return;
  const got = await communityRequest<{ recall: boolean }>("/me/suki", token).catch(() => null);
  recall.value = got ? got.recall : null;
});
async function setRecall(on: boolean) {
  const token = await session.accessToken().catch(() => null);
  if (!token) return;
  recallBusy.value = true;
  const got = await communityRequest<{ recall: boolean }>("/me/suki", token, "PATCH", { recall: on }).catch(() => null);
  if (got) recall.value = got.recall;
  recallBusy.value = false;
}
</script>

<template>
  <section class="panel set-card">
    <AppearanceControls roomy>
      <template #badge><span class="set-chip">{{ $t("settings.thisDevice") }}</span></template>
    </AppearanceControls>
  </section>

  <section class="panel set-card">
    <p id="settings-lang" class="eyebrow set-card__head">{{ $t("nav.language") }}</p>
    <!-- 語言名用它自己的語言寫，不翻譯：各語言的使用者都認得自己的 -->
    <div class="langs" role="radiogroup" aria-labelledby="settings-lang">
      <button
        v-for="l in LOCALES"
        :key="l.code"
        type="button"
        class="langs__item"
        :lang="l.code"
        role="radio"
        :aria-checked="l.code === localeOf(route)"
        :data-settings-locale="l.code"
        @click="switchLocale(l.code)"
      >
        <span>{{ l.label }}</span>
        <svg v-if="l.code === localeOf(route)" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" /></svg>
      </button>
    </div>
  </section>

  <section class="panel set-card">
    <p class="eyebrow set-card__head">{{ $t("mascot.name") }}</p>
    <label class="content__row">
      <span class="content__text">
        <strong class="pet__label">{{ $t("settings.pet.label") }}<span class="set-chip">{{ $t("settings.thisDevice") }}</span></strong>
        <span class="subtle">{{ $t("settings.pet.desc") }}</span>
      </span>
      <input v-model="petEnabled" type="checkbox" class="content__switch" />
    </label>
    <template v-if="recall !== null">
      <hr class="content__rule" />
      <label class="content__row">
        <span class="content__text">
          <strong>{{ $t("settings.pet.recall") }}</strong>
          <span class="subtle">{{ $t("settings.pet.recallDesc") }}</span>
        </span>
        <input type="checkbox" class="content__switch" :checked="recall" :disabled="recallBusy" @change="setRecall(($event.target as HTMLInputElement).checked)" />
      </label>
    </template>
  </section>
</template>

<style scoped>
.langs { display: grid; }
.langs__item {
  display: flex; align-items: center; justify-content: space-between; gap: var(--s-3);
  min-height: var(--h-lg); padding: 0 var(--s-2);
  background: none; border: 0; border-radius: var(--r-sm);
  font: inherit; font-size: 14px; color: var(--text); text-align: start; cursor: pointer;
}
.langs__item:hover { background: var(--surface-2); }
.langs__item[aria-checked="true"] { font-weight: 600; }
.langs__item svg { width: 16px; height: 16px; flex: none; fill: none; stroke: var(--accent-text); stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.pet__label { display: flex; align-items: center; flex-wrap: wrap; gap: var(--s-2); }
</style>
