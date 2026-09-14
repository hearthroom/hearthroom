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

/* 重載與「開新分頁」的鈕在編輯器的分頁列上，跟分頁籤同一排：面板高度全歸手機框，
   多一排工具列就少一排對話。 */
defineExpose({ reload: () => { nonce.value += 1; } });
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
      <div class="ct__stage">
        <!-- key 換掉才會真的重載：只改 src 上的查詢字串，某些瀏覽器不重跑整個文件 -->
        <iframe :key="nonce" class="ct__frame" :src="src" :title="$t('editor.test.title')"
                allow="clipboard-write" />
      </div>
    </template>
  </div>
</template>

<style scoped>
/*
   框把面板填滿：寬度跟著右欄走、高度吃到面板底。
   右欄的預設寬度（見編輯頁 --rail-w）是照手機比例由視窗高反推的，所以不拖的時候
   看到的仍是一張手機版面；把把手往左拉，框就跟著變寬，用來看卡在平板／寬版下的樣子。
   以前是「高度吃滿、寬度由 9:19.5 反推」，拖寬右欄時框不動，只在旁邊多出空白。
*/
.ct__stage {
  flex: 1; min-height: 0; overflow: hidden;
  display: flex; align-items: stretch; justify-content: center;
}
/* 高度靠 flex 的 stretch 拿，不寫 height:100%：iframe 的百分比高度在這條
   grid→flex→flex 的鏈上會解成 auto 而縮回 150px 的預設高；stretch 用的是
   排完版的實際高，不經過百分比。 */
.ct__frame {
  width: 100%; height: auto; min-height: 0; align-self: stretch; border: 0;
  border-radius: var(--r-lg); background: var(--surface-2);
  box-shadow: 0 0 0 1px var(--line), var(--shadow-sm);
}
/* 面板太矮時給框一個底線高度，寧可讓外層捲也不要把對話壓扁 */
@media (max-height: 720px) {
  .ct__stage { overflow-y: auto; }
  .ct__frame { min-height: 480px; }
}
</style>
