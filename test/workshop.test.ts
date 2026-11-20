// The retired review/appeal/reopen journeys are replaced by v2 direct-publish,
// denial and reordered-outbox cases in workshop-v2.test.ts. Preserve the
// independent comment, moderation, adult and metrics integration boundaries here.
import { SELF,env } from 'cloudflare:test';
import { beforeEach,afterEach,describe,it,expect } from 'vitest';
import { approveFixtureResponse } from './hosted-fixture';
import { appAdmins,bearer,identities,makeMember,makeReviewer,ratingBody,resetDb,restoreUpstream,rolesOnMainSite } from './helpers';
import { workshopUpstream,restoreWorkshopUpstream } from '../src/workshop-gateway';
import { applyWorkshopEvents } from '../src/workshop';
import { opsMetrics } from '../src/ops-metrics';
import { HttpError } from '../src/types';
const CARD_AUTHOR=71001,CREATOR=71002,REVIEWER=71004,MANAGER=71005,OLD_PLAYER=71006,NEW_PLAYER=71007;
const op=()=>crypto.randomUUID();const memberOf=(n:number)=>`member-${n}`;
let cardId=0,workId='';
const json=async(r:Response)=>await r.json() as any;
const send=(path:string,token:string|null,method='GET',body?:unknown)=>SELF.fetch('https://c.test'+path,{method,headers:{...(token?bearer(token):{}),'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
beforeEach(async()=>{
 await resetDb();identities({'card-author':CARD_AUTHOR,creator:CREATOR,reviewer:REVIEWER,manager:MANAGER,'old-player':OLD_PLAYER,'new-player':NEW_PLAYER});
 for(const n of [CARD_AUTHOR,CREATOR,OLD_PLAYER,NEW_PLAYER])await makeMember(n);
 await makeReviewer(REVIEWER);await makeReviewer(MANAGER);appAdmins('manager');
 rolesOnMainSite({roleId:'role-base',authorNumId:CARD_AUTHOR,name:'Synthetic workshop card'});
 const r=await approveFixtureResponse(await send('/v1/cards','card-author','POST',{operationId:op(),roleId:'role-base',...ratingBody(false)}));expect(r.status).toBe(201);cardId=Number((await json(r)).id);
 workId=(await env.DB.prepare("SELECT id FROM works WHERE source_provider='harbor' AND source_role_id='role-base'").first<{id:string}>())!.id;
 await applyWorkshopEvents(env,[{kind:'policy_changed',eventKey:'fixture-open',workId,sourceRoleId:'role-base',payload:{policyVersion:2,revision:2,allowNew:true}}]);
});
afterEach(()=>{restoreWorkshopUpstream();restoreUpstream()});
async function published(id:string,rating='G'){
 const receipt={workshopId:id,releaseId:op(),workId,sourceRoleId:'role-base',kind:'lorebook',status:'published',version:1,publicationRevision:1,draftRevision:2,publishedAt:Date.now(),contentHash:'synthetic',authorPublicNo:CREATOR,cardOwnerPublicNo:CARD_AUTHOR,ownerState:'visible',ownerGeneration:0,residentChars:14,policyVersion:2,sealed:{name:'雪夜後日談',summary:'SFW synthetic fixture',readme:'Local content',coverUrl:'',rating,worldbook:[{id:'one',content:'synthetic lore',enabled:true,mode:'constant'}],rules:{rules:[]},opening:{mode:'greeting'}}};
 await applyWorkshopEvents(env,[{kind:'release_published',eventKey:'fixture-publish:'+id,workId,workshopId:id,payload:{policyVersion:2,publication:receipt}}]);
 workshopUpstream.readRelease=async()=>({workshopId:id,releaseId:receipt.releaseId,sealed:receipt.sealed,residentChars:14,publishedVersion:1} as any);
 workshopUpstream.playerDisplay = async (_env, _provider, ids) => ({ displayedIds: ids.filter((candidate) => candidate === id) });
 workshopUpstream.moderate=async()=>({ok:true});
 return receipt;
}
describe('Workshop v2 retained comment and staff paths',()=>{
  it("擴充評論支援發表／回覆／讚／檢舉／審核；isCreator 與刪留言權歸擴充製作者而非原卡作者；計入指標", async () => {
    await published("ws-c1");
    // 玩家發表頂層留言（即使帶 score 亦儲存為 null），製作者回覆顯示 isCreator: true
    const c1 = await json(
      await send("/v1/workshops/ws-c1/comments", "new-player", "POST", { content: "雪夜劇情超棒！", score: 5 }),
    );
    expect(c1.commentId).toBeTruthy();

    const reply = await send("/v1/workshops/ws-c1/comments", "creator", "POST", {
      content: "謝謝遊玩！",
      rootId: c1.commentId,
      parentId: c1.commentId,
    });
    expect(reply.status).toBe(201);

    const listRes = await json(await send("/v1/workshops/ws-c1/comments", "card-author"));
    expect(listRes.total).toBe(1);
    expect(listRes.comments[0].score).toBeNull();
    expect(listRes.comments[0].isCreator).toBe(false);
    // 原卡作者不是擴充製作者，不能刪別人在擴充下的留言
    expect(listRes.comments[0].canDelete).toBe(false);
    expect(listRes.comments[0].replies[0].isCreator).toBe(true);
    expect((await send(`/v1/comments/${c1.commentId}`, "card-author", "DELETE")).status).toBe(403);

    // 留言回覆通知路徑指向 /workshops/ws-c1，且不產生 card_comments 彙總或卡片評論獎勵
    const replyNotice = await env.DB.prepare(
      "SELECT path, card_id FROM community_notifications WHERE kind = 'comment_reply' AND member_id = ?",
    )
      .bind(memberOf(NEW_PLAYER))
      .first();
    expect(replyNotice).toEqual({ path: "/workshops/ws-c1", card_id: null });

    const digestCount = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM community_notifications WHERE kind = 'card_comments'",
    ).first<{ n: number }>();
    expect(digestCount!.n).toBe(0);

    // 檢舉與評論審核佇列支援 target.kind = 'workshop'
    const rep = await send(`/v1/comments/${c1.commentId}/report`, "old-player", "POST", {
      reason: "spam",
      note: "測試檢舉",
    });
    expect(rep.status).toBe(200);
    const modQueue = await json(await send("/v1/moderation/comments?tab=reported", "reviewer"));
    expect(modQueue.items[0].target).toMatchObject({ kind: "workshop", id: "ws-c1", title: "雪夜後日談" });
    expect(
      (
        await send(`/v1/moderation/comments/${c1.commentId}/decision`, "reviewer", "POST", {
          action: "dismiss",
          reason: "正常心得",
          operationId: op(),
        })
      ).status,
    ).toBe(200);

    // 擴充製作者可刪除其擴充底下的留言（如卡片作者對自家卡留言的規則），且不觸發卡片評論移除扣回
    expect((await send(`/v1/comments/${c1.commentId}`, "creator", "DELETE")).status).toBe(204);
    const rewardEvents = await env.DB.prepare("SELECT COUNT(*) AS n FROM reward_event_outbox").first<{ n: number }>();
    expect(rewardEvents!.n).toBe(0);

    const metricsText = await opsMetrics(env.DB);
    expect(metricsText).toContain('hearthroom_workshop_comment_total{action="create",outcome="success"} 1');
    expect(metricsText).toContain('hearthroom_workshop_comment_total{action="reply",outcome="success"} 1');
    expect(metricsText).toContain('hearthroom_workshop_comment_total{action="report",outcome="success"} 1');
    expect(metricsText).toContain('hearthroom_workshop_comment_total{action="moderate",outcome="success"} 1');
    expect(metricsText).not.toContain("ws-c1");
  });
 it('staff content remains private and age/region gated; takedown remains independent from review',async()=>{
  await published('staff-content','R');
  expect((await send('/v1/moderation/workshops/staff-content/content','creator')).status).toBe(403);
  await env.DB.prepare('UPDATE members SET age_verified_at=NULL WHERE id=?').bind(memberOf(MANAGER)).run();
  expect((await send('/v1/moderation/workshops/staff-content/content','manager')).status).toBe(403);
  await env.DB.prepare("UPDATE members SET age_verified_at=?,country_region='CN' WHERE id=?").bind(Date.now(),memberOf(MANAGER)).run();
  expect((await send('/v1/moderation/workshops/staff-content/content','manager')).status).toBe(404);
  await env.DB.prepare("UPDATE members SET country_region='TW' WHERE id=?").bind(memberOf(MANAGER)).run();
  expect((await send('/v1/moderation/workshops/staff-content/content','manager')).status).toBe(200);
  workshopUpstream.readRelease=async()=>{throw new HttpError(503,'upstream_unavailable')};
  expect((await send('/v1/moderation/workshops/staff-content/content','manager')).status).toBe(503);
  const body={operationId:op(),reason:'Synthetic staff takedown'};
  for(let i=0;i<2;i++)expect((await send('/v1/moderation/workshops/staff-content/revoke','manager','POST',body)).status).toBe(200);
  expect((await env.DB.prepare('SELECT moderation_state FROM workshops WHERE id=?').bind('staff-content').first())?.moderation_state).toBe('revoked');
 });
 it('owner hide events preserve rows and publish no retired notifications',async()=>{
  await published('hidden-fixture');
  const events=[{kind:'owner_action',eventKey:'owner-hide',workshopId:'hidden-fixture',workId,payload:{action:'hide',ownerGeneration:1,protectedJoinCutoffSeq:4}},{kind:'appeal_submitted',eventKey:'retired-appeal',workshopId:'hidden-fixture',workId,payload:{}},{kind:'release_committed',eventKey:'retired-commit',workshopId:'hidden-fixture',workId,payload:{decision:'approved',version:50}}];
  await applyWorkshopEvents(env,events);
  expect((await env.DB.prepare('SELECT owner_state,version_no FROM workshops WHERE id=?').bind('hidden-fixture').first())).toMatchObject({owner_state:'hidden_by_owner',version_no:1});
  expect((await env.DB.prepare("SELECT COUNT(*) n FROM community_notifications WHERE kind LIKE 'workshop_%'").first<{n:number}>())?.n).toBe(0);
  expect((await env.DB.prepare('SELECT COUNT(*) n FROM workshop_appeals').first<{n:number}>())?.n).toBe(0);
 });
});
