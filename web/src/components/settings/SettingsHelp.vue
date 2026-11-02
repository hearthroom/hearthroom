<script setup lang="ts">
/**
 * 設定 › 疑難排解：出了狀況才找的兩個補救工具（owner 2026-11-03：救援按鈕不放在偏好設定裡）。
 *   - 蘇綺：「叫她出來」清掉存的位置；被關掉的話先開回來（任務 2026-10-23 曲面屏的脫離工具）。
 *     帳號選單原本的「蘇綺選單／叫回蘇綺」併到這裡；沒登入的訪客進不了設定頁，網站選單照舊留著那一項。
 *   - 線路：目前線路與訊號，「查看線路」開線路清單。只在官方網域與 App 裡有線路時才放（跟頁尾、選單同一個條件）；
 *     頁首的訊號圖示與帳號選單的「線路」照舊保留（owner 2026-11-03 明確要求），連線慢時不必先走進設定。
 */
import { computed, inject } from "vue";
import SignalBars from "@/components/routes/SignalBars.vue";
import { currentLine, openRoutesDialog, routesState, signalOf } from "@/lib/routes";
import { siteLinksKey } from "@/lib/site-links";
import { summonPet } from "@/pet/enabled";

const links = inject(siteLinksKey, null);
const line = computed(() => links?.value.routeLine ?? null);
const here = currentLine();
const status = computed(() => (here ? routesState.results[here.n] : undefined));
</script>

<template>
  <section class="panel set-card">
    <p class="eyebrow set-card__head">{{ $t("mascot.name") }}</p>
    <div class="content__row content__row--plain">
      <span class="content__text">
        <strong>{{ $t("settings.pet.summon") }}</strong>
        <span class="subtle content__pretty">{{ $t("settings.pet.summonDesc") }}</span>
      </span>
      <button type="button" class="btn btn--sm content__nowrap" data-settings-summon @click="summonPet">{{ $t("settings.pet.summon") }}</button>
    </div>
  </section>

  <section v-if="line" class="panel set-card" data-settings-routes>
    <p class="eyebrow set-card__head">{{ $t("routes.title") }}</p>
    <div class="content__row content__row--plain">
      <span class="content__text">
        <strong>{{ $t("settings.routes.current") }}</strong>
        <span class="subtle content__pretty">{{ $t("settings.routes.desc") }}</span>
      </span>
      <span class="route__now">
        <SignalBars v-if="status" :level="signalOf(status.state === 'ok' ? status.ms : null)" :checking="status.state === 'checking'" :down="status.state === 'down'" />
        {{ $t(line.name) }}
      </span>
    </div>
    <div class="route__acts">
      <button type="button" class="btn btn--sm" @click="openRoutesDialog()">{{ $t("settings.routes.open") }}</button>
    </div>
  </section>
</template>

<style scoped>
.route__now { display: inline-flex; align-items: center; gap: 6px; flex: none; font-size: 14px; font-weight: 600; white-space: nowrap; }
.route__acts { display: flex; justify-content: flex-end; }
</style>
