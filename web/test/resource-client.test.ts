import { afterEach, describe, expect, it, vi } from "vitest";
import { resourceClient } from "../src/lib/resource-client";
const response = (data: unknown) =>
  new Response(JSON.stringify({ code: 0, data }), { status: 200 });
afterEach(() => vi.unstubAllGlobals());
describe("provider-bound resources", () => {
  it("normalizes Harbor folder IDs and preserves authored directory paths in completion", async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith("folder/list")) return response({ folders: [{id:"folder-1",name:"立繪",itemCount:3}] });
      if (url.endsWith("uploadIntent")) return response({uploadId:"u",uploadUrl:"https://storage.test/u"});
      return response({imageId:"i",imageUrl:"https://assets.test/u/author/立繪/表情/happy.png"});
    });
    vi.stubGlobal("fetch",fetcher);
    vi.stubGlobal("XMLHttpRequest",class {status=200;upload={};open(){};setRequestHeader(){};onload=()=>{};send(){this.onload();}});
    const c=resourceClient("harbor","token");
    expect(await c.folders()).toEqual([{folderId:"folder-1",name:"立繪",imageCount:3}]);
    const file=new File(["x"],"happy.png",{type:"image/png"});
    Object.defineProperty(file,"webkitRelativePath",{value:"表情/happy.png"});
    await c.upload(file,["folder-1"],()=>{});
    const complete=fetcher.mock.calls.find(([url])=>url.endsWith("uploadComplete"));
    expect(JSON.parse(complete![1].body)).toMatchObject({relativePath:"表情/happy.png",fileName:"happy.png",folderIds:["folder-1"]});
  });
  it("pins reads and mutations to the requested provider, preserving string IDs", async () => {
    const fetcher = vi.fn(async () =>
      response({
        imageList: [{ id: "asset-uuid", imageUrl: "https://cdn.test/a.png" }],
        total: 1,
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const c = resourceClient("harbor", "harbor-token");
    const p = await c.list({
      scope: "all",
      kind: "all",
      page: 2,
      pageSize: 48,
    });
    expect(p.items[0].id).toBe("asset-uuid");
    expect(p.usedBytes).toBeNull();
    expect(String(fetcher.mock.calls[0][0])).toContain(
      "https://api.harperharbor.com/open/v1/image/list?",
    );
    await c.remove(["asset-uuid"]);
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
      imageId: "asset-uuid",
    });
  });
  it("keeps HarperHarbor deletion and server-reported zero quota", async () => {
    const fetcher = vi.fn(async () =>
      response({
        imageList: [],
        total: 0,
        usedBytes: 0,
        byteQuota: 0,
        libraryPrefix: "",
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const c = resourceClient("harbor", "luna-token");
    expect(
      (await c.list({ scope: "all", kind: "all", page: 1, pageSize: 24 }))
        .byteQuota,
    ).toBe(0);
    await c.remove([12]);
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
      imageId: 12,
    });
  });
});

it("retries completion without uploading the file a second time", async () => {
  let completions = 0;
  const fetcher = vi.fn(async (url: string) => {
    if (url.endsWith("uploadIntent"))
      return response({ uploadId: "u1", uploadUrl: "https://storage.test/u1" });
    if (url.endsWith("uploadComplete") && completions++ === 0)
      return new Response(
        JSON.stringify({ error: "temporarily_unavailable" }),
        { status: 503 },
      );
    return response({ imageId: "i1", imageUrl: "https://cdn.test/i1" });
  });
  const send = vi.fn(function (this: any) {
    this.onload();
  });
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal(
    "XMLHttpRequest",
    class {
      status = 200;
      upload = {};
      open() {}
      setRequestHeader() {}
      send = send;
      onload = () => {};
    },
  );
  const c = resourceClient("harbor", "token"),
    f = new File(["x"], "a.png", { type: "image/png" });
  await expect(c.upload(f, [], () => {})).rejects.toThrow();
  await expect(c.upload(f, [], () => {})).resolves.toBe("https://cdn.test/i1");
  expect(
    fetcher.mock.calls.filter(([url]) => url.endsWith("uploadIntent")),
  ).toHaveLength(1);
  expect(send).toHaveBeenCalledTimes(1);
});

it("uses the same issuer for legacy multipart fallback", async () => {
  const fetcher = vi.fn(async (url: string) =>
    url.endsWith("uploadIntent")
      ? new Response("{}", { status: 404 })
      : response({ imageUrl: "https://cdn.test/legacy" }),
  );
  vi.stubGlobal("fetch", fetcher);
  await expect(
    resourceClient("harbor", "token").upload(
      new File(["x"], "a.png"),
      [],
      () => {},
    ),
  ).resolves.toBe("https://cdn.test/legacy");
  expect(
    fetcher.mock.calls.every(([url]) =>
      url.startsWith("https://api.harperharbor.com/"),
    ),
  ).toBe(true);
});
