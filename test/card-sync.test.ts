import { env } from "cloudflare:test";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { resetDb } from "./helpers";
import { syncCard, transfers } from "../src/card-sync";
const source = {
  name: "Example",
  summary: "Summary",
  description: "Character",
  greeting: "Hello",
  language: "en",
};
const input = {
  memberId: "member",
  sourceProvider: "lunatalk" as const,
  sourceRoleId: "source",
  sourceAccount: 1,
  sourceToken: "s",
  targetProvider: "harbor" as const,
  targetAccount: 2,
  targetToken: "t",
  publish: false,
};
beforeEach(async () => {
  await resetDb();
  vi.spyOn(transfers, "read").mockResolvedValue({
    card: source,
    public: false,
  });
  vi.spyOn(transfers, "create").mockResolvedValue("target");
  vi.spyOn(transfers, "update").mockResolvedValue({});
  vi.spyOn(transfers, "publish").mockResolvedValue();
});
afterEach(() => vi.restoreAllMocks());
it("creates one copy and reuses it on retry", async () => {
  const a = await syncCard(env, input);
  expect(a.roleId).toBe("target");
  await syncCard(env, input);
  expect(transfers.create).toHaveBeenCalledTimes(1);
});
it("does not overwrite a target changed outside HearthRoom", async () => {
  await syncCard(env, input);
  vi.mocked(transfers.read).mockImplementation(async (_e, p) => ({
    card:
      p === "harbor" ? { ...source, description: "changed elsewhere" } : source,
    public: false,
  }));
  await expect(syncCard(env, input)).rejects.toThrow("target_changed");
  expect(transfers.update).toHaveBeenCalledTimes(1);
});
it("does not retry a create with an unknown result", async () => {
  vi.mocked(transfers.create).mockRejectedValue(new Error("network"));
  await expect(syncCard(env, input)).rejects.toThrow("create_unconfirmed");
  await expect(syncCard(env, input)).rejects.toThrow("create_unconfirmed");
  expect(transfers.create).toHaveBeenCalledTimes(1);
});
it("does not publish a draft unless publication was requested", async () => {
  await syncCard(env, input);
  expect(transfers.publish).not.toHaveBeenCalled();
});
it("keeps a failed update attached to its created card for retry", async () => {
  vi.mocked(transfers.update).mockRejectedValueOnce(new Error("network"));
  await expect(syncCard(env, input)).rejects.toThrow();
  await syncCard(env, input);
  expect(transfers.create).toHaveBeenCalledTimes(1);
});
it("does not overwrite a copy whose first readback was unavailable", async () => {
  vi.mocked(transfers.read)
    .mockResolvedValueOnce({ card: source, public: false })
    .mockRejectedValueOnce(new Error("network"));
  await expect(syncCard(env, input)).rejects.toThrow();
  vi.mocked(transfers.read).mockResolvedValue({
    card: { ...source, description: "modified elsewhere" },
    public: false,
  });
  await expect(syncCard(env, input)).rejects.toThrow("target_unverified");
  expect(transfers.update).not.toHaveBeenCalled();
});

it('persists the remote resource checkpoint before retrying a failed sync', async()=>{
  vi.mocked(transfers.update).mockImplementationOnce(async(_e,_p,_t,_id,_card,_checkpoint,progress,save)=>{
    if(!progress||typeof progress.books!=='object'||!save)throw new Error('resource checkpoint missing');
    progress.books['book']={status:'created',id:'remote-book'};
    await save();
    throw new Error('network after book creation');
  });
  await expect(syncCard(env,input)).rejects.toThrow();
  const row=await env.DB.prepare('SELECT transfer_state FROM work_copies').first<{transfer_state:string}>();
  expect(JSON.parse(row!.transfer_state).books.book.id).toBe('remote-book');
  vi.mocked(transfers.read).mockImplementation(async(_e,p)=>({card:p==='harbor'?{...source,description:'not finished'}:source,public:false}));
});
