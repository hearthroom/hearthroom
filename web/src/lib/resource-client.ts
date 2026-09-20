import { ApiError, describeApiError } from "./api";
import { apiBaseOf, type ProviderId } from "./provider";
export type ResourceId = string | number;
export interface Resource {
  id: ResourceId;
  imageUrl: string;
  fileName?: string;
  kind: string;
  mimeType?: string;
  byteSize: number | null;
  pixelWidth?: number;
  pixelHeight?: number;
  createTime?: string;
  moderationState?: string;
  thumbnailUrl?: string;
}
export interface Folder {
  folderId: string;
  name: string;
  imageCount: number;
}
export interface Capabilities {
  kinds: string[];
  formats: string[];
  maxFileBytes: number | null;
  search: boolean;
  sorts: string[];
  overwrite: boolean | null;
  relativePaths?: boolean;
}
export interface ResourceQuery {
  scope: string;
  folderId?: string;
  kind: string;
  page: number;
  pageSize: number;
  q?: string;
  sort?: string;
}
export interface ResourcePage {
  items: Resource[];
  total: number;
  usedBytes: number | null;
  byteQuota: number | null;
  libraryPrefix: string;
  capabilities: Capabilities;
}
const numeric = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
/** Immutable issuer + bearer pair. Never consult the global active provider mid-request. */
export function resourceClient(provider: ProviderId, token: string) {
  const base = apiBaseOf(provider);
  const headers = { Authorization: `Bearer ${token}` };
  async function request(path: string, body?: unknown) {
    const r = await fetch(`${base}/open/v1/image/${path}`, {
      headers: {
        ...headers,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined
        ? {}
        : { method: "POST", body: JSON.stringify(body) }),
    });
    const b = await r.json().catch(() => ({}));
    if (!r.ok || (typeof b.code === "number" && b.code !== 0))
      throw new ApiError(
        r.status,
        describeApiError(r.status, b.error || b.message || ""),
        b.error || "",
      );
    return b.data ?? {};
  }
  type UploadState = {
    intent?: { uploadId: string; uploadUrl: string; contentType?: string };
    stored?: boolean;
    done?: { imageId: ResourceId; imageUrl: string };
    attached: Set<string>;
  };
  const uploadStates = new WeakMap<File, UploadState>();
  async function legacy(file: File, folderIds: string[]) {
    const form = new FormData();
    form.append("file", file);
    if (provider === "harbor" && file.webkitRelativePath) form.append("relativePath", file.webkitRelativePath);
    for (const id of folderIds) form.append("folderIds", id);
    const r = await fetch(`${base}/open/v1/image/upload`, {
      method: "POST",
      headers,
      body: form,
    });
    const b = await r.json().catch(() => ({}));
    if (!r.ok)
      throw new ApiError(
        r.status,
        describeApiError(r.status, b.error || ""),
        b.error || "",
      );
    const data = b.data ?? {};
    if (!data.imageUrl && !data.url)
      throw new ApiError(502, describeApiError(502, ""));
    return { imageId: data.imageId, imageUrl: data.imageUrl || data.url };
  }
  return {
    async list(query: ResourceQuery): Promise<ResourcePage> {
      const q = new URLSearchParams({
        scope: query.scope,
        kind: query.kind,
        pageNum: String(query.page),
        pageSize: String(query.pageSize),
      });
      if (query.folderId) q.set("folderId", query.folderId);
      if (query.q) q.set("q", query.q);
      if (query.sort) q.set("sort", query.sort);
      const d = await request(`list?${q}`);
      const c = d.capabilities;
      return {
        items: (d.imageList ?? []).map((v: Resource) => ({
          ...v,
          kind: v.kind || "image",
          byteSize: numeric(v.byteSize),
        })),
        total: d.total ?? 0,
        usedBytes: numeric(d.usedBytes),
        byteQuota: numeric(d.byteQuota),
        libraryPrefix: d.libraryPrefix ?? "",
        capabilities: {
          kinds:
            c?.kinds ??
            (provider === "harbor"
              ? ["image", "font"]
              : ["image", "video", "audio", "font"]),
          formats: c?.formats ?? [],
          maxFileBytes: numeric(c?.maxFileBytes),
          search: c?.search === true,
          sorts: c?.sorts ?? [],
          overwrite: typeof c?.overwrite === "boolean" ? c.overwrite : null,
          relativePaths: c?.relativePaths === true,
        },
      };
    },
    async folders(): Promise<Folder[]> {
      return ((await request("folder/list")).folders ?? []).map((f: Record<string, unknown>) => ({
        folderId: String(f.folderId ?? f.id), name: String(f.name), imageCount: Number(f.imageCount ?? f.itemCount ?? 0),
      }));
    },
    async folder(
      action: "create" | "rename" | "delete" | "addItems" | "removeItems",
      body: unknown,
    ) {
      return request(`folder/${action}`, body);
    },
    async remove(ids: ResourceId[]) {
      if (provider === "harbor") {
        for (const imageId of ids) await request("delete", { imageId });
      } else await request("delete", { imageIds: ids });
    },
    async upload(
      file: File,
      folderIds: string[],
      progress: (n: number) => void,
    ) {
      const contentType =
        file.type ||
        (/\.woff2$/i.test(file.name)
          ? "font/woff2"
          : /\.woff$/i.test(file.name)
            ? "font/woff"
            : "application/octet-stream");
      const state = uploadStates.get(file) ?? { attached: new Set<string>() };
      uploadStates.set(file, state);
      if (!state.done) {
        if (!state.intent) {
          try {
            state.intent = await request("uploadIntent", {
              byteSize: file.size,
              contentType,
            });
          } catch (e) {
            if (e instanceof ApiError && e.status === 404)
              state.done = await legacy(file, folderIds);
            else throw e;
          }
        }
        if (!state.done && state.intent) {
          const intent = state.intent;
          if (!state.stored) {
            try {
              await new Promise<void>((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open("PUT", intent.uploadUrl);
                xhr.setRequestHeader(
                  "Content-Type",
                  intent.contentType || contentType,
                );
                xhr.timeout = 120000;
                xhr.upload.onprogress = (e) => {
                  if (e.lengthComputable) progress(e.loaded / e.total);
                };
                xhr.onload = () =>
                  xhr.status >= 200 && xhr.status < 300
                    ? resolve()
                    : reject(
                        new ApiError(
                          xhr.status,
                          describeApiError(xhr.status, ""),
                        ),
                      );
                xhr.onerror = () =>
                  reject(new ApiError(0, describeApiError(503, "")));
                xhr.ontimeout = () =>
                  reject(new ApiError(408, describeApiError(503, "")));
                xhr.send(file);
              });
              state.stored = true;
            } catch (e) {
              if (e instanceof ApiError && e.status === 0)
                state.done = await legacy(file, folderIds);
              else {
                if (e instanceof ApiError && e.status === 403)
                  state.intent = undefined;
                throw e;
              }
            }
          }
          if (!state.done)
            state.done = await request("uploadComplete", {
              uploadId: intent.uploadId,
              fileName: file.name,
              ...(provider === "harbor" && file.webkitRelativePath ? {relativePath: file.webkitRelativePath} : {}),
              folderIds,
            });
        }
      }
      const d = state.done;
      if (!d?.imageUrl) throw new ApiError(502, describeApiError(502, ""));
      // Retrying a folder assignment or completion must not create another upload.
      if (provider === "harbor")
        for (const folderId of folderIds) {
          if (state.attached.has(folderId)) continue;
          await request("folder/addItems", { folderId, imageIds: [d.imageId] });
          state.attached.add(folderId);
        }
      progress(1);
      return d.imageUrl as string;
    },
  };
}
