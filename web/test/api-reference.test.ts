/**
 * API 參考的呈現：規格檔攤成分組與端點，點標題展開參數表與回應，$ref 解得開、環不會無限展開。
 */
import { describe, expect, it } from "vitest";
import { createApp, nextTick } from "vue";
import ApiReference from "../src/components/ApiReference.vue";
import { endpointId, groupByTag, typeLabel, type OpenApiDocument } from "../src/lib/openapi";

const doc: OpenApiDocument = {
  openapi: "3.1.0",
  info: { title: "T", version: "1" },
  tags: [{ name: "Roles" }, { name: "Identity" }],
  security: [{ userToken: [] }],
  paths: {
    "/open/v1/role/detail": {
      get: {
        summary: "Card detail",
        tags: ["Roles"],
        security: [],
        parameters: [{ name: "roleId", in: "query", required: true, schema: { type: "string", format: "uuid" }, description: "Card id" }],
        responses: { "200": { description: "ok", content: { "application/json": { schema: { $ref: "#/components/schemas/Role" } } } } },
      },
    },
    "/open/v1/me": { get: { summary: "Who am I", tags: ["Identity"], responses: { "200": { description: "ok" } } } },
  },
  components: {
    securitySchemes: { userToken: { type: "http", scheme: "bearer", description: "User token" } },
    schemas: {
      Role: {
        type: "object",
        required: ["characterRoleId"],
        properties: {
          characterRoleId: { type: "string", description: "id" },
          tags: { type: "array", items: { type: "string" } },
          parent: { $ref: "#/components/schemas/Role", description: "cycle" },
        },
      },
    },
  },
};

describe("openapi helpers", () => {
  it("按 tag 分組，順序照宣告；端點錨點穩定", () => {
    const groups = groupByTag(doc);
    expect(groups.map((g) => g.name)).toEqual(["Roles", "Identity"]);
    expect(groups[0]!.endpoints[0]!.id).toBe("get-role-detail");
    expect(endpointId("post", "/open/v1/worldbook/{worldbookId}/document")).toBe("post-worldbook-worldbookid-document");
  });
  it("型別標籤：$ref 名、陣列、格式", () => {
    expect(typeLabel(doc, { $ref: "#/components/schemas/Role" })).toBe("Role");
    expect(typeLabel(doc, { type: "array", items: { type: "string" } })).toBe("string[]");
    expect(typeLabel(doc, { type: "string", format: "uuid" })).toBe("string (uuid)");
  });
});

describe("ApiReference", () => {
  it("列出端點；點標題展開參數表與回應；沒憑證的標「no auth」；環狀 $ref 停在名字", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const app = createApp(ApiReference, { doc });
    app.mount(el);
    await nextTick();
    const heads = [...el.querySelectorAll("h3.ep__head")];
    expect(heads).toHaveLength(2);
    expect(el.querySelector("#get-role-detail .ep__auth-chip")?.textContent).toBe("no auth");
    expect(el.querySelector("#get-me .ep__auth-chip")?.textContent).toBe("userToken");
    expect(el.querySelector(".ep__body")).toBeNull();
    (heads[0] as HTMLElement).click();
    await nextTick();
    const body = el.querySelector(".ep__body")!;
    expect(body.querySelector(".ep__params")?.textContent).toContain("roleId");
    expect(body.querySelector(".ep__params")?.textContent).toContain("string (uuid)");
    // 回應的 $ref 解開成欄位表；自引用那一列不再往下畫
    expect(body.textContent).toContain("characterRoleId");
    expect(body.textContent).toContain("string[]");
    expect(body.querySelectorAll(".st__cycle").length).toBe(1);
    app.unmount();
    el.remove();
  });
});
