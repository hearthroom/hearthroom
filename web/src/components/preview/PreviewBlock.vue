<script setup lang="ts">
import { ref } from "vue";
import PreviewInline from "./PreviewInline.vue";
import { monogramLetter, type Block } from "@/lib/preview-doc";

defineProps<{ node: Block }>();
const open = ref(false);
const broken = ref<Record<string, boolean>>({});
</script>

<template>
  <h2 v-if="node.kind === 'heading' && node.level === 2" class="pv-h pv-h2" :class="`pv-art-${node.art}`" :style="{ textAlign: node.align }"><PreviewInline :nodes="node.content" /></h2>
  <h3 v-else-if="node.kind === 'heading'" class="pv-h pv-h3" :class="`pv-art-${node.art}`" :style="{ textAlign: node.align }"><PreviewInline :nodes="node.content" /></h3>

  <p v-else-if="node.kind === 'paragraph'" class="pv-p" :style="{ textAlign: node.align }"><PreviewInline :nodes="node.content" /></p>

  <blockquote v-else-if="node.kind === 'blockquote'" class="pv-quote">
    <PreviewBlock v-for="(b, i) in node.content" :key="i" :node="b" />
  </blockquote>

  <div v-else-if="node.kind === 'panel'" class="pv-panel" :data-tone="node.tone">
    <PreviewBlock v-for="(b, i) in node.content" :key="i" :node="b" />
  </div>

  <ul v-else-if="node.kind === 'bulletList'" class="pv-list">
    <li v-for="(item, i) in node.items" :key="i"><PreviewBlock v-for="(b, j) in item" :key="j" :node="b" /></li>
  </ul>
  <ol v-else-if="node.kind === 'orderedList'" class="pv-list pv-list--ordered">
    <li v-for="(item, i) in node.items" :key="i"><PreviewBlock v-for="(b, j) in item" :key="j" :node="b" /></li>
  </ol>

  <div v-else-if="node.kind === 'dialogueBubble'" class="pv-bubble-row" :data-side="node.side" :style="{ '--pv-hue': node.hue }">
    <span class="pv-monogram">{{ monogramLetter(node.name) }}</span>
    <div class="pv-bubble-body">
      <span v-if="node.name" class="pv-bubble-name">{{ node.name }}</span>
      <div class="pv-bubble"><PreviewInline :nodes="node.content" /></div>
    </div>
  </div>

  <div v-else-if="node.kind === 'statCard'" class="pv-stat">
    <p v-if="node.title" class="pv-stat-title">{{ node.title }}</p>
    <div v-for="(r, i) in node.rows" :key="i" class="pv-stat-row"><span>{{ r.k }}</span><strong>{{ r.v }}</strong></div>
  </div>

  <div v-else-if="node.kind === 'spoiler'" class="pv-spoiler" :class="{ 'is-open': open }">
    <button class="pv-spoiler-head" type="button" :aria-expanded="open" @click="open = !open">
      <span>{{ node.title }}</span><span class="pv-spoiler-chev" aria-hidden="true">⌄</span>
    </button>
    <div v-show="open" class="pv-spoiler-body"><PreviewBlock v-for="(b, i) in node.content" :key="i" :node="b" /></div>
  </div>

  <figure v-else-if="node.kind === 'image'" class="pv-image" :class="`pv-frame-${node.frame}`" :style="{ '--pv-w': node.width + '%' }">
    <span v-if="broken.main" class="pv-broken" aria-hidden="true">✕</span>
    <img v-else :src="node.src" alt="" loading="lazy" @error="broken.main = true" />
  </figure>

  <hr v-else-if="node.kind === 'divider'" class="pv-divider" />

  <div v-else-if="node.kind === 'columns'" class="pv-columns" :style="{ '--pv-cols': node.columns.length }">
    <div v-for="(col, i) in node.columns" :key="i" class="pv-column"><PreviewBlock v-for="(b, j) in col" :key="j" :node="b" /></div>
  </div>

  <div v-else-if="node.kind === 'profileCard'" class="pv-profile" :class="{ 'has-bg': node.bgSrc && !broken.bg }" :style="{ '--pv-hue': node.hue }">
    <img v-if="node.bgSrc && !broken.bg" :src="node.bgSrc" alt="" class="pv-profile-bg" @error="broken.bg = true" />
    <div class="pv-profile-avatar">
      <img v-if="node.avatarSrc && !broken.avatar" :src="node.avatarSrc" alt="" @error="broken.avatar = true" />
      <span v-else class="pv-monogram">{{ monogramLetter(node.name) }}</span>
    </div>
    <div class="pv-profile-text">
      <strong v-if="node.name" class="pv-profile-name">{{ node.name }}</strong>
      <span v-if="node.subtitle" class="pv-profile-sub">{{ node.subtitle }}</span>
      <p v-if="node.desc" class="pv-profile-desc">{{ node.desc }}</p>
      <div v-if="node.tags.length" class="pv-tags"><span v-for="t in node.tags" :key="t" class="pv-tag">{{ t }}</span></div>
    </div>
  </div>

  <div v-else-if="node.kind === 'gallery'" class="pv-gallery" :style="{ '--pv-w': node.width + '%' }">
    <div class="pv-gallery-rail">
      <figure v-for="(it, i) in node.items" :key="i" class="pv-gallery-cell">
        <span v-if="broken[`g${i}`]" class="pv-broken" aria-hidden="true">✕</span>
        <img v-else :src="it.src" alt="" loading="lazy" @error="broken[`g${i}`] = true" />
      </figure>
    </div>
  </div>

  <div v-else-if="node.kind === 'meter'" class="pv-meter" :data-tone="node.tone">
    <div class="pv-meter-head"><span>{{ node.label }}</span><strong>{{ node.value }}</strong></div>
    <div class="pv-meter-track"><div class="pv-meter-fill" :style="{ width: node.value + '%' }" /></div>
  </div>
</template>
