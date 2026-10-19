<script setup lang="ts">
/**
 * 蘇綺捧著寶箱：乾淨底圖＋三層寶箱（箱身、箱內、蓋）＋手指層。簽到頁 Hero 與開箱舞台共用。
 * 放在白天捧箱比例的方框裡；夜版的箱子位置不同，整疊照技術美術量的外框變形（lib/checkin-art）。
 * 開蓋由舞台直接改 stack／lid 的 transform（每一幀，不經 Vue）。
 */
import { computed, ref } from "vue";
import { boxLayer, CARRY_RATIO, fingersUrl, nightBoxTransform, poseUrl, type BoxKind } from "@/lib/checkin-art";
import { isNight } from "@/lib/mascot-home";

const props = defineProps<{ kind: BoxKind; now?: number }>();
const night = computed(() => isNight(new Date(props.now ?? Date.now())));
const date = computed(() => new Date(props.now ?? Date.now()));
const box = ref<HTMLElement | null>(null);
const lid = ref<HTMLElement | null>(null);
defineExpose({ box, lid });
</script>

<template>
  <span class="carry" :style="{ aspectRatio: String(CARRY_RATIO) }" aria-hidden="true">
    <img class="carry__pose" :src="poseUrl('carry', date)" alt="" draggable="false" />
    <span class="carry__stack" :style="night ? { transform: nightBoxTransform() } : undefined">
      <span ref="box" class="carry__box">
        <img :src="boxLayer(kind, 'body')" alt="" draggable="false" />
        <img :src="boxLayer(kind, 'interior')" alt="" draggable="false" />
        <img ref="lid" class="carry__lid" :src="boxLayer(kind, 'lid')" alt="" draggable="false" />
      </span>
    </span>
    <img class="carry__fingers" :src="fingersUrl(date)" alt="" draggable="false" />
  </span>
</template>

<style scoped>
.carry { position:relative; display:block; height:100%; pointer-events:none; user-select:none; }
.carry__pose, .carry__fingers { position:absolute; left:50%; top:0; height:100%; width:auto; transform:translateX(-50%); }
.carry__stack { position:absolute; inset:0; transform-origin:0 0; }
/* 開蓋時整疊繞箱底中心抖（白天箱底中心約在 46%／74%） */
.carry__box { position:absolute; inset:0; transform-origin:46% 74%; will-change:transform; }
.carry__box img { position:absolute; inset:0; width:100%; height:100%; }
.carry__lid { will-change:transform, opacity; transform-origin:46% 48%; }
.carry__fingers { z-index:1; }
</style>
