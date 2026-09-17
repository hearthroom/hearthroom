import { HttpError } from "../src/types";
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
it('updates a published matching copy only with explicit edit consent and never overwrites external edits',async()=>{
 const unpublish=vi.spyOn(transfers,'unpublish').mockResolvedValue();
 await syncCard(env,input);
 const updated={...source,description:'Updated synthetic text'};
 let written=false;
 vi.mocked(transfers.read).mockImplementation(async(_e,p)=>({card:p==='lunatalk'||written?updated:source,public:p==='harbor'&&!written}));
 vi.mocked(transfers.update).mockImplementation(async()=>{written=true;return {};});
 await expect(syncCard(env,input)).rejects.toThrow('sync_target_published');
 expect(unpublish).not.toHaveBeenCalled();
 await expect(syncCard(env,{...input,updatePublished:true})).resolves.toMatchObject({status:'synced'});
 expect(unpublish).toHaveBeenCalledTimes(1);
});

const missingTarget = () => new HttpError(502,'sync_resource_missing',{provider:'harbor',step:'read',upstreamStatus:404,upstreamCode:'role_not_found'});
async function deletedCopy() {
 await syncCard(env,input);
 await env.DB.prepare("UPDATE work_copies SET transfer_state=?,worldbooks=?").bind(JSON.stringify({books:{old:{id:'old-book',status:'created'}}}),JSON.stringify({old:'old-book'})).run();
 vi.mocked(transfers.read).mockImplementation(async(_env,provider,_token,id)=>{
  if(provider==='harbor' && id==='target')throw missingTarget();
  return {card:source,public:false};
 });
 vi.mocked(transfers.create).mockResolvedValue('replacement');
}
it('recreates a missing target only on explicit request, clearing stale resource mappings',async()=>{
 await deletedCopy();
 await expect(syncCard(env,input)).rejects.toThrow('sync_resource_missing');
 expect(transfers.create).toHaveBeenCalledTimes(1);
 await expect(syncCard(env,{...input,recreateMissing:true})).resolves.toMatchObject({roleId:'replacement',status:'synced'});
 expect(transfers.create).toHaveBeenCalledTimes(2);
 expect(vi.mocked(transfers.create).mock.calls[1][4]).not.toBe(vi.mocked(transfers.create).mock.calls[0][4]);
 const progress=vi.mocked(transfers.update).mock.calls.at(-1)![6];
 expect(progress).toEqual({books:{}});
 const row=await env.DB.prepare('SELECT role_id,worldbooks,transfer_state FROM work_copies').first<any>();
 expect(row.role_id).toBe('replacement');
 expect(JSON.parse(row.worldbooks)).toEqual({});
 expect(JSON.parse(row.transfer_state)).toEqual({books:{}});
 expect(transfers.publish).not.toHaveBeenCalled();
});
it.each([
 new Error('network'),
 new HttpError(403,'sync_permission_denied',{provider:'harbor',step:'read',upstreamStatus:403}),
 new HttpError(502,'sync_resource_missing',{provider:'harbor',step:'lorebook',upstreamStatus:404,upstreamCode:'not_found'}),
])('never recreates on an ambiguous or unrelated target error: %s',async(error)=>{
 await syncCard(env,input);
 vi.mocked(transfers.read).mockImplementation(async(_env,p)=>{if(p==='harbor')throw error;return {card:source,public:false};});
 await expect(syncCard(env,{...input,recreateMissing:true})).rejects.toThrow();
 expect(transfers.create).toHaveBeenCalledTimes(1);
 expect((await env.DB.prepare('SELECT role_id FROM work_copies').first<any>()).role_id).toBe('target');
});
it('does not recreate when the source is missing or publish a recovery copy',async()=>{
 await syncCard(env,input);
 vi.mocked(transfers.read).mockRejectedValue(new HttpError(502,'sync_resource_missing',{provider:'lunatalk',step:'read',upstreamStatus:404,upstreamCode:'role_not_found'}));
 await expect(syncCard(env,{...input,recreateMissing:true})).rejects.toThrow();
 expect(transfers.create).toHaveBeenCalledTimes(1);
 vi.mocked(transfers.read).mockResolvedValue({card:source,public:false});
 await expect(syncCard(env,{...input,recreateMissing:true,publish:true})).rejects.toThrow('sync_proof_required');
 expect(transfers.publish).not.toHaveBeenCalled();
});
it('keeps an uncertain replacement creation blocked instead of duplicating it',async()=>{
 await deletedCopy();
 vi.mocked(transfers.create).mockRejectedValueOnce(new Error('response lost'));
 await expect(syncCard(env,{...input,recreateMissing:true})).rejects.toThrow('sync_create_unconfirmed');
 await expect(syncCard(env,{...input,recreateMissing:true})).rejects.toThrow('sync_create_unconfirmed');
 expect(transfers.create).toHaveBeenCalledTimes(2);
});
