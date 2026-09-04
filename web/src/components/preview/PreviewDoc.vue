<script setup lang="ts">
import { computed } from "vue";
import PreviewBlock from "./PreviewBlock.vue";
import { mapDoc, normSkinId, type Doc } from "@/lib/preview-doc";
import "./preview.css";

const props = defineProps<{ doc: unknown; skinId?: string }>();
const emit = defineEmits<{ fallback: [] }>();

/** 文件壞掉就通知外層回落到預設版面，不讓整頁白掉。 */
const tree = computed<Doc | null>(() => {
  try {
    const t = mapDoc(props.doc);
    if (!t.content.length) { emit("fallback"); return null; }
    return t;
  } catch {
    emit("fallback");
    return null;
  }
});
const skin = computed(() => normSkinId(props.skinId) || undefined);
</script>

<template>
  <div v-if="tree" class="pv-doc" :data-skin="skin">
    <PreviewBlock v-for="(b, i) in tree.content" :key="i" :node="b" />
  </div>
</template>
