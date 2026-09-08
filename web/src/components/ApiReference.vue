<script setup lang="ts">
/**
 * API 參考：把 docs/openapi.json 攤開成一頁。
 *
 * 每個 tag 一節（h2，進左側目錄）、每個端點一段（h3，也進目錄）：方法、路徑、憑證、參數表、
 * 請求本體、回應。細節預設收起，點標題展開；網址帶 #錨點 進來就把那一個展開並捲過去。
 * 內容全部來自規格檔，這裡不寫任何一句契約——文字改了要改規格檔，站上跟著變。
 */
import { computed, onMounted, ref, watch } from "vue";
import SchemaTree from "@/components/SchemaTree.vue";
import { authLabel, groupByTag, typeLabel, type Endpoint, type OpenApiDocument } from "@/lib/openapi";

const props = defineProps<{ doc: OpenApiDocument }>();
const groups = computed(() => groupByTag(props.doc));
const open = ref<Set<string>>(new Set());
const securitySchemes = computed(() =>
  Object.entries(props.doc.components?.securitySchemes ?? {}).map(([name, s]) => ({ name, description: (s as { description?: string }).description ?? "" })),
);

function toggle(id: string) {
  const next = new Set(open.value);
  if (next.has(id)) next.delete(id); else next.add(id);
  open.value = next;
}
function openFromHash() {
  const id = decodeURIComponent(location.hash.replace(/^#/, ""));
  if (!id) return;
  for (const g of groups.value) for (const e of g.endpoints) if (e.id === id) { open.value = new Set([...open.value, id]); }
}
onMounted(() => { openFromHash(); window.addEventListener("hashchange", openFromHash); });
watch(groups, openFromHash);

const bodySchema = (e: Endpoint) => {
  const content = e.op.requestBody?.content ?? {};
  const key = Object.keys(content)[0];
  return key ? { mediaType: key, schema: content[key]!.schema, example: content[key]!.example } : null;
};
const responses = (e: Endpoint) =>
  Object.entries(e.op.responses ?? {}).map(([status, r]) => {
    const content = r.content ?? {};
    const key = Object.keys(content)[0];
    return { status, description: r.description ?? "", mediaType: key, schema: key ? content[key]!.schema : undefined, example: key ? content[key]!.example : undefined };
  });
const authOf = (e: Endpoint) => authLabel(e.op, (props.doc.security as Record<string, string[]>[] | undefined));
const pretty = (v: unknown) => JSON.stringify(v, null, 2);
/** 端點上的 x-* 擴充（例如 WebSocket 協定）：規格裡有就攤開給人看，不挑 */
const extensions = (e: Endpoint) => Object.entries(e.op).filter(([k]) => k.startsWith("x-")).map(([k, v]) => ({ key: k, value: v }));
/** 頂層的 x-*（認證細節、錯誤封包一覽、回應會拿掉的欄位） */
const topNotes = computed(() => Object.entries(props.doc).filter(([k]) => k.startsWith("x-")).map(([k, v]) => ({ key: k, value: v })));
</script>

<template>
  <div class="ref">
    <section v-for="g in groups" :key="g.name" class="ref__group">
      <h2 :id="`tag-${g.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`">{{ g.name }}</h2>
      <p v-if="g.description" class="ref__tagdesc">{{ g.description }}</p>

      <article v-for="e in g.endpoints" :key="e.id" class="ep" :class="{ 'ep--open': open.has(e.id), 'ep--deprecated': e.op.deprecated }">
        <h3 :id="e.id" class="ep__head" @click="toggle(e.id)">
          <span class="ep__method" :class="`ep__method--${e.method}`">{{ e.method.toUpperCase() }}</span>
          <code class="ep__path">{{ e.path }}</code>
          <span class="ep__summary">{{ e.op.summary }}</span>
          <span class="ep__auth">
            <span v-for="a in authOf(e)" :key="a" class="ep__auth-chip" :class="{ 'ep__auth-chip--none': a === 'none' }">{{ a === "none" ? "no auth" : a }}</span>
          </span>
          <a :href="`#${e.id}`" class="ep__anchor" aria-label="link" @click.stop>#</a>
        </h3>

        <div v-if="open.has(e.id)" class="ep__body">
          <p v-if="e.op.description" class="ep__desc">{{ e.op.description }}</p>
          <p v-if="e.op.deprecated" class="ep__deprecated">Deprecated.</p>

          <template v-if="e.op.parameters?.length">
            <h4>Parameters</h4>
            <table class="ep__params">
              <thead><tr><th>Name</th><th>In</th><th>Type</th><th>Constraints</th><th>Description</th></tr></thead>
              <tbody>
                <tr v-for="p in e.op.parameters" :key="`${p.in}-${p.name}`">
                  <td><code>{{ p.name }}</code><span v-if="p.required" class="ep__req" title="required">*</span></td>
                  <td class="subtle">{{ p.in }}</td>
                  <td><code>{{ typeLabel(doc, p.schema) }}</code></td>
                  <td class="ep__cons">{{ p.schema?.enum ? p.schema.enum.map((v) => JSON.stringify(v)).join(" · ") : "" }}{{ p.schema?.default !== undefined ? ` default ${JSON.stringify(p.schema.default)}` : "" }}</td>
                  <td>{{ p.description }}</td>
                </tr>
              </tbody>
            </table>
          </template>

          <template v-for="body in [bodySchema(e)]" :key="'body'">
            <template v-if="body">
              <h4>Request body <span class="subtle">{{ body.mediaType }}{{ e.op.requestBody?.required ? " · required" : "" }}</span></h4>
              <p v-if="e.op.requestBody?.description" class="ep__desc">{{ e.op.requestBody.description }}</p>
              <SchemaTree v-if="body.schema" :doc="doc" :schema="body.schema" />
              <pre v-if="body.example !== undefined" class="ep__example"><code>{{ pretty(body.example) }}</code></pre>
            </template>
          </template>

          <h4>Responses</h4>
          <div v-for="r in responses(e)" :key="r.status" class="ep__resp">
            <p class="ep__status"><code :class="`ep__code ep__code--${r.status[0]}xx`">{{ r.status }}</code> <span>{{ r.description }}</span></p>
            <SchemaTree v-if="r.schema" :doc="doc" :schema="r.schema" />
            <pre v-if="r.example !== undefined" class="ep__example"><code>{{ pretty(r.example) }}</code></pre>
          </div>

          <details v-for="x in extensions(e)" :key="x.key" class="ep__ext">
            <summary><h4>{{ x.key.replace(/^x-/, "").replace(/-/g, " ") }}</h4></summary>
            <pre class="ep__example"><code>{{ pretty(x.value) }}</code></pre>
          </details>
        </div>
      </article>
    </section>

    <section v-if="topNotes.length" class="ref__group">
      <h2 id="notes">Notes</h2>
      <details v-for="n in topNotes" :key="n.key" class="ep__ext">
        <summary><h4>{{ n.key.replace(/^x-/, "").replace(/-/g, " ") }}</h4></summary>
        <pre class="ep__example"><code>{{ pretty(n.value) }}</code></pre>
      </details>
    </section>

    <section v-if="securitySchemes.length" class="ref__group">
      <h2 id="security-schemes">Security schemes</h2>
      <dl class="ref__sec">
        <template v-for="s in securitySchemes" :key="s.name">
          <dt><code>{{ s.name }}</code></dt>
          <dd>{{ s.description }}</dd>
        </template>
      </dl>
    </section>
  </div>
</template>

<style scoped>
.ref__group h2 { font-size: 20px; margin: var(--s-7) 0 var(--s-3); padding-top: var(--s-4); border-top: 1px solid var(--line); scroll-margin-top: calc(var(--header-h) + var(--s-4)); }
.ref__tagdesc { margin: 0 0 var(--s-3); color: var(--text-2); }
.ep { border: 1px solid var(--line); border-radius: var(--r-md); margin: 0 0 var(--s-2); background: var(--surface); }
.ep--open { box-shadow: 0 0 0 1px var(--accent-soft); }
.ep__head {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin: 0; padding: 10px 12px; font-size: 14px; font-weight: 500; cursor: pointer;
  scroll-margin-top: calc(var(--header-h) + var(--s-4));
}
.ep__head:hover { background: var(--surface-2); }
.ep__method { display: inline-block; min-width: 56px; text-align: center; padding: 2px 6px; border-radius: 5px; font-size: 11px; font-weight: 700; letter-spacing: 0.04em; color: #fff; }
.ep__method--get { background: #2f855a; }
.ep__method--post { background: #2b6cb0; }
.ep__method--put { background: #b7791f; }
.ep__method--patch { background: #6b46c1; }
.ep__method--delete { background: #c53030; }
.ep__path { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; overflow-wrap: anywhere; }
.ep__summary { color: var(--text-2); font-weight: 400; flex: 1 1 200px; }
.ep__auth { display: inline-flex; gap: 4px; }
.ep__auth-chip { padding: 1px 7px; border-radius: 4px; background: var(--accent-tint); color: var(--accent-text); font-size: 11px; font-weight: 600; }
.ep__auth-chip--none { background: var(--surface-2); color: var(--text-3); }
.ep__anchor { color: var(--text-3); text-decoration: none; font-weight: 400; }
.ep__anchor:hover { color: var(--accent-text); }
.ep__body { padding: 4px 12px 14px; border-top: 1px solid var(--line); }
.ep__body h4 { font-size: 13px; margin: var(--s-3) 0 6px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-3); }
.ep__desc { margin: var(--s-2) 0; line-height: 1.7; white-space: pre-line; }
.ep__deprecated { color: var(--danger); font-weight: 600; }
.ep__params { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.ep__params th { text-align: left; font-weight: 600; padding: 6px 10px; border-bottom: 1px solid var(--line); background: var(--surface-2); font-size: 12.5px; }
.ep__params td { padding: 6px 10px; border-bottom: 1px solid var(--line); vertical-align: top; line-height: 1.55; }
.ep__req { color: var(--danger); margin-left: 2px; font-weight: 700; }
.ep__cons { color: var(--text-3); font-size: 12.5px; }
.ep__resp { margin: 0 0 var(--s-3); }
.ep__status { margin: 0 0 6px; }
.ep__code { padding: 1px 7px; border-radius: 4px; font-weight: 700; font-size: 12px; }
.ep__code--2xx { background: color-mix(in srgb, #2f855a 14%, var(--surface)); color: #2f855a; }
.ep__code--4xx { background: color-mix(in srgb, #b7791f 14%, var(--surface)); color: #b7791f; }
.ep__code--5xx { background: color-mix(in srgb, #c53030 14%, var(--surface)); color: #c53030; }
.ep__ext { margin: var(--s-2) 0; }
.ep__ext > summary { cursor: pointer; list-style: none; display: flex; align-items: center; gap: 6px; }
.ep__ext > summary::before { content: "▸"; font-size: 11px; color: var(--text-3); }
.ep__ext[open] > summary::before { content: "▾"; }
.ep__ext > summary h4 { display: inline; margin: 0; }
.ep__example { margin: 8px 0 0; padding: 10px 12px; overflow-x: auto; border-radius: var(--r-sm); background: var(--surface-2); font-size: 12.5px; line-height: 1.5; }
.ref__sec dt { margin-top: var(--s-2); }
.ref__sec dd { margin: 2px 0 0; color: var(--text-2); }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
</style>
