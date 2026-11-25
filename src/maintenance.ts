import { MAINTENANCE_KEY, maintenanceOff, parseMaintenance, type MaintenanceState } from '../shared/maintenance';
import { allowedHarborProxyRequest } from './harbor-api-proxy';
import { isSandboxHost } from './sandbox';
import { bumpOp } from './ops-metrics';
import type { Env } from './types';
export { MAINTENANCE_KEY };

class InvalidMaintenanceState extends Error {}
export const PUBLIC_CANDIDATE_PROJECTION_KEY = 'public_candidate_projection_cache';

function parseStoredMaintenance(value?: string | null): MaintenanceState {
  if (value === null || value === undefined) return maintenanceOff();
  try {
    return parseMaintenance(JSON.parse(value));
  } catch (cause) {
    throw new InvalidMaintenanceState('Invalid maintenance configuration', {cause});
  }
}

/** Scheduled and library paths read maintenance directly from the primary. */
export async function readMaintenance(db: D1Database): Promise<MaintenanceState> {
  const primary=typeof db.withSession==='function' ? db.withSession('first-primary') : db;
  const row=await primary.prepare('SELECT value FROM community_settings WHERE key=?').bind(MAINTENANCE_KEY).first<{value:string}>();
  return parseStoredMaintenance(row?.value);
}

async function readAdmission(db: D1Database) {
  const primary = typeof db.withSession === 'function' ? db.withSession('first-primary') : db;
  const row = await primary.prepare(`SELECT (SELECT value FROM community_settings WHERE key=?) AS value,
    (SELECT value FROM community_settings WHERE key=?) AS public_projection`)
    .bind(MAINTENANCE_KEY, PUBLIC_CANDIDATE_PROJECTION_KEY)
    .first<{ value: string | null; public_projection: string | null }>();
  return { maintenance: parseStoredMaintenance(row?.value), publicProjection: row?.public_projection === 'true' };
}
// 2026-11-24 D1 過載止血：每個 API 請求都先讀一次主庫的維護開關（一小時近十萬次）。同一個 Worker 實例 5 秒內共用一份；
// 開關切換最多晚 5 秒生效。排程與資源庫照舊直接讀（readMaintenance）。
let maintenanceMemo:{at:number;value:ReturnType<typeof readAdmission>}|null=null;
export const MAINTENANCE_MEMO_MS=5_000;
export function resetMaintenanceMemo(){maintenanceMemo=null;}
function cachedAdmission(db:D1Database):ReturnType<typeof readAdmission>{
 const now=Date.now();
 if(maintenanceMemo&&now-maintenanceMemo.at<MAINTENANCE_MEMO_MS)return maintenanceMemo.value;
 const value=readAdmission(db);
 maintenanceMemo={at:now,value};
 value.catch(()=>{if(maintenanceMemo?.value===value)maintenanceMemo=null;});
 return value;
}
const STATIC = /\.(?:js|mjs|css|png|webp|jpe?g|gif|svg|ico|woff2?|ttf|map|webmanifest|txt|xml|atom)$/i;
const noStore={'Cache-Control':'no-store','Retry-After':'15'};
/** Runs before sessions, identity reads, HTML metadata, proxy upgrades and Provider calls. */
export async function maintenanceResponse(
  request:Request,env:Env,ctx:ExecutionContext, controls?: { publicProjection: boolean },
):Promise<Response|null> {
  const url=new URL(request.url),path=url.pathname;
  // Preserve local proxy refusals without a DB/Provider call.
  if ((path==='/hh-api'||path.startsWith('/hh-api/'))&&!allowedHarborProxyRequest(request))return null;
  const sandboxAsset=isSandboxHost(url.host)&&/^\/(?:assets|mascot)\//.test(path);
  const browserAuth=/^\/auth(?:\/|$)/.test(path)&&['GET','HEAD'].includes(request.method)&&request.headers.get('Accept')?.includes('text/html');
  const api=/^\/(?:v1|hh-api|auth)(?:\/|$)/.test(path)&&!browserAuth;
  if(path==='/metrics'||path.startsWith('/internal/')||(!api&&!sandboxAsset&&STATIC.test(path)))return null;
  const status=path==='/v1/maintenance';
  const document=['GET','HEAD'].includes(request.method)&&(!path.split('/').pop()?.includes('.')||path.endsWith('.html')||request.headers.get('Accept')?.includes('text/html'));
  if(!status&&!api&&!document&&!sandboxAsset)return null;
  let state:MaintenanceState;
  try {
    const admission = await cachedAdmission(env.DB);
    state = admission.maintenance;
    if (controls) controls.publicProjection = admission.publicProjection;
  }
  catch (error) {
    ctx.waitUntil(bumpOp(env.DB,'maintenance','status','error'));
    // Let the requested route handle its own dependencies. Pollers still need
    // an explicit error so they do not dismiss an active maintenance notice.
    if (!status && !(error instanceof InvalidMaintenanceState)) return null;
    return Response.json({error:'maintenance_status_unavailable'}, {status:503,headers:noStore});
  }
  if(status)return Response.json(state,{headers:{'Cache-Control':'no-store','Access-Control-Allow-Origin':'*'}});
  if(!state.enabled)return null;
  // Only while active: the isolated maintenance shell needs its public SPA assets.
  if(sandboxAsset)return env.ASSETS.fetch(request);
  ctx.waitUntil(bumpOp(env.DB,'maintenance',api?'api':'page','blocked'));
  if(api)return Response.json({error:'site_maintenance',maintenance:state},{status:503,headers:noStore});
  const shell=await env.ASSETS.fetch(new Request(new URL('/',url),{headers:{Accept:'text/html'}}));
  const headers=new Headers(shell.headers);
  for(const key of ['ETag','Last-Modified','Content-Length'])headers.delete(key);
  for(const [key,value] of Object.entries(noStore))headers.set(key,value);
  headers.set('X-Robots-Tag','noindex');
  // A direct sandbox shell resumes its original host document instead of a site route.
  const content=(await shell.text()).replace('<head>','<head><meta name="hearthroom-maintenance-shell" content="'+(isSandboxHost(url.host)||path.startsWith('/sandbox/')?'sandbox':'site')+'">');
  return new Response(request.method==='HEAD'?null:content,{status:503,headers});
}
