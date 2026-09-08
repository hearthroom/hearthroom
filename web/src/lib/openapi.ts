/**
 * OpenAPI 規格 → 文件頁要的形狀。
 *
 * 規格檔（docs/openapi.json）是機器可讀的契約，站上只是把它攤開來給人讀：按 tag 分組、每個端點
 * 一段，參數表、請求本體、回應各自展開。$ref 在這裡解開成可遞迴畫的樹；環狀引用（schema 引到
 * 自己）就停在名字上，不無限展開。
 */
export interface OpenApiSchema {
  type?: string | string[];
  format?: string;
  description?: string;
  enum?: unknown[];
  default?: unknown;
  example?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  nullable?: boolean;
  required?: string[];
  properties?: Record<string, OpenApiSchema>;
  additionalProperties?: boolean | OpenApiSchema;
  items?: OpenApiSchema;
  oneOf?: OpenApiSchema[];
  anyOf?: OpenApiSchema[];
  allOf?: OpenApiSchema[];
  $ref?: string;
  "x-unverified"?: boolean;
  [key: string]: unknown;
}

export interface OpenApiParameter {
  name: string;
  in: "query" | "path" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema?: OpenApiSchema;
}

export interface OpenApiMediaType { schema?: OpenApiSchema; example?: unknown }

export interface OpenApiOperation {
  operationId?: string;
  tags?: string[];
  summary?: string;
  description?: string;
  deprecated?: boolean;
  security?: Record<string, string[]>[];
  parameters?: OpenApiParameter[];
  requestBody?: { required?: boolean; description?: string; content?: Record<string, OpenApiMediaType> };
  responses?: Record<string, { description?: string; content?: Record<string, OpenApiMediaType> }>;
  [key: string]: unknown;
}

export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description?: string };
  servers?: { url: string; description?: string }[];
  tags?: { name: string; description?: string }[];
  paths: Record<string, Record<string, OpenApiOperation>>;
  components?: { schemas?: Record<string, OpenApiSchema>; securitySchemes?: Record<string, unknown> };
  [key: string]: unknown;
}

export const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export interface Endpoint {
  id: string;
  method: HttpMethod;
  path: string;
  op: OpenApiOperation;
}

export interface TagGroup {
  name: string;
  description?: string;
  endpoints: Endpoint[];
}

/** 端點的錨點 id：method + path，路徑參數的大括號拿掉。 */
export function endpointId(method: string, path: string): string {
  return `${method}-${path.replace(/^\/open\/v1\/?/, "").replace(/[{}]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "")}`.toLowerCase();
}

/** 按 tag 分組，順序照規格檔的 tags 宣告；沒宣告的 tag 排後面。每組內照路徑、再照方法。 */
export function groupByTag(doc: OpenApiDocument): TagGroup[] {
  const declared = doc.tags ?? [];
  const groups = new Map<string, TagGroup>();
  for (const t of declared) groups.set(t.name, { name: t.name, description: t.description, endpoints: [] });
  const methodOrder: Record<string, number> = { get: 0, post: 1, put: 2, patch: 3, delete: 4 };
  for (const [path, item] of Object.entries(doc.paths).sort(([a], [b]) => a.localeCompare(b))) {
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!op) continue;
      const tag = op.tags?.[0] ?? "Other";
      if (!groups.has(tag)) groups.set(tag, { name: tag, endpoints: [] });
      groups.get(tag)!.endpoints.push({ id: endpointId(method, path), method, path, op });
    }
  }
  for (const g of groups.values()) {
    g.endpoints.sort((a, b) => a.path.localeCompare(b.path) || methodOrder[a.method]! - methodOrder[b.method]!);
  }
  return [...groups.values()].filter((g) => g.endpoints.length);
}

/** `#/components/schemas/Name` → Name */
export function refName(ref: string): string {
  return ref.split("/").pop() ?? ref;
}

/** 解一層 $ref；解不到就原樣回（畫的時候會標成未知）。 */
export function resolveRef(doc: OpenApiDocument, schema: OpenApiSchema): OpenApiSchema {
  if (!schema.$ref) return schema;
  return doc.components?.schemas?.[refName(schema.$ref)] ?? schema;
}

/** 一句話的型別：string、integer (int64)、string[]、RoleDetail、enum 列出來。 */
export function typeLabel(doc: OpenApiDocument, schema: OpenApiSchema | undefined): string {
  if (!schema) return "any";
  if (schema.$ref) return refName(schema.$ref);
  const t = Array.isArray(schema.type) ? schema.type.join(" | ") : schema.type;
  if (schema.enum) return `enum`;
  if (t === "array") return `${typeLabel(doc, schema.items)}[]`;
  if (schema.oneOf) return schema.oneOf.map((s) => typeLabel(doc, s)).join(" | ");
  if (schema.anyOf) return schema.anyOf.map((s) => typeLabel(doc, s)).join(" | ");
  if (schema.allOf) return schema.allOf.map((s) => typeLabel(doc, s)).join(" & ");
  const base = t ?? (schema.properties ? "object" : "any");
  return schema.format ? `${base} (${schema.format})` : base;
}

/** 值域的一句話：enum、範圍、長度、格式、預設。給參數表的「限制」欄。 */
export function constraintLabel(schema: OpenApiSchema | undefined): string {
  if (!schema) return "";
  const parts: string[] = [];
  if (schema.enum) parts.push(schema.enum.map((v) => JSON.stringify(v)).join(" · "));
  if (schema.minimum !== undefined || schema.maximum !== undefined) parts.push(`${schema.minimum ?? "…"}–${schema.maximum ?? "…"}`);
  if (schema.minLength !== undefined || schema.maxLength !== undefined) parts.push(`len ${schema.minLength ?? 0}–${schema.maxLength ?? "…"}`);
  if (schema.pattern) parts.push(`/${schema.pattern}/`);
  if (schema.default !== undefined) parts.push(`default ${JSON.stringify(schema.default)}`);
  if (schema.nullable || (Array.isArray(schema.type) && schema.type.includes("null"))) parts.push("nullable");
  return parts.join("; ");
}

/** 這個操作要的憑證，給標題列的小標籤。 */
export function authLabel(op: OpenApiOperation, fallback: Record<string, string[]>[] | undefined): string[] {
  const sec = op.security ?? fallback ?? [];
  if (!sec.length) return ["none"];
  const names = new Set<string>();
  for (const s of sec) {
    const keys = Object.keys(s);
    if (!keys.length) names.add("none");
    for (const k of keys) names.add(k);
  }
  return [...names];
}
