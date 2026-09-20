<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import type { Resource } from "@/lib/resource-client";
const props = defineProps<{
  item: Resource;
  provider: string;
  previous: boolean;
  next: boolean;
  busy: boolean;
  error: string;
}>();
const emit = defineEmits<{
  close: [];
  move: [direction: number];
  copy: [url: string];
}>();
const box = ref<HTMLElement | null>(null);
const zoom = ref(false);
const broken = ref(false);
const sample = ref("");
const fontReady = ref(false);
const restore = document.activeElement as HTMLElement | null;
const savedOverflow = document.body.style.overflow;
const name = computed(
  () =>
    props.item.fileName ||
    props.item.imageUrl.split("/").pop()?.split("?")[0] ||
    "",
);
let face: FontFace | undefined;
let generation = 0;
async function loadFont() {
  const ticket = ++generation;
  zoom.value = false;
  broken.value = false;
  fontReady.value = false;
  if (face) document.fonts.delete(face);
  if (props.item.kind !== "font" || typeof FontFace === "undefined") return;
  try {
    const f = new FontFace(
      "resource-preview",
      `url(${JSON.stringify(props.item.imageUrl)})`,
    );
    await f.load();
    if (ticket !== generation) return;
    face = f;
    document.fonts.add(f);
    fontReady.value = true;
  } catch {
    broken.value = true;
  }
}
watch(() => props.item.imageUrl, loadFont, { immediate: true });
function key(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.preventDefault();
    emit("close");
  }
  if ((e.target as HTMLElement)?.tagName !== "INPUT") {
    if (e.key === "ArrowLeft" && props.previous) emit("move", -1);
    if (e.key === "ArrowRight" && props.next) emit("move", 1);
  }
  if (e.key === "Tab" && box.value) {
    const nodes = [
      ...box.value.querySelectorAll<HTMLElement>(
        "button:not(:disabled),a,input",
      ),
    ];
    const first = nodes[0],
      last = nodes.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  }
}
let dragging = false,
  startX = 0,
  startY = 0,
  left = 0,
  top = 0;
function drag(e: PointerEvent) {
  if (!zoom.value) return;
  const el = e.currentTarget as HTMLElement;
  dragging = true;
  startX = e.clientX;
  startY = e.clientY;
  left = el.scrollLeft;
  top = el.scrollTop;
  el.setPointerCapture(e.pointerId);
}
function pan(e: PointerEvent) {
  if (!dragging) return;
  const el = e.currentTarget as HTMLElement;
  el.scrollLeft = left - e.clientX + startX;
  el.scrollTop = top - e.clientY + startY;
}
onMounted(async () => {
  document.body.style.overflow = "hidden";
  document.addEventListener("keydown", key);
  await nextTick();
  box.value?.querySelector("button")?.focus();
});
onBeforeUnmount(() => {
  generation++;
  document.body.style.overflow = savedOverflow;
  document.removeEventListener("keydown", key);
  if (face) document.fonts.delete(face);
  restore?.focus();
});
</script>
<template>
  <Teleport to="body"
    ><div class="preview-backdrop" @click.self="emit('close')">
      <section
        ref="box"
        class="preview panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="resource-preview-title"
      >
        <header>
          <div>
            <h2 id="resource-preview-title">{{ name }}</h2>
            <p class="subtle">{{ $t("resource.hosted", { provider }) }}</p>
          </div>
          <button class="btn" @click="emit('close')">
            {{ $t("resource.close") }}
          </button>
        </header>
        <div
          class="preview-stage"
          :class="{ 'preview-stage--zoom': zoom }"
          @pointerdown="drag"
          @pointermove="pan"
          @pointerup="dragging = false"
          @pointercancel="dragging = false"
        >
          <p v-if="broken" role="status">{{ $t("resource.previewFailed") }}</p>
          <img
            v-else-if="item.kind === 'image'"
            :src="item.imageUrl"
            :alt="name"
            :class="{ zoomed: zoom }"
            draggable="false"
            @error="broken = true"
          />
          <video
            v-else-if="item.kind === 'video'"
            :key="item.imageUrl"
            :src="item.imageUrl"
            controls
            playsinline
            preload="metadata"
            @error="broken = true"
          />
          <audio
            v-else-if="item.kind === 'audio'"
            :key="item.imageUrl"
            :src="item.imageUrl"
            controls
            preload="metadata"
            @error="broken = true"
          />
          <p
            v-else-if="item.kind === 'font'"
            class="font-sample"
            :style="fontReady ? { fontFamily: 'resource-preview' } : {}"
          >
            {{ sample || $t("res.fontSample") }}
          </p>
        </div>
        <input
          v-if="item.kind === 'font'"
          v-model="sample"
          class="input"
          :placeholder="$t('resource.sample')"
          :aria-label="$t('resource.sample')"
        />
        <p v-if="error" role="alert" class="notice notice--error">
          {{ error }}
        </p>
        <div class="preview-meta subtle">
          <span>{{ item.mimeType || item.kind }}</span
          ><span v-if="item.pixelWidth"
            >{{ item.pixelWidth }} × {{ item.pixelHeight }}</span
          ><span v-if="item.byteSize !== null"
            >{{ (item.byteSize / 1024).toFixed(1) }} KB</span
          ><time v-if="item.createTime">{{
            new Date(item.createTime).toLocaleString()
          }}</time
          ><span
            v-if="
              item.moderationState === 'pending' ||
              item.moderationState === 'reject'
            "
            >{{
              $t(
                item.moderationState === "pending"
                  ? "res.state.pending"
                  : "res.state.rejected",
              )
            }}</span
          >
        </div>
        <footer>
          <div>
            <button
              class="btn"
              :disabled="!previous || busy"
              @click="emit('move', -1)"
            >
              {{ $t("resource.previousFile") }}</button
            ><button
              class="btn"
              :disabled="!next || busy"
              @click="emit('move', 1)"
            >
              {{ $t("resource.nextFile") }}
            </button>
          </div>
          <div>
            <button
              v-if="item.kind === 'image'"
              class="btn"
              :aria-pressed="zoom"
              @click="zoom = !zoom"
            >
              {{ $t(zoom ? "resource.fit" : "resource.zoom") }}</button
            ><button
              class="btn btn--primary"
              @click="emit('copy', item.imageUrl)"
            >
              {{ $t("res.copy") }}</button
            ><a
              class="btn"
              :href="item.imageUrl"
              target="_blank"
              rel="noopener noreferrer"
              >{{ $t("res.open") }}</a
            >
          </div>
        </footer>
      </section>
    </div></Teleport
  >
</template>
<style scoped>
.preview-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  padding: var(--s-4);
  background: var(--overlay, rgba(20, 20, 28, 0.65));
  backdrop-filter: blur(12px);
}
.preview {
  width: min(1100px, 100%);
  max-height: 95dvh;
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
  padding: var(--s-4);
  overflow: auto;
}
header,
footer,
footer > div,
.preview-meta {
  display: flex;
  gap: var(--s-2);
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
}
header > div {
  min-width: 0;
  flex: 1;
}
h2 {
  font-size: 1rem;
  overflow-wrap: anywhere;
  margin: 0;
}
header p {
  margin: var(--s-1) 0 0;
  font-size: 0.85rem;
}
.preview-stage {
  height: 55dvh;
  min-height: 180px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  background: repeating-conic-gradient(
      var(--surface-2) 0% 25%,
      var(--surface) 0% 50%
    )
    0/24px 24px;
  border-radius: var(--r-sm);
}
.preview-stage img,
.preview-stage video {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.preview-stage--zoom {
  display: block;
  cursor: grab;
  touch-action: none;
}
.preview-stage img.zoomed {
  max-width: none;
  max-height: none;
  min-width: 100%;
  object-fit: initial;
}
.preview-meta {
  justify-content: flex-start;
  font-size: 0.8rem;
}
.font-sample {
  font-size: 2rem;
  padding: var(--s-4);
  overflow-wrap: anywhere;
}
audio {
  max-width: 100%;
}
footer .btn {
  min-height: 40px;
}
@media (max-width: 640px) {
  .preview-backdrop {
    padding: 0;
  }
  .preview {
    width: 100%;
    height: 100dvh;
    max-height: 100dvh;
    border-radius: 0;
  }
  .preview-stage {
    flex: 1;
    min-height: 180px;
  }
  footer > div {
    width: 100%;
  }
  footer .btn {
    flex: 1;
  }
}
</style>
