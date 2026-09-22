import { CARD_NUMBER, ensureCardNumber, getCard, getPublicCard, previewCard } from './cards';
import { configuredProviders, type ProviderId } from './providers';
import { upstream } from './upstream';
import { HttpError, type Env } from './types';

/** Resolve a work independently of the account used to visit it. No credentials
 * are forwarded while discovering hosts; providers remain the access authority. */
export async function cardLink(env: Env, id: string, preferred: ProviderId) {
  let row = await getPublicCard(env.DB, id, preferred);
  const numbered = CARD_NUMBER.test(id)
    ? await env.DB.prepare('SELECT num,provider,source_role_id FROM card_numbers WHERE num=?').bind(Number(id)).first<{num:number;provider:ProviderId;source_role_id:string}>()
    : null;
  if (CARD_NUMBER.test(id) && !numbered) return {row:null,work:null,source:null};
  const lookupId = numbered?.source_role_id ?? id;
  const lookupProvider = numbered?.provider ?? preferred;
  type Work = {id:string;source_provider:ProviderId;source_role_id:string};
  // A registered global ID/number is authoritative, even if an unrelated work
  // happens to use the same string. Only look up that card's own work.
  const work = row || numbered
    ? await env.DB.prepare('SELECT id,source_provider,source_role_id FROM works WHERE source_provider=? AND source_role_id=?')
      .bind(row?.provider ?? numbered!.provider,row?.source_role_id ?? numbered!.source_role_id).first<Work>()
    : await env.DB.prepare(`SELECT id,source_provider,source_role_id FROM works
      WHERE id=? OR (source_provider=? AND source_role_id=?) OR id IN
        (SELECT work_id FROM work_copies WHERE provider=? AND role_id=?)
      ORDER BY (id=?) DESC LIMIT 1`).bind(lookupId,lookupProvider,lookupId,lookupProvider,lookupId,lookupId).first<Work>();
  // Copy links can arrive without a provider hint too.
  const neutralWork = work ?? (row || numbered ? null : await env.DB.prepare(`SELECT id,source_provider,source_role_id FROM works
    WHERE source_role_id=? OR id IN (SELECT work_id FROM work_copies WHERE role_id=?)
    ORDER BY id LIMIT 2`).bind(id,id).all<Work>()
    .then(r => r.results.length === 1 ? r.results[0] : null));
  if (!row && neutralWork) row = await getCard(env.DB, neutralWork.source_role_id, neutralWork.source_provider);
  if (row?.public_blocked) throw new HttpError(404, 'card not found');
  return {
    row,
    work: neutralWork,
    source: row ? {provider:row.provider as ProviderId,roleId:row.source_role_id}
      : neutralWork ? {provider:neutralWork.source_provider,roleId:neutralWork.source_role_id}
      : numbered ? {provider:numbered.provider,roleId:numbered.source_role_id} : null,
  };
}

export async function linkPreview(env:Env,id:string,link:Awaited<ReturnType<typeof cardLink>>,lang:string) {
  if (!link.source && CARD_NUMBER.test(id)) return null;
  const candidates = link.source ? [link.source] : configuredProviders(env).map(provider=>({provider,roleId:id}));
  const results = await Promise.all(candidates.map(async source => {
    try { return {source,role:await upstream.fetchRole(env,source.roleId,source.provider)}; }
    catch (error) {
      if (error instanceof HttpError && error.status < 500) return null;
      return {error};
    }
  }));
  const found=results.filter((r): r is NonNullable<typeof r> & {source:typeof candidates[number];role:Awaited<ReturnType<typeof upstream.fetchRole>>} => !!r && 'role' in r);
  if (found.length > 1) throw new HttpError(409,'card_provider_ambiguous');
  if (!found.length) {
    if (results.some(r=>r && 'error' in r)) throw new HttpError(502,'card_host_unavailable');
    return null;
  }
  const {source,role}=found[0];
  // A withdrawn card has no cards row, but its moderation decision persists.
  const blocked = !link.row && await env.DB.prepare('SELECT public_blocked FROM moderation_state WHERE provider=? AND source_role_id=?')
    .bind(source.provider,source.roleId).first<{public_blocked:number}>();
  if (blocked && blocked.public_blocked) throw new HttpError(404,'card not found');
  const num = link.row?.num ?? await ensureCardNumber(env.DB,source.provider,source.roleId);
  return {
    ...previewCard(role,lang,source.provider,num),
    sourceRoleId:source.roleId,
    ...(link.row ? {num:link.row.num,status:link.row.status,nsfw:link.row.nsfw===1} : {}),
  };
}
