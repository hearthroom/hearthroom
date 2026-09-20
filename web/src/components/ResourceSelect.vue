<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useId,
  watch,
} from "vue";
const props = defineProps<{
  modelValue: string | number;
  label: string;
  options: { value: string | number; label: string }[];
  disabled?: boolean;
}>();
const emit = defineEmits<{
  "update:modelValue": [value: string | number];
  change: [];
}>();
const id = useId(),
  root = ref<HTMLElement>(),
  trigger = ref<HTMLButtonElement>();
const open = ref(false),
  active = ref(0),
  above = ref(false);
const selected = computed(
  () =>
    props.options.find((o) => o.value === props.modelValue)?.label ||
    props.label,
);
function show() {
  if (props.disabled || !props.options.length) return;
  active.value = Math.max(
    0,
    props.options.findIndex((o) => o.value === props.modelValue),
  );
  const bounds = trigger.value?.getBoundingClientRect();
  above.value =
    !!bounds &&
    innerHeight - bounds.bottom <
      Math.min(280, props.options.length * 44 + 16) &&
    bounds.top > innerHeight - bounds.bottom;
  open.value = true;
}
function choose(index: number) {
  const option = props.options[index];
  if (!option) return;
  emit("update:modelValue", option.value);
  emit("change");
  open.value = false;
  void nextTick(() => trigger.value?.focus());
}
let typed = "",
  lastTyped = 0;
function key(e: KeyboardEvent) {
  if (props.disabled) return;
  if (e.key === "Tab") {
    open.value = false;
    return;
  }
  if (e.key === "Escape") {
    open.value = false;
    e.preventDefault();
    return;
  }
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    open.value ? choose(active.value) : show();
    return;
  }
  if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
    e.preventDefault();
    if (!open.value) show();
    else if (e.key === "Home") active.value = 0;
    else if (e.key === "End") active.value = props.options.length - 1;
    else
      active.value =
        (active.value +
          (e.key === "ArrowDown" ? 1 : -1) +
          props.options.length) %
        props.options.length;
  } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    if (!open.value) show();
    typed = Date.now() - lastTyped > 700 ? e.key : typed + e.key;
    lastTyped = Date.now();
    const match = props.options.findIndex((o) =>
      o.label.toLocaleLowerCase().startsWith(typed.toLocaleLowerCase()),
    );
    if (match >= 0) active.value = match;
  } else return;
  void nextTick(() =>
    root.value
      ?.querySelector(`[id="${id}-${active.value}"]`)
      ?.scrollIntoView?.({ block: "nearest" }),
  );
}
function outside(e: PointerEvent) {
  if (!root.value?.contains(e.target as Node)) open.value = false;
}
watch(
  () => props.disabled,
  (v) => {
    if (v) open.value = false;
  },
);
onMounted(() => document.addEventListener("pointerdown", outside));
onBeforeUnmount(() => document.removeEventListener("pointerdown", outside));
</script>
<template>
  <div
    ref="root"
    class="resource-select"
    :class="{ 'is-open': open }"
    @keydown="key"
    @focusout="
      (e) => {
        if (!root?.contains(e.relatedTarget as Node)) open = false;
      }
    "
  >
    <button
      ref="trigger"
      type="button"
      class="resource-select__trigger"
      role="combobox"
      :aria-label="label"
      aria-haspopup="listbox"
      :aria-controls="id"
      :aria-expanded="open"
      :aria-activedescendant="open ? `${id}-${active}` : undefined"
      :disabled="disabled || !options.length"
      @click="open ? (open = false) : show()"
    >
      <span>{{ selected }}</span
      ><svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m7 10 5 5 5-5" />
      </svg>
    </button>
    <div
      v-if="open"
      :id="id"
      role="listbox"
      :aria-label="label"
      class="resource-select__menu"
      :class="{ 'is-above': above }"
    >
      <button
        v-for="(option, i) in options"
        :id="`${id}-${i}`"
        :key="option.value"
        type="button"
        role="option"
        tabindex="-1"
        :aria-selected="option.value === modelValue"
        :class="{ 'is-active': i === active }"
        @pointermove="active = i"
        @mousedown.prevent
        @click="choose(i)"
      >
        <span>{{ option.label }}</span
        ><svg
          v-if="option.value === modelValue"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="m5 12 4 4 10-10" />
        </svg>
      </button>
    </div>
  </div>
</template>
<style scoped>
.resource-select {
  position: relative;
  min-width: 0;
}
.resource-select__trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-3);
  width: 100%;
  min-height: var(--h-lg);
  padding: var(--s-2) var(--s-4);
  border: 1px solid var(--border-strong);
  border-radius: var(--r-pill);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
}
.resource-select__trigger > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.resource-select__trigger:disabled {
  opacity: 0.5;
  cursor: default;
}
.resource-select__trigger:hover:not(:disabled),
.is-open > .resource-select__trigger {
  border-color: var(--accent);
}
svg {
  flex: none;
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.resource-select__menu {
  position: absolute;
  z-index: 45;
  inset: auto 0;
  top: calc(100% + var(--s-2));
  min-width: 100%;
  max-height: 280px;
  overflow: auto;
  padding: var(--s-2);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background: var(--bg);
  box-shadow: var(--shadow-md);
}
.resource-select__menu.is-above {
  top: auto;
  bottom: calc(100% + var(--s-2));
}
.resource-select__menu button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-2);
  width: 100%;
  min-height: var(--h-lg);
  padding: var(--s-2) var(--s-3);
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text);
  text-align: left;
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
  overflow-wrap: anywhere;
}
.resource-select__menu button.is-active {
  background: var(--surface-2);
}
.resource-select__menu button[aria-selected="true"] {
  color: var(--accent);
  font-weight: 600;
}
</style>
