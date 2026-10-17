import { requireCommunityAdmin } from './staff';
import { isReviewAgent, memberByHandle, requireMember } from './members';
import { HttpError, type Env } from './types';
import type { Context } from 'hono';

/** Every write checks the application's current upstream owner/admin authority. */
export async function changeOfficialAuthor(c: Context<{Bindings:Env}>, input:unknown) {
 const actor=await requireMember(c);
 if(await isReviewAgent(c.env.DB,actor.id))throw new HttpError(403,'agent_not_allowed');
 await requireCommunityAdmin(c);
 if(!input||typeof input!=='object'||Array.isArray(input))throw new HttpError(400,'official_input');
 const b=input as Record<string,unknown>;
 if(typeof b.handle!=='string'||!/^[a-z]{8}$/.test(b.handle)||typeof b.official!=='boolean'||typeof b.reason!=='string'||!b.reason.trim()||b.reason.length>300||/[\u0000-\u001f]/.test(b.reason)||typeof b.requestId!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(b.requestId))throw new HttpError(400,'official_input');
 const member=await memberByHandle(c.env.DB,b.handle);if(!member)throw new HttpError(404,'community_member_missing');
 const payload=JSON.stringify({actor:actor.id,member,official:b.official,reason:b.reason.trim()});
 const existing=async()=>{const old=await c.env.DB.prepare('SELECT payload FROM official_author_audit WHERE request_id=?').bind(b.requestId).first<{payload:string}>();if(old&&old.payload!==payload)throw new HttpError(409,'official_conflict');return !!old;};
 if(!await existing())try{await c.env.DB.batch([
  c.env.DB.prepare('INSERT INTO official_author_audit(request_id,actor_id,member_id,official,reason,payload,created_at) VALUES(?,?,?,?,?,?,?)').bind(b.requestId,actor.id,member,Number(b.official),b.reason.trim(),payload,Date.now()),
  c.env.DB.prepare('UPDATE members SET is_official=? WHERE id=?').bind(Number(b.official),member),
 ]);}catch(error){if(!await existing())throw error;}
 // Return current durable state: replaying an old grant must not undo a later revocation.
 const current=await c.env.DB.prepare('SELECT is_official FROM members WHERE id=?').bind(member).first<{is_official:number}>();
 return {handle:b.handle,official:current?.is_official===1};
}
