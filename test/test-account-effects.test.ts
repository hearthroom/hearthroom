import { env } from 'cloudflare:test';
import { beforeEach,expect,it } from 'vitest';
import { resetDb } from './helpers';
beforeEach(resetDb);
async function members(){await env.DB.batch([
 env.DB.prepare("INSERT INTO members(id,handle,created_at,account_class,test_generation) VALUES('qa','aaaaaaaa',1,'test',1)"),
 env.DB.prepare("INSERT INTO members(id,handle,created_at) VALUES('normal','bbbbbbbb',1)"),
]);}
it('rejects test interactions with a normal author before follower triggers run',async()=>{
 await members();
 await expect(env.DB.prepare("INSERT INTO member_follows(member_id,author_id,created_at) VALUES('qa','normal',1)").run()).rejects.toThrow();
 expect((await env.DB.prepare('SELECT count(*) AS n FROM member_follows').first())?.n).toBe(0);
 await env.DB.prepare("INSERT INTO member_follows(member_id,author_id,created_at) VALUES('normal','normal',1)").run();
 expect((await env.DB.prepare('SELECT count(*) AS n FROM member_follows').first())?.n).toBe(1);
});
it('suppresses test recipient, actor and author notification rows',async()=>{
 await members();
 for(const [id,member,actor,author] of [['r','qa','normal',null],['a','normal','qa',null],['u','normal',null,'qa']] as const){
  await env.DB.prepare("INSERT INTO community_notifications(id,event_key,member_id,kind,path,created_at,actor_id,author_id) VALUES(?,?,?,'comment_reply','/',1,?,?)").bind(id,id,member,actor,author).run();
 }
 expect((await env.DB.prepare('SELECT count(*) AS n FROM community_notifications').first())?.n).toBe(0);
 await env.DB.prepare("INSERT INTO community_notifications(id,event_key,member_id,kind,path,created_at) VALUES('ok','ok','normal','comment_reply','/',1)").run();
 expect((await env.DB.prepare('SELECT count(*) AS n FROM community_notifications').first())?.n).toBe(1);
});

it('does not queue reward progress from a test actor',async()=>{
 await members();
 await env.DB.prepare("INSERT INTO member_identities(provider,external_id,member_id,linked_at) VALUES('harbor','80001','qa',1)").run();
 const {enqueueRewardEvent}=await import('../src/reward-events');
 expect(await enqueueRewardEvent(env.DB,{eventId:'test-event',type:'share_link_created',accountNo:80001,occurredAt:new Date().toISOString(),attrs:{}},Date.now())).toBe(false);
 expect((await env.DB.prepare('SELECT count(*) AS n FROM reward_event_outbox').first())?.n).toBe(0);
});
