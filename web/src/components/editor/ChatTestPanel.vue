<script setup lang="ts">
/**
 * 對話測試：在編輯器旁邊真的跟這張卡聊。
 *
 * 為什麼是 iframe 而不是把舞台元件掛進來：舞台是 `.canvas-root { position: fixed; inset: 0 }`，
 * 按設計就要吃掉整個視口；卡片自己的 CSS 又常把 `position: fixed` 面板與 HUD 掛到 body 上。
 * 掛進側欄的話那些東西會蓋住編輯器。iframe 給它自己的 document，這些全部關在裡面。
 *
 * 為什麼不用試玩卡（PUT /open/v1/trial-cards）：那套是給 playground 的匿名情境建的——
 * 沒有卡、沒登入，只有一份本地檔案。這裡卡已經存過、有 roleId，它本身就是一張真卡，
 * 直接玩它就是真 AI、真世界書、真正則，也就沒有試玩位與到期那些事。
 *
 * 測的是「已經存下去的那一版」。畫面上還沒存的修改不會出現在對話裡——這件事要說出來，
 * 不然作者會改一句、測一輪，然後不明白為什麼沒變。
 */
import { computed, ref, watch } from "vue";
import { useLocalePath } from "@/lib/use-locale";

const props = defineProps<{
  /** 沒存過的新卡是空字串：那時候還沒有卡可以玩。 */
  roleId: string;
  /** 畫面上有沒有還沒存的修改。 */
  dirty: boolean;
  saving: boolean;
}>();

const emit = defineEmits<{ save: [] }>();

const { lp } = useLocalePath();

/** 換這個值就重載 iframe：存完之後要讓對話重新拿一次卡。 */
const nonce = ref(0);
const src = computed(() => (props.roleId ? lp(`/play/${props.roleId}`) : ""));

/** 存完（dirty 由真轉假且有卡）自動重載一次，省得作者存完還要自己按一下。 */
watch(
  () => props.dirty,
  (now, before) => {
    if (before && !now && props.roleId) nonce.value += 1;
  },
);
</script>

<template>
  <div class="ct">
    <!-- 還沒存過：沒有卡就沒有東西可以聊。欄位也還沒經過伺服器的檢查。 -->
    <div v-if="!roleId" class="ct__state">
      <p class="subtle">{{ $t("editor.test.needSave") }}</p>
      <button type="button" class="btn btn--sm btn--primary" :disabled="saving" @click="emit('save')">
        {{ $t("editor.test.saveFirst") }}
      </button>
    </div>

    <template v-else>
      <div v-if="dirty" class="ct__notice">
        <span class="subtle">{{ $t("editor.test.stale") }}</span>
        <button type="button" class="btn btn--sm" :disabled="saving" @click="emit('save')">
          {{ $t("editor.test.saveAndReload") }}
        </button>
      </div>
      <div class="ct__acts">
        <button type="button" class="btn btn--sm btn--ghost" @click="nonce += 1">{{ $t("editor.test.reload") }}</button>
        <a class="btn btn--sm btn--ghost" :href="src" target="_blank" rel="noopener">{{ $t("editor.test.newTab") }}</a>
      </div>
      <div class="ct__stage">
        <!-- key 換掉才會真的重載：只改 src 上的查詢字串，某些瀏覽器不重跑整個文件 -->
        <iframe :key="nonce" class="ct__frame" :src="src" :title="$t('editor.test.title')"
                allow="clipboard-write" />
      </div>
    </template>
  </div>
</template>

<style scoped>
/* flex 而不是固定行數的 grid：上面那條提示是 v-if，不脏的時候整個不存在，
   照位置指定的 minmax(0,1fr) 會落到別的孩子身上，該撐滿的那格反而拿到 auto。 */
.ct { display: flex; flex-direction: column; gap: var(--s-2); min-height: 0; }
.ct__state { display: grid; gap: var(--s-3); place-content: center; text-align: center; padding: var(--s-5) var(--s-3); }
.ct__state .subtle { margin: 0; }
.ct__notice {
  flex: none; display: flex; align-items: center; gap: var(--s-2); flex-wrap: wrap;
  padding: var(--s-2) var(--s-3); border-radius: var(--r-sm); background: var(--surface-2);
}
.ct__notice .subtle { flex: 1; min-width: 0; font-size: 12.5px; }
.ct__acts { flex: none; display: flex; gap: var(--s-2); }
/*
   手機比例，不是「剩下多寬就多寬」。
   卡片是照手機畫的——版面、字級、氣泡寬度、作者自己貼的 HUD 都按那個比例算。
   用一個橫的框去測，看到的是一張永遠不會有人看到的版面。9:19.5 是現在常見的
   手機長寬比；高度吃滿面板，寬度由比例反推，置中放。
*/
/* flex 置中而不是 grid：grid 的隱式行由子元素撐，而子元素又靠 height:100% 反查行高——
   循環相依之下瀏覽器退回「照寬度乘比例」，框就變成 440×953 撐破面板。 */
.ct__stage {
  flex: 1; min-height: 0; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
}
.ct__frame {
  height: 100%; aspect-ratio: 9 / 19.5; width: auto; max-width: 100%; border: 0;
  border-radius: var(--r-lg); background: var(--surface-2);
  box-shadow: 0 0 0 1px var(--line), var(--shadow-sm);
}
/* 面板太矮時倒過來：寬度吃滿、高度由比例決定，寧可讓外層捲也不要壓扁比例 */
@media (max-height: 720px) {
  .ct__stage { align-items: start; overflow-y: auto; }
  .ct__frame { height: auto; width: min(100%, 300px); }
}
</style>
