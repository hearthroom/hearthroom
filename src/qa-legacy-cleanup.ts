/** The only ordinary identity this private cleanup may retire is legacy 279. */
import {HttpError,type Env} from './types';

const privateTables=['card_saves','member_conversations','rating_drafts','checkin_prompts','member_update_state','suki_states','analytics_milestones','community_preferences','community_appearance_preferences','community_discord_appearance','community_appearance_media','community_case_jobs','discord_link_attempts','community_awards','push_subscriptions','community_notifications','member_favorites','member_follows','card_scores'] as const;
export async function legacyCleanupProof(env:Env){
 const scope=await env.DB.prepare('SELECT member_id FROM legacy_account_fence WHERE public_no=279').first<{member_id:string|null}>();
 if(!scope)throw new HttpError(503,'workflow_pending');
 const statements=[env.DB.prepare("SELECT count(*) AS n FROM account_sessions WHERE provider='harbor' AND external_id='279'"),env.DB.prepare("SELECT count(*) AS n FROM account_credentials WHERE provider='harbor' AND external_id='279'")];
 if(scope.member_id){
  statements.push(env.DB.prepare('SELECT count(*) AS n FROM members WHERE id=?').bind(scope.member_id));
  for(const table of privateTables)statements.push(env.DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE member_id=?`).bind(scope.member_id));
 }
 const rows=await env.DB.batch<{n:number}>(statements);
 if(rows.some(r=>r.results.some(row=>row.n!==0)))throw new HttpError(503,'workflow_pending');
 return {ready:true,sessions:0,credentials:0};
}

export async function cleanupLegacy279(env:Env,requestId:string,digest:string){
 const origin=await env.DB.prepare("SELECT member_id FROM member_identities WHERE provider='harbor' AND external_id='279'").first<{member_id:string}>();
 const connection=await env.DB.prepare("SELECT owner_member_id FROM member_connections WHERE provider='harbor' AND external_id='279'").first<{owner_member_id:string}>();
 const stored=await env.DB.prepare('SELECT member_id,handle FROM legacy_account_fence WHERE public_no=279').first<{member_id:string|null;handle:string|null}>();
 const id=connection?.owner_member_id??origin?.member_id??stored?.member_id??null;
 if(stored?.member_id&&id!==stored.member_id)throw new HttpError(409,'legacy_cleanup_blocked');
 if(connection&&origin&&connection.owner_member_id!==origin.member_id)throw new HttpError(409,'legacy_cleanup_blocked');
 const member=id?await env.DB.prepare('SELECT handle,avatar_key FROM members WHERE id=?').bind(id).first<{handle:string;avatar_key:string}>():null;
 // The fence survives a failed cleanup and the member tombstone. It prevents
 // late callbacks, public aliases and background synchronization from reviving it.
 await env.DB.prepare('INSERT OR IGNORE INTO legacy_account_fence(public_no,member_id,handle,request_id,created_at) VALUES(279,?,?,?,?)').bind(id,member?.handle??stored?.handle??null,requestId,Date.now()).run();
 if(member?.avatar_key)throw new HttpError(409,'legacy_asset_cleanup_required');
 if(id){
  const mixed=await env.DB.prepare(`SELECT 1 FROM member_identities WHERE member_id=? AND (provider<>'harbor' OR external_id<>'279')
   UNION ALL SELECT 1 FROM member_connections WHERE owner_member_id=? AND (provider<>'harbor' OR external_id<>'279') LIMIT 1`).bind(id,id).first();
  if(mixed)throw new HttpError(409,'legacy_cleanup_blocked');
 }
 const scope=id??'';
 // Any public, shared, financial or administrative history requires a separate
 // disposition. This bounded path does not cascade through those records.
 const protectedQueries:[string,unknown[]][]=[
  ["SELECT 1 FROM cards WHERE provider='harbor' AND author_num_id=279 LIMIT 1",[]],
  ['SELECT 1 FROM works WHERE member_id=? LIMIT 1',[scope]],
  ['SELECT 1 FROM hosting_versions WHERE member_id=? LIMIT 1',[scope]],
  ['SELECT 1 FROM comments WHERE member_id=? LIMIT 1',[scope]],
  ['SELECT 1 FROM comment_likes WHERE member_id=? LIMIT 1',[scope]],
  ['SELECT 1 FROM blog_post_likes WHERE member_id=? LIMIT 1',[scope]],
  ['SELECT 1 FROM blog_posts WHERE author_member_id=? LIMIT 1',[scope]],
  ['SELECT 1 FROM share_contents WHERE member_id=? OR recipient_account_no=279 LIMIT 1',[scope]],
  ['SELECT 1 FROM share_evidence WHERE member_id=? LIMIT 1',[scope]],
  ['SELECT 1 FROM card_rewards WHERE member_id=? OR recipient_account_no=279 OR requested_by=? LIMIT 1',[scope,scope]],
  ['SELECT 1 FROM card_reward_topups WHERE requested_by=? LIMIT 1',[scope]],
  ['SELECT 1 FROM share_payouts WHERE requested_by=? LIMIT 1',[scope]],
  ['SELECT 1 FROM registration_packs WHERE member_id=? OR granted_by=? LIMIT 1',[scope,scope]],
  ['SELECT 1 FROM reviewers WHERE member_id=? OR granted_by=? LIMIT 1',[scope,scope]],
  ['SELECT 1 FROM review_agents WHERE member_id=? OR granted_by=? LIMIT 1',[scope,scope]],
  ['SELECT 1 FROM audit_log WHERE actor_member_id=? OR subject_id=? LIMIT 1',[scope,scope]],
  ['SELECT 1 FROM community_badge_audit WHERE member_id=? OR actor=? LIMIT 1',[scope,scope]],
  ['SELECT 1 FROM official_author_audit WHERE member_id=? OR actor_id=? LIMIT 1',[scope,scope]],
  ['SELECT 1 FROM discord_links WHERE member_id=? LIMIT 1',[scope]],
  ['SELECT 1 FROM member_follows WHERE author_id=? AND member_id<>? LIMIT 1',[scope,scope]],
  ['SELECT 1 FROM community_notifications WHERE member_id<>? AND (actor_id=? OR author_id=?) LIMIT 1',[scope,scope,scope]],
  ['SELECT 1 FROM comment_reports WHERE reporter_member_id=? OR resolved_by=? LIMIT 1',[scope,scope]],
  ['SELECT 1 FROM comment_mutes WHERE member_id=? OR by_member_id=? LIMIT 1',[scope,scope]],
  ['SELECT 1 FROM moderation_cases WHERE author_member_id=? OR created_by=? OR resolved_by=? LIMIT 1',[scope,scope,scope]],
  ['SELECT 1 FROM reward_event_outbox WHERE json_extract(body,\'$.accountNo\')=279 OR json_extract(body,\'$.attrs.viewerAccountNo\')=279 LIMIT 1',[]],
  ['SELECT 1 FROM account_auth_attempts WHERE source_session IS NULL LIMIT 1',[]],
  ["SELECT 1 FROM account_auth_revocations WHERE generation NOT IN(SELECT generation FROM account_credentials WHERE provider='harbor' AND external_id='279') LIMIT 1",[]],
 ];
 const results=await env.DB.batch(protectedQueries.map(([sql,args])=>env.DB.prepare(sql).bind(...args)));
 if(results.some(r=>r.results.length))throw new HttpError(409,'legacy_cleanup_blocked');
 const statements:D1PreparedStatement[]=[
  env.DB.prepare("DELETE FROM account_auth_revocations WHERE generation IN(SELECT generation FROM account_credentials WHERE provider='harbor' AND external_id='279')"),
  env.DB.prepare('DELETE FROM account_auth_attempts WHERE source_session IN(SELECT token_hash FROM account_sessions WHERE member_id=?)').bind(scope),
  env.DB.prepare('DELETE FROM account_route_handoffs WHERE source_session IN(SELECT token_hash FROM account_sessions WHERE member_id=?) OR consumed_session IN(SELECT token_hash FROM account_sessions WHERE member_id=?)').bind(scope,scope),
  env.DB.prepare('DELETE FROM account_route_families WHERE token_hash IN(SELECT token_hash FROM account_sessions WHERE member_id=?)').bind(scope),
  env.DB.prepare('DELETE FROM account_sessions WHERE member_id=? OR (provider=\'harbor\' AND external_id=\'279\')').bind(scope),
  env.DB.prepare("DELETE FROM account_credentials WHERE provider='harbor' AND external_id='279'"),
 ];
 // Identifiers below are a fixed source whitelist, never request input.
 for(const table of (id?privateTables:[])){
  statements.push(env.DB.prepare(`DELETE FROM ${table} WHERE member_id=?`).bind(scope));
 }
 statements.push(env.DB.prepare("DELETE FROM member_connections WHERE provider='harbor' AND external_id='279'"));
 statements.push(env.DB.prepare("DELETE FROM member_identities WHERE provider='harbor' AND external_id='279'"));
 statements.push(env.DB.prepare('DELETE FROM members WHERE id=?').bind(scope));
 const proof={ready:true,sessions:0,credentials:0};
 statements.push(env.DB.prepare('INSERT INTO qa_account_operation(request_id,input_hash,result,created_at) VALUES(?,?,?,?)').bind(requestId,digest,JSON.stringify(proof),Date.now()));
 await env.DB.batch(statements);
 const remaining=await env.DB.prepare(`SELECT
  (SELECT count(*) FROM account_sessions WHERE member_id=? OR(provider='harbor' AND external_id='279'))+
  (SELECT count(*) FROM account_credentials WHERE provider='harbor' AND external_id='279')+
  (SELECT count(*) FROM members WHERE id=?) AS n`).bind(scope,scope).first<{n:number}>();
 if(remaining?.n!==0)throw new HttpError(503,'workflow_pending');
 return legacyCleanupProof(env);
}
