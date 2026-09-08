<script setup lang="ts">
/**
 * 把一個 JSON Schema 畫成可讀的樹：每個欄位一列（名字、型別、必填、限制、說明），
 * 物件與陣列往下縮。$ref 解開來畫；同一條路徑上重複出現的名字（環）就只留名字，不再往下。
 */
import { computed } from "vue";
import { constraintLabel, refName, resolveRef, typeLabel, type OpenApiDocument, type OpenApiSchema } from "@/lib/openapi";

const props = defineProps<{
  doc: OpenApiDocument;
  schema: OpenApiSchema;
  /** 已經在上層展開過的 $ref 名字（防環） */
  trail?: string[];
  depth?: number;
}>();

const resolved = computed(() => resolveRef(props.doc, props.schema));
const ref = computed(() => (props.schema.$ref ? refName(props.schema.$ref) : ""));
const cyclic = computed(() => !!ref.value && (props.trail ?? []).includes(ref.value));
const trail = computed(() => (ref.value ? [...(props.trail ?? []), ref.value] : (props.trail ?? [])));
const depth = computed(() => props.depth ?? 0);

/** 物件的欄位；allOf 合併；沒有 properties 的物件就沒有列 */
const fields = computed(() => {
  const s = resolved.value;
  const merged: OpenApiSchema = s.allOf
    ? s.allOf.reduce<OpenApiSchema>((acc, part) => {
        const r = resolveRef(props.doc, part);
        return { ...acc, properties: { ...(acc.properties ?? {}), ...(r.properties ?? {}) }, required: [...(acc.required ?? []), ...(r.required ?? [])] };
      }, {})
    : s;
  const req = new Set(merged.required ?? []);
  return Object.entries(merged.properties ?? {}).map(([name, schema]) => ({ name, schema, required: req.has(name) }));
});
const isArray = computed(() => resolved.value.type === "array" && !!resolved.value.items);
/** 陣列元素本身是物件／陣列／oneOf 才往下畫，純量只在標籤上說 */
const itemsExpandable = computed(() => {
  const it = resolved.value.items;
  if (!it) return false;
  const r = resolveRef(props.doc, it);
  return !!(r.properties || r.items || r.oneOf || r.anyOf || r.allOf);
});
const variants = computed(() => resolved.value.oneOf ?? resolved.value.anyOf ?? null);
const isObject = computed(() => fields.value.length > 0);
</script>

<template>
  <div class="st" :class="{ 'st--nested': depth > 0 }">
    <p v-if="cyclic" class="st__cycle subtle">↻ {{ ref }}</p>
    <template v-else>
      <p v-if="resolved.description && depth === 0" class="st__desc">{{ resolved.description }}</p>
      <!-- 物件：欄位表 -->
      <table v-if="isObject" class="st__table">
        <thead v-if="depth === 0"><tr><th>Field</th><th>Type</th><th>Constraints</th><th>Description</th></tr></thead>
        <tbody>
          <template v-for="f in fields" :key="f.name">
            <tr>
              <td class="st__name"><code>{{ f.name }}</code><span v-if="f.required" class="st__req" title="required">*</span></td>
              <td class="st__type"><code>{{ typeLabel(doc, f.schema) }}</code></td>
              <td class="st__cons">{{ constraintLabel(resolveRef(doc, f.schema)) }}</td>
              <td class="st__doc">
                {{ f.schema.description ?? resolveRef(doc, f.schema).description ?? "" }}
                <span v-if="f.schema['x-unverified'] || resolveRef(doc, f.schema)['x-unverified']" class="st__unv">unverified</span>
              </td>
            </tr>
            <!-- 欄位本身是物件、陣列或 $ref：往下縮一層 -->
            <tr v-if="resolveRef(doc, f.schema).properties || resolveRef(doc, f.schema).items || resolveRef(doc, f.schema).oneOf || resolveRef(doc, f.schema).anyOf || resolveRef(doc, f.schema).allOf" class="st__child">
              <td colspan="4">
                <SchemaTree :doc="doc" :schema="f.schema" :trail="trail" :depth="depth + 1" />
              </td>
            </tr>
          </template>
        </tbody>
      </table>
      <!-- 陣列：畫元素 -->
      <div v-else-if="isArray" class="st__array">
        <p class="subtle st__label">array of <code>{{ typeLabel(doc, resolved.items) }}</code></p>
        <SchemaTree v-if="itemsExpandable && resolved.items" :doc="doc" :schema="resolved.items" :trail="trail" :depth="depth + 1" />
      </div>
      <!-- oneOf / anyOf：逐個列 -->
      <div v-else-if="variants" class="st__variants">
        <div v-for="(v, i) in variants" :key="i" class="st__variant">
          <p class="subtle st__label">{{ resolved.oneOf ? "one of" : "any of" }} #{{ i + 1 }} · <code>{{ typeLabel(doc, v) }}</code></p>
          <SchemaTree :doc="doc" :schema="v" :trail="trail" :depth="depth + 1" />
        </div>
      </div>
      <!-- 純量 -->
      <p v-else class="st__scalar"><code>{{ typeLabel(doc, resolved) }}</code> <span class="subtle">{{ constraintLabel(resolved) }}</span></p>
    </template>
  </div>
</template>

<style scoped>
.st { font-size: 13.5px; }
.st__desc { margin: 0 0 8px; color: var(--text-2); }
.st__table { width: 100%; border-collapse: collapse; table-layout: auto; }
.st__table code { white-space: nowrap; }
.st__table th { text-align: left; font-weight: 600; padding: 6px 10px; border-bottom: 1px solid var(--line); background: var(--surface-2); font-size: 12.5px; }
.st__table td { padding: 6px 10px; border-bottom: 1px solid var(--line); vertical-align: top; line-height: 1.55; }
.st__name { white-space: nowrap; }
.st__req { color: var(--danger); margin-left: 2px; font-weight: 700; }
.st__type { white-space: nowrap; color: var(--text-2); }
.st__cons { color: var(--text-3); font-size: 12.5px; max-width: 220px; overflow-wrap: anywhere; }
.st__doc { color: var(--text-2); min-width: 200px; }
.st__unv { margin-left: 6px; padding: 0 6px; border-radius: 4px; background: color-mix(in srgb, var(--danger) 12%, var(--surface)); color: var(--danger); font-size: 11px; }
.st__child > td { padding: 0 0 0 18px; border-bottom: 0; background: color-mix(in srgb, var(--surface-2) 40%, transparent); }
.st--nested .st__table td { font-size: 13px; }
.st__label { margin: 4px 0; }
.st__scalar { margin: 4px 0; }
.st__variant { padding-left: 10px; border-left: 2px solid var(--line); margin: 6px 0; }
.st__cycle { margin: 4px 0; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9em; }
</style>
