import {env} from 'cloudflare:test';
import {beforeEach,afterEach,expect,it} from 'vitest';
import {resetDb,makeMember,restoreUpstream} from './helpers';
import {sweepMilestones} from '../src/community/badges';
import {ensureCardNumber} from '../src/cards';

beforeEach(resetDb);afterEach(restoreUpstream);

it('says only public cards count toward the works badges in every language',async()=>{
 for(const key of ['creator_works_3','creator_works_10','creator_works_30']){
  const d=JSON.parse((await env.DB.prepare('SELECT descriptions FROM community_badge_definitions WHERE key=?').bind(key).first<string>('descriptions'))!);
  expect(Object.keys(d).sort()).toEqual(['en','ja','ko','zh-Hans','zh-Hant']);
  expect(d['zh-Hans']).toContain('私人卡');expect(d.en).toContain('private');
 }
});

it('awards the first approved work from the hourly sweep when the review trigger missed it',async()=>{
 const member=await makeMember(41);
 await env.DB.prepare(`INSERT INTO cards (id,source_role_id,author_num_id,names,summaries,tags,search_text,registered_at,last_synced_at,provider,status)
  VALUES (?,'role-a',41,'{}','{}','[]','',1,1,'harbor','approved')`).bind(await ensureCardNumber(env.DB,'harbor','role-a')).run();
 await sweepMilestones(env);
 expect(await env.DB.prepare("SELECT source FROM community_awards WHERE member_id=? AND badge='first_work'").bind(member).first('source')).toBe('metric-v1');
});
